# Sentinel Security Journal

## 2026-09-11 - CSV Formula Injection Mitigation & Catalog Scope Resolution
**Vulnerability:** Dead video exports in `CatalogManager.exportDeadVideosCSV()` generated CSV files with raw `video_id` strings. If malicious or unexpected input containing `=`, `+`, `-`, `@`, `\t`, or `\r` were exported and opened in spreadsheet software (Excel, LibreOffice Calc), it could trigger CSV formula execution.
**Learning:** Exporting client-side arrays to downloadable CSVs requires escaping formulas (`'`) and double quotes. In addition, compact stream tuples and CSV row parsing must explicitly extract destructured properties to avoid `ReferenceError` runtime exceptions.
**Prevention:** Sanitize leading formula characters on all user/system-generated fields prior to CSV string concatenation.
