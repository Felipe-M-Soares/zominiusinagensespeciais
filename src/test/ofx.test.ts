import { describe, it, expect } from "vitest";
import { lerOfx, sugerirConciliacao, decodificarOfx, type ContaAberta } from "@/lib/ofx";
import { agruparDuplicados } from "@/lib/clientesDuplicados";
import type { Cliente } from "@/types/comercial";

const SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260910120000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO CLIENTE X
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260911<TRNAMT>-320,50<FITID>A2<NAME>ENERGIA
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260912<TRNAMT>-99.90<FITID>A2<MEMO>TARIFA
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260915</DTPOSTED><TRNAMT>1,234.56</TRNAMT><FITID>X9</FITID><MEMO>TED &amp; DOC</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("lê SGML (v1) com vírgula decimal e FITID repetido", () => {
    const e = lerOfx(SGML);
    expect(e.banco).toBe("341");
    expect(e.conta).toBe("12345-6");
    expect(e.transacoes).toHaveLength(3);
    expect(e.transacoes[0]).toMatchObject({ fitid: "A1", data: "2026-09-10", valor: 1500 });
    expect(e.transacoes[1]).toMatchObject({ valor: -320.5, descricao: "ENERGIA" });
    expect(e.transacoes[2].fitid).toBe("A2+");
  });
  it("lê XML (v2) com milhar e entidades", () => {
    const e = lerOfx(XML);
    expect(e.transacoes[0]).toMatchObject({ valor: 1234.56, descricao: "TED & DOC", data: "2026-09-15" });
  });
  it("decodifica 1252", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("CHARSET:1252\n<MEMO>"), 0xc7, 0xc3, 0x4f]);
    expect(decodificarOfx(bytes.buffer)).toContain("ÇÃO");
  });
  it("sugere sem repetir conta e respeita o sentido", () => {
    const contas: ContaAberta[] = [
      { id: "r1", tipo: "receber", valor: 1500, data_vencimento: "2026-09-08", nome: "X", descricao: "" },
      { id: "p1", tipo: "pagar", valor: 320.5, data_vencimento: "2026-09-10", nome: "Luz", descricao: "" },
      { id: "p2", tipo: "pagar", valor: 1500, data_vencimento: "2026-09-10", nome: "Y", descricao: "" },
    ];
    const s = sugerirConciliacao(lerOfx(SGML).transacoes, contas);
    expect(s).toEqual({ A1: "r1", A2: "p1", "A2+": null });
  });
});

describe("clientes repetidos", () => {
  const c = (id: string, nome: string, documento: string | null): Cliente =>
    ({ id, nome, documento, telefone: null, email: null, endereco: null, observacoes: null, created_at: "2026-01-01" });
  it("agrupa por documento e por nome normalizado", () => {
    const g = agruparDuplicados([
      c("1", "Clínica Sorriso LTDA", "12.345.678/0001-95"), c("2", "clinica sorriso", null),
      c("3", "Outra", "12345678000195"), c("4", "Único", "111.444.777-35"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].map(x => x.id).sort()).toEqual(["1", "2", "3"]);
  });
});
