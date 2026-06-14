/**
 * Tests for theme sync logic
 */
import { describe, it, expect } from "vitest";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";

const VALID_THEMES: Theme[] = ["light", "dark", "system"];

// Lógica pura de validação de tema
function isValidTheme(v: unknown): v is Theme {
  return VALID_THEMES.includes(v as Theme);
}

// Simula o que o banco retorna e valida
function resolveThemeFromDB(dbValue: string | null | undefined): Theme {
  if (dbValue && isValidTheme(dbValue)) return dbValue;
  return "light"; // fallback
}

describe("theme validation", () => {
  it("accepts valid themes", () => {
    expect(isValidTheme("light")).toBe(true);
    expect(isValidTheme("dark")).toBe(true);
    expect(isValidTheme("system")).toBe(true);
  });

  it("rejects invalid themes", () => {
    expect(isValidTheme("blue")).toBe(false);
    expect(isValidTheme("")).toBe(false);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
  });
});

describe("resolveThemeFromDB", () => {
  it("returns db theme when valid", () => {
    expect(resolveThemeFromDB("dark")).toBe("dark");
    expect(resolveThemeFromDB("system")).toBe("system");
  });

  it("falls back to light when db value is null", () => {
    expect(resolveThemeFromDB(null)).toBe("light");
  });

  it("falls back to light when db value is invalid", () => {
    expect(resolveThemeFromDB("blue")).toBe("light");
    expect(resolveThemeFromDB("")).toBe("light");
  });
});

describe("getStoredTheme — localStorage resilience", () => {
  it("returns light when localStorage is empty", () => {
    localStorage.clear();
    expect(getStoredTheme()).toBe("light");
  });

  it("returns stored theme when valid", () => {
    localStorage.setItem("theme", "dark");
    expect(getStoredTheme()).toBe("dark");
    localStorage.removeItem("theme");
  });

  it("returns light when stored value is invalid", () => {
    localStorage.setItem("theme", "purple");
    expect(getStoredTheme()).toBe("light");
    localStorage.removeItem("theme");
  });
});
