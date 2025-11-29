// main.js

// ---------------------------
// Tree representation
// ---------------------------

// We'll use plain objects: { label: number, children: Tree[] }
function treeToString(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return (
    tree.label +
    "(" +
    tree.children.map(treeToString).join(", ") +
    ")"
  );
}

// For deduplication in treesOfSize
function treeKey(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return (
    tree.label +
    "(" +
    tree.children.map(treeKey).join(",") +
    ")"
  );
}

// ---------------------------
// IndexedDB cache for treesOfSize
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

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function loadTreesFromCache(size, n) {
  return openTreeDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readonly");
      const store = tx.objectStore("treesOfSize");
      const key = size + ":" + n;
      const req = store.get(key);

      req.onsuccess = function () {
        if (req.result) {
          resolve(req.result.trees);
        } else {
          resolve(null);
        }
      };

      req.onerror = function () {
        reject(req.error);
      };
    });
  });
}

function saveTreesToCache(size, n, trees) {
  return openTreeDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readwrite");
      const store = tx.objectStore("treesOfSize");
      const key = size + ":" + n;
      const req = store.put({ key: key, trees: trees });

      req.onsuccess = function () {
        resolve();
      };

      req.onerror = function () {
        reject(req.error);
      };
    });
  });
}

// NEW: find the largest size cached for this n
function getMaxCachedSizeForN(n) {
  return openTreeDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("treesOfSize", "readonly");
      const store = tx.objectStore("treesOfSize");
      const req = store.openCursor();
      let maxSize = 0;

      req.onsuccess = function () {
        const cursor = req.result;
        if (cursor) {
          const keyStr = String(cursor.key); // "size:n"
          const parts = keyStr.split(":");
          if (parts.length === 2) {
            const sizePart = parseInt(parts[0], 10);
            const nPart = parseInt(parts[1], 10);
            if (!isNaN(sizePart) && !isNaN(nPart) && nPart === n) {
              if (sizePart > maxSize) {
                maxSize = sizePart;
              }
            }
          }
          cursor.continue();
        } else {
          // no more entries
          resolve(maxSize);
        }
      };

      req.onerror = function () {
        reject(req.error);
      };
    });
  });
}

// ---------------------------
// Enumerating all finite labeled trees over {1..n}
// ---------------------------

// async version because of IndexedDB caching
async function treesOfSize(size, n) {
  const cached = await loadTreesFromCache(size, n);
  if (cached) {
    return cached;
  }

  let result;

  if (size === 1) {
    result = [];
    for (let label = 1; label <= n; label++) {
      result.push({ label: label, children: [] });
    }
    await saveTreesToCache(size, n, result);
    return result;
  }

  // local deduplication table using plain object instead of Map
  const seen = {}; // key: treeKey(tree) -> tree

  for (let rootLabel = 1; rootLabel <= n; rootLabel++) {
    for (const comp of compositions(size - 1)) {
      // comp is an array like [part1, part2, ...]
      const subtreeLists = await Promise.all(
        comp.map((part) => treesOfSize(part, n))
      ); // each is an array of trees

      const combos = cartesian(subtreeLists); // array of arrays of subtrees
      for (let i = 0; i < combos.length; i++) {
        const childrenCombo = combos[i];
        const tree = { label: rootLabel, children: childrenCombo };
        const key = treeKey(tree);
        if (!Object.prototype.hasOwnProperty.call(seen, key)) {
          seen[key] = tree;
        }
      }
    }
  }

  result = Object.values(seen);
  await saveTreesToCache(size, n, result);
  return result;
}

// Infinite async generator of all trees, resuming from last IndexedDB size
async function* allTrees(n) {
  // Find the largest cached size for this n
  let maxSize = await getMaxCachedSizeForN(n);

  // If we've never cached anything for this n, start from size 1.
  // If we *have* cached sizes up to S, resume from S + 1.
  let size = maxSize > 0 ? maxSize : 1;

  console.log(
    "allTrees starting at size",
    size,
    "for n =",
    n,
    "(max cached =",
    maxSize,
    ")"
  );

  while (true) {
    const ts = await treesOfSize(size, n);
    for (let i = 0; i < ts.length; i++) {
      yield ts[i];
    }
    size += 1;
  }
}

