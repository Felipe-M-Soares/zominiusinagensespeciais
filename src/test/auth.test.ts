/**
 * TEST-01 + TEST-02 FIX:
 * - translateError agora importa de @/lib/authErrors (fonte única).
 *   Antes era uma cópia local com aviso "manter sincronizado" — agora é impossível sair de sincronia.
 * - validatePassword agora importa de @/lib/passwordUtils e testa a lógica REAL
 *   (maiúscula, minúscula, número, especial) em vez de apenas `length >= 8`.
 * - Adicionados testes para loteValido/formatLote (lógica crítica de rastreabilidade).
 */
import { describe, it, expect } from "vitest";
import { translateError }        from "@/lib/authErrors";
import { validatePassword }      from "@/lib/passwordUtils";
import { loteValido, formatLote, loteStatus } from "@/lib/lote";

// ─── translateError ──────────────────────────────────────────────────────────
describe("translateError", () => {
  it("translates Invalid login credentials", () => {
    expect(translateError("Invalid login credentials")).toBe("Login ou senha incorretos.");
  });

  it("translates invalid_credentials (Supabase v2 code)", () => {
    expect(translateError("invalid_credentials")).toBe("Login ou senha incorretos.");
  });

  it("translates partial match Too many requests (case-insensitive)", () => {
    expect(translateError("Error: Too many requests from this IP")).toBe(
      "Muitas tentativas. Aguarde alguns minutos."
    );
  });

  it("translates Auth session missing", () => {
    expect(translateError("Auth session missing")).toBe(
      "Sessão não encontrada. Faça login novamente."
    );
  });

  it("returns original message if no translation found", () => {
    const unknown = "Some unknown error from server";
    expect(translateError(unknown)).toBe(unknown);
  });

  it("handles empty string", () => {
    expect(translateError("")).toBe("");
  });
});

// ─── validatePassword (real implementation) ───────────────────────────────────
describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("Ab1!")).not.toBeNull();
  });

  it("rejects passwords without uppercase letter", () => {
    // TEST-02 FIX: este caso passava antes com a cópia local mas falha na lógica real
    expect(validatePassword("abcdef1!")).not.toBeNull();
  });

  it("rejects passwords without lowercase letter", () => {
    expect(validatePassword("ABCDEF1!")).not.toBeNull();
  });

  it("rejects passwords without number", () => {
    expect(validatePassword("Abcdefg!")).not.toBeNull();
  });

  it("rejects passwords without special character", () => {
    expect(validatePassword("Abcdefg1")).not.toBeNull();
  });

  it("rejects empty password", () => {
    expect(validatePassword("")).not.toBeNull();
  });

  it("rejects passwords longer than 72 chars", () => {
    expect(validatePassword("Aa1!" + "x".repeat(70))).not.toBeNull();
  });

  it("accepts a strong password", () => {
    expect(validatePassword("Secure@Pass123")).toBeNull();
  });

  it("accepts minimum valid password", () => {
    // Mínimo válido: 8 chars com maiúscula, minúscula, número, especial
    expect(validatePassword("Abcd1!Ef")).toBeNull();
  });
});

// ─── loteValido / formatLote / loteStatus (TEST-01 FIX) ─────────────────────
// Lógica crítica de rastreabilidade — sem testes anteriores
describe("loteValido", () => {
  it("accepts valid lote DDMMYYS-NN format (com turno)", () => {
    expect(loteValido("0101261-01")).toBe(true);
  });

  it("accepts valid lote with suffix /A", () => {
    expect(loteValido("0101261-01/A")).toBe(true);
  });

  it("accepts valid lote DDMMYY-NN format (sem turno — peça de terceiro)", () => {
    expect(loteValido("010126-01")).toBe(true);
  });

  it("accepts valid lote sem turno with suffix /A", () => {
    expect(loteValido("010126-01/A")).toBe(true);
  });

  it("rejects lote with too few digits", () => {
    expect(loteValido("01012-01")).toBe(false);
  });

  it("rejects lote with too many digits before dash", () => {
    expect(loteValido("01012612-01")).toBe(false);
  });

  it("rejects lote without dash", () => {
    expect(loteValido("010126101")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(loteValido("")).toBe(false);
  });

  it("rejects lote with spaces", () => {
    expect(loteValido("0101261 01")).toBe(false);
  });
});

describe("formatLote", () => {
  it("formats continuous digits by inserting dash (com turno, 9 dígitos)", () => {
    // 7 digits + 2 digits without dash → auto-inserts dash after position 7
    const result = formatLote("010126101");
    expect(result).toBe("0101261-01");
  });

  it("formats continuous digits by inserting dash (sem turno, 8 dígitos)", () => {
    // 6 digits + 2 digits without dash → auto-inserts dash after position 6
    const result = formatLote("01012601");
    expect(result).toBe("010126-01");
  });

  it("strips non-allowed characters", () => {
    expect(formatLote("01.01.261-01")).toBe("0101261-01");
  });

  it("converts to uppercase", () => {
    expect(formatLote("0101261-01/a")).toBe("0101261-01/A");
  });

  it("limits output to 13 characters", () => {
    const result = formatLote("0101261-01/ABCDEF");
    expect(result.length).toBeLessThanOrEqual(13);
  });
});

describe("loteStatus", () => {
  it("returns empty for empty string", () => {
    expect(loteStatus("")).toBe("empty");
  });

  it("returns valid for valid lote", () => {
    expect(loteStatus("0101261-01")).toBe("valid");
  });

  it("returns valid for valid lote sem turno", () => {
    expect(loteStatus("010126-01")).toBe("valid");
  });

  it("returns invalid for malformed lote", () => {
    expect(loteStatus("INVALID")).toBe("invalid");
  });
});

// ─── Display name sanitization ───────────────────────────────────────────────
function sanitizeDisplayName(raw: string): string {
  return raw.trim().slice(0, 100);
}

describe("sanitizeDisplayName", () => {
  it("trims whitespace", () => {
    expect(sanitizeDisplayName("  João  ")).toBe("João");
  });
  it("limits to 100 characters", () => {
    const longName = "A".repeat(200);
    expect(sanitizeDisplayName(longName).length).toBe(100);
  });
  it("handles empty string", () => {
    expect(sanitizeDisplayName("")).toBe("");
  });
});
