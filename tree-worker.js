// tree-worker.js
import { embeds } from './lib.js';

self.onmessage = (e) => {
  const { id, pattern, target } = e.data;
  const result = embeds(pattern, target);
  self.postMessage({ id, result });
};
