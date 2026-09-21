## 2025-02-17 - Pre-compute Uppercase Lookups for Large Array Ingestion
**Learning:** Calling `.toUpperCase()` on every item during a large array loop (e.g. 138,000+ items) creates massive allocation overhead and redundant string processing. When categories/decades come from a small bounded enum array, mapping the enum array to uppercase once beforehand turns O(N) string allocations into O(1).
**Action:** When ingesting large dataset arrays, map lookup properties on the dictionary array before looping through row items.
