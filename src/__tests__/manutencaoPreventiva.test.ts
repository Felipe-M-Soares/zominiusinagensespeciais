/**
 * Tests for manutenção preventiva — lógica de cálculo de alertas
 */
import { describe, it, expect } from "vitest";

interface ManutencaoItem {
  id: string;
  tipo_manutencao: string;
  periodicidade_dias: number;
  ultima_manutencao: string | null; // ISO date
  proxima_manutencao: string | null;
}

// Calcula se a manutenção está em atraso, próxima ou ok
type ManutStatus = "em_atraso" | "proximo" | "ok" | "nunca_realizada";

function calcManutStatus(item: ManutencaoItem, hoje = new Date()): ManutStatus {
  if (!item.ultima_manutencao || !item.proxima_manutencao) return "nunca_realizada";

  const proxima = new Date(item.proxima_manutencao);
  const diffDias = Math.ceil((proxima.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) return "em_atraso";
  if (diffDias <= 7) return "proximo";
  return "ok";
}

// Calcula próxima manutenção a partir da última
function calcProximaManutencao(ultimaISO: string, periodicidadeDias: number): string {
  const ultima = new Date(ultimaISO);
  ultima.setDate(ultima.getDate() + periodicidadeDias);
  return ultima.toISOString().split("T")[0];
}

// Valida dados do formulário de manutenção
function validateManutForm(data: { tipo: string; periodicidade: number; ultima?: string }): string | null {
  if (!data.tipo.trim()) return "Tipo de manutenção é obrigatório";
  if (data.periodicidade < 1) return "Periodicidade deve ser pelo menos 1 dia";
  if (data.periodicidade > 3650) return "Periodicidade máxima é 10 anos (3650 dias)";
  if (data.ultima) {
    const d = new Date(data.ultima);
    if (isNaN(d.getTime())) return "Data de última manutenção inválida";
    if (d > new Date()) return "Data de última manutenção não pode ser futura";
  }
  return null;
}

const HOJE = new Date("2026-06-14");

describe("calcManutStatus", () => {
  it("returns em_atraso when proxima is in the past", () => {
    const item: ManutencaoItem = {
      id: "1", tipo_manutencao: "Troca de óleo",
      periodicidade_dias: 30,
      ultima_manutencao: "2026-05-01",
      proxima_manutencao: "2026-05-31",
    };
    expect(calcManutStatus(item, HOJE)).toBe("em_atraso");
  });

  it("returns proximo when proxima is within 7 days", () => {
    const item: ManutencaoItem = {
      id: "2", tipo_manutencao: "Lubrificação",
      periodicidade_dias: 30,
      ultima_manutencao: "2026-05-18",
      proxima_manutencao: "2026-06-17",
    };
    expect(calcManutStatus(item, HOJE)).toBe("proximo");
  });

  it("returns ok when proxima is more than 7 days away", () => {
    const item: ManutencaoItem = {
      id: "3", tipo_manutencao: "Calibração",
      periodicidade_dias: 90,
      ultima_manutencao: "2026-06-01",
      proxima_manutencao: "2026-08-30",
    };
    expect(calcManutStatus(item, HOJE)).toBe("ok");
  });

  it("returns nunca_realizada when ultima_manutencao is null", () => {
    const item: ManutencaoItem = {
      id: "4", tipo_manutencao: "Revisão geral",
      periodicidade_dias: 180,
      ultima_manutencao: null,
      proxima_manutencao: null,
    };
    expect(calcManutStatus(item, HOJE)).toBe("nunca_realizada");
  });
});

describe("calcProximaManutencao", () => {
  it("adds periodicidade days to ultima", () => {
    expect(calcProximaManutencao("2026-06-01", 30)).toBe("2026-07-01");
  });
  it("crosses month boundary", () => {
    expect(calcProximaManutencao("2026-01-20", 30)).toBe("2026-02-19");
  });
  it("crosses year boundary", () => {
    expect(calcProximaManutencao("2026-12-01", 60)).toBe("2027-01-30");
  });
});

describe("validateManutForm", () => {
  it("accepts valid form data", () => {
    expect(validateManutForm({ tipo: "Troca de óleo", periodicidade: 30 })).toBeNull();
  });
  it("rejects empty tipo", () => {
    expect(validateManutForm({ tipo: "", periodicidade: 30 })).toBeTruthy();
  });
  it("rejects periodicidade = 0", () => {
    expect(validateManutForm({ tipo: "T", periodicidade: 0 })).toBeTruthy();
  });
  it("rejects periodicidade > 3650", () => {
    expect(validateManutForm({ tipo: "T", periodicidade: 3651 })).toBeTruthy();
  });
  it("rejects future ultima_manutencao", () => {
    expect(validateManutForm({ tipo: "T", periodicidade: 30, ultima: "2099-01-01" })).toBeTruthy();
  });
  it("accepts past ultima_manutencao", () => {
    expect(validateManutForm({ tipo: "T", periodicidade: 30, ultima: "2025-01-01" })).toBeNull();
  });
});
