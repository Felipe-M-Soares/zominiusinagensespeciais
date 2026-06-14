/**
 * Tests for dashboard materialized view data handling
 */
import { describe, it, expect } from "vitest";

// Interface dos KPIs do dashboard — campos que a view materializada retorna
interface DashboardKPIs {
  estoque_intermediario_qty: number;
  estoque_expedicao_qty: number;
  estoque_critico: number;
  pedidos_pendentes: number;
  pedidos_prontos: number;
  pedidos_atrasados: number;
  devices_vencendo_anvisa: number;
  devices_anvisa_vencidos: number;
  recall_ativos: number;
  refreshed_at: string;
}

// Calcula quantos segundos atrás a view foi atualizada
function viewAgeSeconds(refreshedAt: string): number {
  return Math.floor((Date.now() - new Date(refreshedAt).getTime()) / 1000);
}

// Verifica se a view precisa de refresh manual (> 20 min sem atualizar)
function needsManualRefresh(refreshedAt: string): boolean {
  return viewAgeSeconds(refreshedAt) > 20 * 60;
}

// Preenche campos ausentes com 0 (compatibilidade com dados parciais)
function safeKPIs(data: Partial<DashboardKPIs>): DashboardKPIs {
  return {
    estoque_intermediario_qty: 0,
    estoque_expedicao_qty: 0,
    estoque_critico: 0,
    pedidos_pendentes: 0,
    pedidos_prontos: 0,
    pedidos_atrasados: 0,
    devices_vencendo_anvisa: 0,
    devices_anvisa_vencidos: 0,
    recall_ativos: 0,
    refreshed_at: new Date().toISOString(),
    ...data,
  };
}

describe("viewAgeSeconds", () => {
  it("returns ~0 for just-refreshed view", () => {
    const age = viewAgeSeconds(new Date().toISOString());
    expect(age).toBeLessThanOrEqual(1);
  });

  it("returns correct age for old timestamp", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const age = viewAgeSeconds(tenMinAgo);
    expect(age).toBeGreaterThanOrEqual(599); // ~10 min
    expect(age).toBeLessThan(610);
  });
});

describe("needsManualRefresh", () => {
  it("returns false for recent refresh (5 min ago)", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(needsManualRefresh(fiveMinAgo)).toBe(false);
  });

  it("returns true for old refresh (30 min ago)", () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(needsManualRefresh(thirtyMinAgo)).toBe(true);
  });
});

describe("safeKPIs", () => {
  it("fills all missing fields with 0", () => {
    const result = safeKPIs({});
    expect(result.estoque_intermediario_qty).toBe(0);
    expect(result.recall_ativos).toBe(0);
    expect(result.pedidos_pendentes).toBe(0);
  });

  it("preserves provided values", () => {
    const result = safeKPIs({ pedidos_pendentes: 5, recall_ativos: 2 });
    expect(result.pedidos_pendentes).toBe(5);
    expect(result.recall_ativos).toBe(2);
    expect(result.estoque_critico).toBe(0); // default
  });

  it("includes refreshed_at field", () => {
    const result = safeKPIs({});
    expect(result.refreshed_at).toBeTruthy();
    expect(() => new Date(result.refreshed_at)).not.toThrow();
  });
});
