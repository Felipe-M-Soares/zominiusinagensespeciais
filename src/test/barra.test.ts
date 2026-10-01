import { describe, it, expect } from "vitest";
import {
  densidadeMaterial, diametroDaDescricao, pesoTeoricoBarraKg, kgParaMetros, metrosParaKg,
  metrosParaBarras, fatorSobra, calcularConsumo, pecasPossiveis,
} from "@/lib/barra";

const ti4 = { descricao: "TITÂNIO ASTM F136 Ø4.0", diametro_mm: 4, comprimento_barra_m: 3, peso_barra_kg: 0.168, sobra_barra_mm: 0 };

describe("barra", () => {
  it("reconhece o material e o diâmetro pela descrição", () => {
    expect(densidadeMaterial("TITÂNIO ASTM F136 Ø2.5")).toBe(4.43);
    expect(densidadeMaterial("CROMO COBALTO Ø5")).toBe(8.3);
    expect(densidadeMaterial("AÇO INOX AISI 303 Ø4.0")).toBe(8.0);
    expect(densidadeMaterial("POLIACETAL Ø6.0")).toBe(1.41);
    expect(diametroDaDescricao("TITÂNIO ASTM F136 Ø9,53")).toBe(9.53);
    expect(diametroDaDescricao("sem diâmetro")).toBeNull();
  });

  it("peso teórico de barra de 3 m", () => {
    // Ti Ø4: π/4·16 = 12,566 mm² × 4,43 = 55,67 g/m → 0,167 kg/barra
    expect(pesoTeoricoBarraKg({ descricao: "TITÂNIO Ø4" })!).toBeCloseTo(0.167, 3);
  });

  it("converte kg ↔ metros ↔ barras pelo peso medido", () => {
    // 0,168 kg por barra de 3 m → 1,68 kg = 10 barras = 30 m
    expect(kgParaMetros(1.68, ti4)!).toBeCloseTo(30, 6);
    expect(metrosParaKg(30, ti4)!).toBeCloseTo(1.68, 6);
    expect(metrosParaBarras(30, ti4)).toBe(10);
    expect(kgParaMetros(1, { ...ti4, peso_barra_kg: null })).toBeNull();
  });

  it("consumo inclui refugo, corte e ponta de barra", () => {
    const mp = { ...ti4, sobra_barra_mm: 150 };
    expect(fatorSobra(mp)).toBeCloseTo(3000 / 2850, 9);
    const c = calcularConsumo({ pecasBoas: 190, pecasRefugo: 10, mmPorPeca: 12.5, mp });
    expect(c.pecas).toBe(200);
    expect(c.metros).toBe(2.5);
    expect(c.baixa).toBeCloseTo(2.632, 3);
    expect(c.kgEstimado).toBe(false);
  });

  it("peças possíveis com o saldo", () => {
    expect(pecasPossiveis(3, 12, ti4)).toBe(250);
    expect(pecasPossiveis(0, 12, ti4)).toBe(0);
  });
});
