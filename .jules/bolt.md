# Bolt Performance Journal

## 2026-09-23 - Zero-Allocation Interleaving for Massive Array Queue Generation
**Learning:** Calling `Array.prototype.filter()` inside a tight `while` loop that runs over 138,000+ items creates over 138,000 temporary array allocations, causing heavy garbage collection pauses and doubling queue generation time from ~56ms to ~137ms.
**Action:** Replace `Array.prototype.filter()` with direct loop iteration and weight accumulation when picking items from multiple buckets in high-cardinality collections.