// compositions(total): yields arrays of positive integers summing to total
function* compositions(total) {
  if (total === 0) {
    yield [];
    return;
  }
  for (let first = 1; first <= total; first++) {
    for (const rest of compositions(total - first)) {
      yield [first, ...rest];
    }
  }
}

// Cartesian product of an array of arrays
function cartesian(lists) {
  if (lists.length === 0) return [[]];
  let acc = [[]];
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    const next = [];
    for (let j = 0; j < acc.length; j++) {
      const prefix = acc[j];
      for (let k = 0; k < list.length; k++) {
        const item = list[k];
        next.push(prefix.concat([item]));
      }
    }
    acc = next;
  }
  return acc;
}

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
    // callbacks: plain object instead of Map
    this.callbacks = {}; // id -> {resolve, reject}

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScriptUrl);
      worker.onmessage = (e) => this._onWorkerMessage(worker, e);
      worker.onerror = (err) => {
        console.error("Worker error:", err);
      };
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  _onWorkerMessage(worker, e) {
    const id = e.data.id;
    const result = e.data.result;
    const cb = this.callbacks[id];
    if (cb) {
      delete this.callbacks[id];
      cb.resolve(result);
    }
    this.idleWorkers.push(worker);
    this._dispatch();
  }

  _dispatch() {
    if (this.queue.length === 0) return;
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const worker = this.idleWorkers.pop();
      const task = this.queue.shift();
      worker.postMessage(task.msg);
    }
  }

  submitEmbed(pattern, target) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.callbacks[id] = { resolve: resolve, reject: reject };
      this.queue.push({
        msg: { id: id, pattern: pattern, target: target }
      });
      this._dispatch();
    });
  }

  terminate() {
    for (let i = 0; i < this.workers.length; i++) {
      this.workers[i].terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
    this.callbacks = {};
    this.queue = [];
  }
}

// ---------------------------
// Parallel is_valid_extension
// ---------------------------

async function isValidExtension(seq, t, pool) {
  if (!seq || seq.length === 0) {
    return true;
  }

  const promises = [];
  for (let i = 0; i < seq.length; i++) {
    promises.push(pool.submitEmbed(seq[i], t));
  }

  // Wait in order; workers run in parallel underneath
  for (let i = 0; i < promises.length; i++) {
    const embedsResult = await promises[i];
    if (embedsResult) {
      // Some prev embeds into t => invalid extension
      return false;
    }
  }

  return true;
}

// ---------------------------
// TREE(n) (conceptual, async)
// ---------------------------

async function TREE(n, pool) {
  let best = 0;

  async function backtrack(seq) {
    if (seq.length > best) {
      best = seq.length;
      console.log("New best:", best);
    }

    for await (const t of allTrees(n)) {
      const ok = await isValidExtension(seq, t, pool);
      if (ok) {
        seq.push(t);
        await backtrack(seq);
        seq.pop();
      }
      // Like the Python version, this loop is effectively infinite for n ≥ 2.
    }
  }

  await backtrack([]);
  return best;
}

// ---------------------------
// Example usage in browser
// ---------------------------

(async function main() {
  const n = 3; // default like the Python script
  const workerCount = navigator.hardwareConcurrency || 4;
  const pool = new WorkerPool("tree-worker.js", workerCount);

  console.log(
    "Computing TREE(" +
      n +
      ") (conceptual only, will not terminate for n > 1)..."
  );
  try {
    const result = await TREE(n, pool);
    console.log("TREE(" + n + ") = " + result);
  } catch (e) {
    console.error("Error during TREE computation:", e);
  } finally {
    pool.terminate();
  }
})();
