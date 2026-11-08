"use client";

import { useRouter } from "next/navigation";
import { useCallback, useReducer, useRef } from "react";

export type AsyncActionStatus = "idle" | "loading" | "success" | "error";

export interface AsyncActionState<T> {
  status: AsyncActionStatus;
  data?: T;
  error?: string;
  isLoading: boolean;
  isOptimistic: boolean;
}

type AsyncActionEvent<T> =
  | { type: "start"; optimisticData?: T }
  | { type: "success"; data: T }
  | { type: "error"; message: string };

export function initialAsyncActionState<T>(): AsyncActionState<T> {
  return {
    status: "idle",
    isLoading: false,
    isOptimistic: false,
  };
}

export function asyncActionReducer<T>(
  _state: AsyncActionState<T>,
  event: AsyncActionEvent<T>,
): AsyncActionState<T> {
  switch (event.type) {
    case "start":
      return {
        status: "loading",
        data: event.optimisticData,
        isLoading: true,
        isOptimistic: event.optimisticData !== undefined,
      };
    case "success":
      return {
        status: "success",
        data: event.data,
        isLoading: false,
        isOptimistic: false,
      };
    case "error":
      return {
        status: "error",
        error: event.message,
        isLoading: false,
        isOptimistic: false,
      };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No se ha podido completar la acción. Inténtalo de nuevo.";
}

/**
 * Shared feedback state for mutations. Dispatching `start` happens before the
 * promise is awaited, giving every control an immediate visible loading or
 * optimistic state. A newer action always wins over a delayed older response.
 */
export function useAsyncAction<T>() {
  const [state, dispatch] = useReducer(
    asyncActionReducer<T>,
    undefined,
    initialAsyncActionState<T>,
  );
  const latestAction = useRef(0);

  const run = useCallback(
    async (
      action: () => Promise<T>,
      options: { optimisticData?: T } = {},
    ): Promise<T | undefined> => {
      const actionId = ++latestAction.current;
      dispatch({ type: "start", optimisticData: options.optimisticData });

      try {
        const data = await action();
        if (latestAction.current === actionId) {
          dispatch({ type: "success", data });
        }
        return data;
      } catch (error) {
        if (latestAction.current === actionId) {
          dispatch({ type: "error", message: errorMessage(error) });
        }
        return undefined;
      }
    },
    [],
  );

  return { ...state, run };
}

export interface MutationOptions {
  /** Refresh the server-rendered tree after success (default `true`). */
  refresh?: boolean;
}

/**
 * Single pattern for client mutations (specs/002 research R17): same feedback
 * state as `useAsyncAction`, plus `router.refresh()` after every successful
 * mutation so server-rendered data (fiscal-data banner, quota counters, plan,
 * navigation) updates without reloading the page. Opt out per hook or per
 * call with `{ refresh: false }`.
 */
export function useMutation<T>(defaults: MutationOptions = {}) {
  const router = useRouter();
  const action = useAsyncAction<T>();
  const { run: runAction } = action;
  const defaultRefresh = defaults.refresh ?? true;

  const run = useCallback(
    async (
      mutation: () => Promise<T>,
      options: { optimisticData?: T } & MutationOptions = {},
    ): Promise<T | undefined> => {
      let succeeded = false;
      const result = await runAction(
        async () => {
          const data = await mutation();
          succeeded = true;
          return data;
        },
        { optimisticData: options.optimisticData },
      );
      if (succeeded && (options.refresh ?? defaultRefresh)) {
        router.refresh();
      }
      return result;
    },
    [runAction, router, defaultRefresh],
  );

  return { ...action, run };
}
