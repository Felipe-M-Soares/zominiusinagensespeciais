/**
 * Montagem da NF-e no formato do emissor Focus NFe (API v2, JSON).
 *
 * Módulo PURO (sem Deno/Node): usado pela edge function "nfe" e testado no
 * Vitest. Toda conta de dinheiro é feita em centavos (inteiros) para os
 * totais baterem com a soma dos itens (regra de validação da SEFAZ).
 *
 * O que o emissor faz por nós: numeração/série, assinatura com o certificado
 * A1, transmissão, contingência, grupo do responsável técnico, DANFE e XML.
 */

export type Crt = 1 | 2 | 3 | 4;
export type TipoNota = "venda" | "devolucao" | "troca";

export interface Emitente {
  cnpj: string;
  uf: string;
  crt: Crt;
  pisAliquota?: number;    // % (regime normal cumulativo: 0,65)
  cofinsAliquota?: number; // % (regime normal cumulativo: 3,00)
  aliquotaInterna?: number; // % ICMS dentro do estado (SP: 18)
}

export interface Destinatario {
  nome: string;
  documento: string;   // CPF (11) ou CNPJ (14), só números
  ie?: string | null;  // número, "ISENTO" ou vazio
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  codigoMunicipio?: string | null;
  uf: string;
  cep: string;
  telefone?: string | null;
  email?: string | null;
}

export interface ItemNota {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade?: string;
  quantidade: number;
  valorUnitario: number;     // R$
  descontoPct?: number;      // % sobre o item
  gtin?: string | null;
  cstIcms?: string | null;   // CST (regime normal) ou CSOSN (Simples)
  aliquotaIcms?: number | null;
  aliquotaIpi?: number | null;
  lote?: string | null;
  validade?: string | null;  // AAAA-MM-DD
  registroAnvisa?: string | null;
  udi?: string | null;
}

export interface DadosNota {
  tipo: TipoNota;
  natureza: string;
  dataEmissao: string;        // ISO com fuso (-03:00)
  emitente: Emitente;
  destinatario: Destinatario;
  itens: ItemNota[];
  frete?: number;
  modalidadeFrete?: 0 | 1 | 2 | 9;
  formaPagamento?: string;    // código tPag (01, 03, 04, 15, 17, 99...)
  parcelas?: { vencimento: string; valor: number }[];
  chaveReferenciada?: string | null;
  informacoes?: string | null;
}

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const centavos = (v: number) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => Number((c / 100).toFixed(2));

/** Formas de pagamento do sistema → código tPag da NF-e. */
export const FORMA_PAGAMENTO_TPAG: Record<string, string> = {
  dinheiro: "01", cheque: "02", cartao_credito: "03", cartao_debito: "04",
  boleto: "15", deposito: "16", pix: "17", transferencia: "18", sem_pagamento: "90", outros: "99",
};

/** Alíquota interestadual de ICMS (Res. Senado 22/89): S/SE → N/NE/CO/ES = 7%, demais 12%. */
export function aliquotaInterestadual(ufOrigem: string, ufDestino: string): number {
  const sulSudesteSemES = ["SP", "RJ", "MG", "PR", "SC", "RS"];
  if (ufOrigem === ufDestino) return 0;
  if (sulSudesteSemES.includes(ufOrigem) && !sulSudesteSemES.includes(ufDestino)) return 7;
  return 12;
}

/** Ajusta o 1º dígito do CFOP conforme a operação ser dentro (5/1) ou fora (6/2) do estado. */
export function ajustarCfop(cfop: string, interestadual: boolean, entrada: boolean): string {
  const c = soDigitos(cfop).padEnd(4, "0").slice(0, 4);
  const resto = c.slice(1);
  if (entrada) return (interestadual ? "2" : "1") + resto;
  return (interestadual ? "6" : "5") + resto;
}

