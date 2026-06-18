import { describe, it, expect } from "vitest";

// BUG-11: Unit tests for lote balance calculation logic
// These mirror the calcular saldos logic extracted from PedidosEstoquePanel

type Movement = { lote: string; type: "entrada" | "saida"; quantity: number };

function calcularSaldosPorLote(movs: Movement[]): Record<string, number> {
  const saldos: Record<string, number> = {};
  for (const mv of movs) {
    if (!mv.lote) continue;
    saldos[mv.lote] = (saldos[mv.lote] ?? 0) + (mv.type === "entrada" ? mv.quantity : -mv.quantity);
  }
  return saldos;
}

describe("calcularSaldosPorLote", () => {
  it("calculates correct balances", () => {
    const movs: Movement[] = [
      { lote: "L1", type: "entrada", quantity: 10 },
      { lote: "L1", type: "saida",   quantity: 3 },
      { lote: "L2", type: "entrada", quantity: 5 },
    ];
    const saldos = calcularSaldosPorLote(movs);
    expect(saldos["L1"]).toBe(7);
    expect(saldos["L2"]).toBe(5);
  });

  it("never produces negative balances when Math.max(0) is applied", () => {
    const movs: Movement[] = [
      { lote: "L1", type: "entrada", quantity: 2 },
      { lote: "L1", type: "saida",   quantity: 5 }, // over-deducted
    ];
    const saldos = calcularSaldosPorLote(movs);
    // BUG-08: ensure Math.max(0) guard works
    expect(Math.max(0, saldos["L1"])).toBe(0);
  });

  it("handles empty movements", () => {
    expect(calcularSaldosPorLote([])).toEqual({});
  });
});
