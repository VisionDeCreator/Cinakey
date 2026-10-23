import { useEffect, useState } from "react";

/** Persist a boolean in localStorage; defaults when missing or unreadable. */
export function useLocalStorageBool(key: string, defaultValue: boolean) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "1" || raw === "true";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // ignore quota / private mode
    }
  }, [key, value]);

  return [value, setValue] as const;
}
