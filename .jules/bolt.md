## 2025-05-20 - Avoid Array Filter & Map Lookups in Large Dataset Queue Interleaving Loops
**Learning:** In catalog queue generation over 138,000+ video items, invoking `availableCats.filter()` and `byCategory.get()` inside the per-item loop created millions of temporary arrays and hash lookups.
**Action:** Use active bucket objects (`{ cat, items, len }`) in an array, mutating lengths and splicing empty buckets. This eliminates temporary array allocations and reduces queue generation time by ~50%.
