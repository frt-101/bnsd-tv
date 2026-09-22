## 2025-02-23 - CSV Formula Injection in Exported Video Quarantine Reports
**Vulnerability:** Unsanitized video IDs in `exportDeadVideosCSV()` allowed potential CSV Formula Injection (CWE-1236) when exported files are opened in spreadsheet tools like MS Excel or Google Sheets.
**Learning:** Admin-triggered client-side CSV exports that serialize user-submitted or unvalidated inputs (such as failed custom stream IDs or titles) need explicit formula character neutralization.
**Prevention:** Always sanitize fields before CSV output by prefixing leading formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) with a single quote `'` and escaping double quotes.
