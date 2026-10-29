import { beforeEach, expect, it } from "vitest";
import { migrateBrandStorage } from "../../../../packages/ui/src/brand-storage";
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
let localStorage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  localStorage = memoryStorage();
});
it("preserves unsaved drafts, locale and workspace preferences from a previous namespace", () => {
  const entries = {
    "previous.scriptDraft.account.project.plain": "unsaved script",
    "previous.genjutsuPrompt.account.project": "unsaved prompt",
    "previous.timelineRecovery.account.project": "saved edit recovery",
    "previous.locale": "ko",
    "previous:workspace-layout:2": "layout",
    "previous.workspace:account": "workspace",
  };
  for (const [key, value] of Object.entries(entries))
    localStorage.setItem(key, value);
  migrateBrandStorage(localStorage);
  for (const [key, value] of Object.entries(entries)) {
    expect(localStorage.getItem(key.replace("previous", "dirrio"))).toBe(value);
    expect(localStorage.getItem(key)).toBe(value);
  }
});
it("preserves current values, ignores unrelated keys and supports unavailable storage", () => {
  localStorage.setItem("previous.locale", "ko");
  localStorage.setItem("dirrio.locale", "fr");
  localStorage.setItem("other.unrelated", "keep");
  migrateBrandStorage(localStorage);
  expect(localStorage.getItem("dirrio.locale")).toBe("fr");
  expect(localStorage.getItem("dirrio.unrelated")).toBeNull();
  expect(() =>
    migrateBrandStorage({
      get length(): number {
        throw new Error("unavailable");
      },
      key: () => null,
      getItem: () => null,
      setItem: () => {},
    }),
  ).not.toThrow();
});
