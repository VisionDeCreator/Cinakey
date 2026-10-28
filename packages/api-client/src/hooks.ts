/* eslint-disable @typescript-eslint/no-explicit-any -- Typed HTTP operation facade. */
import { useCallback, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useClient } from "./context";
export { useConvexAuth } from "convex/react";
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
        return await client.call(name, args);
      } finally {
        if (
          !/^(timelineVersions:getContent|workspace:(?:script|loadStaging|stagingHistory)|storage:storeJson)$/.test(
            name,
          )
        )
          await client.invalidate();
      }
    },
    [client, name],
  );
}
/** Typed HTTP facade: all product reads/writes use HTTP; only auth uses Convex React. */
export const useQuery = useApiQuery as typeof import("convex/react").useQuery;
export const useMutation =
  useApiWrite as typeof import("convex/react").useMutation;
export const useAction = useApiWrite as typeof import("convex/react").useAction;
