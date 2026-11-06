// 極簡 IndexedDB 包裝：kv（JSON 檔快取）、photos（照片 Blob）、queue（待上傳的寫入）
const DB_NAME = "training-log";
const STORES = ["kv", "photos", "queue"];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } catch (e) {
    console.warn("IndexedDB unavailable", e);
    return undefined;
  }
}

export const idb = {
  get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
  set: (store, key, val) => tx(store, "readwrite", (s) => s.put(val, key)),
  del: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
  async entries(store) {
    const keys = (await tx(store, "readonly", (s) => s.getAllKeys())) || [];
    const vals = (await tx(store, "readonly", (s) => s.getAll())) || [];
    return keys.map((k, i) => [k, vals[i]]);
  },
  clear: (store) => tx(store, "readwrite", (s) => s.clear()),
};
