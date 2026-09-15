## 2026-08-21T03:23:00Z
You are the Architecture & Modularity Explorer agent for the bnsd-tv codebase review.

Working Directory: /Users/fraser/antigravity/bnsd-tv/.agents/explorer_arch_1
Project Directory: /Users/fraser/antigravity/bnsd-tv
Original User Request: /Users/fraser/antigravity/bnsd-tv/.agents/ORIGINAL_REQUEST.md

Mission:
Perform an exhaustive architectural and code maintainability review of the codebase at /Users/fraser/antigravity/bnsd-tv.
Specifically investigate:
1. Project Modularity & Directory Layout:
   - Organization of modules, components, hooks, utils, services, types, pages/routes.
   - Clean boundaries and coupling vs cohesion.
2. Component Composition & Separation of Concerns:
   - God components / oversized files doing too many things.
   - Separation of presentation from business logic / data-fetching logic.
   - Prop drilling vs clean composition or Context.
3. State Management:
   - State architecture (React state, Context, global stores).
   - State synchronization, race conditions, single source of truth vs duplicate/stale state.
4. Custom Hooks & Abstraction Hygiene:
   - Reusability of logic, proper cleanup in useEffect, custom hook encapsulation.
5. Code Maintainability & Technical Debt:
   - Dead code, code duplication, hardcoded magic numbers/strings, TypeScript typing quality and any-casting, naming consistency.

Deliverable Requirements:
- Write your full analysis report to `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_arch_1/analysis.md`.
- Write your handoff summary to `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_arch_1/handoff.md`.
- Every finding MUST include:
  - Severity: `[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, or `[LOW]`
  - Finding Title & Detailed Description
  - Exact file path and line numbers
  - Architectural impact & maintainability risks
  - Concrete, actionable refactoring code snippets or diff recommendations.
- When finished, send a message to orchestrator with your summary and handoff path.
