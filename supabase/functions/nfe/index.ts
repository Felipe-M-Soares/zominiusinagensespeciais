/**
 * Edge function "nfe" — emissão de NF-e pelo emissor integrado (Focus NFe).
 *
 * Fica DESLIGADA até o administrador colar o token do emissor em
 * Financeiro → Configurações (o token vai para o Vault do Supabase).
 * Enquanto isso, as notas emitidas em outro sistema são registradas pela
 * tela (RPC registrar_nf_externa) — esta função não é chamada.
 *
 * Ações (POST { acao, ... }):
 *   status            → emissor ativo? ambiente? o que falta configurar
 *   emitir_venda      { pedidoId, natureza?, informacoes?, itens?[{id,ncm,cfop,cst,aliquotaIcms}] }
 *   emitir_devolucao  { devolucaoId }
 *   consultar         { notaId }   (atualiza nota "processando")
 *   cancelar          { notaId, justificativa }   (15–255 caracteres)
 *   carta_correcao    { notaId, correcao }        (15–1000 caracteres)
 *   inutilizar        { serie, inicio, fim, justificativa }
 *
 * Os valores da nota SEMPRE são lidos do banco (pedido, itens, cadastro) —
 * o navegador não consegue alterar preço/quantidade da nota.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/log.ts";
import {
  montarNotaFocus, validarNota, agoraBrasilia, statusFocus, FORMA_PAGAMENTO_TPAG,
  type DadosNota, type ItemNota, type Crt,
} from "../_shared/focusnfe.ts";

type Json = Record<string, unknown>;
const URL_FOCUS = { 1: "https://api.focusnfe.com.br", 2: "https://homologacao.focusnfe.com.br" } as const;
const PAPEIS = ["admin", "financeiro", "gerente"];

function resposta(cors: Record<string, string>, body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

interface Contexto {
  admin: SupabaseClient;
  userId: string;
  cfg: Json;
  token: string | null;
  base: string;
}

async function focus(ctx: Contexto, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(`${ctx.base}${caminho}`, {
    method: metodo,
    headers: { Authorization: "Basic " + btoa(`${ctx.token}:`), "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados: Json = {};
  try { dados = await r.json(); } catch { /* resposta sem JSON */ }
  return { http: r.status, dados };
}

function mensagemErroFocus(d: Json): string {
  const erros = Array.isArray(d.erros) ? (d.erros as Json[]).map(e => String(e.mensagem ?? "")).filter(Boolean) : [];
  return [d.mensagem_sefaz, d.mensagem, ...erros].filter(Boolean).join(" · ").slice(0, 900) || "Erro no emissor.";
}

/** Guarda XML autorizado no bucket privado "fiscal" (guarda de 5 anos). */
async function guardarXml(ctx: Contexto, caminhoXml: string | undefined, chave: string, emitidaEm: string): Promise<string | null> {
  if (!caminhoXml) return null;
  try {
    const r = await fetch(`${ctx.base}${caminhoXml}`, { headers: { Authorization: "Basic " + btoa(`${ctx.token}:`) } });
    if (!r.ok) return null;
    const xml = await r.text();
    const path = `nfe/${emitidaEm.slice(0, 4)}/${chave}.xml`;
    const { error } = await ctx.admin.storage.from("fiscal").upload(path, new Blob([xml], { type: "application/xml" }), { upsert: false });
    if (error && !String(error.message).includes("exists")) return null;
    return path;
  } catch { return null; }
}

