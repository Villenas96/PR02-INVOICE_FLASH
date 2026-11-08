"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationPage {
  data: NotificationItem[];
  next_cursor: string | null;
  unread_count: number;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

/** Header indicator of the user's notices (research R21). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async (limit: number) => {
    try {
      setPage(
        await apiRequest<NotificationPage>(
          `/api/v1/notifications?limit=${limit}`,
        ),
      );
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(10);
  }, [load]);

  async function markRead(item: NotificationItem) {
    if (item.read_at) {
      return;
    }
    setPage((current) =>
      current
        ? {
            ...current,
            unread_count: Math.max(0, current.unread_count - 1),
            data: current.data.map((entry) =>
              entry.id === item.id
                ? { ...entry, read_at: new Date().toISOString() }
                : entry,
            ),
          }
        : current,
    );
    await apiRequest(`/api/v1/notifications/${item.id}/read`, {
      method: "POST",
    }).catch(() => undefined);
  }

  const unread = page?.unread_count ?? 0;
  const label =
    unread > 0
      ? `Avisos: ${unread} sin leer`
      : "Avisos: no tienes avisos sin leer";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void load(10);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className="relative"
        >
          <BellIcon aria-hidden="true" />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">Avisos</h2>
        {error ? (
          <p role="alert" className="px-4 py-6 text-sm text-destructive">
            No se han podido cargar los avisos.
          </p>
        ) : !page || page.data.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No tienes avisos.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {page.data.map((item) => {
              const content = (
                <>
                  <span className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "text-sm",
                        item.read_at ? "font-normal" : "font-semibold",
                      )}
                    >
                      {item.title}
                    </span>
                    {item.read_at ? null : (
                      <span className="sr-only">(sin leer)</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.body}
                  </span>
                  <time
                    dateTime={item.created_at}
                    className="mt-1 block text-xs text-muted-foreground"
                  >
                    {dateFormatter.format(new Date(item.created_at))}
                  </time>
                </>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block px-4 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        void markRead(item);
                        setOpen(false);
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => void markRead(item)}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
