## 2025-02-23 - Dynamic Code-Splitting for Large Catalog Modules

**Learning:** Static top-level imports of large data modules (like 3.4MB video stream catalog datasets) force Vite/Rollup to include them in the primary entry JavaScript bundle (`index-[hash].js`). Moving to dynamic `import()` within async initialization methods allows bundlers to split large dataset payloads into separate async chunks, drastically reducing initial JS payload size and improving initial page load time and Time To Interactive (TTI).

**Action:** Prefer dynamic `await import('./largeDataModule.js')` inside async initialization flows when dealing with large static datasets rather than static top-level module imports.
