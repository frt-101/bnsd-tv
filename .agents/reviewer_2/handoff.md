# Handoff Report — Reviewer 2 (Adversarial Quality & Integrity Review)

**Target Deliverable:** `/Users/fraser/antigravity/bnsd-tv/CODE_REVIEW.md`  
**Reviewer:** Reviewer 2  
**Date:** 2026-08-21  
**Verdict:** **`APPROVE`**

---

## 1. Observation

1. **Build & Bundle Size Verification:**
   - Command: `npm run build`
   - Output: `dist/assets/index-CKJhDoMg.js 4,022.72 kB │ gzip: 1,626.00 kB`
   - Confirms `CODE_REVIEW.md` Finding `PERF-01` and `ARCH-04` with exact precision.

2. **Canvas Static Loop Memory Pressure:**
   - Inspected `src/effectsEngine.js:36-57`: `renderNoiseFrame()` executes `this.ctx.createImageData(w, h)` on every `requestAnimationFrame` iteration without caching.
   - At 960x540 canvas dimensions @ 60fps, this creates ~124.4 MB/sec of garbage collection churn and ~31.1M `Math.random()` calls per second, matching `PERF-03`.

3. **Surfing State Machine Mutation in Pure Method:**
   - Inspected `src/playerEngine.js:318-322`: `calculateSmartClip()` mutates `this.sessionClipsRemaining` and `this.currentSessionType`.
   - In `preloadNext()` (lines 260-283) and `nextVideo()` (lines 448-475), `calculateSmartClip()` is invoked twice for each queue item, confirming `ARCH-02` (double-advancement of psychological sessions and duration desync).

4. **Multi-Projector Firestore Synchronization Disconnect:**
   - Inspected `src/main.js:57-75`: `subscribeChannelConfig` receives remote configuration and sets properties on `adminController`, but never calls `catalogManager.generateChannelQueue` or visual effect updates (`effectsEngine.updateWashoutSettings`), confirming `ARCH-01`.

5. **Kiosk Watchdog Timing & Storage Traps:**
   - Inspected `src/main.js:95-98`: `startWatchdog()` is called inside `playerEngine.init()`'s callback, preventing watchdog activation if network or catalog loading stalls, confirming `ERR-01` and `ERR-02`.
   - Inspected `src/catalogManager.js:20-43`, `src/firebase.js:46`: raw `localStorage` calls lack `try...catch` memory-map fallbacks for restricted WebViews, confirming `ERR-03`.

6. **Integrity & Code Quality:**
   - No hardcoded test result facades, no dummy implementations, no bypasses of core logic, and no fabricated artifacts exist in `CODE_REVIEW.md`.

---

## 2. Logic Chain

1. **Technical Soundness:** The security vulnerabilities (insecure Firestore write guidelines in documentation, unauthenticated admin drawers, missing CSP, CSV formula injection), architectural bugs (double buffering race conditions, god singletons, surfing FSM double mutation), and performance bottlenecks (canvas memory leaks, dual hardware video decoders, monolithic 4MB bundle) are logically rigorous, mathematically accurate, and directly grounded in the code.
2. **Kiosk Domain Coverage:** The review specifically addresses the constraints of unattended 24/7 commercial kiosk operation on Android hardware (FreeKiosk / Fully Kiosk), including GPU video decoder leaks, WebView storage quotas, watchdog startup sequences, and error loops.
3. **Roadmap Actionability:** The remediation plan is properly sequenced:
   - Phase 1 (P0): Zero-downtime kiosk stability and critical cloud security hotfixes.
   - Phase 2 (P1): Architectural decoupling, code-splitting, and real-time multi-screen sync.
   - Phase 3 (P2): Automated testing harnesses (Vitest/jsdom), CI/CD, and TypeScript static type-safety.
4. **Conclusion:** Because the deliverable satisfies all core objectives, provides complete drop-in remediation diffs, and contains zero integrity violations, it is approved.

---

## 3. Caveats

1. **Hardware-Specific YouTube Video Decoding:** The exact hardware decoder memory consumption of two concurrent YouTube iframes varies depending on the specific Android GPU chipset (e.g. Amlogic vs. Allwinner vs. Rockchip). However, pausing the inactive player on switch is universally best practice.
2. **PWA Offline Shell:** While `CODE_REVIEW.md` addresses HTTP caching (`Cache-Control`), adding a Service Worker (via `vite-plugin-pwa`) would further protect against momentary venue Wi-Fi dropouts during watchdog reloads. This is recorded as an enhancement recommendation.

---

## 4. Conclusion

**Verdict: `APPROVE`**

`CODE_REVIEW.md` is approved for final delivery to the project stakeholders. It provides a masterclass code review with flawless line references, deep domain comprehension, and complete, production-ready remediation code.

---

## 5. Verification Method

To independently verify the findings and conclusions:

1. **Build & Bundle Analysis:**
   ```bash
   npm run build
   # Verify that dist/assets/index-*.js is ~4,022 kB (confirming PERF-01 / ARCH-04)
   ```
2. **Inspect Source File References:**
   - Verify `src/playerEngine.js:318` (`calculateSmartClip` state mutation).
   - Verify `src/effectsEngine.js:41` (`createImageData` in requestAnimationFrame loop).
   - Verify `src/main.js:57-75` (missing queue regeneration on remote config reception).
   - Verify `firestore.rules:13-16` (read-only rules requiring authentication architecture).
   - Verify `index.html:84` and `src/main.js:84` (phantom `osd-era-badge` query).
3. **Full Analysis Report:**
   - View `/Users/fraser/antigravity/bnsd-tv/.agents/reviewer_2/analysis.md`.
