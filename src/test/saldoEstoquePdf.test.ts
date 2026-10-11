import { describe, it, expect } from "vitest";
import { lerLinhasSaldo, resumoSaldo, numeroBR, linhasDaPagina } from "@/lib/saldoEstoquePdf";

// Linhas no formato do relatório "SALDO DE ESTOQUE" (dados fictícios).
const LINHAS = [
  "SALDO DE ESTOQUE Data: 08/10/2026 14:51:40",
  "ANX - ANALOGO X",
  "NRO UAR LOTE REFERENCIA ... VALIDADE ULT. MOV. UNID. QTD RESERVA SALDO",
  "000001 - ANALOGO X Ø4.5 AT",
  "ENDERECO: EXP - PRODUTO ACABADO",
  "20180814082454653 0608182-08 Ø4.5 AT ATIVO 06/08/2018 18/02/2025 UN 3 1 2",
  "20240711113104053 0207242-06 ANX 4520AT ATIVO 02/07/2024 08/10/2026 UN 32 0 32",
  "Saldo para o item: ANALOGO X Ø4.5 AT 35 1 34",
  "ENDERECO: INT - INTERMEDIÁRIO",
  "20240711113104999 0807252-06/A ANX 4520AT ATIVO 02/07/2024 08/10/2026 UN 1.250 0 1.250",
  "20170622153718780 0207242-06 ATIVO 18/02/2025 UN 10 0 10",
  "Usuário CGN (STQ_PDF_SALDO) ... Pagina 1/2",
  // continua na página seguinte (mesmo endereço INT)
  "20170622153718781 0207242-06 ANX 4520AT ATIVO 01/01/2024 18/02/2025 UN 5 0 5",
  "000002 - BROCA ESPECIAL 0.5",
  "ENDERECO: FERR - FERRAMENTAS",
  "20170420173732243 1645 ATIVO 22/05/2020 UN 4 0 4",
  "000003 - TRANSFER Y",
  "ENDERECO: EXP - PRODUTO ACABADO",
  "20171107151544167 ATIVO 01/04/2017 18/02/2025 UN 7 0 7",
];

describe("leitura do PDF SALDO DE ESTOQUE", () => {
  const r = lerLinhasSaldo(LINHAS);

  it("separa peça, fase e lotes (inclui lote com sufixo e continuação de página)", () => {
    const p = r.pecas.find(x => x.codigoErp === "000001")!;
    expect(p.nome).toBe("ANALOGO X Ø4.5 AT");
    expect(p.referencia).toBe("ANX 4520AT"); // a do lote mais recente
    expect(p.referencias).toContain("Ø4.5 AT");
    expect(p.fases.expedicao).toEqual([
      { lote: "0608182-08", qtd: 3, reserva: 1, saldo: 2 },
      { lote: "0207242-06", qtd: 32, reserva: 0, saldo: 32 },
    ]);
    // mesmo lote repetido no INT é somado; lote "/A" reconhecido; milhar 1.250
    expect(p.fases.intermediaria).toEqual([
      { lote: "0807252-06/A", qtd: 1250, reserva: 0, saldo: 1250 },
      { lote: "0207242-06", qtd: 15, reserva: 0, saldo: 15 },
    ]);
  });

  it("ignora outros endereços e lotes sem número", () => {
    expect(r.pecas.map(p => p.codigoErp)).toEqual(["000001", "000003"]);
    expect(r.pecasIgnoradas).toBe(1);
    expect(r.enderecosIgnorados).toEqual({ "FERR - FERRAMENTAS": 1 });
    expect(r.lotesSemNumero).toEqual([{ codigoErp: "000003", nome: "TRANSFER Y", quantidade: 7 }]);
  });

  it("resumo por saldo ou quantidade total", () => {
    expect(resumoSaldo(r.pecas, false)).toMatchObject({ pecas: 2, comSaldo: 1, lotes: 4, unidades: 2 + 32 + 1250 + 15 });
    expect(resumoSaldo(r.pecas, true).unidades).toBe(3 + 32 + 1250 + 15);
  });

  it("números no formato brasileiro", () => {
    expect(numeroBR("4.995")).toBe(4995);
    expect(numeroBR("1,5")).toBe(1.5);
  });

  it("monta linhas a partir dos pedaços de texto da página", () => {
    const linhas = linhasDaPagina([
      { str: "UN", transform: [1, 0, 0, 1, 300, 500.4] },
      { str: "20171107151544167", transform: [1, 0, 0, 1, 20, 500] },
      { str: "000044 - ANALOGO", transform: [1, 0, 0, 1, 10, 520] },
    ]);
    expect(linhas).toEqual(["000044 - ANALOGO", "20171107151544167 UN"]);
  });
});
