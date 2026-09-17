## 2026-08-21 - CSV Formula Injection (CWE-1236) in Data Exports
**Vulnerability:** Unsanitized video IDs in `exportDeadVideosCSV()` exported to CSV without escaping quotes or neutralizing formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`), allowing CSV / Formula Injection when opened in spreadsheet software.
**Learning:** Exporting client-side lists or user inputs to CSV format can execute arbitrary code/formulas in Excel or Google Sheets if values start with formula trigger characters.
**Prevention:** Escape double quotes (`" -> ""`) and prepend a single quote (`'`) to any string starting with `=`, `+`, `-`, `@`, `\t`, or `\r` before outputting into CSV columns.
