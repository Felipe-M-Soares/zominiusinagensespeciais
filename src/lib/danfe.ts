/**
 * src/lib/danfe.ts
 *
 * Gerador único do DANFE (Documento Auxiliar da Nota Fiscal Eletrônica),
 * seguindo o layout padrão do SEFAZ (o mesmo modelo que qualquer emissor de
 * NF-e no Brasil usa): canhoto de recebimento, cabeçalho com o quadro
 * "DANFE" e a chave de acesso, natureza da operação, destinatário/remetente,
 * cálculo do imposto, transportador/volumes, tabela de produtos/serviços e
 * dados adicionais.
 *
 * Usado tanto para a NF-e de venda (Financeiro → NFViewerModal) quanto para
 * a NF-e de devolução/troca (Financeiro → DevolucaoTrocaPanel) — mesma
 * função, dados diferentes — pra manter as duas com a cara idêntica de uma
 * nota fiscal de verdade.
 */
import { escHtml } from "@/lib/escHtml";

// ── Dados da empresa emitente ────────────────────────────────────────────────
// A emissão real para o SEFAZ usa os secrets SEFAZ_CNPJ / SEFAZ_RAZAO_SOCIAL
// etc. (só existem no servidor, nunca chegam ao navegador). Para exibição e
// impressão do DANFE no navegador, ajuste os dados reais da empresa aqui uma
// vez só — todas as notas (venda e devolução/troca) usam este mesmo bloco.
export const EMITENTE = {
  nome: "ZOMINI USINAGENS ESPECIAIS LTDA",
  logradouro: "Endereço da empresa, 000",
  bairro: "Bairro",
  cep: "00000-000",
  municipio: "Cidade",
  uf: "UF",
  telefone: "(00) 0000-0000",
  email: "contato@zomini.com.br",
  cnpj: "00.000.000/0001-00",
  ie: "000000000",
};

export interface DanfeItem {
  codigo?: string;
  descricao: string;
  ncm?: string;
  cfop?: string;
  cst?: string; // CST (regime normal) ou CSOSN (Simples Nacional) — mesmo campo
  unidade?: string;
  quantidade: number;
  valorUnitario: number;
  valorDesconto?: number;
  aliqIcms?: number;
  aliqIpi?: number;
}

export interface DanfeDados {
  tipoOperacao: "entrada" | "saida";
  naturezaOperacao: string;
  numero: string;
  serie: string;
  chaveAcesso?: string | null;
  protocolo?: string | null;
  dataEmissao: string; // já formatada (dd/mm/aaaa hh:mm) ou ISO
  dataSaida?: string | null;
  destinatario: {
    nome: string;
    documento?: string | null;
    ie?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cep?: string | null;
    municipio?: string | null;
    uf?: string | null;
    telefone?: string | null;
  };
  transportador?: {
    nome?: string | null;
    fretePorConta?: string | null;
    placa?: string | null;
    uf?: string | null;
    documento?: string | null;
  } | null;
  itens: DanfeItem[];
  valorFrete?: number;
  valorSeguro?: number;
  outrasDespesas?: number;
  observacoes?: string | null;
  faixaSuperior?: string | null; // texto extra acima do DANFE (ex: "NFe sem Autorização de Uso da SEFAZ" em modo teste)
}

