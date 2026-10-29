import { useEffect, useState } from "react";
/** Public display state only; verified account creation always checks the backend policy. */
export function useRegistrationPolicy() {
  const [requireApproval, setRequireApproval] = useState(true);
  useEffect(() => {
    let alive = true;
    let pending: AbortController | undefined;
    async function refresh() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(
          `${(import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "")}/registration-policy`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = response.ok ? await response.json() : null;
        if (alive) setRequireApproval(body?.requireApproval !== false);
      } catch {
        if (alive) setRequireApproval(true);
      } finally {
        window.clearTimeout(timeout);
        pending = undefined;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      pending?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return requireApproval;
}
