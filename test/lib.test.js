import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  treeToString,
  treeKey,
  compositions,
  cartesian,
  embeds,
  rootEmbeds,
  matchChildren,
  treesOfSize,
  allTrees,
  isValidExtension,
} from '../lib.js';

// In-memory cache adapter for testing (replaces IndexedDB)
class MemoryCache {
  constructor() { this.data = new Map(); }
  async load(size, n) { return this.data.get(`${size}:${n}`) ?? null; }
  async save(size, n, trees) { this.data.set(`${size}:${n}`, trees); }
  async getMaxCachedSize(n) {
    let max = 0;
    for (const key of this.data.keys()) {
      const [s, nk] = key.split(':').map(Number);
      if (nk === n && s > max) max = s;
    }
    return max;
  }
}

const leaf = (l) => ({ label: l, children: [] });

describe('treeToString', () => {
  it('renders a leaf node', () => {
    assert.equal(treeToString(leaf(1)), '1');
  });

  it('renders a node with two children', () => {
    const tree = { label: 1, children: [leaf(2), leaf(3)] };
    assert.equal(treeToString(tree), '1(2, 3)');
  });

  it('renders nested trees', () => {
    const tree = { label: 1, children: [{ label: 2, children: [leaf(3)] }] };
    assert.equal(treeToString(tree), '1(2(3))');
  });
});

describe('treeKey', () => {
  it('renders a leaf with no spaces', () => {
    assert.equal(treeKey(leaf(1)), '1');
  });

  it('renders children separated by commas without spaces', () => {
    const tree = { label: 1, children: [leaf(2), leaf(3)] };
    assert.equal(treeKey(tree), '1(2,3)');
  });
});

describe('compositions', () => {
  it('compositions(0) yields one empty composition', () => {
    assert.deepEqual([...compositions(0)], [[]]);
  });

  it('compositions(1) yields [[1]]', () => {
    assert.deepEqual([...compositions(1)], [[1]]);
  });

  it('compositions(2) yields [[1,1],[2]]', () => {
    assert.deepEqual([...compositions(2)], [[1, 1], [2]]);
  });

  it('compositions(3) yields all four ordered compositions', () => {
    assert.deepEqual(
      [...compositions(3)],
      [[1, 1, 1], [1, 2], [2, 1], [3]]
    );
  });
});

describe('cartesian', () => {
  it('returns [[]] for empty input', () => {
    assert.deepEqual(cartesian([]), [[]]);
  });

  it('wraps each element in a single-list input', () => {
    assert.deepEqual(cartesian([[1, 2]]), [[1], [2]]);
  });

  it('produces all pairs for two lists', () => {
    assert.deepEqual(
      cartesian([[1, 2], [3, 4]]),
      [[1, 3], [1, 4], [2, 3], [2, 4]]
    );
  });

  it('handles three lists', () => {
    assert.equal(cartesian([[1, 2], [3], [4, 5]]).length, 4);
  });
});

describe('embeds', () => {
  it('a leaf embeds into a same-label leaf', () => {
    assert.equal(embeds(leaf(1), leaf(1)), true);
  });

  it('a leaf does not embed into a different-label leaf', () => {
    assert.equal(embeds(leaf(1), leaf(2)), false);
  });

  it('a leaf embeds into a subtree containing a matching label', () => {
    assert.equal(embeds(leaf(1), { label: 2, children: [leaf(1)] }), true);
  });

  it('a tree embeds into itself', () => {
    const tree = { label: 1, children: [leaf(1)] };
    assert.equal(embeds(tree, tree), true);
  });

  it('a parent does not embed into its own child', () => {
    assert.equal(embeds({ label: 1, children: [leaf(1)] }, leaf(1)), false);
  });

  it('1(1) embeds into 1(1(1))', () => {
    const pattern = { label: 1, children: [leaf(1)] };
    const target = { label: 1, children: [{ label: 1, children: [leaf(1)] }] };
    assert.equal(embeds(pattern, target), true);
  });

  it('1(1,1) does not embed into 1(1) — not enough children', () => {
    const pattern = { label: 1, children: [leaf(1), leaf(1)] };
    const target = { label: 1, children: [leaf(1)] };
    assert.equal(embeds(pattern, target), false);
  });
});

describe('rootEmbeds', () => {
  it('returns false when root labels differ', () => {
    assert.equal(rootEmbeds(leaf(1), leaf(2)), false);
  });

  it('a childless pattern root-embeds into any same-label node', () => {
    const target = { label: 1, children: [leaf(2)] };
    assert.equal(rootEmbeds(leaf(1), target), true);
  });
});

describe('matchChildren', () => {
  it('empty pattern children always match', () => {
    assert.equal(matchChildren([], [leaf(1), leaf(2)]), true);
  });

  it('returns false when no child matches', () => {
    assert.equal(matchChildren([leaf(1)], [leaf(2)]), false);
  });
});

describe('treesOfSize', () => {
  it('treesOfSize(1, 1) produces one leaf labeled 1', async () => {
    const result = await treesOfSize(1, 1, new MemoryCache());
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 1);
    assert.deepEqual(result[0].children, []);
  });

  it('treesOfSize(1, 3) produces three leaves', async () => {
    const result = await treesOfSize(1, 3, new MemoryCache());
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((t) => t.label), [1, 2, 3]);
  });

  it('treesOfSize(2, 1) produces one two-node tree', async () => {
    const result = await treesOfSize(2, 1, new MemoryCache());
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 1);
    assert.equal(result[0].children.length, 1);
    assert.equal(result[0].children[0].label, 1);
  });

  it('returns the cached value on a second call', async () => {
    const cache = new MemoryCache();
    const first = await treesOfSize(1, 2, cache);
    const second = await treesOfSize(1, 2, cache);
    assert.equal(first, second);
  });

  it('treesOfSize(2, 2) produces four distinct trees', async () => {
    const result = await treesOfSize(2, 2, new MemoryCache());
    assert.equal(result.length, 4);
    // All keys must be unique
    const keys = result.map(treeKey);
    assert.equal(new Set(keys).size, 4);
  });
});

describe('allTrees', () => {
  it('yields size-1 trees before size-2 trees for n=2', async () => {
    const gen = allTrees(2, new MemoryCache());
    const first = (await gen.next()).value;
    const second = (await gen.next()).value;
    // First two values must be leaves (the two size-1 trees for n=2)
    assert.equal(first.children.length, 0);
    assert.equal(second.children.length, 0);
    assert.deepEqual(
      [first.label, second.label].sort((a, b) => a - b),
      [1, 2]
    );
  });

  it('the third value is a size-2 tree for n=2', async () => {
    const gen = allTrees(2, new MemoryCache());
    await gen.next();
    await gen.next();
    const third = (await gen.next()).value;
    // Size-2 trees have exactly one child
    assert.equal(third.children.length, 1);
  });
});

describe('isValidExtension', () => {
  const syncEmbeds = (a, b) => Promise.resolve(embeds(a, b));

  it('an empty sequence is always a valid extension', async () => {
    assert.equal(await isValidExtension([], leaf(1), syncEmbeds), true);
  });

  it('valid when no previous tree embeds into the candidate', async () => {
    assert.equal(await isValidExtension([leaf(1)], leaf(2), syncEmbeds), true);
  });

  it('invalid when a previous tree embeds into the candidate', async () => {
    assert.equal(await isValidExtension([leaf(1)], leaf(1), syncEmbeds), false);
  });

  it('invalid when any tree in the sequence embeds into the candidate', async () => {
    assert.equal(
      await isValidExtension([leaf(2), leaf(1)], leaf(1), syncEmbeds),
      false
    );
  });
});
