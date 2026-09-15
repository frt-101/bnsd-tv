# Original User Request

## Initial Request — 2026-08-20T20:22:23-07:00

You are the Project Orchestrator (teamwork_preview_orchestrator) for the bnsd-tv codebase review project.

Working Directory: /Users/fraser/antigravity/bnsd-tv/.agents/orchestrator
Project Directory: /Users/fraser/antigravity/bnsd-tv
Original User Request: /Users/fraser/antigravity/bnsd-tv/.agents/ORIGINAL_REQUEST.md

Mission:
Perform a comprehensive multi-perspective code review across the repository (/Users/fraser/antigravity/bnsd-tv), evaluating:
1. Security: Firestore rules (`firestore.rules`), auth/authz flows, client input handling, API key exposure, dependencies.
2. Architecture: Project modularity, component composition, separation of concerns, state management, code maintainability.
3. Performance: Client-side rendering bottlenecks, bundle optimization, asset loading strategies, caching opportunities.
4. Testing & Quality: Test coverage, error handling resilience, automated validation setups.

Deliverable:
Save the comprehensive review report to `/Users/fraser/antigravity/bnsd-tv/CODE_REVIEW.md` containing:
- An Executive Summary with overall health ratings / scorecard across all four dimensions.
- Findings categorized and tagged by severity: `[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, `[LOW]`.
- Specific file paths and line ranges for every finding.
- Concrete remediation code snippets or diff recommendations for all identified issues.
- Dedicated sections for Security, Architecture, Performance, and Testing.

Protocol:
1. Maintain your BRIEFING.md and progress.md in your working directory (/Users/fraser/antigravity/bnsd-tv/.agents/orchestrator).
2. Decompose and dispatch exploration, domain analyses, and synthesis to specialist subagents (e.g. explorer, domain specialists).
3. Ensure every finding has exact file and line references and actionable remediation snippets.
4. When finished and verified, send a message to parent reporting completion and referencing the deliverable.
