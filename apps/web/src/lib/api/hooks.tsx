/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP facade retains the independently typed operation contracts at its callers. */
import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ApiClient } from "./client";
export { useConvexAuth } from "convex/react";
const Context = createContext<ApiClient | null>(null);
export function ApiProvider({ children }: { children: ReactNode }) {
  const token = useAuthToken();
  const client = useMemo(
    () =>
      new ApiClient(
        import.meta.env.VITE_API_URL ?? "http://localhost:3001",
        token,
      ),
    [token],
  );
  useEffect(() => {
    clearTimeout(client.disposalTimer);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void client.poll();
    }, 10_000);
    const focus = () => {
      for (const entry of client.queries.values())
        if (entry.listeners.size) void client.load(entry);
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      client.disposalTimer = setTimeout(() => client.close(), 0);
    };
  }, [client]);
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
function useClient() {
  const client = useContext(Context);
  if (!client) throw new Error("API hooks require ApiProvider");
  return client;
}
function useApiQuery(
  reference: FunctionReference<any>,
  args: Record<string, unknown> | "skip" = {},
) {
  const client = useClient(),
    name = getFunctionName(reference);
  const entry = args === "skip" ? null : client.entry(name, args);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry || !client.token) return () => {};
      entry.listeners.add(listener);
      void client.load(entry);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [client, entry],
  );
  useSyncExternalStore(
    subscribe,
    () => entry?.snapshot ?? 0,
    () => 0,
  );
  if (entry?.error) throw entry.error;
  return client.token ? entry?.data : undefined;
}
function useApiWrite(reference: FunctionReference<any>) {
  const client = useClient(),
    name = getFunctionName(reference);
  return useCallback(
    async (args: Record<string, unknown> = {}) => {
      try {
        return await client.call(name, args, name === "copilot:runTurn");
      } finally {
        await client.invalidate();
      }
    },
    [client, name],
  );
}
/** Typed migration facade: all product reads/writes use HTTP; only auth uses Convex React. */
export const useQuery = useApiQuery as typeof import("convex/react").useQuery;
export const useMutation =
  useApiWrite as typeof import("convex/react").useMutation;
export const useAction = useApiWrite as typeof import("convex/react").useAction;
