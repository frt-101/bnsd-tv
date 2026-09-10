# Bolt's Journal - Critical Learnings

## 2025-05-18 - Pre-computing upper-case properties on large tuple catalogs
**Learning:** The in-memory catalog holds over 138,000 video records. Performing `String(v.category).toUpperCase()` or `items.filter()` repeatedly in UI interaction handlers (like category count calculations or channel queue generation) allocates hundreds of thousands of temporary string objects and array elements on the heap, blocking the main thread for ~78ms.
**Action:** Always pre-compute and store normalized uppercase properties (`catUpper`, `decadeUpper`) on video items during initial tuple ingestion, and use direct loops over arrays instead of `filter()` when only counting matching items.
