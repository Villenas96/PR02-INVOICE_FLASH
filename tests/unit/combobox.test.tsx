// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Combobox, type ComboboxPage } from "@/components/ui/combobox";

interface Client {
  id: string;
  name: string;
  taxId: string;
}

const clients: Client[] = [
  { id: "1", name: "Ana Ibáñez", taxId: "12345678Z" },
  { id: "2", name: "Bodegas Norte", taxId: "B12345678" },
  { id: "3", name: "Carpintería Sur", taxId: "B87654321" },
];

beforeAll(() => {
  // jsdom lacks the layout APIs Radix Popover and cmdk rely on.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  cleanup();
});

function Harness(props: {
  initial?: Client | null;
  options?: Client[];
  loadOptions?: (
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<ComboboxPage<Client>>;
  onCreate?: (query: string) => void;
  onChange?: (value: Client | null) => void;
}) {
  const [value, setValue] = useState<Client | null>(props.initial ?? null);
  return (
    <div>
      <span id="client-label">Cliente</span>
      <Combobox<Client>
        aria-labelledby="client-label"
        value={value}
        onChange={(next) => {
          setValue(next);
          props.onChange?.(next);
        }}
        getKey={(client) => client.id}
        getLabel={(client) => client.name}
        getDescription={(client) => client.taxId}
        placeholder="Selecciona un cliente"
        searchPlaceholder="Buscar cliente"
        options={props.options}
        loadOptions={props.loadOptions}
        onCreate={props.onCreate}
      />
    </div>
  );
}

describe("Combobox", () => {
  it("shows the selected object's label and description, not its id", () => {
    render(<Harness initial={clients[1]} options={clients} />);
    const trigger = screen.getByRole("combobox", { name: /cliente/i });
    expect(trigger).toHaveTextContent("Bodegas Norte");
    expect(trigger).toHaveTextContent("B12345678");
    expect(trigger).not.toHaveTextContent(/^2$/);
  });

  it("filters local options and selects with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness options={clients} onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: /cliente/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("carpin");
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /Ana/ })).toBeNull();
    });
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(clients[2]);
    expect(trigger).toHaveTextContent("Carpintería Sur");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("debounces remote searches and only queries the final text", async () => {
    const user = userEvent.setup();
    const loadOptions = vi.fn(
      async (query: string): Promise<ComboboxPage<Client>> => ({
        items: clients.filter((client) =>
          client.name.toLowerCase().includes(query.toLowerCase()),
        ),
        nextCursor: null,
      }),
    );
    render(<Harness loadOptions={loadOptions} />);

    await user.click(screen.getByRole("combobox", { name: /cliente/i }));
    await user.keyboard("bod");

    await waitFor(() => {
      expect(loadOptions).toHaveBeenLastCalledWith(
        "bod",
        null,
        expect.any(AbortSignal),
      );
    });
    expect(
      await screen.findByRole("option", { name: /Bodegas Norte/ }),
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: /Ana/ })).toBeNull();
    const queries = loadOptions.mock.calls.map(([query]) => query);
    expect(queries).not.toContain("b");
    expect(queries).not.toContain("bo");
    expect(queries.at(-1)).toBe("bod");
  });

  it("loads the next page with the cursor", async () => {
    const user = userEvent.setup();
    const loadOptions = vi.fn(
      async (
        _query: string,
        cursor: string | null,
      ): Promise<ComboboxPage<Client>> =>
        cursor
          ? { items: [clients[2] as Client], nextCursor: null }
          : { items: clients.slice(0, 2), nextCursor: "page-2" },
    );
    render(<Harness loadOptions={loadOptions} />);

    await user.click(screen.getByRole("combobox", { name: /cliente/i }));
    await user.click(
      await screen.findByRole("option", { name: /Mostrar más/ }),
    );

    expect(
      await screen.findByRole("option", { name: /Carpintería Sur/ }),
    ).toBeVisible();
    expect(loadOptions).toHaveBeenLastCalledWith(
      "",
      "page-2",
      expect.any(AbortSignal),
    );
  });

  it("offers to create the typed text", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Harness options={clients} onCreate={onCreate} />);

    await user.click(screen.getByRole("combobox", { name: /cliente/i }));
    await user.keyboard("Nueva Empresa");
    await user.click(
      await screen.findByRole("option", { name: /Crear «Nueva Empresa»/ }),
    );

    expect(onCreate).toHaveBeenCalledWith("Nueva Empresa");
  });
});