/** Consulta a nota na Focus e grava o resultado. */
async function sincronizar(ctx: Contexto, notaId: string, ref: string): Promise<Json> {
  const { dados } = await focus(ctx, "GET", `/v2/nfe/${encodeURIComponent(ref)}`);
  const st = statusFocus(dados.status as string | undefined);
  if (st === "processando") return { status: "processando" };
  const chave = typeof dados.chave_nfe === "string" ? String(dados.chave_nfe).replace(/\D/g, "") : null;
  const emitidaEm = (dados.data_emissao as string) || new Date().toISOString();
  const xmlPath = st === "autorizada" && chave ? await guardarXml(ctx, dados.caminho_xml_nota_fiscal as string, chave, emitidaEm) : null;
  const danfe = typeof dados.caminho_danfe === "string" ? `${ctx.base}${dados.caminho_danfe}` : null;
  const { error } = await ctx.admin.rpc("fiscal_aplicar_resultado", {
    p_nf_id: notaId, p_status: st === "cancelada" ? "autorizada" : st,
    p_numero: dados.numero ? Number(dados.numero) : null, p_serie: dados.serie ? String(dados.serie) : null,
    p_chave: chave, p_protocolo: (dados.protocolo as string) ?? null, p_emitida_em: emitidaEm,
    p_mensagem: st === "autorizada" ? "Autorizado o uso da NF-e" : mensagemErroFocus(dados),
    p_xml_path: xmlPath, p_danfe_url: danfe,
  });
  if (error) {
    log.error("nfe", "aplicar_resultado", error.message);
    return { status: "processando", mensagem: "A nota foi processada, mas não consegui gravar o resultado. Use \"Atualizar situação\"." };
  }
  if (st === "cancelada") {
    // Cancelada direto no painel do emissor: registra o cancelamento aqui também
    await ctx.admin.rpc("fiscal_aplicar_cancelamento", { p_nf_id: notaId, p_protocolo: null, p_motivo: "Cancelada no painel do emissor", p_uid: ctx.userId });
  }
  return { status: st, numero: dados.numero ?? null, mensagem: st === "autorizada" ? null : mensagemErroFocus(dados), danfe_url: danfe };
}

async function aguardar(ctx: Contexto, notaId: string, ref: string): Promise<Json> {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 1500 : 2500));
    const r = await sincronizar(ctx, notaId, ref);
    if (r.status !== "processando") return r;
  }
  return { status: "processando", mensagem: "A SEFAZ ainda está processando. Use \"Atualizar situação\" em instantes." };
}

/** Duplicatas (boleto/cartão parcelado): vencimentos a cada 30 dias, centavos no fim. */
function montarParcelas(itens: ItemNota[], frete: number, n: number, prazo: number, forma: string) {
  if (!["boleto", "cartao_credito"].includes(forma)) return undefined;
  const totalC = itens.reduce((s, i) => s + Math.round(i.valorUnitario * i.quantidade * 100), 0) + Math.round(frete * 100);
  const qtd = Math.max(1, Math.min(48, n || 1));
  const hoje = new Date(Date.now() - 3 * 3600_000);
  let acum = 0;
  return Array.from({ length: qtd }, (_, i) => {
    const d = new Date(hoje); d.setUTCDate(d.getUTCDate() + (qtd > 1 ? 30 * (i + 1) : prazo));
    const v = i < qtd - 1 ? Math.floor(totalC / qtd) : totalC - acum; acum += v;
    return { vencimento: d.toISOString().slice(0, 10), valor: v / 100 };
  });
}

function emitente(cfg: Json) {
  return {
    cnpj: String(cfg.cnpj ?? ""), uf: String(cfg.uf ?? "SP"), crt: Number(cfg.crt ?? 0) as Crt,
    pisAliquota: Number(cfg.pis_aliquota ?? 0.65), cofinsAliquota: Number(cfg.cofins_aliquota ?? 3),
    aliquotaInterna: Number(cfg.aliquota_icms_interna ?? 18),
  };
}

