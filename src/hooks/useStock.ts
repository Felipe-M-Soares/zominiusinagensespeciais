import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import type { Device } from "@/types/device";

// ─── Tipos locais ────────────────────────────────────────────────────────────

export type StockFase = "intermediaria" | "expedicao" | "retrabalho";

export interface StockItem {
  id: string;
  device_id: string;
  quantity: number;
  quantity_reserved: number;
  quantity_available: number; // computed: quantity - quantity_reserved
  min_quantity: number;
  location: string | null;
  notes: string | null;
  fase: StockFase;
  created_at: string;
  updated_at: string;
  device: Device & { id: string };
}

export interface StockMovement {
  id: string;
  stock_item_id: string;
  type: "entrada" | "saida";
  quantity: number;
  reason: string | null;
  lote: string | null;
  user_id: string | null;
  user_display_name: string | null;
  created_at: string;
}

export interface LoteSummary {
  lote: string;
  total_entrada: number;
  total_saida: number;
  saldo: number;
  last_movement: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitize(raw: string): string {
  return raw
    .trim()
    .slice(0, 200)
    .split("").filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("")
    .replace(/[(),;'"`]/g, "")
    .replace(/[%_\\]/g, "\\$&");
}

// ─── Hook principal de estoque ────────────────────────────────────────────────

export function useStock(search: string) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadItems = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("stock_items")
        .select(
          `id, device_id, quantity, quantity_reserved, min_quantity, location, notes, fase, created_at, updated_at,
           device:devices(
             id, udi_di, reference, model, brand_name, internal_code,
             anvisa_registration, manufacturer_country, classification_code,
             risk_class, sterile, single_use, implantable, intended_use,
             body_region, primary_material, secondary_material,
             surface_treatment, exocad_compatibility, compatible_systems, icon_url
           )`,
          { count: "exact" }
        )
        .order("updated_at", { ascending: false });

      const s = sanitize(q);
      if (s) {
        const isLoteSearch = /^\d{6}-\d{2}([/][A-Za-z])?$/.test(s.toUpperCase());

        if (isLoteSearch) {
          const { data: loteMov } = await supabase
            .from("stock_movements")
            .select("stock_item_id")
            .ilike("lote", s.toUpperCase());

          if (!loteMov || loteMov.length === 0) {
            setItems([]);
            setTotalCount(0);
            setLoading(false);
            return;
          }
          const itemIds = [...new Set(loteMov.map((m) => m.stock_item_id))];
          query = query.in("id", itemIds);
        } else {
          const { data: matched } = await supabase
            .from("devices")
            .select("id")
            .or(
              [
                `model.ilike.%${s}%`,
                `reference.ilike.%${s}%`,
                `udi_di.ilike.%${s}%`,
                `internal_code.ilike.%${s}%`,
                `anvisa_registration.ilike.%${s}%`,
                `brand_name.ilike.%${s}%`,
              ].join(",")
            );

          if (!matched || matched.length === 0) {
            setItems([]);
            setTotalCount(0);
            setLoading(false);
            return;
          }
          const ids = matched.map((d) => d.id);
          query = query.in("device_id", ids);
        }
      }

      // Supabase PostgREST limita a 1000 linhas por request — paginamos até buscar tudo
      const PAGE_SIZE = 1000;
      let allRows: Record<string, unknown>[] = [];
      let fetchedCount = 0;

      const MAX_PAGES = 100;
      let pageNum = 0;
      while (pageNum < MAX_PAGES) {
        const from = pageNum * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data: pageData, count: pageCount, error: err } = await query
          .range(from, to);
        if (err) throw err;
        const rows = pageData ?? [];
        allRows = allRows.concat(rows);
        if (pageNum === 0) fetchedCount = pageCount ?? rows.length;
        if (rows.length < PAGE_SIZE) break;
        pageNum++;
      }

      const normalized: StockItem[] = allRows
        .map((row: Record<string, unknown>) => {
          const qty = (row.quantity as number) ?? 0;
          const reserved = (row.quantity_reserved as number) ?? 0;
          return {
            ...row,
            quantity_reserved: reserved,
            quantity_available: Math.max(0, qty - reserved),
            fase: (row.fase as StockFase) ?? "intermediaria",
            device: Array.isArray(row.device) ? (row.device[0] ?? null) : (row.device ?? null),
          } as StockItem;
        })
        // Filtra itens órfãos: stock_items sem device associado causam crash no render
        .filter((item) => item.device != null);

      // Recalcula quantity_reserved a partir dos pedido_itens ativos (apenas pendente/separando).
      // "pronto" NÃO conta como reserva — o estoque já foi deduzido ao marcar como pronto.
      try {
        const expedicaoIds = normalized.filter(i => i.fase === "expedicao").map(i => i.id);
        if (expedicaoIds.length > 0) {
          // Apenas pedidos pendente e separando geram reserva de estoque
          const { data: pedidosAtivos } = await supabase
            .from("pedidos_comerciais")
            .select("id")
            .in("status", ["pendente", "separando"]);

          const pedidoIds = (pedidosAtivos ?? []).map((p: { id: string }) => p.id);

          // Monta mapa de reservas reais (zero para itens sem pedido ativo)
          const reservaMap = new Map<string, number>();
          for (const id of expedicaoIds) reservaMap.set(id, 0);

          if (pedidoIds.length > 0) {
            const { data: pedidoItens } = await supabase
              .from("pedido_itens")
              .select("stock_item_id, quantidade")
              .in("stock_item_id", expedicaoIds)
              .in("pedido_id", pedidoIds);

            for (const pi of (pedidoItens ?? []) as { stock_item_id: string; quantidade: number }[]) {
              reservaMap.set(pi.stock_item_id, (reservaMap.get(pi.stock_item_id) ?? 0) + pi.quantidade);
            }
          }

          // Aplica o recálculo em todos os itens de expedição
          for (const item of normalized) {
            if (item.fase === "expedicao") {
              const reservaReal = reservaMap.get(item.id) ?? 0;
              item.quantity_reserved = reservaReal;
              item.quantity_available = Math.max(0, item.quantity - reservaReal);
            }
          }
        }
      } catch (e) {
        // Falha no recálculo de reservas — usa o quantity_reserved do banco como fallback
        logger.warn("useStock: falha ao recalcular reservas de expedição:", e);
      }

      setItems(normalized);
      setTotalCount(fetchedCount);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setError("Erro ao carregar estoque.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems(search);
    return () => abortRef.current?.abort();
  }, [search, loadItems]);

