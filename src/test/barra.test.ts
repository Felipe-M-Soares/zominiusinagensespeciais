import { describe, it, expect } from "vitest";
import {
  densidadeMaterial, diametroDaDescricao, pesoTeoricoBarraKg, kgParaBarras, kgParaMetros,
  barrasParaKg, barrasParaMetros, metrosParaBarras, metrosParaKg, pecasPorBarra,
} from "@/lib/barra";

const ti4 = { descricao: "TITÂNIO ASTM F136 Ø4.0", diametro_mm: 4, comprimento_barra_m: 3, peso_barra_kg: 0.168 };

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

  it("nota em kg vira barras pelo peso medido", () => {
    // 0,168 kg por barra → nota de 1,68 kg = 10 barras = 30 m
    expect(kgParaBarras(1.68, ti4)!).toBeCloseTo(10, 9);
    expect(kgParaMetros(1.68, ti4)!).toBeCloseTo(30, 9);
    expect(barrasParaKg(10, ti4)!).toBeCloseTo(1.68, 9);
    expect(metrosParaKg(30, ti4)!).toBeCloseTo(1.68, 9);
    expect(kgParaBarras(1, { ...ti4, peso_barra_kg: null })).toBeNull();
  });

  it("barras gastas ↔ metros (3 m por barra)", () => {
    expect(barrasParaMetros(4, ti4)).toBe(12);
    expect(metrosParaBarras(12, ti4)).toBe(4);
    expect(barrasParaMetros(2, { descricao: "x" })).toBe(6);
  });

  it("rendimento em peças por barra", () => {
    expect(pecasPorBarra(250, 4)).toBe(62.5);
    expect(pecasPorBarra(250, 0)).toBeNull();
  });
});
