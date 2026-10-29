type BrowserStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem">;

/** Copy existing same-origin preferences and unsaved drafts into the current namespace. */
export function migrateBrandStorage(storage: BrowserStorage) {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i),
    );
    for (const key of keys) {
      if (!key || key.startsWith("dirrio.") || key.startsWith("dirrio:"))
        continue;
      const suffix = /^[a-z][a-z0-9_-]*([.:].+)$/.exec(key)?.[1];
      if (
        !suffix ||
        !/^(?:\.locale$|\.sidebarCollapsed$|\.admin\.sidebar\.collapsed$|\.workspace:.+|\.scriptDraft\..+|\.genjutsuPrompt\..+|\.timelineRecovery\..+|:workspace-layout:2$)/.test(
          suffix,
        )
      )
        continue;
      const target = `dirrio${suffix}`;
      const value = storage.getItem(key);
      if (value !== null && storage.getItem(target) === null)
        storage.setItem(target, value);
    }
  } catch {
    // Storage is optional in private/embedded contexts. Never erase recovery drafts.
  }
}
