// main.js - Browser entry point

import { allTrees, isValidExtension } from './lib.js';

// ---------------------------
// IndexedDB cache adapter
// ---------------------------

let dbPromise = null;

function openTreeDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("TreeCacheDB", 1);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains("treesOfSize")) {
          db.createObjectStore("treesOfSize", { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

const indexedDBCacheAdapter = {
  async load(size, n) {
    const db = await openTreeDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readonly");
      const req = tx.objectStore("treesOfSize").get(size + ":" + n);
      req.onsuccess = () => resolve(req.result ? req.result.trees : null);
      req.onerror = () => reject(req.error);
    });
  },

  async save(size, n, trees) {
    const db = await openTreeDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readwrite");
      const req = tx.objectStore("treesOfSize").put({ key: size + ":" + n, trees });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getMaxCachedSize(n) {
    const db = await openTreeDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readonly");
      const req = tx.objectStore("treesOfSize").openCursor();
      let maxSize = 0;

      req.onsuccess = function () {
        const cursor = req.result;
        if (cursor) {
          const parts = String(cursor.key).split(":");
          if (parts.length === 2) {
            const sizePart = parseInt(parts[0], 10);
            const nPart = parseInt(parts[1], 10);
            if (!isNaN(sizePart) && !isNaN(nPart) && nPart === n && sizePart > maxSize) {
              maxSize = sizePart;
            }
          }
          cursor.continue();
        } else {
          resolve(maxSize);
        }
      };

      req.onerror = () => reject(req.error);
    });
  },
};

// ---------------------------
// Worker pool for parallel embeds()
// ---------------------------

class WorkerPool {
  constructor(workerScriptUrl, size) {
    this.size = size;
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.nextId = 1;
    this.callbacks = {};

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScriptUrl, { type: 'module' });
      worker.onmessage = (e) => this._onWorkerMessage(worker, e);
      worker.onerror = (err) => console.error("Worker error:", err);
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  _onWorkerMessage(worker, e) {
    const { id, result } = e.data;
    const cb = this.callbacks[id];
    if (cb) {
      delete this.callbacks[id];
      cb.resolve(result);
    }
    this.idleWorkers.push(worker);
    this._dispatch();
  }

  _dispatch() {
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const worker = this.idleWorkers.pop();
      const task = this.queue.shift();
      worker.postMessage(task.msg);
    }
  }

  submitEmbed(pattern, target) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.callbacks[id] = { resolve, reject };
      this.queue.push({ msg: { id, pattern, target } });
      this._dispatch();
    });
  }

  terminate() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
    this.callbacks = {};
    this.queue = [];
  }
}

// ---------------------------
// TREE(n) (conceptual, async)
// ---------------------------

async function TREE(n, pool, cacheAdapter) {
  let best = 0;
  const embedsFn = (pattern, target) => pool.submitEmbed(pattern, target);

  async function backtrack(seq) {
    if (seq.length > best) {
      best = seq.length;
      console.log("New best:", best);
    }

    for await (const t of allTrees(n, cacheAdapter)) {
      const ok = await isValidExtension(seq, t, embedsFn);
      if (ok) {
        seq.push(t);
        await backtrack(seq);
        seq.pop();
      }
      // This loop is effectively infinite for n >= 2.
    }
  }

  await backtrack([]);
  return best;
}

// ---------------------------
// Browser entry point
// ---------------------------

(async function main() {
  const params = new URLSearchParams(window.location.search);
  const nParam = params.get('n');
  const n = nParam !== null ? Math.max(1, parseInt(nParam, 10)) : 3;
  const workerCount = navigator.hardwareConcurrency || 4;
  const pool = new WorkerPool(new URL('./tree-worker.js', import.meta.url), workerCount);

  console.log(
    "Computing TREE(" + n + ") (conceptual only, will not terminate for n > 1)..."
  );

  try {
    const result = await TREE(n, pool, indexedDBCacheAdapter);
    console.log("TREE(" + n + ") = " + result);
  } catch (e) {
    console.error("Error during TREE computation:", e);
  } finally {
    pool.terminate();
  }
})();
