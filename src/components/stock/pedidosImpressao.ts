/**
 * Impressão dos pedidos do estoque (pedido individual e relatório do mês).
 * Movido de PedidosEstoquePanel.tsx sem mudança de conteúdo do documento impresso.
 */
import { supabase } from "@/integrations/supabase/client";
import { escHtml } from "@/lib/escHtml";
import { detectarUF, adaptarCFOP as adaptarCFOPShared } from "@/lib/cfop";
import type { LoteSelecao, Pedido } from "./pedidosTipos";

/** Abre o pedido pronto para imprimir (lotes: separados › seleção na tela › saldos). */
export async function imprimirPedido(pedido: Pedido, sel: LoteSelecao, expIdByItem: Record<string, string>) {
  const now = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
  const LOTE_PH = new Set(["a-definir","a definir","sem lote",""]);
  const printRows: { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }[] = [];

  const hasSel = Object.keys(sel).length > 0;
  const hasSep = (pedido.lotes_separados ?? []).length > 0;

  if (hasSep) {
    // lotes_separados é sempre a fonte mais confiável — tem um entry por (stock_item, lote)
    const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }>();
    for (const ls of pedido.lotes_separados!) {
      const item = pedido.itens.find(i => (expIdByItem[i.id] ?? i.stock_item_id) === ls.stock_item_id)
        ?? pedido.itens.find(i => i.device_model === ls.device_model);
      const key = `${ls.device_model}||${ls.lote}`;
      const ex = rowMap.get(key);
      if (ex) ex.quantidade += ls.quantidade;
      else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade, stock_item_id: item?.stock_item_id ?? ls.stock_item_id });
    }
    for (const row of rowMap.values()) printRows.push(row);
  } else if (hasSel) {
    // Seleção ativa na tela (pedido pendente ainda não iniciado)
    const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }>();
    for (const item of pedido.itens) {
      for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
        if (qty <= 0) continue;
        const key = `${item.device_model}||${lote}`;
        const ex = rowMap.get(key);
        if (ex) ex.quantidade += qty;
        else rowMap.set(key, { model: item.device_model, reference: item.device_reference, lote, quantidade: qty, stock_item_id: item.stock_item_id });
      }
    }
    for (const row of rowMap.values()) printRows.push(row);
  } else {
    const stockItemIds = [...new Set(pedido.itens_raw.map(r => r.stock_item_id))];
    const { data: movs } = await supabase
      .from("stock_movements")
      .select("stock_item_id, lote, type, quantity")
      .in("stock_item_id", stockItemIds)
      .neq("lote", null);

    const saldoMap = new Map<string, Map<string, number>>();
    for (const m of (movs ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number }[]) {
      if (!m.lote || LOTE_PH.has(m.lote.trim().toLowerCase())) continue;
      const k = m.lote.toUpperCase();
      if (!saldoMap.has(m.stock_item_id)) saldoMap.set(m.stock_item_id, new Map());
      const lm = saldoMap.get(m.stock_item_id)!;
      lm.set(k, (lm.get(k) ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity));
    }

    for (const item of pedido.itens) {
      const lm = saldoMap.get(item.stock_item_id);
      const lotesComSaldo = lm ? [...lm.entries()].filter(([,s]) => s > 0).map(([l]) => l) : [];
      if (lotesComSaldo.length > 0) {
        for (const lote of lotesComSaldo) {
          printRows.push({ model: item.device_model, reference: item.device_reference, lote, quantidade: item.quantidade, stock_item_id: item.stock_item_id });
        }
      } else {
        printRows.push({ model: item.device_model, reference: item.device_reference, lote: "", quantidade: item.quantidade, stock_item_id: item.stock_item_id });
      }
    }
  }

  // ── Busca dados completos do pedido e cliente (antes de montar tableBody) ──
  const stockItemIdsParaDevice = [...new Set(pedido.itens.map(i => i.stock_item_id).filter(Boolean))];
  const [{ data: pedidoExtra }, { data: clienteData }, { data: itensPreco }, { data: stockItemsData }] = await Promise.all([
    supabase.from("pedidos_comerciais")
      .select("forma_pagamento, parcelas, endereco_entrega, usar_endereco_cliente, desconto_pct, frete")
      .eq("id", pedido.id).maybeSingle(),
    supabase.from("clientes")
      .select("documento, ie, telefone, email, logradouro, numero, bairro, municipio, uf, cep, c_mun, endereco")
      .eq("id", pedido.cliente_id).maybeSingle(),
    supabase.from("pedido_itens")
      .select("stock_item_id, quantidade, preco_unitario, valor_total")
      .eq("pedido_id", pedido.id),
    supabase.from("stock_items")
      .select("id, devices(ncm, cfop_padrao, ipi_pct, preco_venda, margem_minima_pct)")
      .in("id", stockItemIdsParaDevice),
  ]);

  type ClienteExtra = {
    documento?: string; ie?: string; telefone?: string; email?: string;
    logradouro?: string; numero?: string; bairro?: string; municipio?: string;
    uf?: string; cep?: string; c_mun?: string; endereco?: string;
  };
  type PedidoExtra = {
    forma_pagamento?: string; parcelas?: number; endereco_entrega?: string;
    usar_endereco_cliente?: boolean; desconto_pct?: number; frete?: number;
  };
  type DeviceExtra = { ncm?: string; cfop_padrao?: string; ipi_pct?: number; preco_venda?: number };
  type StockItemRow = { id: string; devices?: DeviceExtra | null };
  type ItemPreco = { stock_item_id: string; quantidade: number; preco_unitario?: number; valor_total?: number };

  const cl = clienteData as ClienteExtra | null;
  const ex = pedidoExtra as PedidoExtra | null;
  // Mapa direto stock_item_id → dados do device (via join stock_items → devices)
  const devByStockItem = new Map<string, DeviceExtra>(
    ((stockItemsData ?? []) as StockItemRow[]).map(si => [si.id, si.devices ?? {}])
  );
  const itemPrecoMap = new Map<string, ItemPreco>(
    ((itensPreco ?? []) as ItemPreco[]).map(i => [i.stock_item_id, i])
  );

  const endFormatado = cl?.logradouro
    ? `${cl.logradouro}${cl.numero ? ", " + cl.numero : ""}${cl.bairro ? " — " + cl.bairro : ""}${cl.municipio ? " — " + cl.municipio : ""}${cl.uf ? "/" + cl.uf : ""}${cl.cep ? " — CEP " + cl.cep : ""}`
    : (cl?.endereco ?? "");
  const enderecoEntrega = ex?.usar_endereco_cliente !== false
    ? endFormatado
    : (ex?.endereco_entrega ?? endFormatado);

  const fmtPagamento: Record<string, string> = {
    dinheiro: "A VISTA — Dinheiro", pix: "A VISTA — PIX", boleto: "Boleto",
    cartao_debito: "Cartão de Débito", cartao_credito: "Cartão de Crédito",
  };
  const pagamentoLabel = ex?.forma_pagamento
    ? fmtPagamento[ex.forma_pagamento] ?? ex.forma_pagamento
    : "A VISTA";
  // Parcelas em linha separada, sem traço
  const parcelasLabel = ["cartao_credito", "boleto"].includes(ex?.forma_pagamento ?? "") && (ex?.parcelas ?? 1) > 1
    ? `<br><span style="font-weight:400;font-size:10px">${ex?.parcelas}x</span>` : "";
  const desconto = ex?.desconto_pct ?? pedido.desconto_pct ?? 0;
  const frete = ex?.frete ?? 0;

  // ── CFOP por localidade: 5xxx (intraestadual) ou 6xxx (interestadual) ────────
  // UF da empresa emitente: SP. UF do cliente extraída do endereço.
  const UF_EMPRESA = "SP";
  const endCliente = cl?.logradouro
    ? `${cl?.municipio ?? ""} ${cl?.uf ?? ""}`.trim()
    : (cl?.endereco ?? enderecoEntrega ?? "");
  const ufCliente = cl?.uf ?? detectarUF(endCliente);
  const isInterestadual = ufCliente && ufCliente !== UF_EMPRESA;

  // Mapeia CFOP base: 5102 → 6102 se interestadual; 5405 → 6404; etc.
  function adaptarCFOP(cfopOriginal: string | null | undefined): string {
    return adaptarCFOPShared(cfopOriginal, ufCliente, UF_EMPRESA);
  }

  // ── Agrupa por tipo de peça (model + reference) para separadores na página ──
  const grouped = new Map<string, typeof printRows>();
  for (const row of printRows) {
    const key = `${row.model}|||${row.reference}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  let rowIdx = 0;
  let tableBody = "";
  let subtotalGeral = 0;
  for (const [, rows] of grouped) {
    rowIdx++;
    const first = rows[0];
    const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);

    // Preço unitário — busca nos pedido_itens ou nos devices como fallback
    const itemPreco = itemPrecoMap.get(first.stock_item_id ?? "");
    const dev = devByStockItem.get(first.stock_item_id ?? "");
    // Se preco_unitario do pedido_item for 0 ou nulo, usa preco_venda do device
    const precoFromItem = itemPreco?.preco_unitario ?? 0;
    const precoUnit = precoFromItem > 0 ? precoFromItem : (dev?.preco_venda ?? 0);
    const precoComDesconto = desconto > 0 ? precoUnit * (1 - desconto / 100) : precoUnit;
    const valorTotal = precoComDesconto * tipoTotal;
    subtotalGeral += valorTotal;

    const ncm = dev?.ncm ?? "—";
    const cfop = adaptarCFOP(dev?.cfop_padrao);
    const ipiNum = dev?.ipi_pct ?? 0;
    const ipi = ipiNum > 0 ? ipiNum.toFixed(2).replace(".", ",") + "%" : "0,00%";

    const precoFmt = (v: number) => v > 0 ? "R$ " + v.toFixed(2).replace(".", ",") : "—";

    tableBody += `<tr>
      <td class="col-num">${rowIdx}</td>
      <td class="col-model">
        <span class="model-name">${escHtml(first.model ?? "")}</span>
        <span class="model-ref">${escHtml(first.reference ?? "")}</span>
        <span class="model-meta">NCM: ${escHtml(String(ncm))} &nbsp;|&nbsp; CFOP: ${escHtml(String(cfop))} &nbsp;|&nbsp; IPI: ${ipi}</span>
      </td>
      <td class="col-preco">${precoFmt(precoComDesconto)}</td>
      <td class="col-qty">${tipoTotal}</td>
      <td class="col-total">${precoFmt(valorTotal)}</td>
    </tr>`;
  }

  const totalComFrete = subtotalGeral + frete;
  const fmtVal = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pedido ${pedido.id.slice(0,8).toUpperCase()} — ${escHtml(pedido.cliente_nome)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; padding: 20px 24px; color: #111; font-size: 11px; }

  .empresa-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2px solid #111; margin-bottom: 10px; }
  .empresa-nome { font-size: 14px; font-weight: 800; text-transform: uppercase; }
  .empresa-info { font-size: 9.5px; color: #444; line-height: 1.7; margin-top: 2px; }
  .empresa-contato { text-align: right; font-size: 9.5px; color: #444; line-height: 1.7; }

  .pedido-info { display: flex; border: 1px solid #bbb; margin-bottom: 8px; }
  .pedido-info-col { flex: 1; padding: 5px 8px; border-right: 1px solid #bbb; font-size: 10px; }
  .pedido-info-col:last-child { border-right: none; }
  .pedido-info-label { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 1px; }
  .pedido-info-val { font-weight: 700; color: #111; font-size: 11px; }

  .cliente-box { border: 1px solid #bbb; padding: 7px 10px; margin-bottom: 8px; font-size: 10px; line-height: 1.8; }
  .cliente-title { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 4px; }
  .cliente-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { text-align: left; padding: 6px 7px; background: #f0f0f0; border: 1px solid #bbb; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 5px 7px; border: 1px solid #ddd; vertical-align: top; font-size: 10px; }
  tr:nth-child(even) td { background: #fafafa; }
  .col-num { width: 22px; text-align: center; color: #999; }
  .col-model { width: 42%; }
  .col-preco { width: 80px; text-align: right; white-space: nowrap; }
  .col-qty { width: 45px; text-align: center; font-weight: 800; }
  .col-total { width: 90px; text-align: right; font-weight: 700; white-space: nowrap; }
  .model-name { display: block; font-weight: 700; font-size: 10.5px; }
  .model-ref { display: block; font-family: monospace; font-size: 8.5px; color: #888; }
  .model-meta { display: block; font-size: 8px; color: #aaa; margin-top: 2px; }

  .totais-box { border: 1px solid #bbb; margin-bottom: 14px; }
  .totais-row { display: flex; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #eee; font-size: 10px; }
  .totais-row:last-child { border-bottom: none; font-weight: 800; font-size: 12px; background: #f5f5f5; }
  .totais-label { color: #666; }
  .totais-val { font-weight: 600; }

  .obs-box { background: #f9f9f9; border-left: 3px solid #999; padding: 5px 8px; margin-bottom: 8px; font-size: 10px; color: #555; }

  .assinaturas { display: flex; justify-content: space-between; margin-top: 36px; gap: 40px; }
  .assinatura { flex: 1; border-top: 1px solid #333; padding-top: 5px; text-align: center; font-size: 9.5px; color: #555; }

  @page { size: A4 portrait; margin: 15mm 15mm 15mm 15mm; }
  @media print { button { display: none } body { padding: 0 } }
</style>
</head>
<body>

<!-- Cabeçalho empresa -->
<div class="empresa-header">
  <div>
    <div class="empresa-nome">Zomini Usinagens Especiais Ltda. ME</div>
    <div class="empresa-info">
      CNPJ: 00.000.000/0000-00 &nbsp;|&nbsp; IE: 000.000.000.000<br>
      Av. Fictícia, 1000 — Jardim Exemplo — Indaiatuba/SP — CEP 13.000-000
    </div>
  </div>
  <div class="empresa-contato">
    <strong>CONTATO:</strong><br>
    contato@zomini.com.br<br>
    www.zomini.com.br<br>
    (19) 00000-0000
  </div>
</div>

<!-- Info do pedido -->
<div class="pedido-info">
  <div class="pedido-info-col">
    <div class="pedido-info-label">NRO. Pedido</div>
    <div class="pedido-info-val">${pedido.id.slice(0,8).toUpperCase()}</div>
  </div>
  <div class="pedido-info-col">
    <div class="pedido-info-label">Tipo</div>
    <div class="pedido-info-val">COMÉRCIO</div>
  </div>
  <div class="pedido-info-col">
    <div class="pedido-info-label">Status</div>
    <div class="pedido-info-val">${pedido.status.toUpperCase()}</div>
  </div>
  <div class="pedido-info-col">
    <div class="pedido-info-label">Data</div>
    <div class="pedido-info-val">${now}</div>
  </div>
  <div class="pedido-info-col">
    <div class="pedido-info-label">PGTO.</div>
    <div class="pedido-info-val">${pagamentoLabel}${parcelasLabel}</div>
  </div>
  ${desconto > 0 ? `<div class="pedido-info-col">
    <div class="pedido-info-label">Desconto</div>
    <div class="pedido-info-val">${desconto}%</div>
  </div>` : ""}
</div>

<!-- Vendedora -->
<div style="font-size:10px; margin-bottom:4px; color:#555;">
  Vendedora: <strong style="color:#111">${escHtml(pedido.vendedora_nome ?? "—")}</strong>
  ${ufCliente ? ` &nbsp;|&nbsp; CFOP: <strong style="color:#111">${isInterestadual ? "6xxx (Interestadual — " + ufCliente + ")" : "5xxx (Intraestadual — SP)"}</strong>` : ""}
  ${pedido.prazo_entrega ? ` &nbsp;|&nbsp; Prazo de entrega: <strong style="color:#111">${new Date(pedido.prazo_entrega + "T12:00:00").toLocaleDateString("pt-BR")}</strong>` : ""}
</div>

<!-- Dados do cliente -->
<div class="cliente-box">
  <div class="cliente-title">Destinatário</div>
  <div class="cliente-grid">
    <div>
      <strong style="font-size:11px">${escHtml(pedido.cliente_nome)}</strong><br>
      ${cl?.documento ? `CPF/CNPJ: ${escHtml(cl.documento)}<br>` : ""}
      ${cl?.ie ? `IE: ${escHtml(cl.ie)}<br>` : ""}
      ${cl?.c_mun ? `Cód. Município: ${escHtml(cl.c_mun)}<br>` : ""}
      ${enderecoEntrega ? `End.: ${escHtml(enderecoEntrega)}` : ""}
    </div>
    <div>
      ${cl?.telefone ? `Telefone: ${escHtml(cl.telefone)}<br>` : ""}
      ${cl?.email ? `E-mail: ${escHtml(cl.email)}<br>` : ""}
    </div>
  </div>
</div>

${pedido.observacoes ? `<div class="obs-box"><strong>Obs:</strong> ${escHtml(pedido.observacoes)}</div>` : ""}

<!-- Tabela de itens -->
<table>
  <thead>
    <tr>
      <th class="col-num">#</th>
      <th class="col-model">Descrição / Item</th>
      <th class="col-preco" style="text-align:right">R$ Unit.</th>
      <th class="col-qty" style="text-align:center">Qtd.</th>
      <th class="col-total" style="text-align:right">Valor (R$)</th>
    </tr>
  </thead>
  <tbody>${tableBody}</tbody>
</table>

<!-- Totais -->
<div class="totais-box">
  ${frete > 0 ? `<div class="totais-row"><span class="totais-label">Subtotal dos itens</span><span class="totais-val">${fmtVal(subtotalGeral)}</span></div>
  <div class="totais-row"><span class="totais-label">Frete</span><span class="totais-val">${fmtVal(frete)}</span></div>` : ""}
  <div class="totais-row">
    <span class="totais-label">VALOR TOTAL DOS ITENS${frete > 0 ? " + FRETE" : ""}</span>
    <span class="totais-val">${fmtVal(totalComFrete)}</span>
  </div>
</div>

<!-- Assinaturas -->
<div class="assinaturas">
  <div class="assinatura">Zomini Usinagens Especiais Ltda. ME</div>
  <div class="assinatura">${escHtml(pedido.cliente_nome)}</div>
</div>

</body>
</html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

/** Relatório de todos os pedidos do mês atual (ou todos os listados, se nenhum do mês). */
export async function imprimirPedidosDoMes(filtrados: Pedido[]) {
  const now = new Date();
  const nowStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const mesAtual = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const LOTE_PH = new Set(["a-definir", "a definir", "sem lote", ""]);

  function escH(s?: string | null) {
    return (s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function fmtBRL(v: number) {
    return "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  // Filtra pedidos do mês atual
  const pedidosDoMes = filtrados.filter(p => {
    const d = new Date(p.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const pedidosParaImprimir = pedidosDoMes.length > 0 ? pedidosDoMes : filtrados;

  // ── Busca dados extras em batch ────────────────────────────────────────────
  const ids = pedidosParaImprimir.map(p => p.id);
  const clienteIds = [...new Set(pedidosParaImprimir.map(p => p.cliente_id))];
  const stockIds = [...new Set(pedidosParaImprimir.flatMap(p => p.itens.map(i => i.stock_item_id)))];

  const [exRes, clRes, devRes, itensPrecoRes] = await Promise.all([
    supabase.from("pedidos_comerciais")
      .select("id, forma_pagamento, parcelas, endereco_entrega, usar_endereco_cliente, desconto_pct, frete")
      .in("id", ids),
    supabase.from("clientes")
      .select("id, documento, email, telefone, logradouro, numero, bairro, municipio, uf, cep, endereco")
      .in("id", clienteIds),
    supabase.from("stock_items")
      .select("id, devices(id, model, reference, ncm, cfop_padrao, ipi_pct, preco_venda)")
      .in("id", stockIds),
    supabase.from("pedido_itens")
      .select("pedido_id, stock_item_id, quantidade, preco_unitario")
      .in("pedido_id", ids),
  ]);

  type ExtraRow = { id: string; forma_pagamento?: string | null; parcelas?: number | null; endereco_entrega?: string | null; usar_endereco_cliente?: boolean | null; desconto_pct?: number; frete?: number };
  type ClienteRow = { id: string; documento?: string | null; email?: string | null; telefone?: string | null; logradouro?: string | null; numero?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null; cep?: string | null; endereco?: string | null };
  type DevRow = { id: string; devices?: { model?: string; reference?: string; preco_venda?: number } };
  type ItemPrecoRow = { pedido_id: string; stock_item_id: string; quantidade: number; preco_unitario?: number };

  const extraMap = new Map<string, ExtraRow>((exRes.data ?? []).map((r: ExtraRow) => [r.id, r]));
  const clienteMap = new Map<string, ClienteRow>((clRes.data ?? []).map((r: ClienteRow) => [r.id, r]));
  const devMap = new Map<string, DevRow>((devRes.data ?? []).map((r: DevRow) => [r.id, r]));
  const itemPrecoMap = new Map<string, ItemPrecoRow[]>();
  for (const ip of (itensPrecoRes.data ?? []) as ItemPrecoRow[]) {
    if (!itemPrecoMap.has(ip.pedido_id)) itemPrecoMap.set(ip.pedido_id, []);
    itemPrecoMap.get(ip.pedido_id)!.push(ip);
  }

  const fmtPgto: Record<string, string> = {
    dinheiro: "Dinheiro", pix: "PIX", boleto: "Boleto",
    cartao_debito: "Cartão Débito", cartao_credito: "Cartão Crédito",
  };

  let sections = "";
  let totalGeralPecas = 0;
  let totalGeralValor = 0;

  for (const pedido of pedidosParaImprimir) {
    const ex = extraMap.get(pedido.id);
    const cl = clienteMap.get(pedido.cliente_id);
    const itensPreco = itemPrecoMap.get(pedido.id) ?? [];
    const desconto = ex?.desconto_pct ?? pedido.desconto_pct ?? 0;
    const frete = ex?.frete ?? 0;

    // Endereço de entrega
    const endCl = cl?.logradouro
      ? `${cl.logradouro}${cl.numero ? ", " + cl.numero : ""}${cl.bairro ? " — " + cl.bairro : ""}${cl.municipio ? " — " + cl.municipio : ""}${cl.uf ? "/" + cl.uf : ""}${cl.cep ? " — CEP " + cl.cep : ""}`
      : (cl?.endereco ?? "");
    const enderecoEntrega = ex?.usar_endereco_cliente === false && ex?.endereco_entrega
      ? ex.endereco_entrega : endCl;

    // Pagamento
    const pgtoLabel = ex?.forma_pagamento ? fmtPgto[ex.forma_pagamento] ?? ex.forma_pagamento : "—";
    const parcelasLabel = ["cartao_credito", "boleto"].includes(ex?.forma_pagamento ?? "") && (ex?.parcelas ?? 1) > 1
      ? ` ${ex?.parcelas}x` : "";

    const printRows: { model?: string; reference?: string; lote: string; quantidade: number; precoUnit: number }[] = [];

    if (pedido.lotes_separados && pedido.lotes_separados.length > 0) {
      const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; precoUnit: number }>();
      for (const ls of pedido.lotes_separados) {
        const item = pedido.itens.find(i => i.stock_item_id === ls.stock_item_id)
          ?? pedido.itens.find(i => i.device_model === ls.device_model);
        const ip = itensPreco.find(i => i.stock_item_id === ls.stock_item_id);
        const dev = devMap.get(ls.stock_item_id ?? "");
        const precoUnit = (ip?.preco_unitario ?? 0) > 0
          ? (ip!.preco_unitario! * (1 - desconto / 100))
          : ((dev?.devices?.preco_venda ?? 0) * (1 - desconto / 100));
        const key = `${ls.device_model}||${ls.lote}`;
        const ex2 = rowMap.get(key);
        if (ex2) ex2.quantidade += ls.quantidade;
        else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade, precoUnit });
      }
      for (const row of rowMap.values()) printRows.push(row);
    } else {
      for (const item of pedido.itens) {
        const ip = itensPreco.find(i => i.stock_item_id === item.stock_item_id);
        const dev = devMap.get(item.stock_item_id ?? "");
        const precoUnit = (ip?.preco_unitario ?? 0) > 0
          ? (ip!.preco_unitario! * (1 - desconto / 100))
          : ((dev?.devices?.preco_venda ?? 0) * (1 - desconto / 100));
        const lote = item.lote && !LOTE_PH.has(item.lote.trim().toLowerCase()) ? item.lote : "";
        printRows.push({ model: item.device_model, reference: item.device_reference, lote, quantidade: item.quantidade, precoUnit });
      }
    }

    const grouped = new Map<string, typeof printRows>();
    for (const row of printRows) {
      const key = `${row.model}|||${row.reference}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    const statusLabel = pedido.status === "pronto" ? "Pronto" : pedido.status === "separando" ? "Separando" : pedido.status === "enviado" ? "Enviado" : "Pendente";
    const statusColor = pedido.status === "pronto" ? "#166534" : pedido.status === "separando" ? "#1e40af" : pedido.status === "enviado" ? "#0369a1" : "#92400e";
    const statusBg = pedido.status === "pronto" ? "#dcfce7" : pedido.status === "separando" ? "#dbeafe" : pedido.status === "enviado" ? "#e0f2fe" : "#fef3c7";
    const dataPedido = new Date(pedido.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    let subtotal = 0;
    let tableRows = "";
    let idx = 0;
    for (const [, rows] of grouped) {
      idx++;
      const first = rows[0];
      const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);
      const itemSubtotal = first.precoUnit * tipoTotal;
      subtotal += itemSubtotal;
      const lotesBadges = rows
        .filter(r => r.lote && !LOTE_PH.has(r.lote.toLowerCase()))
        .map(r => `<span class="lote-badge">${escH(r.lote)}</span>`)
        .join(" ");
      const lotesCell = lotesBadges || `<span class="lote-empty">—</span>`;
      const precoCell = first.precoUnit > 0
        ? `<span class="preco-unit">${fmtBRL(first.precoUnit)}</span>`
        : `<span class="lote-empty">—</span>`;
      const totalCell = itemSubtotal > 0 ? fmtBRL(itemSubtotal) : "—";
      tableRows += `<tr>
        <td class="col-num">${idx}</td>
        <td class="col-model">
          <span class="model-name">${escH(first.model)}</span>
          <span class="model-ref">${escH(first.reference)}</span>
        </td>
        <td class="col-lotes">${lotesCell}</td>
        <td class="col-preco">${precoCell}</td>
        <td class="col-qty-n">${tipoTotal}</td>
        <td class="col-total">${totalCell}</td>
      </tr>`;
    }

    const totalComFrete = subtotal + frete;
    totalGeralValor += totalComFrete;
    const totalPecas = printRows.reduce((s, r) => s + r.quantidade, 0);
    totalGeralPecas += totalPecas;
    const totalTipos = grouped.size;

    const totaisHtml = `
      <div class="totais-bloco">
        ${desconto > 0 ? `<div class="totais-row"><span class="totais-lbl">Desconto aplicado</span><span class="totais-val desc">${desconto}% por peça</span></div>` : ""}
        ${frete > 0 ? `<div class="totais-row"><span class="totais-lbl">Subtotal</span><span class="totais-val">${fmtBRL(subtotal)}</span></div>
        <div class="totais-row"><span class="totais-lbl">Frete</span><span class="totais-val">${fmtBRL(frete)}</span></div>` : ""}
        <div class="totais-row total-final"><span class="totais-lbl">TOTAL DO PEDIDO</span><span class="totais-val">${fmtBRL(totalComFrete)}</span></div>
      </div>`;

    sections += `
      <div class="pedido-section">
        <div class="pedido-header">
          <div class="pedido-header-left">
            <div class="pedido-client">${escH(pedido.cliente_nome)}</div>
            <div class="pedido-meta">
              ${cl?.documento ? `<span>CPF/CNPJ: <strong>${escH(cl.documento)}</strong></span> &nbsp;·&nbsp;` : ""}
              ${cl?.telefone ? `<span>Tel: <strong>${escH(cl.telefone)}</strong></span> &nbsp;·&nbsp;` : ""}
              ${cl?.email ? `<span>Email: <strong>${escH(cl.email)}</strong></span>` : ""}
            </div>
            ${enderecoEntrega ? `<div class="pedido-meta" style="margin-top:2px">📍 ${escH(enderecoEntrega)}</div>` : ""}
            <div class="pedido-meta" style="margin-top:2px">
              Vendedora: <strong>${escH(pedido.vendedora_nome ?? "—")}</strong>
              &nbsp;·&nbsp; Data: <strong>${dataPedido}</strong>
              &nbsp;·&nbsp; ${escH(pgtoLabel)}${parcelasLabel ? " · " + parcelasLabel : ""}
              ${pedido.observacoes ? `&nbsp;·&nbsp; Obs: ${escH(pedido.observacoes)}` : ""}
            </div>
          </div>
          <span class="status-badge" style="background:${statusBg};color:${statusColor};border-color:${statusColor}40">${statusLabel}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-model">Peça</th>
              <th class="col-lotes">Lotes</th>
              <th class="col-preco" style="text-align:right">Unit. c/ desc.</th>
              <th class="col-qty-n" style="text-align:right">Qtd.</th>
              <th class="col-total" style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${totaisHtml}
        <div class="pedido-footer">
          ${totalPecas} peça${totalPecas !== 1 ? "s" : ""} · ${totalTipos} tipo${totalTipos !== 1 ? "s" : ""}
        </div>
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pedidos — ${mesAtual}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 14mm 14mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #fff; color: #111; font-size: 12px; }

  /* ── Cabeçalho da empresa (igual ao pedido individual) ── */
  .company-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 3px solid #111; }
  .company-name { font-size: 17px; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; color: #111; }
  .company-sub { font-size: 9px; color: #555; margin-top: 2px; }
  .company-contact { text-align: right; font-size: 9px; color: #444; line-height: 1.6; }
  .company-contact strong { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #111; margin-bottom: 1px; }

  /* ── Info bar do relatório ── */
  .report-bar { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; margin-bottom: 5mm; display: flex; gap: 18px; align-items: center; }
  .report-bar-item { font-size: 9px; color: #666; }
  .report-bar-item strong { font-size: 12px; font-weight: 800; color: #111; display: block; }

  /* ── Seção de cada pedido ── */
  .pedido-section { margin-bottom: 6mm; border: 1px solid #ccc; border-radius: 4px; overflow: hidden; page-break-inside: avoid; }

  /* cabeçalho do pedido — idêntico ao individual */
  .pedido-header { background: #f9f9f9; border-bottom: 1.5px solid #ddd; padding: 5px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pedido-header-left { display: flex; flex-direction: column; gap: 1px; }
  .pedido-client { font-size: 14px; font-weight: 800; color: #111; }
  .pedido-meta { font-size: 9px; color: #777; }
  .pedido-meta strong { color: #333; }
  .status-badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 20px; white-space: nowrap; border: 1px solid; }

  /* ── Tabela de itens ── */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 4px 8px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #555; background: #fafafa; border-bottom: 1px solid #e0e0e0; }
  th.col-qty { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #efefef; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .col-num { width: 20px; color: #bbb; font-size: 10px; }
  .col-model { width: 30%; }
  .col-lotes { width: 22%; }
  .col-preco { width: 80px; text-align: right; }
  .col-qty-n { width: 40px; text-align: right; font-weight: 800; font-size: 12px; color: #111; }
  .col-total { width: 80px; text-align: right; font-weight: 700; font-size: 11px; color: #111; }
  .model-name { display: block; font-weight: 700; font-size: 11px; }
  .model-ref { display: block; font-family: monospace; font-size: 9px; color: #888; margin-top: 1px; }
  .preco-unit { font-size: 10px; color: #444; }
  .lote-badge { display: inline-block; background: #f0f0ff; color: #4c1d95; font-family: monospace; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #d4d0ee; margin: 1px 2px 1px 0; }
  .lote-empty { color: #ccc; font-size: 10px; }
  .totais-bloco { padding: 5px 10px; background: #f9f9f9; border-top: 1px solid #e0e0e0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .totais-row { display: flex; gap: 16px; align-items: baseline; }
  .totais-lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.04em; }
  .totais-val { font-size: 11px; font-weight: 700; color: #111; min-width: 80px; text-align: right; }
  .totais-val.desc { color: #16a34a; }
  .total-final .totais-lbl { font-weight: 700; color: #333; font-size: 10px; }
  .total-final .totais-val { font-size: 13px; font-weight: 900; color: #111; }
  .pedido-footer { padding: 4px 10px; background: #fafafa; border-top: 1px solid #eee; font-size: 9px; color: #999; }

  /* ── Rodapé geral ── */
  .page-footer { margin-top: 6mm; padding-top: 3mm; border-top: 1.5px solid #ddd; display: flex; justify-content: space-between; font-size: 10px; color: #555; }

  @media print { button { display: none } }
</style>
</head>
<body>

<!-- Cabeçalho empresa -->
<div class="company-header">
  <div>
    <div class="company-name">Zomini Usinagens Especiais Ltda. ME</div>
    <div class="company-sub">CNPJ: 00.000.000/0000-00 &nbsp;|&nbsp; IE: 000.000.000.000</div>
    <div class="company-sub">Av. Fictícia, 1000 — Jardim Exemplo — Indaiatuba/SP — CEP 13.000-000</div>
  </div>
  <div class="company-contact">
    <strong>Contato:</strong>
    contato@zomini.com.br<br>
    www.zomini.com.br<br>
    (19) 00000-0000
  </div>
</div>

<!-- Barra de resumo do relatório -->
<div class="report-bar">
  <div class="report-bar-item"><strong>${pedidosParaImprimir.length}</strong>pedido${pedidosParaImprimir.length !== 1 ? "s" : ""}</div>
  <div class="report-bar-item"><strong>${totalGeralPecas}</strong>peças no total</div>
  <div class="report-bar-item"><strong>${mesAtual}</strong>período</div>
  <div class="report-bar-item" style="margin-left:auto">Gerado em: ${nowStr}</div>
</div>

${sections}

<div class="page-footer">
  <span>Total: <strong>${totalGeralPecas} peças</strong> em <strong>${pedidosParaImprimir.length} pedido${pedidosParaImprimir.length !== 1 ? "s" : ""}</strong> &nbsp;·&nbsp; Valor total: <strong>${fmtBRL(totalGeralValor)}</strong></span>
  <span>Zomini Usinagens Especiais Ltda. ME</span>
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
