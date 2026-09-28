import { describe, it, expect } from "vitest";
import { casarNotas } from "@/components/financeiro/casarNotas";

const P = (id: string, doc: string, total: number, criadoEm = "2026-09-01") => ({ id, doc, total, criadoEm });
const N = (chave: string, doc: string, valor: number, finalidade = "1") => ({ chave, destinatarioDoc: doc, valor, finalidade });

describe("casarNotas", () => {
  it("casa por CNPJ + valor e não repete pedido", () => {
    const r = casarNotas(
      [N("a", "11222333000181", 100), N("b", "11222333000181", 100), N("c", "11444777000161", 55)],
      [P("p1", "11.222.333/0001-81", 100), P("p2", "11222333000181", 100, "2026-09-02"), P("p3", "11444777000161", 60)],
    );
    expect(r.map(x => [x.pedidoId, x.confianca])).toEqual([["p1", "exata"], ["p2", "exata"], ["p3", "so_cliente"]]);
  });
  it("valor exato tem prioridade sobre aproximado", () => {
    const r = casarNotas([N("x", "1", 90), N("y", "1", 100)], [P("p1", "1", 100), P("p2", "1", 95)]);
    expect(r.find(c => c.chave === "y")?.pedidoId).toBe("p1");
    expect(r.find(c => c.chave === "x")?.pedidoId).toBe("p2");
  });
  it("devolução e cliente desconhecido não casam", () => {
    const r = casarNotas([N("d", "1", 10, "4"), N("e", "9", 10)], [P("p1", "1", 10)]);
    expect(r.map(x => x.confianca)).toEqual(["devolucao", "nenhuma"]);
  });
});
