// tree-worker.js

// Tree is represented as plain objects:
// { label: number, children: [Tree, Tree, ...] }

function embeds(A, B) {
  if (rootEmbeds(A, B)) {
    return true;
  }
  // Check embedding into B's children
  for (const child of B.children) {
    if (embeds(A, child)) return true;
  }
  return false;
}

function rootEmbeds(pattern, target) {
  if (pattern.label !== target.label) return false;

  if (!pattern.children || pattern.children.length === 0) {
    return true;
  }

  return matchChildren(pattern.children, target.children);
}

function matchChildren(pkids, tkids) {
  if (!pkids || pkids.length === 0) {
    return true;
  }

  const [first, ...rest] = pkids;

  for (let i = 0; i < tkids.length; i++) {
    const tchild = tkids[i];

    if (rootEmbeds(first, tchild)) {
      if (matchChildren(rest, tkids.slice(i + 1))) {
        return true;
      }
    }

    if (matchChildren(pkids, tchild.children || [])) {
      return true;
    }
  }

  return false;
}

self.onmessage = (e) => {
  const { id, pattern, target } = e.data;
  const result = embeds(pattern, target);
  self.postMessage({ id, result });
};

