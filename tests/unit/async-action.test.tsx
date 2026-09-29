import { describe, expect, it } from "vitest";

import {
  asyncActionReducer,
  initialAsyncActionState,
} from "@/components/ui/async-action";

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
