import { describe, it, expect } from "vitest";
import { sanitizeQuery } from "@/lib/sanitize";
import { escHtml } from "@/lib/escHtml";

// ─── sanitizeQuery — proteção de busca PostgREST ─────────────────────────────
// DUP-02: Garante que a implementação centralizada em sanitize.ts preserva o
// comportamento correto de ambas as implementações anteriores.
describe("sanitizeQuery", () => {
  it("trims whitespace", () => {
    expect(sanitizeQuery("  hello  ")).toBe("hello");
  });

  it("limits to 200 characters", () => {
    const long = "a".repeat(300);
    expect(sanitizeQuery(long).length).toBe(200);
  });

  it("removes PostgREST/SQL syntax characters", () => {
    expect(sanitizeQuery("(foo)")).toBe("foo");
    expect(sanitizeQuery("a,b")).toBe("ab");
    expect(sanitizeQuery("a;b")).toBe("ab");
    expect(sanitizeQuery("it's")).toBe("its");
    expect(sanitizeQuery('say "hi"')).toBe("say hi");
    expect(sanitizeQuery("back`tick")).toBe("backtick");
  });

  it("escapes ILIKE wildcards", () => {
    expect(sanitizeQuery("50%")).toBe("50\\%");
    expect(sanitizeQuery("_test")).toBe("\\_test");
    expect(sanitizeQuery("back\\slash")).toBe("back\\\\slash");
  });

  it("removes control characters", () => {
    // char code 0 (null byte) should be removed
    expect(sanitizeQuery("hel\x00lo")).toBe("hello");
    // char code 127 (DEL) should be removed
    expect(sanitizeQuery("hel\x7flo")).toBe("hello");
  });

  it("preserves normal search strings", () => {
    expect(sanitizeQuery("DP-100")).toBe("DP-100");
    expect(sanitizeQuery("Modelo XYZ 3.5")).toBe("Modelo XYZ 3.5");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeQuery("   ")).toBe("");
  });
});

// ─── escHtml — prevenção de XSS crítica em CRÍTICO-01 ────────────────────────
// CRÍTICO-01 regression guard: IntermediaryLotesModal deve usar escHtml()
// antes de interpolar model/reference/lote em templates de impressão.
describe("escHtml — CRÍTICO-01 regression guard", () => {
  it("escapes XSS payloads that would break label template", () => {
    // Garante que um payload típico de XSS é neutralizado antes da interpolação
    const payload = '<img src=x onerror=alert(1)>';
    const escaped = escHtml(payload);
    // Não deve conter < ou > (vetores de tag HTML)
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    // Deve conter as entidades escapadas
    expect(escaped).toContain("&lt;");
    expect(escaped).toContain("&gt;");
  });

  it("escapes script injection via lote field", () => {
    const payload = '"></div><script>alert(1)</script><div class="';
    const escaped = escHtml(payload);
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("</script>");
  });

  it("safe content passes through unchanged", () => {
    expect(escHtml("DP-100")).toBe("DP-100");
    expect(escHtml("2026/06/A")).toBe("2026/06/A");
    expect(escHtml("Modelo Normal 3.5mm")).toBe("Modelo Normal 3.5mm");
  });

  it("handles null and undefined safely", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });
});
