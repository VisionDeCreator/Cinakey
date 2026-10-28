import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatUsd,
  getLocale,
  I18nText,
  LanguageSelector,
  languages,
  localeStorageKey,
  resolveLocale,
  setLocale,
  t,
  tn,
  useLocale,
} from "@cinakey/ui/i18n";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  setLocale("en");
});
afterEach(() => {
  act(() => setLocale("en"));
  vi.restoreAllMocks();
});

describe("shared web/admin localization", () => {
  it("normalizes browser languages and rejects unsupported preferences", () => {
    expect(resolveLocale("fr-CA")).toBe("fr");
    expect(resolveLocale("ko-KR")).toBe("ko");
    expect(resolveLocale("zh-Hans-CN")).toBe("zh");
    expect(resolveLocale("de-DE")).toBeUndefined();
    expect(resolveLocale(null)).toBeUndefined();
  });

  it.each(languages.filter(({ code }) => code !== "en"))(
    "renders translated UI in $name",
    ({ code }) => {
      setLocale(code);
      render(<I18nText text="Save changes" />);
      expect(screen.getByText(t("Save changes"))).toBeInTheDocument();
      expect(t("Save changes")).not.toBe("Save changes");
      expect(document.documentElement.lang).toBe(
        code === "zh" ? "zh-Hans" : code,
      );
    },
  );

  it("changes language immediately, persists it, and retains an unsaved form", () => {
    function Form() {
      useLocale();
      return (
        <>
          <LanguageSelector />
          <label>
            {t("Project name")}
            <input defaultValue="" />
          </label>
        </>
      );
    }
    render(<Form />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "My unfinished script" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "한국어" }));
    expect(getLocale()).toBe("ko");
    expect(window.localStorage.getItem(localeStorageKey)).toBe("ko");
    expect(screen.getByRole("textbox", { name: t("Project name") })).toBe(
      input,
    );
    expect(input).toHaveValue("My unfinished script");
  });

  it("syncs other tabs and remains usable when storage is blocked", () => {
    render(<LanguageSelector />);
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: localeStorageKey, newValue: "ja" }),
      ),
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("日本語");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(() => act(() => setLocale("es"))).not.toThrow();
    expect(getLocale()).toBe("es");
  });

  it("falls back to English and interpolates values without interpreting HTML", () => {
    setLocale("fr");
    expect(t("Unknown UI key")).toBe("Unknown UI key");
    expect(t("constructor")).toBe("constructor");
    expect(t("Untranslated {count}", { count: 3 })).toBe("Untranslated 3");
    const value = '<img src=x onerror="alert(1)">';
    render(<p>{t("View {0}", { 0: value })}</p>);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp("<img"))).toBeInTheDocument();
  });

  it("uses locale plural rules and preserves micro-USD precision", () => {
    expect(tn("one:{count}", "other:{count}", 1)).toBe("one:1");
    setLocale("fr");
    expect(tn("one:{count}", "other:{count}", 0)).toBe("one:0");
    expect(formatUsd(1_234_567)).toContain("1,234567");
    setLocale("en");
    expect(formatUsd(1_234_567)).toBe("$1.234567");
    expect(formatUsd(1_000_000)).toBe("$1.00");
  });
});
