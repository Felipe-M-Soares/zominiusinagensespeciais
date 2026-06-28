/**
 * offlineDB — IndexedDB para modo offline da produção
 * Armazena dados localmente quando sem conexão e sincroniza ao reconectar
 */

const DB_NAME = "concept_producao_offline";
const DB_VERSION = 1;

export type OfflineTable =
  | "apontamentos"
  | "ordens_planejamento"
  | "maquinas"
  | "produtos_producao"
  | "paradas"
  | "refugos"
  | "materias_primas"
  | "movimentos_mp"
  | "sync_queue";

export interface SyncQueueItem {
  id: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE" | "RPC";
  data: Record<string, unknown>;
  created_at: string;
  retries: number;
  /** Nome da função RPC a chamar quando operation === "RPC". O campo
   * `table` nesse caso é usado só como rótulo informativo (ex: nome da
   * tabela local correspondente), não é usado para montar a query. */
  rpcName?: string;
}

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      const tables: OfflineTable[] = [
        "apontamentos",
        "ordens_planejamento",
        "maquinas",
        "produtos_producao",
        "paradas",
        "refugos",
        "materias_primas",
        "movimentos_mp",
        "sync_queue",
      ];

      for (const table of tables) {
        if (!db.objectStoreNames.contains(table)) {
          const store = db.createObjectStore(table, { keyPath: "id" });
          if (table === "sync_queue") {
            store.createIndex("created_at", "created_at", { unique: false });
          }
          if (table === "apontamentos") {
            store.createIndex("status", "status", { unique: false });
          }
          if (table === "paradas") {
            store.createIndex("maquina", "maquina_id", { unique: false });
          }
        }
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function dbGetAll<T>(table: OfflineTable): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readonly");
    const req = tx.objectStore(table).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T>(table: OfflineTable, id: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readonly");
    const req = tx.objectStore(table).get(id);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut<T extends { id: string }>(table: OfflineTable, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readwrite");
    const req = tx.objectStore(table).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutMany<T extends { id: string }>(table: OfflineTable, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readwrite");
    const store = tx.objectStore(table);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(table: OfflineTable, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readwrite");
    const req = tx.objectStore(table).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbClear(table: OfflineTable): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, "readwrite");
    const req = tx.objectStore(table).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Sync Queue ─────────────────────────────────────────────────────────────────

export async function queueOperation(
  table: string,
  operation: SyncQueueItem["operation"],
  data: Record<string, unknown>,
  rpcName?: string
): Promise<void> {
  const item: SyncQueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    table,
    operation,
    data,
    created_at: new Date().toISOString(),
    retries: 0,
    ...(rpcName ? { rpcName } : {}),
  };
  await dbPut("sync_queue", item);
}

export async function getQueuedOperations(): Promise<SyncQueueItem[]> {
  return dbGetAll<SyncQueueItem>("sync_queue");
}

export async function removeFromQueue(id: string): Promise<void> {
  return dbDelete("sync_queue", id);
}

export async function incrementRetry(item: SyncQueueItem): Promise<void> {
  await dbPut("sync_queue", { ...item, retries: item.retries + 1 });
}

/**
 * Acha a entrada da fila de sincronização correspondente a um registro
 * local pendente, pelo __localId gravado em data (ver saveRpcWithFallback
 * em useOfflineSync.ts). Necessário porque o id da própria entrada na fila
 * (SyncQueueItem.id) é diferente do id do registro local que o usuário vê
 * na tela — para editar/cancelar um apontamento pendente a partir da UI,
 * é o __localId que se tem em mãos.
 */
export async function findQueuedOperationByLocalId(localId: string): Promise<SyncQueueItem | undefined> {
  const queue = await getQueuedOperations();
  return queue.find(item => item.data?.__localId === localId);
}

/**
 * Retorna os argumentos RPC originais (rpcArgs) de um apontamento pendente,
 * sem o __localId interno. Usado para reabrir o formulário de edição com
 * TODOS os campos preenchidos (incluindo paradas/refugos serializados em
 * JSON), que o preview simplificado salvo em "apontamentos" não carrega —
 * o preview existe só para exibição rápida na lista, não para edição.
 */
export async function getQueuedRpcArgsByLocalId(localId: string): Promise<Record<string, unknown> | null> {
  const item = await findQueuedOperationByLocalId(localId);
  if (!item) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { __localId, ...rpcArgs } = item.data;
  return rpcArgs;
}

/**
 * Atualiza os argumentos de uma operação RPC ainda pendente na fila, sem
 * alterar sua posição/retries. Usado para permitir corrigir um apontamento
 * salvo offline antes dele ser de fato enviado ao servidor.
 */
export async function updateQueuedRpcArgs(
  queueItemId: string,
  newRpcArgs: Record<string, unknown>
): Promise<void> {
  const item = await dbGet<SyncQueueItem>("sync_queue", queueItemId);
  if (!item) return;
  // Preserva __localId — é a chave que liga a fila ao registro local exibido na tela.
  const localId = item.data?.__localId;
  await dbPut("sync_queue", {
    ...item,
    data: { ...newRpcArgs, ...(localId ? { __localId: localId } : {}) },
  });
}

/**
 * Remove por completo um apontamento ainda pendente — tanto da fila de
 * sincronização quanto do registro local exibido na tela. Só deve ser
 * chamado para itens com operation === "RPC" e __localId definido (ainda
 * não confirmados pelo servidor); cancelar algo já sincronizado deve usar
 * o fluxo normal de cancelamento online.
 */
export async function cancelPendingRpc(queueItemId: string, offlineTable: OfflineTable): Promise<void> {
  const item = await dbGet<SyncQueueItem>("sync_queue", queueItemId);
  await dbDelete("sync_queue", queueItemId);
  const localId = item?.data?.__localId as string | undefined;
  if (localId) await dbDelete(offlineTable, localId);
}