async function emitirVenda(ctx: Contexto, body: Json): Promise<Json> {
  const pedidoId = String(body.pedidoId ?? "");
  const { data: p, error } = await ctx.admin.from("pedidos_comerciais")
    .select("id,status,frete,desconto_pct,forma_pagamento,parcelas,observacoes,clientes(*),pedido_itens(id,quantidade,valor_unitario,lote,stock_items(devices(internal_code,reference,model,ncm,cfop_padrao,ipi_pct,gtin,udi_di,anvisa_registration,unidade)))")
    .eq("id", pedidoId).single();
  if (error || !p) return { ok: false, erro: "Pedido não encontrado." };
  if (p.status !== "pronto") return { ok: false, erro: `O pedido precisa estar "pronto" (está "${p.status}").` };
  const ambiente = Number(ctx.cfg.ambiente ?? 2);
  const { data: jaTem } = await ctx.admin.from("notas_fiscais").select("id,status").eq("pedido_id", pedidoId).eq("tipo", "venda")
    .eq("ambiente", ambiente).in("status", ["processando", "autorizada"]);
  if (jaTem?.length) return { ok: false, erro: "Este pedido já tem NF-e (ou está em processamento)." };

  const c = (p.clientes as unknown) as Json;
  const ajustes = new Map<string, Json>(((body.itens as Json[]) ?? []).map(i => [String(i.id), i]));
  // valor_unitario já é líquido (desconto por peça aplicado no pedido)
  const itens: ItemNota[] = ((p.pedido_itens as Json[]) ?? []).map(pi => {
    const dv = ((pi.stock_items as Json)?.devices ?? {}) as Json;
    const aj = ajustes.get(String(pi.id)) ?? {};
    const ncm = /^\d{8}$/.test(String(aj.ncm ?? "")) ? String(aj.ncm) : String(dv.ncm ?? "").replace(/\D/g, "");
    const cfop = /^\d{4}$/.test(String(aj.cfop ?? "")) ? String(aj.cfop) : String(dv.cfop_padrao || ctx.cfg.cfop_dentro_uf || "5101");
    return {
      codigo: String(dv.internal_code || dv.reference || pi.id).slice(0, 60),
      descricao: `${dv.model ?? ""} ${dv.reference ?? ""}`.trim() || "Produto",
      ncm, cfop, unidade: String(dv.unidade || "UN"),
      quantidade: Number(pi.quantidade), valorUnitario: Number(pi.valor_unitario ?? 0),
      gtin: (dv.gtin as string) ?? null,
      cstIcms: /^\d{2,3}$/.test(String(aj.cst ?? "")) ? String(aj.cst) : null,
      aliquotaIcms: aj.aliquotaIcms != null && Number.isFinite(Number(aj.aliquotaIcms)) ? Number(aj.aliquotaIcms) : null,
      aliquotaIpi: Number(dv.ipi_pct ?? 0),
      lote: (pi.lote as string) ?? null, registroAnvisa: (dv.anvisa_registration as string) ?? null, udi: (dv.udi_di as string) ?? null,
    };
  });

  const dados: DadosNota = {
    tipo: "venda",
    natureza: String(body.natureza || ctx.cfg.natureza_padrao || "Venda de produção do estabelecimento"),
    dataEmissao: agoraBrasilia(),
    emitente: emitente(ctx.cfg),
    destinatario: {
      nome: String(c.nome ?? ""), documento: String(c.documento ?? ""), ie: (c.ie as string) ?? null,
      logradouro: String(c.logradouro ?? ""), numero: String(c.numero ?? ""), bairro: String(c.bairro ?? ""),
      municipio: String(c.municipio ?? ""), codigoMunicipio: (c.c_mun as string) ?? null, uf: String(c.uf ?? "").toUpperCase(),
      cep: String(c.cep ?? ""), telefone: (c.telefone as string) ?? null, email: (c.email as string) ?? null,
    },
    itens,
    frete: Number(p.frete ?? 0),
    formaPagamento: FORMA_PAGAMENTO_TPAG[String(p.forma_pagamento ?? "")] ?? "99",
    parcelas: montarParcelas(itens, Number(p.frete ?? 0), Number(p.parcelas ?? 1), Number(ctx.cfg.prazo_padrao_dias ?? 30), String(p.forma_pagamento ?? "")),
    informacoes: [body.informacoes, ctx.cfg.info_complementar].filter(Boolean).join(" · ") || null,
  };
  const problemas = validarNota(dados);
  if (problemas.length) return { ok: false, erro: "Corrija antes de emitir:", problemas };

  const ref = `v-${pedidoId.slice(0, 8)}-${Date.now().toString(36)}`;
  const nota = montarNotaFocus(dados);
  const total = Number(((nota.formas_pagamento as Json[])?.[0]?.valor_pagamento as number) ?? 0);
  const { data: nf, error: insErr } = await ctx.admin.from("notas_fiscais").insert({
    tipo: "venda", origem: "emissor", pedido_id: pedidoId, ref, status: "processando",
    ambiente, natureza: dados.natureza, destinatario_nome: dados.destinatario.nome,
    destinatario_doc: dados.destinatario.documento.replace(/\D/g, ""), valor_total: Number(total.toFixed(2)), created_by: ctx.userId,
  }).select("id").single();
  if (insErr?.code === "23505") return { ok: false, erro: "Este pedido já tem NF-e (ou está em processamento)." };
  if (insErr || !nf) return { ok: false, erro: "Não foi possível registrar a nota." };

  const envio = await focus(ctx, "POST", `/v2/nfe?ref=${encodeURIComponent(ref)}`, nota);
  if (envio.http >= 400) {
    await ctx.admin.rpc("fiscal_aplicar_resultado", {
      p_nf_id: nf.id, p_status: "rejeitada", p_numero: null, p_serie: null, p_chave: null, p_protocolo: null,
      p_emitida_em: null, p_mensagem: mensagemErroFocus(envio.dados), p_xml_path: null, p_danfe_url: null,
    });
    return { ok: false, erro: mensagemErroFocus(envio.dados), notaId: nf.id };
  }
  const r = await aguardar(ctx, nf.id, ref);
  return { ok: r.status === "autorizada" || r.status === "processando", notaId: nf.id, ...r };
}