export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Chave de acesso: 44 dígitos com dígito verificador (módulo 11). */
export function chaveValida(chave: string): boolean {
  const d = soDigitos(chave);
  if (d.length !== 44) return false;
  let s = 0, p = 2;
  for (let i = 42; i >= 0; i--) { s += Number(d[i]) * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11;
  return (r < 2 ? 0 : 11 - r) === Number(d[43]);
}

/** Lista de problemas que impedem a emissão (texto para o usuário). */
export function validarNota(d: DadosNota): string[] {
  const erros: string[] = [];
  const e = d.emitente, dest = d.destinatario;
  if (!cnpjValido(e.cnpj)) erros.push("CNPJ da empresa (emitente) inválido — confira em Configurações.");
  if (!e.crt) erros.push("Regime tributário (CRT) da empresa não informado — confira em Configurações.");
  const doc = soDigitos(dest.documento);
  if (!(doc.length === 11 ? cpfValido(doc) : cnpjValido(doc))) erros.push("CPF/CNPJ do cliente inválido.");
  if (!dest.nome?.trim()) erros.push("Nome do cliente vazio.");
  if (!dest.logradouro?.trim() || !dest.numero?.trim() || !dest.bairro?.trim() || !dest.municipio?.trim())
    erros.push("Endereço do cliente incompleto (rua, número, bairro e cidade).");
  if (!/^[A-Z]{2}$/.test(dest.uf ?? "")) erros.push("UF do cliente inválida.");
  if (soDigitos(dest.cep).length !== 8) erros.push("CEP do cliente inválido.");
  if (!d.itens.length) erros.push("A nota não tem itens.");
  d.itens.forEach((it, i) => {
    const n = `Item ${i + 1} (${it.codigo || it.descricao})`;
    if (soDigitos(it.ncm).length !== 8) erros.push(`${n}: NCM deve ter 8 números.`);
    if (!/^\d{4}$/.test(soDigitos(it.cfop))) erros.push(`${n}: CFOP inválido.`);
    if (!(it.quantidade > 0)) erros.push(`${n}: quantidade deve ser maior que zero.`);
    if (!(it.valorUnitario > 0) && d.tipo === "venda") erros.push(`${n}: sem preço.`);
  });
  const docDest = soDigitos(dest.documento);
  const ieDest = (dest.ie ?? "").trim().toUpperCase();
  const naoContribuinte = !(docDest.length === 14 && ieDest && ieDest !== "ISENTO");
  if (d.tipo === "venda" && e.crt === 3 && dest.uf !== e.uf && naoContribuinte)
    erros.push("Venda para outro estado a não contribuinte (consumidor final) exige o cálculo do DIFAL — emita esta nota pelo painel do emissor ou peça ao contador para configurar.");
  d.itens.forEach((it, i) => {
    if (e.crt === 3 && it.cstIcms && !["00", "40", "41", "50", "51", "60", "90"].includes(it.cstIcms))
      erros.push(`Item ${i + 1}: CST ${it.cstIcms} não suportado aqui (exige campos extras) — use 00, 40, 41, 50, 51, 60 ou 90.`);
  });
  if (d.tipo !== "venda" && !chaveValida(d.chaveReferenciada ?? ""))
    erros.push("Devolução exige a chave (44 números) da NF-e de venda original.");
  return erros;
}

/** Monta o JSON da NF-e no formato Focus NFe v2. */
export function montarNotaFocus(d: DadosNota): Record<string, unknown> {
  const e = d.emitente, dest = d.destinatario;
  const entrada = d.tipo !== "venda";                    // devolução/troca recebida = nota de entrada
  const interestadual = dest.uf !== e.uf;
  const simples = e.crt === 1 || e.crt === 2 || e.crt === 4;
  const doc = soDigitos(dest.documento);
  const ie = (dest.ie ?? "").trim().toUpperCase();
  const indIE = doc.length === 14 && ie && ie !== "ISENTO" ? 1 : doc.length === 14 && ie === "ISENTO" ? 2 : 9;
  const consumidorFinal = indIE === 9 ? 1 : 0;           // não contribuinte é sempre consumidor final (regra 696)

  // Valores por item em centavos + rateio do frete (sobra vai no último item)
  const brutos = d.itens.map(it => Math.round(centavos(it.valorUnitario) * it.quantidade));
  const descontos = d.itens.map((it, i) => Math.round(brutos[i] * Math.min(100, Math.max(0, it.descontoPct ?? 0)) / 100));
  const liquidos = brutos.map((b, i) => b - descontos[i]);
  const totalLiq = liquidos.reduce((a, b) => a + b, 0);
  const freteC = centavos(d.frete ?? 0);
  const fretes = liquidos.map(() => 0);
  if (freteC > 0 && totalLiq > 0) {
    let acum = 0;
    liquidos.forEach((l, i) => {
      fretes[i] = i === liquidos.length - 1 ? freteC - acum : Math.floor(freteC * l / totalLiq);
      acum += fretes[i];
    });
  }

  const ipiItens = d.itens.map(() => 0);
  const itens = d.itens.map((it, i) => {
    const qtd = Number(it.quantidade.toFixed(4));
    const vUnit = Number(it.valorUnitario.toFixed(4));
    const base: Record<string, unknown> = {
      numero_item: i + 1,
      codigo_produto: it.codigo.slice(0, 60),
      descricao: it.descricao.slice(0, 120),
      cfop: ajustarCfop(it.cfop, interestadual, entrada),
      codigo_ncm: soDigitos(it.ncm),
      unidade_comercial: (it.unidade ?? "UN").slice(0, 6),
      quantidade_comercial: qtd,
      valor_unitario_comercial: vUnit,
      valor_bruto: reais(brutos[i]),
      unidade_tributavel: (it.unidade ?? "UN").slice(0, 6),
      quantidade_tributavel: qtd,
      valor_unitario_tributavel: vUnit,
      codigo_barras_comercial: soDigitos(it.gtin).length >= 8 ? soDigitos(it.gtin) : "SEM GTIN",
      codigo_barras_tributavel: soDigitos(it.gtin).length >= 8 ? soDigitos(it.gtin) : "SEM GTIN",
      inclui_no_total: 1,
      icms_origem: 0,
    };
    if (descontos[i] > 0) base.valor_desconto = reais(descontos[i]);
    if (fretes[i] > 0) base.valor_frete = reais(fretes[i]);

    const baseIcmsC = liquidos[i] + fretes[i];
    if (simples) {
      base.icms_situacao_tributaria = it.cstIcms || "102";
      base.pis_situacao_tributaria = entrada ? "99" : "49";
      base.cofins_situacao_tributaria = entrada ? "99" : "49";
    } else {
      const cst = it.cstIcms || "00";
      base.icms_situacao_tributaria = cst;
      if (cst === "00") {
        const aliq = it.aliquotaIcms ?? (interestadual ? aliquotaInterestadual(e.uf, dest.uf) : (e.aliquotaInterna ?? 18));
        base.icms_modalidade_base_calculo = 3;
        base.icms_base_calculo = reais(baseIcmsC);
        base.icms_aliquota = aliq;
        base.icms_valor = reais(Math.round(baseIcmsC * aliq / 100));
      }
      const pis = e.pisAliquota ?? 0.65, cofins = e.cofinsAliquota ?? 3;
      if (entrada) {
        base.pis_situacao_tributaria = "98";
        base.cofins_situacao_tributaria = "98";
      } else {
      base.pis_situacao_tributaria = "01";
      base.pis_base_calculo = reais(liquidos[i]);
      base.pis_aliquota_porcentual = pis;
      base.pis_valor = reais(Math.round(liquidos[i] * pis / 100));
      base.cofins_situacao_tributaria = "01";
      base.cofins_base_calculo = reais(liquidos[i]);
      base.cofins_aliquota_porcentual = cofins;
      base.cofins_valor = reais(Math.round(liquidos[i] * cofins / 100));
      }
      const ipi = it.aliquotaIpi ?? 0;
      base.ipi_codigo_enquadramento_legal = "999";
      if (ipi > 0) {
        base.ipi_situacao_tributaria = entrada ? "00" : "50";
        base.ipi_base_calculo = reais(liquidos[i]);
        base.ipi_aliquota = ipi;
        base.ipi_valor = reais(Math.round(liquidos[i] * ipi / 100));
        ipiItens[i] = Math.round(liquidos[i] * ipi / 100);
      } else {
        base.ipi_situacao_tributaria = entrada ? "03" : "51";
      }
    }
    // Rastreabilidade (RDC ANVISA 665/2022): lote, validade, registro e UDI no próprio item
    const rastro = [
      it.lote ? `Lote ${it.lote}` : "",
      it.validade ? `Val. ${it.validade.split("-").reverse().join("/")}` : "",
      it.registroAnvisa ? `Reg. ANVISA ${it.registroAnvisa}` : "",
      it.udi ? `UDI ${it.udi}` : "",
    ].filter(Boolean).join(" · ");
    if (rastro) base.informacoes_adicionais_item = rastro.slice(0, 500);
    return base;
  });

  const totalNotaC = totalLiq + freteC + ipiItens.reduce((a, b) => a + b, 0);
  const nota: Record<string, unknown> = {
    natureza_operacao: d.natureza.slice(0, 60),
    data_emissao: d.dataEmissao,
    tipo_documento: entrada ? 0 : 1,
    local_destino: interestadual ? 2 : 1,
    finalidade_emissao: entrada ? 4 : 1,
    consumidor_final: consumidorFinal,
    presenca_comprador: entrada ? 0 : 9,
    cnpj_emitente: soDigitos(e.cnpj),
    nome_destinatario: dest.nome.slice(0, 60),
    [doc.length === 11 ? "cpf_destinatario" : "cnpj_destinatario"]: doc,
    indicador_inscricao_estadual_destinatario: indIE,
    logradouro_destinatario: dest.logradouro.slice(0, 60),
    numero_destinatario: dest.numero.slice(0, 60),
    bairro_destinatario: dest.bairro.slice(0, 60),
    municipio_destinatario: dest.municipio.slice(0, 60),
    uf_destinatario: dest.uf,
    cep_destinatario: soDigitos(dest.cep),
    pais_destinatario: "Brasil",
    modalidade_frete: freteC > 0 ? (d.modalidadeFrete ?? 0) : (d.modalidadeFrete ?? 9),
    items: itens,
  };
  if (indIE === 1) nota.inscricao_estadual_destinatario = soDigitos(ie);
  if (dest.complemento) nota.complemento_destinatario = dest.complemento.slice(0, 60);
  if (dest.codigoMunicipio) nota.codigo_municipio_destinatario = soDigitos(dest.codigoMunicipio);
  if (dest.telefone) nota.telefone_destinatario = soDigitos(dest.telefone).slice(0, 14);
  if (dest.email) nota.email_destinatario = dest.email.trim();
  if (freteC > 0) nota.valor_frete = reais(freteC);

  if (entrada) {
    nota.notas_referenciadas = [{ chave_nfe: soDigitos(d.chaveReferenciada) }];
    nota.formas_pagamento = [{ forma_pagamento: "90", valor_pagamento: 0 }];
  } else {
    nota.formas_pagamento = [{ forma_pagamento: d.formaPagamento || "99", valor_pagamento: reais(totalNotaC) }];
    if (d.parcelas && d.parcelas.length > 0) {
      // valores recalculados sobre o total da nota (inclui IPI/frete) — a soma bate com a fatura
      const n = d.parcelas.length;
      let acum = 0;
      nota.duplicatas = d.parcelas.map((p, i) => {
        const v = i < n - 1 ? Math.floor(totalNotaC / n) : totalNotaC - acum; acum += v;
        return { numero: String(i + 1).padStart(3, "0"), data_vencimento: p.vencimento, valor: reais(v) };
      });
    }
  }
  if (d.informacoes?.trim()) nota.informacoes_adicionais_contribuinte = d.informacoes.trim().slice(0, 2000);
  return nota;
}

/** Data/hora atual em Brasília com fuso explícito (evita "data de emissão no futuro"). */
export function agoraBrasilia(agora = new Date()): string {
  const local = new Date(agora.getTime() - 3 * 3600_000);
  return local.toISOString().slice(0, 19) + "-03:00";
}

/** Situação retornada pela Focus → situação no sistema. */
export function statusFocus(s: string | undefined): "processando" | "autorizada" | "rejeitada" | "cancelada" | "denegada" {
  switch (s) {
    case "autorizado": return "autorizada";
    case "cancelado": return "cancelada";
    case "denegado": return "denegada";
    case "erro_autorizacao": return "rejeitada";
    default: return "processando";
  }
}
