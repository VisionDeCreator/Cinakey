import { useMemo, useEffect, type ReactNode } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { ApiClient } from "./client";
import { Context } from "./context";
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
