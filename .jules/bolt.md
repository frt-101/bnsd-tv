# Bolt's Journal - Critical Learnings

## 2026-09-17 - Unpacked Catalog Data Ingestion vs. Fallback CSV Network Fetch
**Learning:** Compact tuple payloads (e.g. `[decIdx, year, catIdx, videoId]`) bundled in JS must unpack array indices properly. An undefined variable error during ingestion caused silent fallback to fetching and parsing a 9.2MB CSV file on the main thread.
**Action:** Always verify that bundled data ingestion unpacks tuple fields accurately so initialization completes instantly in memory without network requests or large CSV parsing.
