"use client";

import { ChevronDownIcon, PlusIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { documentTypeLabel } from "@/lib/documents/labels";
import type { NavItem, Navigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function isActive(item: NavItem, pathname: string, type: string | null) {
  const [path, query] = item.href.split("?");
  if (query) {
    return pathname === path && `type=${type}` === query;
  }
  if (path === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Header navigation built by `buildNavigation` (FR-057–FR-060). */
export function AppNav({ navigation }: { navigation: Navigation }) {
  const pathname = usePathname();
  const type = useSearchParams().get("type");

  return (
    <nav
      className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 pb-3 sm:px-6"
      aria-label="Principal"
    >
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {navigation.primary.map((item) => {
          const active = isActive(item, pathname, type);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-muted hover:text-foreground",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        {navigation.more.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                Más
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {navigation.more.map((item) => (
                <DropdownMenuItem key={item.key} asChild>
                  <Link href={item.href}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {navigation.upgrade ? (
          <Link
            href={navigation.upgrade.href}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SparklesIcon aria-hidden="true" className="size-4" />
            {navigation.upgrade.label}
          </Link>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <PlusIcon aria-hidden="true" />
              Nuevo
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {navigation.newDocumentTypes.map((documentType) => (
              <DropdownMenuItem key={documentType} asChild>
                <Link href={`/documents/new?type=${documentType}`}>
                  {documentTypeLabel(documentType)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
