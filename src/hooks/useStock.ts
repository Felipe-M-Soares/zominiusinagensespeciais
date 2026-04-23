import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Device } from "@/types/device";

// ─── Tipos locais ────────────────────────────────────────────────────────────

export type StockFase = "intermediaria" | "expedicao" | "retrabalho";

export interface StockItem {
  id: string;
  device_id: string;
  quantity: number;
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

  const fetch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("stock_items")
        .select(
          `id, device_id, quantity, min_quantity, location, notes, fase, created_at, updated_at,
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

      const { data, count, error: err } = await query.limit(10000);
      if (err) throw err;

      const normalized: StockItem[] = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        fase: (row.fase as StockFase) ?? "intermediaria",
        device: Array.isArray(row.device) ? row.device[0] : row.device,
      } as StockItem));

      setItems(normalized);
      setTotalCount(count ?? 0);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setError("Erro ao carregar estoque.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch(search);
    return () => abortRef.current?.abort();
  }, [search, fetch]);

  return { items, totalCount, loading, error, refetch: () => fetch(search) };
}

// ─── Hook de movimentos de um item ────────────────────────────────────────────

export function useStockMovements(stockItemId: string | null) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef<boolean>(false);

  const fetch = useCallback(async (id: string) => {
    cancelledRef.current = false;
    setLoading(true);
    const { data } = await supabase
      .from("stock_movements")
      .select("id, stock_item_id, type, quantity, reason, lote, user_id, user_display_name, created_at")
      .eq("stock_item_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!cancelledRef.current) {
      setMovements((data as StockMovement[]) ?? []);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (stockItemId) fetch(stockItemId);
    else setMovements([]);
    return () => { cancelledRef.current = true; };
  }, [stockItemId, fetch]);

  return { movements, loading, refetch: stockItemId ? () => fetch(stockItemId) : () => {} };
}

// ─── Ações de escrita ─────────────────────────────────────────────────────────

export async function upsertStockItem(
  deviceId: string,
  patch: { quantity?: number; min_quantity?: number; location?: string; notes?: string },
  fase: StockFase = "intermediaria"
): Promise<{ id: string } | null> {
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id, quantity")
    .eq("device_id", deviceId)
    .eq("fase", fase)
    .maybeSingle();

  if (existing) {
    const { data } = await supabase
      .from("stock_items")
      .update(patch)
      .eq("id", existing.id)
      .select("id")
      .single();
    return data;
  } else {
    const { data } = await supabase
      .from("stock_items")
      .insert({ device_id: deviceId, quantity: 0, min_quantity: 0, fase, ...patch })
      .select("id")
      .single();
    return data;
  }
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
  const { data: item } = await supabase
    .from("stock_items")
    .select("quantity")
    .eq("id", stockItemId)
    .single();

  if (!item) return { ok: false, error: "Item não encontrado." };

  const newQty =
    type === "entrada" ? item.quantity + quantity : item.quantity - quantity;

  if (newQty < 0) {
    return { ok: false, error: `Estoque insuficiente. Disponível: ${item.quantity}` };
  }

  const { data: mvData, error: mvErr } = await supabase
    .from("stock_movements")
    .insert({
      stock_item_id: stockItemId,
      type,
      quantity,
      reason: reason || null,
      lote: lote?.trim() || null,
      user_id: userId,
      user_display_name: userDisplayName ?? null,
    })
    .select("id")
    .single();

  if (mvErr) return { ok: false, error: mvErr.message };

  const { error: upErr } = await supabase
    .from("stock_items")
    .update({ quantity: newQty })
    .eq("id", stockItemId);

  if (upErr) {
    await supabase.from("stock_movements").delete().eq("id", mvData.id);
    return { ok: false, error: "Erro ao atualizar estoque. Operação cancelada para evitar inconsistência." };
  }

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
 * Devolve unidades de um lote da Expedição para Retrabalho (intermediária).
 * Fluxo: saída da expedição → entrada no intermediário com reason "Retrabalho".
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
    "Retrabalho — devolvido ao Intermediário",
    userId,
    userDisplayName,
    lote
  );
  if (!saidaResult.ok) return saidaResult;

  // 2. Localiza ou usa item intermediário existente para o mesmo device
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id")
    .eq("device_id", deviceId)
    .eq("fase", "intermediaria")
    .maybeSingle();

  let intermediariaItemId: string | null = existing?.id ?? null;

  if (!intermediariaItemId) {
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
        min_quantity: srcItem?.min_quantity ?? 0,
        location: srcItem?.location ?? null,
        notes: srcItem?.notes ?? null,
        fase: "intermediaria",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      await registerMovement(expedicaoItemId, "entrada", quantity, "Rollback — falha ao criar item intermediário", userId, userDisplayName, lote);
      return { ok: false, error: "Erro ao criar item no intermediário." };
    }
    intermediariaItemId = created.id;
  }

  // 3. Entrada no intermediário
  const entradaResult = await registerMovement(
    intermediariaItemId,
    "entrada",
    quantity,
    "Retrabalho — recebido da Expedição",
    userId,
    userDisplayName,
    lote
  );

  if (!entradaResult.ok) {
    await registerMovement(expedicaoItemId, "entrada", quantity, "Rollback — falha ao registrar entrada no intermediário", userId, userDisplayName, lote);
    return { ok: false, error: "Erro ao registrar entrada no intermediário." };
  }

  return { ok: true };
}

// ─── Lotes de um item de estoque ─────────────────────────────────────────────
export async function fetchLotesSummary(stockItemId: string): Promise<LoteSummary[]> {
  const { data } = await supabase
    .from("stock_movements")
    .select("lote, type, quantity, created_at")
    .eq("stock_item_id", stockItemId)
    .not("lote", "is", null)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const map = new Map<string, LoteSummary>();
  for (const row of data as { lote: string; type: string; quantity: number; created_at: string }[]) {
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
  stockItemId: string,
  type: "entrada" | "saida",
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const { data: mv } = await supabase
    .from("stock_movements")
    .select("stock_item_id, type, quantity")
    .eq("id", movementId)
    .maybeSingle();

  if (!mv) return { ok: false, error: "Movimento não encontrado." };
  if (mv.stock_item_id !== stockItemId) return { ok: false, error: "Movimento não pertence a este item." };
  type = mv.type as "entrada" | "saida";
  quantity = mv.quantity;

  const { data: item } = await supabase
    .from("stock_items")
    .select("quantity")
    .eq("id", stockItemId)
    .single();

  if (!item) return { ok: false, error: "Item não encontrado." };

  const newQty = type === "entrada" ? item.quantity - quantity : item.quantity + quantity;

  if (newQty < 0) {
    return { ok: false, error: `Não é possível cancelar: estoque ficaria negativo (${newQty}).` };
  }

  const { error: delErr } = await supabase
    .from("stock_movements")
    .delete()
    .eq("id", movementId);
  if (delErr) return { ok: false, error: delErr.message };

  const { error: upErr } = await supabase
    .from("stock_items")
    .update({ quantity: newQty })
    .eq("id", stockItemId);
  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true };
}

export async function deleteStockItem(
  stockItemId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("stock_items")
    .delete()
    .eq("id", stockItemId);
  return error ? { ok: false, error: error.message } : { ok: true };
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
  const { data: existing } = await supabase
    .from("backup_configs")
    .select("id")
    .maybeSingle();

  const op = existing
    ? supabase.from("backup_configs").update({ schedule, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : supabase.from("backup_configs").insert({ schedule });

  const { error } = await op;
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

  const { error } = await supabase.from("stock_backups").insert({
    created_by: userId,
    created_name: userName,
    item_count: (itemsRes.data ?? []).length,
    payload,
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
    .select("id, created_by, created_name, item_count, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as StockBackup[]) ?? [];
}

export async function downloadBackup(backupId: string): Promise<object | null> {
  const { data } = await supabase
    .from("stock_backups")
    .select("payload, created_at")
    .eq("id", backupId)
    .single();
  return data ?? null;
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

export async function fetchAllMovements(limit = 100): Promise<AllMovement[]> {
  const { data } = await supabase
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