async function emitirDevolucao(ctx: Contexto, body: Json): Promise<Json> {
  const { data: d } = await ctx.admin.from("notas_devolucao_troca").select("*").eq("id", String(body.devolucaoId ?? "")).single();
  if (!d) return { ok: false, erro: "Devolução/troca não encontrada." };
  if (d.status === "autorizada") return { ok: false, erro: "Esta devolução já tem nota." };
  if (String(d.status_msg ?? "").startsWith("[QUALIDADE:em_analise]")) return { ok: false, erro: "Aguardando análise da Qualidade." };
  const ambiente = Number(ctx.cfg.ambiente ?? 2);
  const { data: jaTem } = await ctx.admin.from("notas_fiscais").select("id").eq("devolucao_id", d.id).eq("ambiente", ambiente).in("status", ["processando", "autorizada"]);
  if (jaTem?.length) return { ok: false, erro: "Esta devolução já tem nota (ou está em processamento) — veja em Notas emitidas." };
  // Endereço estruturado: vem do cadastro do cliente do pedido original
  let cli: Json = {};
  if (d.pedido_id) {
    const { data: ped } = await ctx.admin.from("pedidos_comerciais").select("clientes(*)").eq("id", d.pedido_id).single();
    cli = ((ped?.clientes ?? {}) as Json);
  }
  const itens: ItemNota[] = ((d.itens as Json[]) ?? []).map(i => ({
    codigo: String(i.id ?? "").slice(0, 60) || "ITEM", descricao: String(i.descricao ?? "Produto"), ncm: String(i.ncm ?? ""),
    // Devolução de venda de produção própria: 1201 (dentro do estado) / 2201 (fora) — o 1º dígito é ajustado na montagem
    cfop: /^[12]\d{3}$/.test(String(i.cfop ?? "")) ? String(i.cfop) : "1201",
    quantidade: Number(i.quantidade ?? 0), valorUnitario: Number(String(i.valorUnitario ?? "0").replace(",", ".")) || 0,
    cstIcms: /^\d{2,3}$/.test(String(i.cst ?? "")) ? String(i.cst) : null,
    aliquotaIcms: i.aliqICMS != null ? Number(String(i.aliqICMS).replace(",", ".")) : null,
  }));
  const dados: DadosNota = {
    tipo: d.tipo === "troca" ? "troca" : "devolucao",
    natureza: d.tipo === "troca" ? "Devolução de venda (troca)" : "Devolução de venda",
    dataEmissao: agoraBrasilia(), emitente: emitente(ctx.cfg),
    destinatario: {
      nome: String(cli.nome ?? d.cliente_nome ?? ""), documento: String(cli.documento ?? d.cliente_documento ?? ""),
      ie: (cli.ie as string) ?? d.cliente_ie ?? null, logradouro: String(cli.logradouro ?? ""), numero: String(cli.numero ?? ""),
      bairro: String(cli.bairro ?? ""), municipio: String(cli.municipio ?? ""), codigoMunicipio: (cli.c_mun as string) ?? null,
      uf: String(cli.uf ?? ctx.cfg.uf ?? "SP").toUpperCase(), cep: String(cli.cep ?? ""), email: (cli.email as string) ?? d.cliente_email ?? null,
    },
    itens, frete: Number(d.valor_frete ?? 0), chaveReferenciada: d.nf_original_chave,
    informacoes: `Devolução referente à NF-e ${d.nf_original_numero ?? ""}. Motivo: ${d.motivo ?? ""}`.slice(0, 1000),
  };
  const problemas = validarNota(dados);
  if (problemas.length) return { ok: false, erro: "Corrija antes de emitir:", problemas };
  const ref = `d-${String(d.id).slice(0, 8)}-${Date.now().toString(36)}`;
  const { data: nf, error } = await ctx.admin.from("notas_fiscais").insert({
    tipo: dados.tipo, origem: "emissor", devolucao_id: d.id, ref, status: "processando",
    ambiente, natureza: dados.natureza, destinatario_nome: dados.destinatario.nome,
    destinatario_doc: dados.destinatario.documento.replace(/\D/g, ""), valor_total: Number(d.valor_total ?? 0), created_by: ctx.userId,
  }).select("id").single();
  if (error?.code === "23505") return { ok: false, erro: "Esta devolução já tem nota." };
  if (error || !nf) return { ok: false, erro: "Não foi possível registrar a nota." };
  const envio = await focus(ctx, "POST", `/v2/nfe?ref=${encodeURIComponent(ref)}`, montarNotaFocus(dados));
  if (envio.http >= 400) {
    await ctx.admin.rpc("fiscal_aplicar_resultado", {
      p_nf_id: nf.id, p_status: "rejeitada", p_numero: null, p_serie: null, p_chave: null, p_protocolo: null,
      p_emitida_em: null, p_mensagem: mensagemErroFocus(envio.dados), p_xml_path: null, p_danfe_url: null,
    });
    return { ok: false, erro: mensagemErroFocus(envio.dados), notaId: nf.id };
  }
  const r = await aguardar(ctx, nf.id, ref);
  return { ok: r.status === "autorizada" || r.status === "processando", notaId: nf.id, ...r };
}

