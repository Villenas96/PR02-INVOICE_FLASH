import { describe, expect, it } from "vitest";

import { requestSafeSingleton } from "@/lib/request-safe-singleton";

interface Instance {
  id: number;
  ready: Promise<void>;
}

function factory(readiness: Array<Promise<void>>) {
  let created = 0;
  const create = (): Instance => {
    const ready = readiness[created] ?? Promise.resolve();
    created += 1;
    return { id: created, ready };
  };
  return { create, count: () => created };
}

describe("requestSafeSingleton", () => {
  it("does not share an instance whose initialisation never settles", async () => {
    const neverSettles = new Promise<void>(() => {});
    const { create, count } = factory([neverSettles, Promise.resolve()]);
    const get = requestSafeSingleton(create, (instance) => instance.ready);

    // First request ends (or is cancelled) before its init finishes.
    void get();
    const second = await get();

    expect(second.id).toBe(2);
    expect(count()).toBe(2);
  });

  it("shares the first instance that finished initialising", async () => {
    const { create, count } = factory([Promise.resolve()]);
    const get = requestSafeSingleton(create, (instance) => instance.ready);

    const first = await get();
    const second = await get();

    expect(second).toBe(first);
    expect(count()).toBe(1);
  });

  it("does not share an instance whose initialisation failed", async () => {
    const { create, count } = factory([
      Promise.reject(new Error("db down")),
      Promise.resolve(),
    ]);
    const get = requestSafeSingleton(create, (instance) => instance.ready);

    await expect(get()).rejects.toThrow("db down");
    const recovered = await get();

    expect(recovered.id).toBe(2);
    expect(count()).toBe(2);
  });
});
