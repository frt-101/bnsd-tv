# Bolt's Journal - Critical Performance Learnings

## 2025-05-18 - Unhandled exceptions in fallback chains bypass bundled assets
**Learning:** When bundled compact data payloads exist alongside network fallback logic (e.g. fetching raw CSV over network), missing variable declarations or exceptions in the compact payload parser silently trigger the network fallback path, incurring network latency and runtime parsing overhead.
**Action:** Ensure bundled payload ingestion functions have unit tests verifying zero errors during load, preventing silent failovers to network fetch logic.
