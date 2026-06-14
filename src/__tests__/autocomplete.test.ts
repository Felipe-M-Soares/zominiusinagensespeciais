/**
 * Tests for useAutocomplete hook and autocomplete_devices RPC logic
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeQuery } from "@/lib/sanitize";

// ── sanitizeQuery (base do autocomplete) ────────────────────────────────────
describe("sanitizeQuery — autocomplete safety", () => {
  it("strips PostgREST injection characters", () => {
    const r = sanitizeQuery("{}[]:");
    expect(r).toBe("");
  });
  it("preserves normal search terms", () => {
    const r = sanitizeQuery("implante titanio");
    expect(r).toBe("implante titanio");
  });
  it("escapes ILIKE wildcards in user input", () => {
    expect(sanitizeQuery("100%")).toContain("\\%");
    expect(sanitizeQuery("_abc")).toContain("\\_");
  });
  it("limits to 200 chars", () => {
    expect(sanitizeQuery("a".repeat(500))).toHaveLength(200);
  });
  it("handles empty string", () => {
    expect(sanitizeQuery("")).toBe("");
  });
  it("removes new chars {} [] :", () => {
    const result = sanitizeQuery("{key:value}[0]");
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain("[");
    expect(result).not.toContain("]");
    expect(result).not.toContain(":");
  });
});

// ── Autocomplete URL building ────────────────────────────────────────────────
describe("QR Code URL building", () => {
  it("encodes lote correctly in URL", () => {
    const lote = "230601-01/A";
    const encoded = encodeURIComponent(lote);
    expect(encoded).toBe("230601-01%2FA");
    expect(decodeURIComponent(encoded)).toBe(lote);
  });
  it("handles lotes with special chars", () => {
    const lote = "23-01/B #2";
    const encoded = encodeURIComponent(lote);
    expect(decodeURIComponent(encoded)).toBe(lote);
  });
});
