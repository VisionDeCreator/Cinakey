import { useSyncExternalStore } from "react";

/** Playhead time kept outside React state so playback does not re-render the editor. */
export type TimeStore = {
  get: () => number;
  set: (t: number) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createTimeStore(): TimeStore {
  let time = 0;
  const subs = new Set<() => void>();
  return {
    get: () => time,
    set: (t) => {
      time = t;
      for (const fn of subs) fn();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useTime(store: TimeStore): number {
  return useSyncExternalStore(store.subscribe, store.get);
}
