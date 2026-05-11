// lib.js - Pure tree logic, no browser-specific APIs

// Tree representation: { label: number, children: Tree[] }

export function treeToString(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return tree.label + "(" + tree.children.map(treeToString).join(", ") + ")";
}

// Used for deduplication keys (no spaces)
export function treeKey(tree) {
  if (!tree.children || tree.children.length === 0) {
    return String(tree.label);
  }
  return tree.label + "(" + tree.children.map(treeKey).join(",") + ")";
}

// Yields all ordered compositions of total into positive integers
export function* compositions(total) {
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
export function cartesian(lists) {
  if (lists.length === 0) return [[]];
  let acc = [[]];
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    const next = [];
    for (let j = 0; j < acc.length; j++) {
      const prefix = acc[j];
      for (let k = 0; k < list.length; k++) {
        next.push(prefix.concat([list[k]]));
      }
    }
    acc = next;
  }
  return acc;
}

// Tree minor embedding (also used in tree-worker.js)
export function embeds(A, B) {
  if (rootEmbeds(A, B)) return true;
  for (const child of B.children) {
    if (embeds(A, child)) return true;
  }
  return false;
}

export function rootEmbeds(pattern, target) {
  if (pattern.label !== target.label) return false;
  if (!pattern.children || pattern.children.length === 0) return true;
  return matchChildren(pattern.children, target.children);
}

export function matchChildren(pkids, tkids) {
  if (!pkids || pkids.length === 0) return true;
  const [first, ...rest] = pkids;
  for (let i = 0; i < tkids.length; i++) {
    const tchild = tkids[i];
    if (rootEmbeds(first, tchild)) {
      if (matchChildren(rest, tkids.slice(i + 1))) return true;
    }
    if (matchChildren(pkids, tchild.children || [])) return true;
  }
  return false;
}

// Lazy cartesian product — yields one combination at a time without
// materialising the full cross-product array, keeping peak memory O(depth).
function* cartesianLazy(lists) {
  if (lists.length === 0) { yield []; return; }
  const [first, ...rest] = lists;
  for (const item of first) {
    for (const combo of cartesianLazy(rest)) {
      yield [item, ...combo];
    }
  }
}

// cacheAdapter interface: { load(size, n), save(size, n, trees), getMaxCachedSize(n) }
// All methods return Promises.

export async function treesOfSize(size, n, cacheAdapter) {
  const cached = await cacheAdapter.load(size, n);
  if (cached) return cached;

  let result;

  if (size === 1) {
    result = [];
    for (let label = 1; label <= n; label++) {
      result.push({ label, children: [] });
    }
    await cacheAdapter.save(size, n, result);
    return result;
  }

  const seen = new Map();

  outer:
  for (let rootLabel = 1; rootLabel <= n; rootLabel++) {
    for (const comp of compositions(size - 1)) {
      const subtreeLists = await Promise.all(
        comp.map((part) => treesOfSize(part, n, cacheAdapter))
      );
      for (const childrenCombo of cartesianLazy(subtreeLists)) {
        const tree = { label: rootLabel, children: childrenCombo };
        const key = treeKey(tree);
        if (!seen.has(key)) {
          try {
            seen.set(key, tree);
          } catch (e) {
            if (e instanceof RangeError) {
              // Map capacity exhausted — cache and return the partial set so
              // the caller can keep running with trees enumerated so far.
              console.warn(
                `treesOfSize(${size}, ${n}): map limit reached at ${seen.size} trees, truncating`
              );
              break outer;
            }
            throw e;
          }
        }
      }
    }
  }

  result = [...seen.values()];
  await cacheAdapter.save(size, n, result);
  return result;
}

// Infinite async generator of all trees in order of increasing size,
// resuming from the largest size already in the cache.
// Stops cleanly if treesOfSize throws (e.g. memory exhausted on larger sizes).
export async function* allTrees(n, cacheAdapter) {
  const maxSize = await cacheAdapter.getMaxCachedSize(n);
  let size = maxSize > 0 ? maxSize + 1 : 1;

  console.log("allTrees starting at size", size, "for n =", n, "(max cached =", maxSize, ")");

  while (true) {
    let ts;
    try {
      ts = await treesOfSize(size, n, cacheAdapter);
    } catch (e) {
      console.warn(`allTrees: stopping at size ${size} — ${e.message}`);
      return;
    }
    for (let i = 0; i < ts.length; i++) {
      yield ts[i];
    }
    size += 1;
  }
}

// embedsFn(pattern, target) -> Promise<boolean>
// Returns false (invalid extension) if any tree in seq embeds into t.
export async function isValidExtension(seq, t, embedsFn) {
  if (!seq || seq.length === 0) return true;

  const promises = seq.map((s) => embedsFn(s, t));

  for (let i = 0; i < promises.length; i++) {
    const result = await promises[i];
    if (result) return false;
  }

  return true;
}
