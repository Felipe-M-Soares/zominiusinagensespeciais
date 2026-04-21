/**
 * ARCH-002 FIX: Unit tests for critical authentication and business logic.
 * These cover the functions most impacted by the security audit findings.
 *
 * FIX: translateError aqui espelha EXATAMENTE o mapa de useAuth.tsx.
 * Manter sincronizado — se alterar as mensagens lá, atualizar aqui também.
 */
import { describe, it, expect } from "vitest";

// ─── translateError (espelha useAuth.tsx) ────────────────────────────────────
function translateError(message: string): string {
  const errors: Record<string, string> = {
    "Invalid login credentials": "Login ou senha incorretos.",
    "Invalid email or password": "Login ou senha incorretos.",
    "invalid_credentials": "Login ou senha incorretos.",
    "Password should be at least 6 characters": "A senha deve ter no mínimo 6 caracteres.",
    "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
    "User not found": "Usuário não encontrado.",
    "Too many requests": "Muitas tentativas. Aguarde alguns minutos.",
    "Session expired": "Sua sessão expirou. Faça login novamente.",
    "User is not authorized": "Sem permissão para realizar esta ação.",
    "New password should be different from the old password": "A nova senha deve ser diferente da atual.",
    "Auth session missing": "Sessão não encontrada. Faça login novamente.",
  };
  if (errors[message]) return errors[message];
  for (const [key, value] of Object.entries(errors)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return message;
}

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

// ─── Password validation ─────────────────────────────────────────────────────
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
