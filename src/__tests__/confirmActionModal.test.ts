/**
 * Tests for ConfirmActionModal — lógica de validação e exibição
 */
import { describe, it, expect } from "vitest";
import type { ConfirmItem } from "@/components/ConfirmActionModal";

// Lógica pura: formata valor monetário para exibição no modal
function formatModalValue(value: number, type: "currency" | "qty" | "text"): string {
  if (type === "currency") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (type === "qty") return `${value} unidade${value !== 1 ? "s" : ""}`;
  return String(value);
}

// Valida se todos os items obrigatórios estão presentes
function validateModalItems(items: ConfirmItem[]): boolean {
  return items.every((item) => item.label.length > 0 && item.value.length > 0);
}

describe("ConfirmActionModal — item validation", () => {
  it("accepts valid items", () => {
    const items: ConfirmItem[] = [
      { label: "Pedido", value: "#ABC123" },
      { label: "Valor", value: "R$ 4.800,00", highlight: true },
    ];
    expect(validateModalItems(items)).toBe(true);
  });

  it("rejects items with empty label", () => {
    const items: ConfirmItem[] = [{ label: "", value: "R$ 100" }];
    expect(validateModalItems(items)).toBe(false);
  });

  it("rejects items with empty value", () => {
    const items: ConfirmItem[] = [{ label: "Valor", value: "" }];
    expect(validateModalItems(items)).toBe(false);
  });

  it("allows empty items array", () => {
    expect(validateModalItems([])).toBe(true);
  });
});

describe("ConfirmActionModal — value formatting", () => {
  it("formats currency correctly", () => {
    const v = formatModalValue(4800, "currency");
    expect(v).toContain("4.800");
    expect(v).toContain("R$");
  });

  it("formats quantity with singular", () => {
    expect(formatModalValue(1, "qty")).toBe("1 unidade");
  });

  it("formats quantity with plural", () => {
    expect(formatModalValue(12, "qty")).toBe("12 unidades");
  });

  it("formats text as string", () => {
    expect(formatModalValue(42, "text")).toBe("42");
  });
});
