## 2025-05-18 - Pre-compute uppercase lookup arrays for large catalog ingestion
**Learning:** Performing `.toUpperCase()` inside loops over large datasets (138,000+ items) incurs high memory allocation and CPU overhead (~277,000 redundant string allocations).
**Action:** Always pre-compute transformed lookup arrays for static/finite categories and decades before looping over massive stream tuples.
