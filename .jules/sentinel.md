## 2026-08-21 - CSV Formula Injection in Dead Video Export
**Vulnerability:** Dead video ID export in `CatalogManager.exportDeadVideosCSV()` generated unescaped CSV strings, allowing formula injection (CWE-1236) if video IDs start with `=`, `+`, `-`, `@`, `\t`, or `\r`.
**Learning:** In JavaScript regex character classes `[...]`, an unescaped hyphen `-` between characters (e.g. `[=\+\-\@\t\r]`) specifies an ASCII character range (`+` through `@`), which inadvertently matches digits `0`-`9`. Placing `-` at the start (`^[-=+\t\r@]`) ensures it is treated as a literal character.
**Prevention:** Always place hyphens at the start/end of regex character classes or escape them, and prepend a single quote `'` to sanitize user-controllable CSV fields starting with formula trigger characters.
