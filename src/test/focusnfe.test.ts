import { describe, it, expect } from "vitest";
import {
  montarNotaFocus, validarNota, ajustarCfop, aliquotaInterestadual, cnpjValido, cpfValido, chaveValida, agoraBrasilia, statusFocus,
  type DadosNota,
} from "../../supabase/functions/_shared/focusnfe";

// Formato (parcial) do payload montado para a Focus NFe — só o que os testes inspecionam
interface NotaItemTest { cfop: string; valor_bruto: number; valor_desconto: number; valor_frete?: number;
  icms_situacao_tributaria: string; icms_aliquota: number; pis_situacao_tributaria: string;
  ipi_situacao_tributaria: string; ipi_valor: number }
interface NotaTest {
  local_destino: number; cnpj_destinatario: string; indicador_inscricao_estadual_destinatario: number;
  consumidor_final: number; tipo_documento: number; finalidade_emissao: number;
  items: NotaItemTest[];
  formas_pagamento: { valor_pagamento: number; forma_pagamento: string }[];
  notas_referenciadas: { chave_nfe: string }[];
  duplicatas: { valor: number }[];
}

const base: DadosNota = {
  tipo: "venda", natureza: "Venda de produção do estabelecimento", dataEmissao: "2026-09-27T10:00:00-03:00",
  emitente: { cnpj: "11222333000181", uf: "SP", crt: 1 },
  destinatario: { nome: "Clínica X", documento: "11.444.777/0001-61", ie: "123456789", logradouro: "Rua A", numero: "10",
    bairro: "Centro", municipio: "Curitiba", uf: "PR", cep: "80000-000" },
  itens: [
    { codigo: "IM-3510", descricao: "Implante", ncm: "90213190", cfop: "5101", quantidade: 3, valorUnitario: 33.33 },
    { codigo: "CP-1020", descricao: "Parafuso", ncm: "90211020", cfop: "5101", quantidade: 1, valorUnitario: 10, descontoPct: 10 },
  ],
  frete: 10, formaPagamento: "15",
};

describe("NF-e (Focus NFe)", () => {
  it("valida documentos e chave", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("11111111111")).toBe(false);
    expect(chaveValida("35260912345678000190550010000001231123456780")).toBe(false);
  });
  it("ajusta CFOP e alíquota interestadual", () => {
    expect(ajustarCfop("5101", true, false)).toBe("6101");
    expect(ajustarCfop("6101", false, false)).toBe("5101");
    expect(ajustarCfop("5202", true, true)).toBe("2202");
    expect(aliquotaInterestadual("SP", "PR")).toBe(12);
    expect(aliquotaInterestadual("SP", "BA")).toBe(7);
  });
  it("monta nota interestadual com totais em centavos e frete rateado", () => {
    const n = montarNotaFocus(base) as unknown as NotaTest;
    expect(n.local_destino).toBe(2);
    expect(n.cnpj_destinatario).toBe("11444777000161");
    expect(n.indicador_inscricao_estadual_destinatario).toBe(1);
    expect(n.consumidor_final).toBe(0);
    expect(n.items[0].cfop).toBe("6101");
    expect(n.items[0].valor_bruto).toBe(99.99);
    expect(n.items[1].valor_desconto).toBe(1);
    const freteItens = n.items.reduce((s: number, i: NotaItemTest) => s + Math.round((i.valor_frete ?? 0) * 100), 0);
    expect(freteItens).toBe(1000);
    expect(n.formas_pagamento[0].valor_pagamento).toBe(118.99); // 99,99 + 9,00 + 10,00
    expect(n.items[0].icms_situacao_tributaria).toBe("102");
  });
  it("cliente sem IE vira consumidor final (evita rejeição 696)", () => {
    const n = montarNotaFocus({ ...base, destinatario: { ...base.destinatario, ie: "" } }) as unknown as NotaTest;
    expect(n.indicador_inscricao_estadual_destinatario).toBe(9);
    expect(n.consumidor_final).toBe(1);
  });
  it("regime normal calcula ICMS/PIS/COFINS e IPI zero", () => {
    const n = montarNotaFocus({ ...base, emitente: { ...base.emitente, crt: 3 } }) as unknown as NotaTest;
    expect(n.items[0].icms_situacao_tributaria).toBe("00");
    expect(n.items[0].icms_aliquota).toBe(12);
    expect(n.items[0].pis_situacao_tributaria).toBe("01");
    expect(n.items[0].ipi_situacao_tributaria).toBe("51");
  });
  it("devolução: entrada, finalidade 4, chave referenciada e pagamento 90", () => {
    const chave = "35260911222333000181550010000001231123456789";
    const n = montarNotaFocus({ ...base, tipo: "devolucao", chaveReferenciada: chave }) as unknown as NotaTest;
    expect(n.tipo_documento).toBe(0);
    expect(n.finalidade_emissao).toBe(4);
    expect(n.items[0].cfop).toBe("2101");
    expect(n.notas_referenciadas[0].chave_nfe).toBe(chave);
    expect(n.formas_pagamento[0].forma_pagamento).toBe("90");
  });
  it("aponta problemas antes de enviar", () => {
    const erros = validarNota({ ...base, destinatario: { ...base.destinatario, cep: "1", documento: "123" } });
    expect(erros.some(e => e.includes("CEP"))).toBe(true);
    expect(erros.some(e => e.includes("CPF/CNPJ"))).toBe(true);
    expect(validarNota(base)).toEqual([]);
  });
  it("data de emissão em horário de Brasília", () => {
    expect(agoraBrasilia(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-27T12:00:00-03:00");
    expect(statusFocus("autorizado")).toBe("autorizada");
    expect(statusFocus("processando_autorizacao")).toBe("processando");
  });
});

describe("NF-e — regras extras", () => {
  it("duplicatas somam o total da nota e DIFAL bloqueia regime normal interestadual a consumidor", () => {
    const n = montarNotaFocus({ ...base, parcelas: [{ vencimento: "2026-10-27", valor: 0 }, { vencimento: "2026-11-26", valor: 0 }, { vencimento: "2026-12-26", valor: 0 }] }) as unknown as NotaTest;
    const soma = n.duplicatas.reduce((s: number, d: { valor: number }) => s + Math.round(d.valor * 100), 0);
    expect(soma).toBe(Math.round(n.formas_pagamento[0].valor_pagamento * 100));
    const erros = validarNota({ ...base, emitente: { ...base.emitente, crt: 3 }, destinatario: { ...base.destinatario, ie: "" } });
    expect(erros.some(e => e.includes("DIFAL"))).toBe(true);
  });
  it("IPI entra no total no regime normal", () => {
    const n = montarNotaFocus({ ...base, frete: 0, emitente: { ...base.emitente, crt: 3 }, itens: [{ ...base.itens[0], aliquotaIpi: 10 }] }) as unknown as NotaTest;
    expect(n.items[0].ipi_valor).toBe(10);
    expect(n.formas_pagamento[0].valor_pagamento).toBe(109.99);
  });
});
