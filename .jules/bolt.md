## 2025-02-20 - Compact Tuples and Pre-uppercasing Ingested Data
**Learning:** Compact tuple catalog ingestion requires proper unpacking of positional array indices (`decIdx`, `year`, `catIdx`, `videoId`). Pre-uppercasing category and decade reference arrays before looping over 138,000+ items avoids ~276,000 redundant `.toUpperCase()` string allocations and speeds up catalog initialization.
**Action:** Always pre-compute string transformations on lookups/dictionaries outside high-volume ingestion loops.
