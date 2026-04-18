import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Device } from "@/types/device";

// ─── Tipos locais ────────────────────────────────────────────────────────────

export interface StockItem {
  id: string;
  device_id: string;
  quantity: number;
  min_quantity: number;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // join de devices
  device: Device & { id: string };
}

export interface StockMovement {
  id: string;
  stock_item_id: string;
  type: "entrada" | "saida";
  quantity: number;
  reason: string | null;
  user_id: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitize(raw: string): string {
  return raw.trim().slice(0, 200).replace(/[(),]/g, "").replace(/[%_\\]/g, "\\$&");
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
      // Traz stock_items + join de devices em uma única query
      let query = supabase
        .from("stock_items")
        .select(
          `id, device_id, quantity, min_quantity, location, notes, created_at, updated_at,
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
        // Filtra via devices relacionado — usa subquery via in
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

      const { data, count, error: err } = await query;
      if (err) throw err;

      // O PostgREST retorna device como array de 1 no join to-one — normaliza
      const normalized: StockItem[] = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
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

  const fetch = useCallback(async (id: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("stock_movements")
      .select("*")
      .eq("stock_item_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    setMovements((data as StockMovement[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (stockItemId) fetch(stockItemId);
    else setMovements([]);
  }, [stockItemId, fetch]);

  return { movements, loading, refetch: stockItemId ? () => fetch(stockItemId) : () => {} };
}

// ─── Ações de escrita ─────────────────────────────────────────────────────────

/** Cria ou atualiza um item de estoque (upsert por device_id) */
export async function upsertStockItem(
  deviceId: string,
  patch: { quantity?: number; min_quantity?: number; location?: string; notes?: string }
): Promise<{ id: string } | null> {
  // Verifica se já existe
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id, quantity")
    .eq("device_id", deviceId)
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
      .insert({ device_id: deviceId, quantity: 0, min_quantity: 0, ...patch })
      .select("id")
      .single();
    return data;
  }
}

/** Registra um movimento (entrada ou saída) e atualiza a quantidade */
export async function registerMovement(
  stockItemId: string,
  type: "entrada" | "saida",
  quantity: number,
  reason: string,
  userId: string | null
): Promise<{ ok: boolean; error?: string }> {
  // Busca quantidade atual
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

  // Insere movimento
  const { error: mvErr } = await supabase.from("stock_movements").insert({
    stock_item_id: stockItemId,
    type,
    quantity,
    reason: reason || null,
    user_id: userId,
  });
  if (mvErr) return { ok: false, error: mvErr.message };

  // Atualiza quantidade
  const { error: upErr } = await supabase
    .from("stock_items")
    .update({ quantity: newQty })
    .eq("id", stockItemId);
  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true };
}

/** Adiciona uma peça ao estoque a partir de um device (cria com qty 0 se não existir) */
export async function addDeviceToStock(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("stock_items")
    .upsert({ device_id: deviceId, quantity: 0, min_quantity: 0 }, { onConflict: "device_id", ignoreDuplicates: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Cancela (desfaz) um movimento: reverte a qty e deleta o registro */
export async function cancelMovement(
  movementId: string,
  stockItemId: string,
  type: "entrada" | "saida",
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  // Busca qty atual
  const { data: item } = await supabase
    .from("stock_items")
    .select("quantity")
    .eq("id", stockItemId)
    .single();

  if (!item) return { ok: false, error: "Item não encontrado." };

  // Inverte o movimento: entrada vira saída e vice-versa
  const newQty = type === "entrada" ? item.quantity - quantity : item.quantity + quantity;

  if (newQty < 0) {
    return { ok: false, error: `Não é possível cancelar: estoque ficaria negativo (${newQty}).` };
  }

  // Deleta o movimento
  const { error: delErr } = await supabase
    .from("stock_movements")
    .delete()
    .eq("id", movementId);
  if (delErr) return { ok: false, error: delErr.message };

  // Atualiza quantidade
  const { error: upErr } = await supabase
    .from("stock_items")
    .update({ quantity: newQty })
    .eq("id", stockItemId);
  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true };
}

/** Remove uma peça completamente do sistema de estoque */
export async function deleteStockItem(
  stockItemId: string
): Promise<{ ok: boolean; error?: string }> {
  // Os movimentos são deletados em cascata pela FK
  const { error } = await supabase
    .from("stock_items")
    .delete()
    .eq("id", stockItemId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
