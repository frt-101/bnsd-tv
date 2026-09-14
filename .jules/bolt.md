## 2025-05-18 - Zero-Allocation Interleaving for High-Volume Catalog Queues
**Learning:** In large dataset operations (100k+ items), calling `.filter()` repeatedly inside a `while` loop creates hundreds of thousands of temporary arrays, causing high CPU overhead (~514ms) and severe garbage collection pressure.
**Action:** Replace `Array.prototype.filter()` in loop iterations over large datasets with zero-allocation index-based iterations over bucket arrays.
