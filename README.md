# TREE3.js

A client-side JavaScript implementation of the TREE(3) function — a famously large number from combinatorics and Ramsey theory. TREE(3) is the length of the longest sequence of labeled trees where each tree has at most *k* nodes (with *k* incrementing per step), no tree is a minor of a later tree, and labels come from a set of size 3.

This implementation runs entirely in the browser using Web Workers and IndexedDB for caching intermediate results, allowing it to make progress without blocking the UI.

## Live Demo

[https://starkeblog.com/tree3.js](https://starkeblog.com/tree3.js)

## Background

The TREE sequence grows so fast it dwarfs numbers like Graham's number. TREE(1) = 1, TREE(2) = 3, and TREE(3) is a number so astronomically large it cannot be expressed with conventional mathematical notation.

The original paper: [Kruskal's Tree Theorem (1960)](https://www.ams.org/journals/tran/1960-095-02/S0002-9947-1960-0111704-1/S0002-9947-1960-0111704-1.pdf)