function fmtMoeda(v: number): string {
  return (v || 0).toFixed(2).replace(".", ",");
}
function fmtData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}
function fmtHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtChave(chave?: string | null): string {
  if (!chave) return "";
  return chave.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** Barras verticais simples pra dar a impressão visual de um código de barras (não é um barcode real/escaneável). */
function barcodeVisual(seed: string): string {
  let bars = "";
  const chars = (seed || "0").split("");
  for (let i = 0; i < 60; i++) {
    const c = chars[i % chars.length] || "0";
    const w = (c.charCodeAt(0) % 3) + 1;
    bars += `<div style="width:${w}px;background:#111;height:100%;${i % 5 === 0 ? "margin-right:1px" : ""}"></div>`;
  }
  return bars;
}

export function gerarDanfeHtml(d: DanfeDados): string {
  const esc = escHtml;
  const totalProdutos = d.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
  const totalDesconto = d.itens.reduce((s, i) => s + (i.valorDesconto ?? 0), 0);
  const valorFrete = d.valorFrete ?? 0;
  const valorSeguro = d.valorSeguro ?? 0;
  const outrasDespesas = d.outrasDespesas ?? 0;
  const valorIpiTotal = 0; // este emissor não trabalha com IPI destacado
  const totalNota = totalProdutos - totalDesconto + valorFrete + valorSeguro + outrasDespesas + valorIpiTotal;
  const chaveFmt = fmtChave(d.chaveAcesso);
  const enderecoEmitCompleto = `${EMITENTE.logradouro}`;
  const enderecoDestCompleto = d.destinatario.endereco ?? "—";

  const itensRows = d.itens.map(i => {
    const total = i.quantidade * i.valorUnitario - (i.valorDesconto ?? 0);
    return `<tr>
      <td class="c">${esc(i.codigo ?? "—")}</td>
      <td>${esc(i.descricao)}</td>
      <td class="c">${esc(i.ncm ?? "—")}</td>
      <td class="c">${esc(i.cst ?? "—")}</td>
      <td class="c">${esc(i.cfop ?? "—")}</td>
      <td class="c">${esc(i.unidade ?? "UN")}</td>
      <td class="r">${i.quantidade}</td>
      <td class="r">${fmtMoeda(i.valorUnitario)}</td>
      <td class="r">${fmtMoeda(i.valorDesconto ?? 0)}</td>
      <td class="r"><strong>${fmtMoeda(total)}</strong></td>
      <td class="r">0,00</td>
      <td class="r">0,00</td>
      <td class="r">0,00</td>
      <td class="c">${i.aliqIcms ? i.aliqIcms.toFixed(2).replace(".", ",") : "0,00"}</td>
      <td class="c">${i.aliqIpi ? i.aliqIpi.toFixed(2).replace(".", ",") : "0,00"}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>DANFE — ${esc(d.numero)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:7.5pt;color:#000;background:#fff;padding:6mm}
  .danfe{width:100%;max-width:210mm;margin:0 auto;border:1px solid #000}
  .lbl{font-size:6pt;font-weight:700;text-transform:uppercase;color:#333}
  .val{font-size:8pt;font-weight:600;margin-top:0.5mm}
  table{width:100%;border-collapse:collapse}
  .grid{display:grid}
  .bd-b{border-bottom:1px solid #000}
  .bd-r{border-right:1px solid #000}
  .p{padding:1mm 2mm}
  .center{text-align:center}
  .right{text-align:right}
  .bold{font-weight:700}

  /* Canhoto */
  .canhoto{display:grid;grid-template-columns:1fr 45mm}
  .canhoto-texto{padding:1.5mm 2mm;font-size:7pt;line-height:1.5}
  .canhoto-nf{padding:1.5mm 2mm;text-align:center;border-left:1px solid #000}
  .canhoto-nf .t1{font-size:8pt;font-weight:800}
  .canhoto-nf .t2{font-size:9pt;font-weight:900;margin-top:1mm}
  .canhoto-assinatura{display:grid;grid-template-columns:35mm 1fr;font-size:6pt;font-weight:700;text-transform:uppercase}

  /* Cabeçalho principal */
  .cabecalho{display:grid;grid-template-columns:1fr 38mm 55mm}
  .cab-emit{padding:2mm}
  .cab-emit .nome{font-size:10pt;font-weight:900;margin-bottom:1mm}
  .cab-emit .linha{font-size:7pt;line-height:1.5}
  .cab-danfe{padding:2mm;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8mm}
  .cab-danfe .t{font-size:13pt;font-weight:900;letter-spacing:1px}
  .cab-danfe .sub{font-size:6pt;line-height:1.3}
  .tipo-box{display:flex;border:1px solid #000;margin:1mm 0}
  .tipo-box .op{padding:0.5mm 1.5mm;font-size:6pt;border-right:1px solid #000}
  .tipo-box .num{padding:0.5mm 2mm;font-size:9pt;font-weight:900}
  .cab-danfe .nf-serie{font-size:7pt;font-weight:700;margin-top:1mm}
  .cab-chave{padding:2mm;font-size:6.5pt}
  .barcode{display:flex;height:11mm;align-items:stretch;margin:1mm 0}
  .chave-txt{font-family:monospace;font-size:7.5pt;letter-spacing:0.5px;word-break:break-all;text-align:center;margin:1mm 0}
  .consulta{font-size:6pt;text-align:center;color:#333;line-height:1.3}

  /* Linhas de campos genéricas */
  .linha-campos{display:grid;border-bottom:1px solid #000}
  .campo{padding:1mm 2mm;border-right:1px solid #000}
  .campo:last-child{border-right:none}

  /* Blocos com título de seção */
  .secao-titulo{background:#fff;font-size:6.5pt;font-weight:800;text-transform:uppercase;padding:0.8mm 2mm;border-bottom:1px solid #000}

  /* Tabela de produtos */
  .itens-table{font-size:7pt}
  .itens-table th{font-size:6pt;text-transform:uppercase;font-weight:700;padding:1mm 1mm;border:1px solid #000;background:#fff}
  .itens-table td{padding:1mm 1mm;border:1px solid #000;vertical-align:top}
  .c{text-align:center} .r{text-align:right}

  /* Dados adicionais */
  .adicionais{display:grid;grid-template-columns:1fr 45mm;min-height:28mm}
  .adicionais .col{padding:1mm 2mm;font-size:7pt}
  .adicionais .col.esq{border-right:1px solid #000}

  .rodape{padding:1.5mm 2mm;font-size:6.5pt;color:#333;display:flex;justify-content:space-between}
  .faixa-teste{background:#000;color:#fff;text-align:center;font-size:8pt;font-weight:800;padding:1mm;letter-spacing:1px}

  @media print{body{padding:2mm}@page{margin:5mm}}
</style></head>
<body><div class="danfe">

  ${d.faixaSuperior ? `<div class="faixa-teste">${esc(d.faixaSuperior)}</div>` : ""}

  <!-- Canhoto / recibo de entrega -->
  <div class="canhoto bd-b">
    <div class="canhoto-texto">
      Recebemos de <strong>${esc(EMITENTE.nome)}</strong> os produtos e/ou serviços constantes da Nota Fiscal Eletrônica
      indicada ao lado. Emissão: ${fmtData(d.dataEmissao)} &nbsp; Dest/Reme: ${esc(d.destinatario.nome)} &nbsp;
      Valor Total: ${fmtMoeda(totalNota)}
    </div>
    <div class="canhoto-nf">
      <div class="t1">NF-e</div>
      <div class="t2">Nº ${esc(d.numero.padStart(9, "0"))}</div>
      <div style="font-size:7pt;margin-top:0.5mm">Série ${esc(d.serie.padStart(3, "0"))}</div>
    </div>
  </div>
  <div class="canhoto-assinatura bd-b">
    <div class="p bd-r">Data do Recebimento</div>
    <div class="p">Identificação e Assinatura do Recebedor</div>
  </div>

  <!-- Cabeçalho principal -->
  <div class="cabecalho bd-b">
    <div class="cab-emit bd-r">
      <div class="nome">${esc(EMITENTE.nome)}</div>
      <div class="linha">${esc(enderecoEmitCompleto)} — CEP: ${esc(EMITENTE.cep)}</div>
      <div class="linha">Bairro ${esc(EMITENTE.bairro)}</div>
      <div class="linha">${esc(EMITENTE.municipio)} — ${esc(EMITENTE.uf)}</div>
      <div class="linha">Fone: ${esc(EMITENTE.telefone)} · ${esc(EMITENTE.email)}</div>
    </div>
    <div class="cab-danfe bd-r">
      <div class="t">DANFE</div>
      <div class="sub">Documento Auxiliar da<br>Nota Fiscal Eletrônica</div>
      <div class="tipo-box">
        <div class="op">0 - ENTRADA<br>1 - SAÍDA</div>
        <div class="num">${d.tipoOperacao === "entrada" ? "0" : "1"}</div>
      </div>
      <div class="nf-serie">Nº ${esc(d.numero.padStart(9, "0"))}</div>
      <div class="nf-serie">SÉRIE ${esc(d.serie.padStart(3, "0"))} &nbsp; FOLHA 1/1</div>
    </div>
    <div class="cab-chave">
      <div class="barcode">${barcodeVisual(d.chaveAcesso ?? d.numero)}</div>
      <div class="chave-txt">${esc(chaveFmt || "—")}</div>
      <div class="consulta">Consulta de autenticidade no portal nacional da NF-e<br>www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora</div>
    </div>
  </div>

  <div class="linha-campos bd-b" style="grid-template-columns:1fr 45mm">
    <div class="campo bd-r"><div class="lbl">Natureza da Operação</div><div class="val">${esc(d.naturezaOperacao)}</div></div>
    <div class="campo"><div class="lbl">Protocolo de Autorização de Uso</div><div class="val" style="font-size:6.5pt">${esc(d.protocolo ?? "—")}</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 1fr 1fr">
    <div class="campo bd-r"><div class="lbl">Inscrição Estadual</div><div class="val">${esc(EMITENTE.ie)}</div></div>
    <div class="campo bd-r"><div class="lbl">Insc. Estadual do Subst. Tributário</div><div class="val">—</div></div>
    <div class="campo"><div class="lbl">CNPJ</div><div class="val">${esc(EMITENTE.cnpj)}</div></div>
  </div>

  <div class="secao-titulo">Destinatário / Remetente</div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 45mm 30mm">
    <div class="campo bd-r"><div class="lbl">Nome / Razão Social</div><div class="val">${esc(d.destinatario.nome)}</div></div>
    <div class="campo bd-r"><div class="lbl">CNPJ / CPF</div><div class="val">${esc(d.destinatario.documento ?? "—")}</div></div>
    <div class="campo"><div class="lbl">Data da Emissão</div><div class="val">${fmtData(d.dataEmissao)}</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 30mm 22mm 22mm">
    <div class="campo bd-r"><div class="lbl">Endereço</div><div class="val">${esc(enderecoDestCompleto)}</div></div>
    <div class="campo bd-r"><div class="lbl">Bairro / Distrito</div><div class="val">${esc(d.destinatario.bairro ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">CEP</div><div class="val">${esc(d.destinatario.cep ?? "—")}</div></div>
    <div class="campo"><div class="lbl">Data da Saída</div><div class="val">${fmtData(d.dataSaida)}</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 15mm 30mm 30mm 22mm">
    <div class="campo bd-r"><div class="lbl">Município</div><div class="val">${esc(d.destinatario.municipio ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">UF</div><div class="val">${esc(d.destinatario.uf ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">Telefone / Fax</div><div class="val">${esc(d.destinatario.telefone ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">Inscrição Estadual</div><div class="val">${esc(d.destinatario.ie ?? "—")}</div></div>
    <div class="campo"><div class="lbl">Hora da Saída</div><div class="val">${fmtHora(d.dataSaida)}</div></div>
  </div>

  <div class="secao-titulo">Cálculo do Imposto</div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 1fr 1fr 1fr 1.3fr">
    <div class="campo bd-r"><div class="lbl">Base de Cálculo do ICMS</div><div class="val">0,00</div></div>
    <div class="campo bd-r"><div class="lbl">Valor do ICMS</div><div class="val">0,00</div></div>
    <div class="campo bd-r"><div class="lbl">Base Cálc. ICMS Subst.</div><div class="val">0,00</div></div>
    <div class="campo bd-r"><div class="lbl">Valor do ICMS Subst.</div><div class="val">0,00</div></div>
    <div class="campo"><div class="lbl">Valor Total dos Produtos</div><div class="val">${fmtMoeda(totalProdutos)}</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 1fr 1fr 1.2fr 1fr 1.3fr">
    <div class="campo bd-r"><div class="lbl">Valor do Frete</div><div class="val">${fmtMoeda(valorFrete)}</div></div>
    <div class="campo bd-r"><div class="lbl">Valor do Seguro</div><div class="val">${fmtMoeda(valorSeguro)}</div></div>
    <div class="campo bd-r"><div class="lbl">Desconto</div><div class="val">${fmtMoeda(totalDesconto)}</div></div>
    <div class="campo bd-r"><div class="lbl">Outras Despesas Acessórias</div><div class="val">${fmtMoeda(outrasDespesas)}</div></div>
    <div class="campo bd-r"><div class="lbl">Valor do IPI</div><div class="val">${fmtMoeda(valorIpiTotal)}</div></div>
    <div class="campo"><div class="lbl">Valor Total da Nota</div><div class="val bold" style="font-size:9pt">${fmtMoeda(totalNota)}</div></div>
  </div>

  <div class="secao-titulo">Transportador / Volumes Transportados</div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 25mm 22mm 22mm 12mm 30mm">
    <div class="campo bd-r"><div class="lbl">Nome / Razão Social</div><div class="val">${esc(d.transportador?.nome ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">Frete por Conta</div><div class="val">${esc(d.transportador?.fretePorConta ?? "0 - Remetente")}</div></div>
    <div class="campo bd-r"><div class="lbl">Código ANTT</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Placa do Veículo</div><div class="val">${esc(d.transportador?.placa ?? "—")}</div></div>
    <div class="campo bd-r"><div class="lbl">UF</div><div class="val">${esc(d.transportador?.uf ?? "—")}</div></div>
    <div class="campo"><div class="lbl">CNPJ / CPF</div><div class="val">${esc(d.transportador?.documento ?? "—")}</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 30mm 15mm 30mm">
    <div class="campo bd-r"><div class="lbl">Endereço</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Município</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">UF</div><div class="val">—</div></div>
    <div class="campo"><div class="lbl">Inscrição Estadual</div><div class="val">—</div></div>
  </div>
  <div class="linha-campos bd-b" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr">
    <div class="campo bd-r"><div class="lbl">Quantidade</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Espécie</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Marca</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Numeração</div><div class="val">—</div></div>
    <div class="campo bd-r"><div class="lbl">Peso Bruto</div><div class="val">—</div></div>
    <div class="campo"><div class="lbl">Peso Líquido</div><div class="val">—</div></div>
  </div>

  <div class="secao-titulo">Dados dos Produtos / Serviços</div>
  <table class="itens-table">
    <thead><tr>
      <th>Código</th><th>Descrição do Produto / Serviço</th><th>NCM/SH</th><th>CST/CSOSN</th><th>CFOP</th>
      <th>Unid.</th><th>Qtde</th><th>Valor Unit.</th><th>Valor Desc.</th><th>Valor Total</th>
      <th>Base Cálc. ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th>
    </tr></thead>
    <tbody>${itensRows}</tbody>
  </table>

  <div class="secao-titulo">Dados Adicionais</div>
  <div class="adicionais bd-b">
    <div class="col esq">
      <div class="lbl">Informações Complementares</div>
      <div class="val" style="font-weight:400;white-space:pre-wrap">${esc(d.observacoes ?? "")}</div>
    </div>
    <div class="col"><div class="lbl">Reservado ao Fisco</div></div>
  </div>

  <div class="rodape">
    <span>Data e hora da impressão: ${new Date().toLocaleString("pt-BR")}</span>
    <span>${esc(EMITENTE.nome)}</span>
  </div>

</div>
<script>window.onload = function(){ window.print(); }</script>
</body></html>`;
}
