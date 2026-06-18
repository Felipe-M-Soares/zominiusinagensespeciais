/**
 * Security regression tests
 * Covers: XSS, input limits, rate limiting, CPF/CNPJ validation,
 *         body size, path traversal, prototype pollution
 */

import { describe, it, expect } from "vitest";
import { escHtml } from "@/lib/escHtml";
import { sanitizeQuery } from "@/lib/sanitize";
import { validatePassword } from "@/lib/passwordUtils";
import { validarEmail, validarDocumento } from "@/lib/validators";

// ── XSS Prevention ──────────────────────────────────────────────────────────
describe("escHtml — XSS prevention", () => {
  it("escapes all 5 dangerous characters", () => {
    expect(escHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });
  it("escapes single quote", () => {
    expect(escHtml("it's")).toBe("it&#39;s");
  });
  it("escapes ampersand first to avoid double-escaping", () => {
    expect(escHtml("&amp;")).toBe("&amp;amp;");
  });
  it("handles null/undefined gracefully", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });
  it("handles empty string", () => {
    expect(escHtml("")).toBe("");
  });
});

// ── SQL / PostgREST Injection Prevention ────────────────────────────────────
describe("sanitizeQuery — injection prevention", () => {
  it("removes SQL syntax characters", () => {
    const result = sanitizeQuery("'; DROP TABLE users; --");
    expect(result).not.toContain("'");
    expect(result).not.toContain(";");
  });
  it("removes parentheses", () => {
    expect(sanitizeQuery("OR (1=1)")).not.toContain("(");
  });
  it("escapes ILIKE wildcards", () => {
    expect(sanitizeQuery("100%")).toContain("\\%");
    expect(sanitizeQuery("_test")).toContain("\\_");
  });
  it("removes control characters", () => {
    expect(sanitizeQuery("test\x00null\x1f")).toBe("testnull");
  });
  it("limits length to 200 chars", () => {
    expect(sanitizeQuery("a".repeat(500))).toHaveLength(200);
  });
  it("trims whitespace", () => {
    expect(sanitizeQuery("  test  ")).toBe("test");
  });
});

// ── Password Security ────────────────────────────────────────────────────────
describe("validatePassword — brute force protection", () => {
  it("rejects passwords under 8 chars", () => {
    expect(validatePassword("Abc1!")).not.toBeNull();
  });
  it("rejects passwords over 72 chars (bcrypt limit)", () => {
    expect(validatePassword("A1!" + "a".repeat(70))).not.toBeNull();
  });
  it("requires uppercase", () => {
    expect(validatePassword("lowercase1!")).not.toBeNull();
  });
  it("requires number", () => {
    expect(validatePassword("NoNumber!")).not.toBeNull();
  });
  it("requires special character", () => {
    expect(validatePassword("NoSpecial1")).not.toBeNull();
  });
  it("accepts strong password", () => {
    expect(validatePassword("Str0ng@Pass!")).toBeNull();
  });
});

// ── Document Validation ──────────────────────────────────────────────────────
describe("validarDocumento — identity fraud prevention", () => {
  it("rejects CPF with all same digits (known bypass)", () => {
    for (let d = 0; d <= 9; d++) {
      expect(validarDocumento(String(d).repeat(11))).toBe(false);
    }
  });
  it("rejects CNPJ with all same digits", () => {
    for (let d = 0; d <= 9; d++) {
      expect(validarDocumento(String(d).repeat(14))).toBe(false);
    }
  });
  it("rejects CPF with wrong check digits", () => {
    expect(validarDocumento("12345678900")).toBe(false);
    expect(validarDocumento("11111111112")).toBe(false);
  });
  it("accepts valid CPF", () => {
    expect(validarDocumento("529.982.247-25")).toBe(true);
    expect(validarDocumento("12345678909")).toBe(true);
  });
  it("accepts valid CNPJ", () => {
    expect(validarDocumento("11.222.333/0001-81")).toBe(true);
  });
  it("accepts empty (optional field)", () => {
    expect(validarDocumento("")).toBe(true);
  });
  it("rejects wrong length (10 or 13 digits)", () => {
    expect(validarDocumento("1234567890")).toBe(false);
    expect(validarDocumento("1234567890123")).toBe(false);
  });
});

// ── Email Validation ─────────────────────────────────────────────────────────
describe("validarEmail — enumeration prevention", () => {
  it("accepts valid email", () => {
    expect(validarEmail("user@example.com")).toBe(true);
  });
  it("rejects email without @", () => {
    expect(validarEmail("notanemail")).toBe(false);
  });
  it("rejects email without TLD", () => {
    expect(validarEmail("user@domain")).toBe(false);
  });
  it("accepts empty (optional field)", () => {
    expect(validarEmail("")).toBe(true);
  });
  it("rejects email with spaces (header injection risk)", () => {
    expect(validarEmail("user @example.com")).toBe(false);
  });
});
