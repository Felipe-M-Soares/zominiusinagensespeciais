/**
 * Tests for realtime cache invalidation logic
 */
import { describe, it, expect, vi } from "vitest";

// Lógica pura de mapeamento tabela → query key
function getQueryKeysForTable(table: string): string[] {
  const map: Record<string, string[]> = {
    stock_movements: ["stock"],
    pedidos_comerciais: ["pedidos", "stock"], // reservas mudam junto
    devices: ["devices"],
    stock_items: ["stock"],
  };
  return map[table] ?? [];
}

// Filtra eventos que devem disparar invalidação
function shouldInvalidate(event: string, table: string): boolean {
  // Pedidos: apenas UPDATE (criação não invalida stock)
  if (table === "pedidos_comerciais") return event === "UPDATE";
  // Stock movements: qualquer evento
  if (table === "stock_movements") return true;
  // Devices: qualquer evento
  if (table === "devices") return true;
  return false;
}

describe("getQueryKeysForTable", () => {
  it("maps stock_movements to stock key", () => {
    expect(getQueryKeysForTable("stock_movements")).toContain("stock");
  });

  it("maps pedidos to both pedidos and stock keys", () => {
    const keys = getQueryKeysForTable("pedidos_comerciais");
    expect(keys).toContain("pedidos");
    expect(keys).toContain("stock");
  });

  it("maps devices to devices key", () => {
    expect(getQueryKeysForTable("devices")).toContain("devices");
  });

  it("returns empty array for unknown table", () => {
    expect(getQueryKeysForTable("unknown_table")).toEqual([]);
  });
});

describe("shouldInvalidate", () => {
  it("invalidates stock on any stock_movements event", () => {
    expect(shouldInvalidate("INSERT", "stock_movements")).toBe(true);
    expect(shouldInvalidate("UPDATE", "stock_movements")).toBe(true);
    expect(shouldInvalidate("DELETE", "stock_movements")).toBe(true);
  });

  it("only invalidates pedidos on UPDATE, not INSERT", () => {
    expect(shouldInvalidate("UPDATE", "pedidos_comerciais")).toBe(true);
    expect(shouldInvalidate("INSERT", "pedidos_comerciais")).toBe(false);
  });

  it("invalidates devices on any event", () => {
    expect(shouldInvalidate("INSERT", "devices")).toBe(true);
    expect(shouldInvalidate("UPDATE", "devices")).toBe(true);
  });

  it("does not invalidate unknown tables", () => {
    expect(shouldInvalidate("UPDATE", "profiles")).toBe(false);
  });
});
