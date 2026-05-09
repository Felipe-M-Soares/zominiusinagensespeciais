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

  return { items, totalCount, loading, error, refetch: () => loadItems(search) };
}

// ─── Hook de movimentos de um item ────────────────────────────────────────────

export function useStockMovements(stockItemId: string | null) {
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
      setMovements((data as StockMovement[]) ?? []);
    } catch (err) {
      if (!cancelledRef.current) {
        logger.error("useStockMovements error:", err);
        setMovements([]);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

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

  // 2. Localiza ou cria item de retrabalho para o mesmo device
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id")
    .eq("device_id", deviceId)
    .eq("fase", "retrabalho")
    .maybeSingle();

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
        notes: srcItem?.notes ?? null,
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
export async function fetchLotesDisponivelBatch(
  stockItemIds: string[]
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (stockItemIds.length === 0) return result;

  const { data } = await supabase
    .from("stock_movements")
    .select("stock_item_id, lote, type, quantity")
    .in("stock_item_id", stockItemIds)
    .not("lote", "is", null);

  for (const id of stockItemIds) result.set(id, {});

  for (const row of (data ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number }[]) {
    if (!row.lote) continue;
    const map = result.get(row.stock_item_id) ?? {};
    map[row.lote] = (map[row.lote] ?? 0) + (row.type === "entrada" ? row.quantity : -row.quantity);
    result.set(row.stock_item_id, map);
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

  const INTERNAL_REASONS = [
    "Transferência para Expedição",
    "Recebido de Intermediário",
    "Retrabalho concluído — recebido do Retrabalho",
    "Retrabalho concluído — enviado para Expedição",
    "Enviado para Retrabalho",
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
  ];

  // Agrupa por (stock_item_id, lote) e calcula saldo — ignora movimentos internos entre fases
  type Row = { stock_item_id: string; lote: string; type: string; quantity: number; reason: string | null };
  const saldos = new Map<string, number>(); // chave: "itemId|lote"
  for (const row of data as Row[]) {
    if (row.reason && INTERNAL_REASONS.includes(row.reason)) continue;
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

export async function fetchLotesSummary(stockItemId: string): Promise<LoteSummary[]> {
  const { data } = await supabase
    .from("stock_movements")
    .select("lote, type, quantity, reason, created_at")
    .eq("stock_item_id", stockItemId)
    .not("lote", "is", null)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  // Reasons de transferência interna entre fases — não contam como entrada/saída real
  const INTERNAL_REASONS = [
    "Transferência para Expedição",
    "Recebido de Intermediário",
    "Retrabalho concluído — recebido do Retrabalho",
    "Retrabalho concluído — enviado para Expedição",
    "Enviado para Retrabalho",
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
  ];

  const map = new Map<string, LoteSummary>();
  for (const row of data as { lote: string; type: string; quantity: number; reason: string | null; created_at: string }[]) {
    // Ignora movimentos internos de transferência entre fases
    if (row.reason && INTERNAL_REASONS.includes(row.reason)) continue;

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

  return [...map.values()].sort((a, b) => b.last_movement.localeCompare(a.last_movement));
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
    } catch { return null; }
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
