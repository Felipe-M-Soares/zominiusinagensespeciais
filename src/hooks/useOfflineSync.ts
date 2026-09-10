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
  findQueuedOperationByLocalId,
  getQueuedRpcArgsByLocalId,
  updateQueuedRpcArgs,
  cancelPendingRpc,
  saveFormDraft,
  getFormDraft,
  clearFormDraft,
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
  const [oldestPendingDays, setOldestPendingDays] = useState<number | null>(null);
  const [storageWarning, setStorageWarning] = useState<{ usageRatio: number; isCritical: boolean } | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const queue = await getQueuedOperations();
    setPendingCount(queue.length);

    // Idade do item mais antigo ainda não sincronizado — usado para avisar
    // o operador/admin se algo ficou pendente por muito tempo (ex: vários
    // dias sem internet), em vez de só mostrar "X pendentes" sem contexto
    // de urgência.
    if (queue.length > 0) {
      const oldest = queue.reduce((min, item) =>
        item.created_at < min.created_at ? item : min
      );
      const ageMs = Date.now() - new Date(oldest.created_at).getTime();
      setOldestPendingDays(Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    } else {
      setOldestPendingDays(null);
    }

    // Estimativa de quota de armazenamento do navegador (IndexedDB + Cache
    // Storage). navigator.storage.estimate() é amplamente suportado em
    // navegadores modernos via HTTPS; em navegadores sem suporte, degrada
    // para null sem quebrar nada.
    try {
      if (navigator.storage?.estimate) {
        const { usage = 0, quota = 1 } = await navigator.storage.estimate();
        const usageRatio = usage / quota;
        setStorageWarning({ usageRatio, isCritical: usageRatio > 0.9 });
      }
    } catch {
      // API indisponível ou bloqueada — não é crítico, segue sem o aviso.
    }
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
          const { id } = item.data as { id: string };
          const { error } = await supabase.from(item.table as never).delete().eq("id", id);
          if (error) throw error;
        } else if (item.operation === "RPC" && item.rpcName) {
          // Apontamentos de produção via RPC (criar_apontamento_ppi51) geram
          // sequencial/lote no servidor (nextval) — não podem ser calculados
          // localmente sem risco de colisão entre operadores offline, então
          // a fila guarda os dados brutos do formulário e só chama a função
          // real quando reconectar.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rpcResult, error } = await (supabase.rpc as any)(item.rpcName, item.data);
          if (error) throw error;
          const result = rpcResult as { ok?: boolean; error?: string } | null;
          if (result?.ok === false) throw new Error(result.error ?? "Falha ao sincronizar apontamento");
          // Remove o registro local "pendente" (id temporário) — a próxima
          // recarga de dados online traz o apontamento real do servidor.
          if (item.data.__localId) {
            await dbDelete("apontamentos", item.data.__localId as string);
          }
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

      // Atualiza cache local (chega aqui só para INSERT/UPDATE — o branch
      // DELETE/RPC sempre retorna antes, nas linhas acima)
      if (result.data) {
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

  // ── Salva via RPC com fallback offline ──────────────────────────────────
  // Para chamadas que não são um INSERT/UPDATE/DELETE simples de tabela —
  // ex: criar_apontamento_ppi51, que gera sequencial/lote no servidor e
  // grava em mais de uma tabela atomicamente. Quando offline, guarda os
  // dados brutos do formulário num registro local temporário (id próprio,
  // prefixo "local-") para o operador ver na lista mesmo sem ter sincronizado
  // ainda; a RPC real só é chamada quando a conexão volta.
  const saveRpcWithFallback = useCallback(async (
    rpcName: string,
    rpcArgs: Record<string, unknown>,
    offlineTable: OfflineTable,
    localPreview: Record<string, unknown>
  ): Promise<{ ok: boolean; error: string | null; savedOffline: boolean; localId?: string }> => {
    if (!navigator.onLine) {
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await dbPut(offlineTable, { ...localPreview, id: localId, __pendingSync: true });
      await queueOperation(offlineTable, "RPC", { ...rpcArgs, __localId: localId }, rpcName);
      await refreshPendingCount();
      return { ok: true, error: null, savedOffline: true, localId };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(rpcName, rpcArgs);
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string } | null;
      if (result?.ok === false) throw new Error(result.error ?? "Erro ao salvar");
      return { ok: true, error: null, savedOffline: false };
    } catch (err) {
      // Fallback: rede falhou no meio da chamada (ex: conexão instável,
      // não necessariamente navigator.onLine=false) — mesma lógica do caso
      // offline acima, para nunca perder o que o operador digitou.
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await dbPut(offlineTable, { ...localPreview, id: localId, __pendingSync: true });
      await queueOperation(offlineTable, "RPC", { ...rpcArgs, __localId: localId }, rpcName);
      await refreshPendingCount();
      const msg = err instanceof Error ? err.message : "Falha de conexão";
      return { ok: true, error: msg, savedOffline: true, localId };
    }
  }, [refreshPendingCount]);

  // ── Busca os dados originais de um apontamento pendente para edição ─────
  // Diferente do preview exibido no card (simplificado), retorna os
  // argumentos RPC completos salvos na fila — inclui paradas/refugos.
  const getEditDataForPending = useCallback(async (localId: string) => {
    return getQueuedRpcArgsByLocalId(localId);
  }, []);

  // ── Rascunho de formulário (proteção contra fechar o navegador no meio) ──
  const saveDraft = useCallback(async (data: Record<string, unknown>) => {
    await saveFormDraft(data);
  }, []);
  const loadDraft = useCallback(async () => {
    return getFormDraft();
  }, []);
  const clearDraft = useCallback(async () => {
    await clearFormDraft();
  }, []);

  // ── Edita um apontamento ainda pendente (não sincronizado) ──────────────
  // Atualiza tanto o preview exibido na tela quanto os argumentos reais que
  // serão enviados à RPC quando a conexão voltar. Só funciona para itens
  // ainda na fila local — depois de sincronizado, a edição precisa passar
  // pelo fluxo normal (online) de correção de apontamento.
  const updatePendingApontamento = useCallback(async (
    localId: string,
    offlineTable: OfflineTable,
    newRpcArgs: Record<string, unknown>,
    newLocalPreview: Record<string, unknown>
  ): Promise<{ ok: boolean; error: string | null }> => {
    const queueItem = await findQueuedOperationByLocalId(localId);
    if (!queueItem) {
      return { ok: false, error: "Este apontamento já foi sincronizado e não pode mais ser editado offline." };
    }
    await updateQueuedRpcArgs(queueItem.id, newRpcArgs);
    await dbPut(offlineTable, { ...newLocalPreview, id: localId, __pendingSync: true });
    return { ok: true, error: null };
  }, []);

  // ── Cancela (remove) um apontamento ainda pendente ──────────────────────
  const cancelPendingApontamento = useCallback(async (
    localId: string,
    offlineTable: OfflineTable
  ): Promise<{ ok: boolean; error: string | null }> => {
    const queueItem = await findQueuedOperationByLocalId(localId);
    if (!queueItem) {
      return { ok: false, error: "Este apontamento já foi sincronizado e não pode mais ser cancelado offline." };
    }
    await cancelPendingRpc(queueItem.id, offlineTable);
    await refreshPendingCount();
    return { ok: true, error: null };
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
        // select("*") é proposital aqui: loadWithFallback é genérico (usado por
        // ~9 painéis de produção) e grava o registro completo no cache local
        // (IndexedDB) para uso offline — restringir colunas quebraria o cache
        // para quem não passar uma query customizada. Chamadores que precisam
        // de menos campos já podem usar o parâmetro `query` para isso.
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
    oldestPendingDays,
    storageWarning,
    syncing,
    syncQueue,
    saveWithFallback,
    saveRpcWithFallback,
    getEditDataForPending,
    saveDraft,
    loadDraft,
    clearDraft,
    updatePendingApontamento,
    cancelPendingApontamento,
    loadWithFallback,
    refreshPendingCount,
  };
}