  // Recarrega automaticamente quando o usuario volta para a aba/janela,
  // garantindo que reservas confirmadas em outras abas sejam refletidas.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") loadItems(search);
    }
    function handleFocus() {
      loadItems(search);
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [search, loadItems]);

  return { items, totalCount, loading, error, refetch: () => loadItems(search) };
}

// ─── Hook de movimentos de um item ────────────────────────────────────────────

// Reasons de movimentos internos entre fases — nunca devem aparecer no histórico da expedição
const EXPEDICAO_INTERNAL_REASONS = [
  "Recebido de Intermediário",
  "Enviado para Retrabalho",
  "Retrabalho concluído — recebido do Retrabalho",
  "Retrabalho concluído — enviado para Expedição",
  "Rollback — falha ao criar item de retrabalho",
  "Rollback — falha ao criar item de expedição",
  "Rollback — falha ao registrar entrada na expedição",
];

export function useStockMovements(stockItemId: string | null, fase?: StockFase) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef<boolean>(false);

  const loadMovements = useCallback(async (id: string) => {
    cancelledRef.current = false;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, stock_item_id, type, quantity, reason, lote, user_id, user_display_name, created_at")
        .eq("stock_item_id", id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelledRef.current) return;
      if (error) throw error;
      let rows = (data as StockMovement[]) ?? [];
      // Na expedição, filtra movimentos internos de transferência entre fases
      if (fase === "expedicao") {
        rows = rows.filter(m => !m.reason || !EXPEDICAO_INTERNAL_REASONS.includes(m.reason));
      }
      setMovements(rows);
    } catch (err) {
      if (!cancelledRef.current) {
        logger.error("useStockMovements error:", err);
        setMovements([]);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [fase]);

  useEffect(() => {
    cancelledRef.current = false;
    if (stockItemId) loadMovements(stockItemId);
    else setMovements([]);
    return () => { cancelledRef.current = true; };
  }, [stockItemId, loadMovements]);

  return { movements, loading, refetch: stockItemId ? () => loadMovements(stockItemId) : () => {} };
}

// ─── Ações de escrita ─────────────────────────────────────────────────────────

export async function upsertStockItem(
  deviceId: string,
  patch: { quantity?: number; min_quantity?: number; location?: string; notes?: string },
  fase: StockFase = "intermediaria"
): Promise<{ id: string } | null> {
  // FIX: substitui SELECT + INSERT separados por upsert atômico.
  // A versão anterior tinha race condition: dois processos simultâneos podiam
  // passar pelo SELECT sem encontrar registro e ambos tentar INSERT, causando
  // violação de unique constraint (device_id, fase).
  const { data, error } = await supabase
    .from("stock_items")
    .upsert(
      { device_id: deviceId, quantity: 0, min_quantity: 0, fase, ...patch },
      { onConflict: "device_id,fase" }
    )
    .select("id")
    .single();

  if (error) {
    logger.error("upsertStockItem error:", error.message);
    return null;
  }
  return data;
}

export async function registerMovement(
  stockItemId: string,
  type: "entrada" | "saida",
  quantity: number,
  reason: string,
  userId: string | null,
  userDisplayName?: string | null,
  lote?: string | null
): Promise<{ ok: boolean; error?: string }> {
  // BUG-01 / BUG-04: Use atomic RPC — eliminates read-modify-write race condition
  // and fragile manual rollback. The DB function handles quantity update + movement
  // insert in a single transaction.
  const { data, error } = await supabase.rpc("stock_movement_atomic", {
    p_item_id:   stockItemId,
    p_type:      type,
    p_qty:       quantity,
    p_reason:    reason || null,
    p_lote:      lote?.trim() || null,
    p_user_id:   userId,
    p_user_name: userDisplayName ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.error) return { ok: false, error: result.error };

  return { ok: true };
}

export async function addDeviceToStock(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("stock_items")
    .upsert(
      { device_id: deviceId, quantity: 0, min_quantity: 0, fase: "intermediaria" },
      { onConflict: "device_id,fase", ignoreDuplicates: true }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Transfere unidades de um lote da fase Intermediária para Expedição.
 * Fluxo: saída da intermediária → cria/localiza item de expedição → entrada na expedição.
 */
export async function transferToExpedicao(
  intermediariaItemId: string,
  deviceId: string,
  lote: string,
  quantity: number,
  userId: string | null,
  userDisplayName: string | null
): Promise<{ ok: boolean; error?: string }> {
  // 0. Verifica saldo antes da saída para detectar se vai sobrar algo
  const { data: movsBefore } = await supabase
    .from("stock_movements")
    .select("lote, type, quantity")
    .eq("stock_item_id", intermediariaItemId)
    .not("lote", "is", null);

  // Calcula saldo atual do lote específico no intermediário
  let saldoLoteAtual = 0;
  const loteUp = lote.toUpperCase();
  for (const m of (movsBefore ?? []) as { lote: string; type: string; quantity: number }[]) {
    if (m.lote?.toUpperCase() === loteUp) {
      saldoLoteAtual += m.type === "entrada" ? m.quantity : -m.quantity;
    }
  }
  const sobra = saldoLoteAtual - quantity;

  // 1. Saída da intermediária
  const saidaResult = await registerMovement(
    intermediariaItemId,
    "saida",
    quantity,
    "Transferência para Expedição",
    userId,
    userDisplayName,
    lote
  );
  if (!saidaResult.ok) return saidaResult;

  // 1b. Se sobrou algo do lote, renomeia o restante com sufixo /A, /B, /C...
  //     Regra: lote original sem sufixo → /A; já em /A → /B; /B → /C; etc.
  if (sobra > 0) {
    // Determina o próximo sufixo
    function nextLoteSuffix(base: string): string {
      const match = base.match(/^(.+)\/([A-Z])$/);
      if (match) {
        const nextChar = String.fromCharCode(match[2].charCodeAt(0) + 1);
        return `${match[1]}/${nextChar}`;
      }
      return `${base}/A`;
    }
    const novoLote = nextLoteSuffix(loteUp);

    // Registra a renomeação: saída do lote antigo + entrada no novo lote
    await registerMovement(
      intermediariaItemId,
      "saida",
      sobra,
      `Renomeação de lote: ${loteUp} → ${novoLote}`,
      userId,
      userDisplayName,
      loteUp
    );
    await registerMovement(
      intermediariaItemId,
      "entrada",
      sobra,
      `Renomeação de lote: ${loteUp} → ${novoLote}`,
      userId,
      userDisplayName,
      novoLote
    );
  }

  // 2. Localiza ou cria item de expedição para o mesmo device
  let expedicaoItemId: string | null = null;

  const { data: existing } = await supabase
    .from("stock_items")
    .select("id")
    .eq("device_id", deviceId)
    .eq("fase", "expedicao")
    .maybeSingle();

  if (existing) {
    expedicaoItemId = existing.id;
  } else {
    const { data: srcItem } = await supabase
      .from("stock_items")
      .select("min_quantity, location, notes")
      .eq("id", intermediariaItemId)
      .single();

    const { data: created, error: createErr } = await supabase
      .from("stock_items")
      .insert({
        device_id: deviceId,
        quantity: 0,
        min_quantity: srcItem?.min_quantity ?? 0,
        location: srcItem?.location ?? null,
        notes: srcItem?.notes ?? null,
        fase: "expedicao",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      await registerMovement(
        intermediariaItemId, "entrada", quantity,
        "Rollback — falha ao criar item de expedição",
        userId, userDisplayName, lote
      );
      return { ok: false, error: "Erro ao criar item na expedição." };
    }
    expedicaoItemId = created.id;
  }

  // 3. Entrada na expedição
  const entradaResult = await registerMovement(
    expedicaoItemId,
    "entrada",
    quantity,
    "Recebido de Intermediário",
    userId,
    userDisplayName,
    lote
  );

  if (!entradaResult.ok) {
    await registerMovement(
      intermediariaItemId, "entrada", quantity,
      "Rollback — falha ao registrar entrada na expedição",
      userId, userDisplayName, lote
    );
    return { ok: false, error: "Erro ao registrar entrada na expedição." };
  }

  return { ok: true };
}

/**
 * Envia peças da Expedição para a fila de Retrabalho (fase separada).
 * Fluxo: saída da expedição → entrada no retrabalho.
 * Após o retrabalho ser concluído, usar transferRetrabalhoToExpedicao para retornar.
 */
export async function transferToRetrabalho(
  expedicaoItemId: string,
  deviceId: string,
  lote: string,
  quantity: number,
  userId: string | null,
  userDisplayName: string | null
): Promise<{ ok: boolean; error?: string }> {
  // 1. Saída da expedição
  const saidaResult = await registerMovement(
    expedicaoItemId,
    "saida",
    quantity,
    "Enviado para Retrabalho",
    userId,
    userDisplayName,
    lote
  );
  if (!saidaResult.ok) return saidaResult;

  // 2. Localiza ou cria item de retrabalho para o mesmo device+lote
  // Cada lote deve ter seu próprio stock_item de retrabalho para aparecer separado no painel
  const { data: existingList } = await supabase
    .from("stock_items")
    .select("id")
    .eq("device_id", deviceId)
    .eq("fase", "retrabalho")
    .filter("notes", "ilike", `%lote:${lote.toUpperCase()}%`)
    .limit(1);

  const existing = existingList?.[0] ?? null;
  let retrabalhoItemId: string | null = existing?.id ?? null;

  if (!retrabalhoItemId) {
    const { data: srcItem } = await supabase
      .from("stock_items")
      .select("min_quantity, location, notes")
      .eq("id", expedicaoItemId)
      .single();

    const { data: created, error: createErr } = await supabase
      .from("stock_items")
      .insert({
        device_id: deviceId,
        quantity: 0,
        min_quantity: 0,
        location: srcItem?.location ?? null,
        notes: `lote:${lote.toUpperCase()}${srcItem?.notes ? ` | ${srcItem.notes}` : ""}`,
        fase: "retrabalho",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      await registerMovement(expedicaoItemId, "entrada", quantity, "Rollback — falha ao criar item de retrabalho", userId, userDisplayName, lote);
      return { ok: false, error: "Erro ao criar item no retrabalho." };
    }
    retrabalhoItemId = created.id;
  }

  // 3. Entrada no retrabalho
  const entradaResult = await registerMovement(
    retrabalhoItemId,
    "entrada",
    quantity,
    "Recebido da Expedição para Retrabalho",
    userId,
    userDisplayName,
    lote
  );

  if (!entradaResult.ok) {
    await registerMovement(expedicaoItemId, "entrada", quantity, "Rollback — falha ao registrar entrada no retrabalho", userId, userDisplayName, lote);
    return { ok: false, error: "Erro ao registrar entrada no retrabalho." };
  }

  return { ok: true };
}

/**
 * Conclui o retrabalho: envia peças da fila de Retrabalho de volta para Expedição.
 * Fluxo: saída do retrabalho → entrada na expedição.
 */
export async function transferRetrabalhoToExpedicao(
  retrabalhoItemId: string,
  deviceId: string,
  lote: string,
  quantity: number,
  userId: string | null,
  userDisplayName: string | null
): Promise<{ ok: boolean; error?: string }> {
  // 1. Saída do retrabalho
  const saidaResult = await registerMovement(
    retrabalhoItemId,
    "saida",
    quantity,
    "Retrabalho concluído — enviado para Expedição",
    userId,
    userDisplayName,
    lote
  );
  if (!saidaResult.ok) return saidaResult;

  // 2. Localiza ou cria item de expedição para o mesmo device
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id")
    .eq("device_id", deviceId)
    .eq("fase", "expedicao")
    .maybeSingle();

  let expedicaoItemId: string | null = existing?.id ?? null;

  if (!expedicaoItemId) {
    const { data: srcItem } = await supabase
      .from("stock_items")
      .select("min_quantity, location, notes")
      .eq("id", retrabalhoItemId)
      .single();

    const { data: created, error: createErr } = await supabase
      .from("stock_items")
      .insert({
        device_id: deviceId,
        quantity: 0,
        min_quantity: srcItem?.min_quantity ?? 0,
        location: srcItem?.location ?? null,
        notes: srcItem?.notes ?? null,
        fase: "expedicao",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      await registerMovement(retrabalhoItemId, "entrada", quantity, "Rollback — falha ao criar item de expedição", userId, userDisplayName, lote);
      return { ok: false, error: "Erro ao criar item na expedição." };
    }
    expedicaoItemId = created.id;
  }

  // 3. Entrada na expedição
  const entradaResult = await registerMovement(
    expedicaoItemId,
    "entrada",
    quantity,
    "Retrabalho concluído — recebido do Retrabalho",
    userId,
    userDisplayName,
    lote
  );

  if (!entradaResult.ok) {
    await registerMovement(retrabalhoItemId, "entrada", quantity, "Rollback — falha ao registrar entrada na expedição", userId, userDisplayName, lote);
    return { ok: false, error: "Erro ao registrar entrada na expedição." };
  }

  return { ok: true };
}

// ─── Lotes de um item de estoque ─────────────────────────────────────────────
/**
 * PERF-01: Batch version — fetches lote balances for many stock_item_ids in ONE query.
 * Returns Map<stock_item_id, Record<lote, saldo>>
 */
/**
 * Ordena lotes do mais antigo para o mais novo usando o código do lote (DDMMYYA-NN).
 * Lotes mais antigos devem ser usados primeiro (FIFO por data de produção).
 */
function sortLotesByDate(lotes: Record<string, number>): Record<string, number> {
  const entries = Object.entries(lotes).filter(([, qty]) => qty > 0);
  entries.sort(([a], [b]) => {
    // Formato esperado: DDMMYYA-NN (ex: 0101261-01)
    // Extrai a parte da data: primeiros 7 chars sem o separador
    const dateA = a.replace("-", "").slice(0, 7);
    const dateB = b.replace("-", "").slice(0, 7);
    // Reordena para YYMMDD para comparação cronológica correta
    // DDMMYYA → YYA + MM + DD  (índices: DD=0-1, MM=2-3, YYA=4-6)
    const toComp = (s: string) => s.slice(4) + s.slice(2, 4) + s.slice(0, 2);
    return toComp(dateA).localeCompare(toComp(dateB));
  });
  // Reconstrói objeto mantendo a ordem (JS Objects preservam insertion order para strings)
  const ordered: Record<string, number> = {};
  for (const [k, v] of entries) ordered[k] = v;
  return ordered;
}

export async function fetchLotesDisponivelBatch(
  stockItemIds: string[],
  excludePedidoId?: string  // exclui as reservas deste pedido (o próprio pedido em separação)
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (stockItemIds.length === 0) return result;

  // 1. Saldo bruto por lote a partir dos movimentos de estoque
  const { data } = await supabase
    .from("stock_movements")
    .select("stock_item_id, lote, type, quantity")
    .in("stock_item_id", stockItemIds)
    .not("lote", "is", null);

  for (const id of stockItemIds) result.set(id, {});

  const LOTE_PLACEHOLDER = new Set(["a-definir", "a definir", "sem lote"]);

  for (const row of (data ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number }[]) {
    if (!row.lote || LOTE_PLACEHOLDER.has(row.lote.trim().toLowerCase())) continue;
    const map = result.get(row.stock_item_id) ?? {};
    const key = row.lote.toUpperCase();
    map[key] = (map[key] ?? 0) + (row.type === "entrada" ? row.quantity : -row.quantity);
    result.set(row.stock_item_id, map);
  }

  // 2. Desconta reservas de pedidos ativos (pendente/separando) por lote.
  //    Prioridade: lotes_separados (distribuição real por lote quando separação foi iniciada)
  //    Fallback:   pedido_itens.lote (só lote principal — usado para pedidos pendentes)
  try {
    const { data: pedidosAtivos } = await supabase
      .from("pedidos_comerciais")
      .select("id, lotes_separados")
      .in("status", ["pendente", "separando"]);

    const pedidoIds = (pedidosAtivos ?? [])
      .map((p: { id: string }) => p.id)
      .filter(id => id !== excludePedidoId);

    if (pedidoIds.length > 0) {
      // Para pedidos sem lotes_separados (pendente): busca via pedido_itens
      // Inclui todos os stock_item_ids passados (já são expIds)
      const piQuery = supabase
        .from("pedido_itens")
        .select("stock_item_id, lote, quantidade, pedido_id")
        .in("stock_item_id", stockItemIds)
        .in("pedido_id", pedidoIds);
      const { data: piData } = await piQuery;

      // Monta pedido_itens agrupado por pedido_id para lookup rápido
      const piByPedido = new Map<string, { stock_item_id: string; lote: string | null; quantidade: number }[]>();
      for (const pi of (piData ?? []) as { stock_item_id: string; lote: string | null; quantidade: number; pedido_id: string }[]) {
        const arr = piByPedido.get(pi.pedido_id) ?? [];
        arr.push(pi);
        piByPedido.set(pi.pedido_id, arr);
      }

      // Coleta reservas a deduzir: por pedido, prefere lotes_separados sobre pedido_itens
      const reservas: { stock_item_id: string; lote: string | null; quantidade: number }[] = [];

      for (const pedido of (pedidosAtivos ?? []) as { id: string; lotes_separados: { stock_item_id: string; lote: string; quantidade: number }[] | null }[]) {
        if (pedido.id === excludePedidoId) continue;

        // Filtra lotes_separados que correspondem a um dos expIds que estamos consultando
        const sep = (pedido.lotes_separados ?? []).filter(s => stockItemIds.includes(s.stock_item_id));

        if (sep.length > 0) {
          // Pedido separando: usa lotes_separados — tem a distribuição real por lote
          for (const s of sep) reservas.push(s);
        } else {
          // Pedido pendente: usa pedido_itens como fallback
          for (const pi of (piByPedido.get(pedido.id) ?? [])) reservas.push(pi);
        }
      }

      // Aplica as deduções no mapa de saldos
      const fifoSort = (keys: string[]) => keys.sort((a, b) => {
        const toComp = (s: string) => {
          const d = s.replace("-", "").slice(0, 7);
          return d.slice(4) + d.slice(2, 4) + d.slice(0, 2);
        };
        return toComp(a).localeCompare(toComp(b));
      });

      for (const reserva of reservas) {
        const map = result.get(reserva.stock_item_id);
        if (!map) continue;

        const loteRaw = reserva.lote?.trim() ?? "";
        const loteIndefinido = !loteRaw || LOTE_PLACEHOLDER.has(loteRaw.toLowerCase());

        if (!loteIndefinido) {
          const key = loteRaw.toUpperCase();
          if (key in map) {
            map[key] = Math.max(0, (map[key] ?? 0) - reserva.quantidade);
          } else {
            // Lote não encontrado no mapa: deduz FIFO
            let restante = reserva.quantidade;
            for (const k of fifoSort(Object.keys(map))) {
              if (restante <= 0) break;
              const deduzir = Math.min(map[k], restante);
              map[k] = Math.max(0, map[k] - deduzir);
              restante -= deduzir;
            }
          }
        } else {
          // Lote indefinido: FIFO
          let restante = reserva.quantidade;
          for (const k of fifoSort(Object.keys(map))) {
            if (restante <= 0) break;
            const deduzir = Math.min(map[k], restante);
            map[k] = Math.max(0, map[k] - deduzir);
            restante -= deduzir;
          }
        }
        result.set(reserva.stock_item_id, map);
      }
    }
  } catch (e) {
    // Falha silenciosa — usa saldo bruto como fallback
    logger.warn("useStock: falha ao buscar saldos de lotes disponíveis:", e);
  }

  // 3. Ordena cada mapa de lotes do mais antigo ao mais novo (FIFO por data de produção)
  for (const [id, lotesMap] of result.entries()) {
    result.set(id, sortLotesByDate(lotesMap));
  }

  return result;
}

/**
 * Versão batch: busca contagem de lotes com saldo > 0 para vários items em UMA só query.
 * Substitui o padrão de N queries paralelas que causava ERR_INSUFFICIENT_RESOURCES.
 */
export async function fetchLotesSummaryBatch(
  stockItemIds: string[]
): Promise<Map<string, number>> {
  if (stockItemIds.length === 0) return new Map();

  const { data } = await supabase
    .from("stock_movements")
    .select("stock_item_id, lote, type, quantity, reason")
    .in("stock_item_id", stockItemIds)
    .not("lote", "is", null);

  if (!data || data.length === 0) return new Map();

  // Movimentos que são apenas "ruído" contábil entre fases — nunca representam
  // estoque real em nenhum dos dois lados, portanto devem ser ignorados no cômputo.
  // ATENÇÃO: "Transferência para Expedição" e "Enviado para Retrabalho" são saídas
  // REAIS da intermediária/expedição e NÃO devem ser ignoradas — caso contrário o
  // saldo da intermediária fica positivo mesmo com estoque zerado (bug dos "2 lotes").
  // Só ignoramos entradas-espelho que duplicariam o saldo no destino.
  const IGNORE_REASONS = new Set([
    "Recebido de Intermediário",                         // entrada na expedição — já contada como saída na intermediária
    "Retrabalho concluído — recebido do Retrabalho",     // entrada na expedição — já contada como saída no retrabalho
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
  ]);

  // Agrupa por (stock_item_id, lote) e calcula saldo real
  type Row = { stock_item_id: string; lote: string; type: string; quantity: number; reason: string | null };
  const saldos = new Map<string, number>(); // chave: "itemId|lote"
  for (const row of data as Row[]) {
    if (row.reason && IGNORE_REASONS.has(row.reason)) continue;
    const key = `${row.stock_item_id}|${row.lote.toUpperCase()}`;
    const current = saldos.get(key) ?? 0;
    saldos.set(key, row.type === "entrada" ? current + row.quantity : current - row.quantity);
  }

  // Conta lotes com saldo positivo por item
  const result = new Map<string, number>();
  for (const id of stockItemIds) result.set(id, 0);
  for (const [key, saldo] of saldos) {
    if (saldo > 0) {
      const itemId = key.split("|")[0];
      result.set(itemId, (result.get(itemId) ?? 0) + 1);
    }
  }
  return result;
}

export async function fetchLotesSummary(stockItemId: string, _fase?: string): Promise<LoteSummary[]> {
  // 1. Busca todos os movimentos com lote real (exclui null e 'a-definir')
  const { data: movimentos } = await supabase
    .from("stock_movements")
    .select("lote, type, quantity, reason, created_at")
    .eq("stock_item_id", stockItemId)
    .not("lote", "is", null)
    .order("created_at", { ascending: false });

  // 2. Busca pedidos ativos (pendente/separando) com lotes_separados e pedido_itens
  //    lotes_separados tem a distribuição real por lote (ex: 100 do lote A + 50 do lote B).
  //    pedido_itens.lote só guarda o lote principal — insuficiente quando há múltiplos lotes.
  const { data: pedidosAtivos } = await supabase
    .from("pedidos_comerciais")
    .select("id, lotes_separados")
    .in("status", ["pendente", "separando"]);

  const pedidoIdsAtivos = (pedidosAtivos ?? []).map((p: { id: string }) => p.id);

  // Reservas por lote: prefere lotes_separados (distribuição real), cai para pedido_itens.lote
  const pedidoItensReservados: { lote: string | null; quantidade: number }[] = [];

  if (pedidoIdsAtivos.length > 0) {
    // Busca o device_id deste stock_item para localizar pedidos que possam ter sido
    // criados com o stock_item_id da intermediária em vez da expedição.
    // Sem isso, pedidos antigos (criados antes da padronização) não são encontrados
    // e os saldos por lote ficam incorretos (não descontam reservas).
    const { data: siData } = await supabase
      .from("stock_items")
      .select("device_id")
      .eq("id", stockItemId)
      .maybeSingle();
    const deviceId = (siData as { device_id: string } | null)?.device_id;

    // Todos os stock_item_ids do mesmo device (cobre tanto expedição quanto intermediária)
    let allStockItemIds = [stockItemId];
    if (deviceId) {
      const { data: siblings } = await supabase
        .from("stock_items")
        .select("id")
        .eq("device_id", deviceId);
      allStockItemIds = [...new Set([stockItemId, ...(siblings ?? []).map((s: { id: string }) => s.id)])];
    }

    // Busca pedido_itens por todos os stock_item_ids do device
    const { data: piDataAll } = await supabase
      .from("pedido_itens")
      .select("pedido_id, stock_item_id, lote, quantidade")
      .in("stock_item_id", allStockItemIds)
      .in("pedido_id", pedidoIdsAtivos);

    // Agrupa por pedido — mas normaliza: cada pedido conta UMA VEZ por device
    // (evita dupla contagem se o mesmo pedido tiver itens na intermediária e na expedição)
    const piByPedido = new Map<string, { lote: string | null; quantidade: number }[]>();
    const pedidoContado = new Set<string>(); // garante que cada pedido contribui 1x
    for (const pi of (piDataAll ?? []) as { pedido_id: string; stock_item_id: string; lote: string | null; quantidade: number }[]) {
      // Prioriza o item que aponta direto para este stockItemId (expedição)
      const arr = piByPedido.get(pi.pedido_id) ?? [];
      arr.push({ lote: pi.lote, quantidade: pi.quantidade, _sid: pi.stock_item_id } as { lote: string | null; quantidade: number; _sid: string });
      piByPedido.set(pi.pedido_id, arr);
    }

    for (const pedido of (pedidosAtivos ?? []) as { id: string; lotes_separados: { stock_item_id: string; lote: string; quantidade: number }[] | null }[]) {
      if (pedidoContado.has(pedido.id)) continue;

      const sep = (pedido.lotes_separados ?? []).filter(s => allStockItemIds.includes(s.stock_item_id));
      if (sep.length > 0) {
        // Usa lotes_separados — distribuição real por lote (após separação iniciada)
        for (const s of sep) {
          pedidoItensReservados.push({ lote: s.lote, quantidade: s.quantidade });
        }
        pedidoContado.add(pedido.id);
      } else {
        const items = piByPedido.get(pedido.id) ?? [];
        if (items.length > 0) {
          // Prefere itens que apontam diretamente para o stockItemId da expedição
          const diretos = items.filter((i: { lote: string | null; quantidade: number; _sid?: string }) => (i as { _sid?: string })._sid === stockItemId);
          const usar = diretos.length > 0 ? diretos : items.slice(0, 1);
          for (const pi of usar) {
            pedidoItensReservados.push({ lote: pi.lote, quantidade: pi.quantidade });
          }
          pedidoContado.add(pedido.id);
        }
      }
    }
  }

  if ((!movimentos || movimentos.length === 0) && pedidoItensReservados.length === 0) return [];

  const ROLLBACK_REASONS = [
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
  ];

  // Lotes sem definição real que o sistema usa como placeholder
  const LOTE_INDEFINIDO = new Set(["a-definir", "a definir", "sem lote"]);

  // Calcula saldo bruto por lote a partir dos stock_movements
  const map = new Map<string, LoteSummary>();

  for (const row of (movimentos ?? []) as { lote: string; type: string; quantity: number; reason: string | null; created_at: string }[]) {
    if (row.reason && ROLLBACK_REASONS.includes(row.reason)) continue;
    if (LOTE_INDEFINIDO.has(row.lote.trim().toLowerCase())) continue;

    const key = row.lote.toUpperCase();
    if (!map.has(key)) {
      map.set(key, { lote: key, total_entrada: 0, total_saida: 0, saldo: 0, last_movement: row.created_at });
    }
    const entry = map.get(key)!;
    if (row.type === "entrada") entry.total_entrada += row.quantity;
    else entry.total_saida += row.quantity;
    entry.saldo = entry.total_entrada - entry.total_saida;
    if (row.created_at > entry.last_movement) entry.last_movement = row.created_at;
  }

  // Deduz reservas de pedidos (pendente e separando) dos saldos dos lotes.
  // - lote definido: deduz diretamente daquele lote
  // - lote null (pedido criado sem lote): deduz do mais antigo primeiro (FIFO),
  //   completando com o próximo se necessário — idêntico ao que o separador fará
  //
  // Lotes ordenados do mais antigo ao mais novo para FIFO correto
  function lotesOrdenadosFIFO(): string[] {
    return [...map.keys()].sort((a, b) => {
      const toComp = (s: string) => {
        const d = s.replace("-", "").slice(0, 7); // DDMMYYA
        return d.slice(4) + d.slice(2, 4) + d.slice(0, 2); // → YYAMMDD
      };
      return toComp(a).localeCompare(toComp(b));
    });
  }

  for (const pi of pedidoItensReservados) {
    const loteRaw = pi.lote?.trim() ?? "";
    // BUG-FIX: pedidos criados antes da correção usam "a-definir" como placeholder.
    // Esses também devem cair no FIFO — caso contrário a dedução tenta descontar
    // do lote literal "A-DEFINIR" que não existe no map e a reserva nunca é aplicada.
    const loteEhIndefinido = !loteRaw || LOTE_INDEFINIDO.has(loteRaw.toLowerCase());

    if (!loteEhIndefinido) {
      // Lote real já escolhido: deduz direto
      const key = loteRaw.toUpperCase();
      if (map.has(key)) {
        const entry = map.get(key)!;
        entry.saldo = Math.max(0, entry.saldo - pi.quantidade);
        map.set(key, entry);
      } else {
        // Lote definido mas não encontrado nos movimentos: cai para FIFO como fallback
        let restante = pi.quantidade;
        for (const fifoKey of lotesOrdenadosFIFO()) {
          if (restante <= 0) break;
          const entry = map.get(fifoKey)!;
          const deduzir = Math.min(entry.saldo, restante);
          entry.saldo = Math.max(0, entry.saldo - deduzir);
          restante -= deduzir;
          map.set(fifoKey, entry);
        }
      }
    } else {
      // Lote indefinido (null, "", "a-definir", etc.): deduz FIFO (mais antigo primeiro)
      let restante = pi.quantidade;
      for (const fifoKey of lotesOrdenadosFIFO()) {
        if (restante <= 0) break;
        const entry = map.get(fifoKey)!;
        const deduzir = Math.min(entry.saldo, restante);
        entry.saldo = Math.max(0, entry.saldo - deduzir);
        restante -= deduzir;
        map.set(fifoKey, entry);
      }
    }
  }

  return [...map.values()]
    .filter(l => l.saldo > 0)
    .sort((a, b) => b.last_movement.localeCompare(a.last_movement));
}

export async function cancelMovement(
  movementId: string,
  stockItemId: string
): Promise<{ ok: boolean; error?: string }> {
  // Use atomic RPC — avoids read-modify-write race condition in cancel
  const { data, error } = await supabase.rpc("cancel_movement", {
    p_movement_id:   movementId,
    p_stock_item_id: stockItemId,
  });

  if (error) return { ok: false, error: error.message };
  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.error) return { ok: false, error: result.error };
  return { ok: true };
}

export async function deleteStockItem(
  stockItemId: string
): Promise<{ ok: boolean; error?: string }> {
  // Usa RPC com SECURITY DEFINER para contornar RLS e deletar em cascata
  const { data, error } = await supabase
    .rpc("delete_stock_item", { p_stock_item_id: stockItemId });

  if (error) return { ok: false, error: error.message };
  const result = data as { ok: boolean; error?: string };
  return result;
}

// ─── Backup ──────────────────────────────────────────────────────────────────

export type BackupSchedule = "mon_thu" | "tue_fri" | "wed_sat" | "mon_fri";

export interface BackupConfig {
  id: string;
  schedule: BackupSchedule;
  last_backup: string | null;
  updated_at: string;
}

export interface StockBackup {
  id: string;
  created_by: string | null;
  created_name: string | null;
  item_count: number;
  created_at: string;
  file_path?: string | null;
}

export const SCHEDULE_LABELS: Record<BackupSchedule, string> = {
  mon_thu: "Segunda e Quinta",
  tue_fri: "Terça e Sexta",
  wed_sat: "Quarta e Sábado",
  mon_fri: "Segunda e Sexta",
};

export async function getBackupConfig(): Promise<BackupConfig | null> {
  const { data } = await supabase
    .from("backup_configs")
    .select("*")
    .maybeSingle();
  return data as BackupConfig | null;
}

export async function saveBackupConfig(
  schedule: BackupSchedule
): Promise<{ ok: boolean; error?: string }> {
  // FIX: upsert atômico evita race condition do SELECT+UPDATE separados
  const { error } = await supabase
    .from("backup_configs")
    .upsert({ schedule, updated_at: new Date().toISOString() }, { onConflict: "id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function runBackup(
  userId: string | null,
  userName: string | null
): Promise<{ ok: boolean; error?: string }> {
  const [itemsRes, movRes] = await Promise.all([
    supabase
      .from("stock_items")
      .select("id, quantity, min_quantity, location, notes, fase, updated_at, device:devices(model,reference,udi_di,internal_code)"),
    supabase
      .from("stock_movements")
      .select("id, stock_item_id, type, quantity, reason, user_display_name, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const payload = {
    generated_at: new Date().toISOString(),
    items: itemsRes.data ?? [],
    recent_movements: movRes.data ?? [],
  };

  // PERF-03: Store backup JSON in Storage instead of JSONB column to avoid row bloat
  const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = `backups/${fileName}`;
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });

  const { error: uploadErr } = await supabase.storage
    .from("stock-backups")
    .upload(filePath, blob, { contentType: "application/json", upsert: false });

  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { error } = await supabase.from("stock_backups").insert({
    created_by:  userId,
    created_name: userName,
    item_count:  (itemsRes.data ?? []).length,
    file_path:   filePath,
    // payload column kept null — data lives in Storage
  });

  if (error) return { ok: false, error: error.message };

  const { data: cfg } = await supabase.from("backup_configs").select("id").maybeSingle();
  if (cfg) {
    await supabase.from("backup_configs").update({ last_backup: new Date().toISOString() }).eq("id", cfg.id);
  }

  return { ok: true };
}

export async function listBackups(limit = 20): Promise<StockBackup[]> {
  const { data } = await supabase
    .from("stock_backups")
    .select("id, created_by, created_name, item_count, created_at, file_path")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as StockBackup[]) ?? [];
}

export async function downloadBackup(backupId: string): Promise<object | null> {
  // PERF-03: Fetch from Storage using file_path stored in DB record
  const { data: row } = await supabase
    .from("stock_backups")
    .select("file_path, payload, created_at")
    .eq("id", backupId)
    .single();

  if (!row) return null;

  // New backups use Storage; old ones fall back to inline payload
  if ((row as { file_path?: string }).file_path) {
    const { data: fileData, error } = await supabase.storage
      .from("stock-backups")
      .download((row as { file_path: string }).file_path);
    if (error || !fileData) return null;
    try {
      return JSON.parse(await fileData.text());
    } catch (e) {
      logger.warn("useStock: falha ao parsear payload de backup:", e);
      return null;
    }
  }

  return (row as { payload?: object }).payload ?? null;
}

export type AllMovementFase = StockFase;

export interface AllMovement {
  id: string;
  stock_item_id: string;
  type: "entrada" | "saida";
  quantity: number;
  reason: string | null;
  lote: string | null;
  user_display_name: string | null;
  created_at: string;
  device_model: string;
  device_reference: string;
  fase: StockFase;
}

export async function fetchAllMovements(limit = 100, fase?: StockFase): Promise<AllMovement[]> {
  let query = supabase
    .from("stock_movements")
    .select(`
      id, stock_item_id, type, quantity, reason, lote, user_display_name, created_at,
      stock_item:stock_items(
        fase,
        device:devices(model, reference)
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Filtra por fase diretamente no banco para não trazer dados desnecessários
  if (fase) {
    query = query.eq("stock_items.fase", fase);
  }

  const { data } = await query;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const si = row.stock_item as Record<string, unknown> | null;
    const siObj = Array.isArray(si) ? si[0] : si;
    const dev = siObj?.device as Record<string, unknown> | null;
    const d = Array.isArray(dev) ? dev[0] : dev;
    return {
      id: row.id as string,
      stock_item_id: row.stock_item_id as string,
      type: row.type as "entrada" | "saida",
      quantity: row.quantity as number,
      reason: row.reason as string | null,
      lote: row.lote as string | null,
      user_display_name: row.user_display_name as string | null,
      created_at: row.created_at as string,
      device_model: (d?.model as string) ?? "—",
      device_reference: (d?.reference as string) ?? "—",
      fase: ((siObj?.fase as StockFase) ?? "intermediaria"),
    };
  });
}
