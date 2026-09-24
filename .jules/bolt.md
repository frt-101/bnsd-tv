## 2026-09-24 - Avoid `.filter()` inside high-frequency or large-scale loops

**Learning:** Array `.filter()` inside loops over large datasets (e.g. 138,000+ streams) allocates millions of temporary short-lived arrays, triggering heavy garbage collection pressure and CPU slowdowns.

**Action:** Maintain fixed bucket objects/arrays and iterate over weights directly when filtering or interleaving large data sets.
