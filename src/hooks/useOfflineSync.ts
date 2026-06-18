/**
 * useOfflineSync — Hook de sincronização offline/online
 * Detecta conectividade, processa fila de operações pendentes
 * e provê utilitários para salvar com fallback offline
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  dbPut,
  dbPutMany,
  dbDelete,
  dbGetAll,
  queueOperation,
  getQueuedOperations,
  removeFromQueue,
  incrementRetry,
  type OfflineTable,
  type SyncQueueItem,
} from "@/lib/offlineDB";
import { toast } from "sonner";

const MAX_RETRIES = 3;

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  // ── Atualiza contador de pendentes ─────────────────────────────────────────
  const refreshPendingCount = useCallback(async () => {
    const queue = await getQueuedOperations();
    setPendingCount(queue.length);
  }, []);

  // ── Sincroniza fila com Supabase ───────────────────────────────────────────
  const syncQueue = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);

    const queue = await getQueuedOperations();
    if (queue.length === 0) {
      syncingRef.current = false;
      setSyncing(false);
      return;
    }

    let synced = 0;
    let failed = 0;

    for (const item of queue) {
      if (item.retries >= MAX_RETRIES) {
        await removeFromQueue(item.id);
        failed++;
        continue;
      }

      try {
        if (item.operation === "INSERT") {
          const { error } = await supabase.from(item.table as never).insert(item.data as never);
          if (error) throw error;
        } else if (item.operation === "UPDATE") {
          const { id, ...rest } = item.data as { id: string; [key: string]: unknown };
          const { error } = await supabase.from(item.table as never).update(rest as never).eq("id", id);
          if (error) throw error;
        } else if (item.operation === "DELETE") {
          const { error } = await supabase.from(item.table as never).delete().eq("id", item.data.id);
          if (error) throw error;
        }
        await removeFromQueue(item.id);
        synced++;
      } catch {
        await incrementRetry(item);
        failed++;
      }
    }

    syncingRef.current = false;
    setSyncing(false);
    await refreshPendingCount();

    if (synced > 0) {
      toast.success(`${synced} operação${synced > 1 ? "ões" : ""} sincronizada${synced > 1 ? "s" : ""} com sucesso`);
    }
    if (failed > 0) {
      toast.error(`${failed} operação${failed > 1 ? "ões" : ""} falhou na sincronização`);
    }
  }, [refreshPendingCount]);

  // ── Detecta mudanças de conectividade ─────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Conexão restaurada — sincronizando...", { duration: 3000 });
      syncQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("Sem conexão — operações serão salvas localmente", { duration: 4000 });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    refreshPendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncQueue, refreshPendingCount]);

  // ── Salva com fallback offline ─────────────────────────────────────────────
  // useCallback garante referência estável
  const saveWithFallback = useCallback(async function<T extends { id: string }>(
    supabaseTable: string,
    offlineTable: OfflineTable,
    operation: SyncQueueItem["operation"],
    data: T,
    localData?: T
  ): Promise<{ data: T | null; error: string | null; savedOffline: boolean }> {
    const itemToStore = localData || data;

    if (!navigator.onLine) {
      await dbPut(offlineTable, itemToStore);
      await queueOperation(supabaseTable, operation, data as Record<string, unknown>);
      await refreshPendingCount();
      return { data: itemToStore, error: null, savedOffline: true };
    }

    try {
      let result;
      if (operation === "INSERT") {
        result = await supabase.from(supabaseTable as never).insert(data as never).select().single();
      } else if (operation === "UPDATE") {
        const { id, ...rest } = data as { id: string; [key: string]: unknown };
        result = await supabase.from(supabaseTable as never).update(rest as never).eq("id", id).select().single();
      } else {
        result = await supabase.from(supabaseTable as never).delete().eq("id", (data as { id: string }).id);
        await dbDelete(offlineTable, (data as { id: string }).id);
        return { data: null, error: null, savedOffline: false };
      }

      if (result.error) throw result.error;

      // Atualiza cache local
      if (operation !== "DELETE" && result.data) {
        await dbPut(offlineTable, result.data as T);
      }

      return { data: result.data as T, error: null, savedOffline: false };
    } catch (err) {
      // Fallback: salva offline
      await dbPut(offlineTable, itemToStore);
      await queueOperation(supabaseTable, operation, data as Record<string, unknown>);
      await refreshPendingCount();
      return { data: itemToStore, error: null, savedOffline: true };
    }
  }, [refreshPendingCount]);

  // ── Carrega dados (online primeiro, fallback offline) ──────────────────────
  // useCallback garante referência estável — evita loop infinito em dependências
  const loadWithFallback = useCallback(async function<T extends { id: string }>(
    supabaseTable: string,
    offlineTable: OfflineTable,
    query?: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>
  ): Promise<T[]> {
    if (navigator.onLine) {
      try {
        let q = supabase.from(supabaseTable as never).select("*");
        if (query) q = query(q as never) as never;
        const { data, error } = await q;
        if (error) throw error;
        if (data && data.length > 0) {
          await dbPutMany(offlineTable, data as T[]);
          return data as T[];
        }
      } catch {
        // fallback para cache local
      }
    }

    const cached = await dbGetAll<T>(offlineTable);
    return cached;
  }, []);

  return {
    isOnline,
    pendingCount,
    syncing,
    syncQueue,
    saveWithFallback,
    loadWithFallback,
    refreshPendingCount,
  };
}
