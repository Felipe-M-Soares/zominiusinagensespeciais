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
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: Record<string, unknown>;
  created_at: string;
  retries: number;
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
  data: Record<string, unknown>
): Promise<void> {
  const item: SyncQueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    table,
    operation,
    data,
    created_at: new Date().toISOString(),
    retries: 0,
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
