"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type ComboboxLoader<T> = (
  query: string,
  cursor: string | null,
  signal: AbortSignal,
) => Promise<ComboboxPage<T>>;

export interface ComboboxProps<T> {
  /** Selected object (not just its id) so its label survives any search. */
  value: T | null;
  onChange(value: T | null): void;
  getKey(item: T): string;
  getLabel(item: T): string;
  /** Secondary text, e.g. the client's NIF. */
  getDescription?(item: T): string | null | undefined;
  /** Local mode: short, bounded lists filtered in the browser. */
  options?: T[];
  /** Remote mode: server search, debounced, cursor-paginated. */
  loadOptions?: ComboboxLoader<T>;
  /** Shows a «Crear «texto»» option that hands the typed text over. */
  onCreate?(query: string): void;
  /** Adds an option that clears the selection (e.g. «Ninguno»). */
  clearLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

export const COMBOBOX_DEBOUNCE_MS = 250;

// Muted text must keep 4.5:1 contrast on the highlighted option background.
const MUTED_OPTION_TEXT =
  "text-muted-foreground group-data-[selected=true]/command-item:text-accent-foreground";

const CREATE_VALUE_PREFIX = "__create__";
const CLEAR_VALUE = "__clear__";
const MORE_VALUE = "__more__";

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useRemoteOptions<T>(
  loadOptions: ComboboxLoader<T> | undefined,
  open: boolean,
  query: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!loadOptions) {
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(undefined);
      try {
        const page = await loadOptions(query, cursor, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setItems((current) =>
          cursor ? [...current, ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "No se han podido cargar las opciones.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [loadOptions, query],
  );

  useEffect(() => {
    if (open && loadOptions) {
      void load(null);
    }
    return () => controllerRef.current?.abort();
  }, [open, load, loadOptions]);

  return { items, nextCursor, loading, error, loadMore: load };
}

/**
 * Searchable selector (specs/002 research R8, FR-014): ARIA combobox trigger
 * with a cmdk listbox, fully keyboard operable. Remote mode searches on the
 * server with a 250 ms debounce and cursor pagination; local mode filters a
 * short list in the browser.
 */
export function Combobox<T>({
  value,
  onChange,
  getKey,
  getLabel,
  getDescription,
  options,
  loadOptions,
  onCreate,
  clearLabel,
  placeholder = "Selecciona una opción",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Sin resultados.",
  disabled,
  invalid,
  id,
  className,
  ...aria
}: ComboboxProps<T>) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const remote = Boolean(loadOptions);
  const debouncedQuery = useDebouncedValue(query, COMBOBOX_DEBOUNCE_MS);
  const remoteOptions = useRemoteOptions(
    loadOptions,
    open,
    remote ? debouncedQuery : "",
  );
  const items = remote ? remoteOptions.items : (options ?? []);
  const trimmedQuery = query.trim();
  const description = value ? getDescription?.(value) : null;

  function close() {
    setOpen(false);
    setQuery("");
  }

  function select(item: T | null) {
    onChange(item);
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left font-normal",
            className,
          )}
          {...aria}
        >
          {value ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{getLabel(value)}</span>
              {description ? (
                // The trigger gets a muted background on hover/focus;
                // `foreground/70` keeps 4.5:1 there (muted text does not).
                <span className="truncate text-xs text-foreground/70">
                  {description}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="truncate text-foreground/70">{placeholder}</span>
          )}
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
        // The panel is a dialog: it needs a name (axe aria-dialog-name).
        aria-label={searchPlaceholder ?? placeholder ?? "Opciones"}
      >
        <Command shouldFilter={!remote}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList id={listId}>
            {remote && remoteOptions.error ? (
              <p role="alert" className="px-3 py-2 text-sm text-destructive">
                {remoteOptions.error}
              </p>
            ) : null}
            {!remote || !remoteOptions.loading ? (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            ) : null}
            <CommandGroup>
              {clearLabel ? (
                <CommandItem value={CLEAR_VALUE} onSelect={() => select(null)}>
                  <span className={MUTED_OPTION_TEXT}>{clearLabel}</span>
                </CommandItem>
              ) : null}
              {items.map((item) => {
                const key = getKey(item);
                const itemDescription = getDescription?.(item);
                const selected = value ? getKey(value) === key : false;
                return (
                  <CommandItem
                    key={key}
                    value={`${getLabel(item)} ${itemDescription ?? ""} ${key}`}
                    onSelect={() => select(item)}
                    data-checked={selected || undefined}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{getLabel(item)}</span>
                      {itemDescription ? (
                        <span
                          className={cn("truncate text-xs", MUTED_OPTION_TEXT)}
                        >
                          {itemDescription}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <CheckIcon aria-hidden="true" className="ml-auto" />
                    ) : null}
                  </CommandItem>
                );
              })}
              {remote && remoteOptions.nextCursor ? (
                <CommandItem
                  value={MORE_VALUE}
                  disabled={remoteOptions.loading}
                  onSelect={() =>
                    void remoteOptions.loadMore(remoteOptions.nextCursor)
                  }
                >
                  <span className={MUTED_OPTION_TEXT}>
                    {remoteOptions.loading ? "Cargando…" : "Mostrar más"}
                  </span>
                </CommandItem>
              ) : null}
              {onCreate && trimmedQuery ? (
                <CommandItem
                  value={`${CREATE_VALUE_PREFIX} ${trimmedQuery}`}
                  onSelect={() => {
                    onCreate(trimmedQuery);
                    close();
                  }}
                >
                  <PlusIcon aria-hidden="true" />
                  <span>Crear «{trimmedQuery}»</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
          {/* Outside the listbox: role="listbox" may only own options/groups. */}
          {remote && remoteOptions.loading ? (
            <output className="block px-3 py-2 text-sm text-muted-foreground">
              Buscando…
            </output>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
