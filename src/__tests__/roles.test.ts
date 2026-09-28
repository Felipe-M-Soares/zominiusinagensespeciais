import { describe, it, expect } from "vitest";
import { APP_ROLES, ROLE_LABELS } from "@/types/roles";
import type { AppRole } from "@/types/roles";

// BUG-11: Tests for role definitions — SEG-02 regression guard
describe("APP_ROLES", () => {
  const EXPECTED: AppRole[] = ["admin", "estoque", "qualidade", "comercial", "financeiro", "producao", "processos"];

  it("contains all expected roles", () => {
    for (const role of EXPECTED) {
      expect(APP_ROLES).toContain(role);
    }
  });

  it("has a label for every role", () => {
    for (const role of APP_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("includes financeiro (SEG-02 regression)", () => {
    expect(APP_ROLES).toContain("financeiro");
    expect(ROLE_LABELS.financeiro).toBe("Financeiro");
  });

  it("includes processos", () => {
    expect(APP_ROLES).toContain("processos");
    expect(ROLE_LABELS.processos).toBe("Processos");
  });
});

describe("perfil gerente", () => {
  it("acessa todos os módulos menos Admin", async () => {
    const { temPapel, canAccessRoute } = await import("@/types/roles");
    for (const p of ["estoque", "qualidade", "comercial", "financeiro", "producao", "processos"] as const) {
      expect(temPapel("gerente", p)).toBe(true);
    }
    expect(temPapel("gerente", "admin")).toBe(false);
    expect(canAccessRoute("gerente", "/admin")).toBe(false);
    expect(canAccessRoute("gerente", "/financeiro")).toBe(true);
    expect(temPapel("comercial", "financeiro")).toBe(false);
    expect(temPapel("admin", "financeiro")).toBe(true);
  });
});
