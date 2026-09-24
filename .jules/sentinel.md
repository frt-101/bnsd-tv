## 2026-09-24 - Strict YouTube Video ID Validation for CSV & Array Ingestion
**Vulnerability:** Ingestion of playlist data (via CSV uploads or array data payloads) lacked YouTube Video ID format validation and contained missing row variable declarations in `parseCSVText` and `ingestArrayData`, creating risk of malformed/malicious video ID injections into the YouTube player iframe and runtime errors.
**Learning:** External CSV file imports or third-party catalog payloads must be strictly validated at ingestion boundaries before being passed to downstream media player APIs or DOM nodes.
**Prevention:** Always validate YouTube Video IDs against a strict regex (`/^[a-zA-Z0-9_-]{11}$/`) and sanitize numeric offset values upon catalog ingestion.
