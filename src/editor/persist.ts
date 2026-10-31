import type { Doc } from "@/model";

const DB = "trama";
const STORE = "docs";
const KEY = "current";

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await open();
  return new Promise((resolve, reject) => {
    const req = fn(conn.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const load = () => run<Doc | undefined>("readonly", (s) => s.get(KEY));
export const save = (doc: Doc) => run("readwrite", (s) => s.put(doc, KEY));
