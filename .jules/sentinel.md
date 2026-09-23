## 2026-03-31 - YouTube Video ID Input Sanitization in CSV and Catalog Ingestion
**Vulnerability:** Unvalidated user-uploaded CSV and catalog array payloads could inject malformed or malicious video ID strings into YouTube iframe player API calls.
**Learning:** CSV parsers and catalog ingestion routines must sanitize external data fields before passing them to iframe API instances or DOM elements.
**Prevention:** Strictly validate YouTube video IDs with `/^[a-zA-Z0-9_-]{11}$/` at the point of ingestion before adding items to active catalog queues.
