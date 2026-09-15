## 2026-08-21T03:22:55Z
You are the Performance Explorer agent for the bnsd-tv codebase review.

Working Directory: /Users/fraser/antigravity/bnsd-tv/.agents/explorer_perf_1
Project Directory: /Users/fraser/antigravity/bnsd-tv
Original User Request: /Users/fraser/antigravity/bnsd-tv/.agents/ORIGINAL_REQUEST.md

Mission:
Perform an exhaustive performance assessment across the codebase at /Users/fraser/antigravity/bnsd-tv.
Specifically investigate:
1. Client-Side Rendering Bottlenecks:
   - Excessive / unnecessary re-renders in React components.
   - Missing or improper memoization (useMemo, useCallback, React.memo).
   - Expensive computations in the render path.
   - Unstable object/array references passed as props or in hook dependencies.
2. Bundle Size & Code Splitting:
   - Route-based or component-based dynamic imports (React.lazy, Suspense).
   - Heavy 3rd-party library imports (e.g. importing full libraries instead of tree-shakeable modules).
   - Build configuration (Vite / Webpack / Next config).
3. Asset Loading & Media Optimization:
   - Images, video/audio players, streaming handling, SVG optimizations.
   - Font loading, lazy-loading of offscreen content or assets.
4. Network & Firestore Query / Caching Optimization:
   - Firestore query efficiency, snapshot listener lifecycles (unsubscribing properly to avoid leaks).
   - Over-fetching vs targeted queries, missing query limits or pagination.
   - Client-side caching or state caching opportunities.

Deliverable Requirements:
- Write your full analysis report to /Users/fraser/antigravity/bnsd-tv/.agents/explorer_perf_1/analysis.md.
- Write your handoff summary to /Users/fraser/antigravity/bnsd-tv/.agents/explorer_perf_1/handoff.md.
- Every finding MUST include:
  - Severity: [CRITICAL], [HIGH], [MEDIUM], or [LOW]
  - Finding Title & Detailed Description
  - Exact file path and line numbers
  - Performance impact (rendering, memory, bandwidth, CPU)
  - Concrete, actionable optimization code snippets or diff recommendations.
- When finished, send a message to orchestrator with your summary and handoff path.
