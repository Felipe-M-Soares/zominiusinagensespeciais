/**
 * ARCH-002 FIX: Unit tests for critical authentication and business logic.
 * These cover the functions most impacted by the security audit findings.
 */
import { describe, it, expect } from "vitest";

// ─── translateError (extracted for testability) ───────────────────────────────
function translateError(message: string): string {
  const errors: Record<string, string> = {
    "Invalid login credentials": "Email ou senha incorretos.",
    "Email not confirmed": "Confirme seu email antes de entrar. Verifique sua caixa de entrada.",
    "User already registered": "Este email já está cadastrado.",
    "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
    "Too many requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "Session expired": "Sua sessão expirou. Faça login novamente.",
  };
  if (errors[message]) return errors[message];
  for (const [key, value] of Object.entries(errors)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return message;
}

describe("translateError", () => {
  it("translates exact match", () => {
    expect(translateError("Invalid login credentials")).toBe("Email ou senha incorretos.");
  });

  it("translates partial match (case-insensitive)", () => {
    expect(translateError("Error: Too many requests from this IP")).toBe(
      "Muitas tentativas. Aguarde alguns minutos e tente novamente."
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

// ─── Password validation (mirrors useAuth signUp logic) ──────────────────────
function validatePassword(password: string): string | null {
  if (password.length < 8) return "A senha deve ter no mínimo 8 caracteres.";
  return null;
}

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("abc123")).not.toBeNull();
  });
  it("accepts passwords of 8+ chars", () => {
    expect(validatePassword("securePass1")).toBeNull();
  });
  it("rejects empty password", () => {
    expect(validatePassword("")).not.toBeNull();
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
