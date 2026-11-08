// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  asyncActionReducer,
  initialAsyncActionState,
  useMutation,
} from "@/components/ui/async-action";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("async action state", () => {
  it("exposes loading and optimistic data before the action completes", () => {
    const state = asyncActionReducer(initialAsyncActionState<string>(), {
      type: "start",
      optimisticData: "Guardado provisionalmente",
    });

    expect(state).toMatchObject({
      status: "loading",
      data: "Guardado provisionalmente",
      isLoading: true,
      isOptimistic: true,
    });
  });

  it("exposes success synchronously when the action resolves", () => {
    const loading = asyncActionReducer(initialAsyncActionState<string>(), {
      type: "start",
    });
    const state = asyncActionReducer(loading, {
      type: "success",
      data: "Guardado",
    });

    expect(state).toEqual({
      status: "success",
      data: "Guardado",
      isLoading: false,
      isOptimistic: false,
    });
  });

  it("exposes an actionable error without retaining optimistic data", () => {
    const loading = asyncActionReducer(initialAsyncActionState<string>(), {
      type: "start",
      optimisticData: "Temporal",
    });
    const state = asyncActionReducer(loading, {
      type: "error",
      message:
        "No se ha podido guardar. Revisa los datos e inténtalo de nuevo.",
    });

    expect(state).toEqual({
      status: "error",
      error: "No se ha podido guardar. Revisa los datos e inténtalo de nuevo.",
      isLoading: false,
      isOptimistic: false,
    });
  });
});

describe("useMutation", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("refreshes the server tree after a successful mutation", async () => {
    const { result } = renderHook(() => useMutation<string>());

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.run(() => Promise.resolve("ok"));
    });

    expect(returned).toBe("ok");
    expect(result.current.status).toBe("success");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes even when the mutation resolves to undefined", async () => {
    const { result } = renderHook(() => useMutation<void>());

    await act(async () => {
      await result.current.run(() => Promise.resolve(undefined));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the mutation fails", async () => {
    const { result } = renderHook(() => useMutation<string>());

    await act(async () => {
      await result.current.run(() =>
        Promise.reject(new Error("No se ha podido guardar.")),
      );
    });

    expect(result.current.error).toBe("No se ha podido guardar.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("honours refresh: false per call and as a default", async () => {
    const { result } = renderHook(() => useMutation<string>());
    await act(async () => {
      await result.current.run(() => Promise.resolve("ok"), {
        refresh: false,
      });
    });
    expect(refresh).not.toHaveBeenCalled();

    const { result: noRefresh } = renderHook(() =>
      useMutation<string>({ refresh: false }),
    );
    await act(async () => {
      await noRefresh.current.run(() => Promise.resolve("ok"));
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