async function carregarNota(ctx: Contexto, notaId: string) {
  const { data } = await ctx.admin.from("notas_fiscais").select("*").eq("id", notaId).single();
  return data as Json | null;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return resposta(cors, { ok: false, erro: "Método não permitido." }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!jwt) return resposta(cors, { ok: false, erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return resposta(cors, { ok: false, erro: "Sessão inválida." }, 401);
  const [{ data: papeis }, { data: perfil }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", user.id),
    admin.from("profiles").select("approved,blocked").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!perfil?.approved || perfil?.blocked || !(papeis ?? []).some(p => PAPEIS.includes(String(p.role))))
    return resposta(cors, { ok: false, erro: "Acesso não autorizado." }, 403);

  let body: Json = {};
  try { body = await req.json(); } catch { return resposta(cors, { ok: false, erro: "Requisição inválida." }, 400); }
  const acao = String(body.acao ?? "");

  const { data: cfg } = await admin.from("fiscal_config").select("*").eq("id", 1).single();
  const cfgJ = (cfg ?? {}) as Json;
  let token: string | null = Deno.env.get("FOCUS_NFE_TOKEN") ?? null;
  if (!token) {
    const { data: t } = await admin.rpc("get_fiscal_token");
    token = (t as string | null) ?? null;
  }
  const ambiente = Number(cfgJ.ambiente ?? 2) === 1 ? 1 : 2;
  const ctx: Contexto = { admin, userId: user.id, cfg: cfgJ, token, base: URL_FOCUS[ambiente] };

  const faltando: string[] = [];
  if (!token) faltando.push("token do emissor");
  if (!/^\d{14}$/.test(String(cfgJ.cnpj ?? ""))) faltando.push("CNPJ da empresa");
  if (!cfgJ.crt) faltando.push("regime tributário (CRT)");

  if (acao === "status") {
    return resposta(cors, { ok: true, ativo: faltando.length === 0, ambiente, provedor: token ? "focusnfe" : "nenhum", faltando });
  }
  if (faltando.length) {
    return resposta(cors, { ok: false, codigo: "EMISSOR_INATIVO", erro: `Emissor de NF-e não ativado. Falta: ${faltando.join(", ")}.` }, 412);
  }

  try {
    switch (acao) {
      case "emitir_venda": return resposta(cors, await emitirVenda(ctx, body));
      case "emitir_devolucao": return resposta(cors, await emitirDevolucao(ctx, body));
      case "consultar": {
        const n = await carregarNota(ctx, String(body.notaId ?? ""));
        if (!n || !n.ref) return resposta(cors, { ok: false, erro: "Nota não encontrada." });
        return resposta(cors, { ok: true, ...(await sincronizar(ctx, String(n.id), String(n.ref))) });
      }
      case "cancelar": {
        const just = String(body.justificativa ?? "").trim();
        if (just.length < 15 || just.length > 255) return resposta(cors, { ok: false, erro: "Justificativa deve ter de 15 a 255 caracteres." });
        const n = await carregarNota(ctx, String(body.notaId ?? ""));
        if (!n || n.status !== "autorizada") return resposta(cors, { ok: false, erro: "Só nota autorizada pode ser cancelada." });
        if (n.origem !== "emissor") return resposta(cors, { ok: false, erro: "Nota emitida em outro sistema: cancele lá e registre o cancelamento aqui." });
        const { data: pode } = await admin.rpc("nf_pode_cancelar", { p_nf_id: n.id });
        if (!(pode as Json | null)?.ok) return resposta(cors, { ok: false, erro: String((pode as Json | null)?.error ?? "Não é possível cancelar.") });
        const r = await focus(ctx, "DELETE", `/v2/nfe/${encodeURIComponent(String(n.ref))}`, { justificativa: just });
        if (r.http >= 400 || (r.dados.status && r.dados.status !== "cancelado")) {
          return resposta(cors, { ok: false, erro: mensagemErroFocus(r.dados) });
        }
        const { data: ap, error: apErr } = await admin.rpc("fiscal_aplicar_cancelamento", {
          p_nf_id: n.id, p_protocolo: (r.dados.protocolo_cancelamento as string) ?? (r.dados.protocolo as string) ?? null,
          p_motivo: just, p_uid: user.id,
        });
        if (apErr || !(ap as Json | null)?.ok) return resposta(cors, { ok: false, erro: "Cancelada na SEFAZ, mas não consegui atualizar o sistema — avise o administrador." });
        return resposta(cors, { ok: true });
      }
      case "carta_correcao": {
        const txt = String(body.correcao ?? "").trim();
        if (txt.length < 15 || txt.length > 1000) return resposta(cors, { ok: false, erro: "A correção deve ter de 15 a 1000 caracteres." });
        const n = await carregarNota(ctx, String(body.notaId ?? ""));
        if (!n || n.status !== "autorizada" || n.origem !== "emissor") return resposta(cors, { ok: false, erro: "Carta de correção só para nota autorizada emitida por aqui." });
        const r = await focus(ctx, "POST", `/v2/nfe/${encodeURIComponent(String(n.ref))}/carta_correcao`, { correcao: txt });
        if (r.http >= 400 || r.dados.status === "erro_autorizacao") return resposta(cors, { ok: false, erro: mensagemErroFocus(r.dados) });
        const eventos = Array.isArray(n.eventos) ? n.eventos as Json[] : [];
        await admin.from("notas_fiscais").update({
          eventos: [...eventos, { tipo: "carta_correcao", em: new Date().toISOString(), texto: txt, sequencia: r.dados.numero_carta_correcao ?? null, protocolo: r.dados.protocolo ?? null, por: user.id }],
        }).eq("id", n.id);
        return resposta(cors, { ok: true });
      }
      case "inutilizar": {
        const inicio = Number(body.inicio), fim = Number(body.fim);
        const just = String(body.justificativa ?? "").trim();
        if (!(inicio > 0 && fim >= inicio && fim - inicio < 1000)) return resposta(cors, { ok: false, erro: "Faixa de números inválida." });
        if (just.length < 15) return resposta(cors, { ok: false, erro: "Justificativa deve ter ao menos 15 caracteres." });
        const r = await focus(ctx, "POST", "/v2/nfe/inutilizacao", {
          cnpj: cfgJ.cnpj, serie: String(body.serie ?? cfgJ.serie_nfe ?? "1"), numero_inicial: inicio, numero_final: fim, justificativa: just,
        });
        if (r.http >= 400 || r.dados.status === "erro_autorizacao") return resposta(cors, { ok: false, erro: mensagemErroFocus(r.dados) });
        await admin.from("audit_log").insert({
          user_id: user.id, user_name: "—", action: "inutilizar_nf", entity_type: "nota_fiscal",
          details: { serie: body.serie, inicio, fim, justificativa: just, protocolo: r.dados.protocolo ?? null },
        });
        return resposta(cors, { ok: true });
      }
      default:
        return resposta(cors, { ok: false, erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    log.error("nfe", acao, e);
    return resposta(cors, { ok: false, erro: "Falha ao falar com o emissor. Tente de novo em instantes." }, 502);
  }
});
