// main.js

// ---------------------------
// Tree representation
// ---------------------------

// We'll use plain objects: { label: number, children: Tree[] }
function treeToString(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return `${tree.label}(` +
    tree.children.map(treeToString).join(", ") +
    `)`;
}

// For deduplication in treesOfSize
function treeKey(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return `${tree.label}(${tree.children.map(treeKey).join(",")})`;
}

// ---------------------------
// Enumerating all finite labeled trees over {1..n}
// ---------------------------

const treesOfSizeCache = new Map(); // key: `${size}:${n}` -> Tree[]

function treesOfSize(size, n) {
  const cacheKey = `${size}:${n}`;
  if (treesOfSizeCache.has(cacheKey)) {
    return treesOfSizeCache.get(cacheKey);
  }

  let result;

  if (size === 1) {
    result = [];
    for (let label = 1; label <= n; label++) {
      result.push({ label, children: [] });
    }
    treesOfSizeCache.set(cacheKey, result);
    return result;
  }

  const seen = new Map(); // map from treeKey -> tree

  for (let rootLabel = 1; rootLabel <= n; rootLabel++) {
    for (const comp of compositions(size - 1)) {
      const subtreeLists = comp.map((part) => treesOfSize(part, n)); // each is Tree[]
      const combos = cartesian(subtreeLists); // array of arrays of subtrees
      for (const childrenCombo of combos) {
        const tree = { label: rootLabel, children: childrenCombo };
        const key = treeKey(tree);
        if (!seen.has(key)) {
          seen.set(key, tree);
        }
      }
    }
  }

  result = Array.from(seen.values());
  treesOfSizeCache.set(cacheKey, result);
  return result;
}

// Infinite generator of all trees
function* allTrees(n) {
  let size = 1;
  while (true) {
    const ts = treesOfSize(size, n);
    for (const t of ts) {
      yield t;
    }
    size += 1;
  }
}

// compositions(total): yields tuples of positive integers summing to total
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
  for (const list of lists) {
    const next = [];
    for (const prefix of acc) {
      for (const item of list) {
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
    this.callbacks = new Map(); // id -> {resolve, reject}

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
    const { id, result } = e.data;
    const cb = this.callbacks.get(id);
    if (cb) {
      this.callbacks.delete(id);
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
      this.callbacks.set(id, { resolve, reject });
      this.queue.push({
        msg: { id, pattern, target }
      });
      this._dispatch();
    });
  }

  terminate() {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
    this.callbacks.clear();
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

  // submit all embeds(prev, t) in parallel
  const promises = seq.map((prev) => pool.submitEmbed(prev, t));

  // Wait sequentially for results; workers run in parallel underneath
  for (const p of promises) {
    const embedsResult = await p;
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

    for (const t of allTrees(n)) {
      const ok = await isValidExtension(seq, t, pool);
      if (ok) {
        seq.push(t);
        await backtrack(seq);
        seq.pop();
      }
      // NOTE: This loop is infinite for n ≥ 2, just like the Python version.
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

  console.log(`Computing TREE(${n}) (conceptual only, will not terminate for n > 1)...`);
  try {
    const result = await TREE(n, pool);
    console.log(`TREE(${n}) = ${result}`);
  } catch (e) {
    console.error("Error during TREE computation:", e);
  } finally {
    pool.terminate();
  }
})();

