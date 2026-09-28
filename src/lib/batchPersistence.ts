/**
 * Persistencia local del Batch en IndexedDB (solo en este navegador; nada sale
 * del equipo). Guarda el workbook original, el mapeo, las filas, los logs y los
 * ajustes para que un reload, cierre de pestaña o crash no pierda el trabajo.
 */

export const BATCH_SNAPSHOT_SCHEMA = 1;

export interface PersistedBatchRow {
  question: string;
  answer: string;
  review: string;
  reviewApproved: boolean;
  expert: string;
  sources: string;
  sourceRow: number;
  status: "pending" | "running" | "done" | "error" | "skipped";
  redoneAt?: number;
}

export interface BatchSnapshot {
  schema: number;
  savedAt: number;
  fileName: string;
  fileBytes: ArrayBuffer | null;
  selectedSheet: string;
  headerRow: number;
  questionCol: string;
  answerCol: string;
  reviewCol: string;
  newAnswerColumnName: string;
  newReviewColumnName: string;
  context: string;
  mode: string;
  customPrompt: string;
  customPromptFileName: string;
  startRow: number;
  rows: PersistedBatchRow[];
  logs: Array<{ time: number; level: "info" | "warn" | "error"; message: string; row?: number }>;
  /** true si se guardó mientras había una petición en curso. */
  interrupted: boolean;
}

const DB_NAME = "askanything-batch";
const STORE = "snapshots";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBatchSnapshot(snapshot: BatchSnapshot): Promise<void> {
  await tx("readwrite", (store) => store.put(snapshot, KEY));
}

export async function loadBatchSnapshot(): Promise<BatchSnapshot | null> {
  const snap = await tx<BatchSnapshot | undefined>("readonly", (store) => store.get(KEY));
  if (!snap || snap.schema !== BATCH_SNAPSHOT_SCHEMA) return null;
  return snap;
}

export async function clearBatchSnapshot(): Promise<void> {
  await tx("readwrite", (store) => store.delete(KEY));
}

/** Una fila "running" al restaurar nunca llegó a completarse: vuelve a pending. */
export function restoreRows(rows: PersistedBatchRow[]): PersistedBatchRow[] {
  return rows.map((row) => (row.status === "running" ? { ...row, status: "pending" } : row));
}

/** Primera fila pendiente (1-based) desde el inicio elegido, para reanudar. */
export function resumeStartRow(rows: PersistedBatchRow[], startRow: number): number {
  const from = Math.max(0, startRow - 1);
  const index = rows.findIndex((row, i) => i >= from && row.status === "pending");
  return index >= 0 ? index + 1 : Math.max(1, startRow);
}
