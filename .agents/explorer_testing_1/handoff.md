# Handoff Report: Testing, Reliability & Quality Assessment

**Explorer**: `explorer_testing_1`  
**Working Directory**: `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_testing_1`  
**Date**: 2026-08-20  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

Direct observations across the codebase (`/Users/fraser/antigravity/bnsd-tv`):

1. **Test Files and Dependencies**:
   - `find_by_name` across the entire workspace returned 0 test files (`*.test.js`, `*.spec.js`).
   - `package.json:6-18`:
     ```json
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview",
       "build-catalog": "node scripts/build-catalog.js"
     },
     "dependencies": {
       "firebase": "^10.12.5",
       "papaparse": "^5.4.1"
     },
     "devDependencies": {
       "vite": "^5.4.0"
     }
     ```
     No testing libraries (`vitest`, `jest`, `@testing-library/*`, `playwright`, `cypress`, `jsdom`) or test scripts exist.

2. **Error Trapping and Watchdog Timing**:
   - `src/main.js:8-46`: `bootstrapApp()` has no `try/catch`. It calls `await catalogManager.loadCSV('/bnsd_tv_playlist.csv')`. If `isLoaded` is false, it executes `return;` at line 45.
   - `src/main.js:97`: `startWatchdog()` is only invoked after YouTube players initialize.
   - No `window.addEventListener('error')` or `window.addEventListener('unhandledrejection')` handlers exist anywhere in `src/`.

3. **Storage and Error Loop Behaviors**:
   - `src/firebase.js:46`: `localStorage.setItem('bnsd_channel_' + channelId, JSON.stringify(payload))` is executed without `try/catch`.
   - `src/playerEngine.js:299-300`: `findNextLiveIndex()` outputs `console.warn("Every video in the current queue is flagged dead. Playing anyway."); return startIndex;`.
   - `src/playerEngine.js:525-564`: `handlePlayerError()` marks the video dead and calls `this.nextVideo()`, which calls `findNextLiveIndex()`, which returns the same dead index, creating an infinite synchronous error loop.

4. **Static Quality and Schemas**:
   - No `tsconfig.json`, `eslint.config.js`, `.eslintrc*`, or `.prettierrc` exist in the repository.
   - `src/firebase.js:57-75`: Firestore document payloads received from `onSnapshot` are applied directly to `adminController` without schema validation.
   - `scripts/build-catalog.js:24-66`: 32-row permutation matrix `CYPHER_MATRIX` and `decodeVideoId()` unscrambles ~30,000 video records with zero test coverage.

---

## 2. Logic Chain

1. **Step 1 (Testing Gap -> Production Regression Risk)**:
   - *Observation*: `package.json` has no test framework or test script, and zero test files exist in the codebase.
   - *Reasoning*: The codebase contains non-trivial custom algorithms: category-interleaved Fisher-Yates shuffle with anti-clustering (`catalogManager.js:306-393`), a 3-state stochastic psychological surfing machine (`playerEngine.js:304-434`), dual-iframe A/B player double-buffering (`playerEngine.js:80-283`), and a 32-row permutation cipher decoder (`build-catalog.js:24-66`). Without automated test suites, any refactor or data update risks silent breakage in production.

2. **Step 2 (Startup Error Trap Absence -> Frozen Kiosk)**:
   - *Observation*: `src/main.js` does not wrap `bootstrapApp()` in `try/catch` and starts `startWatchdog()` only at line 97 after all initializations succeed.
   - *Reasoning*: If network connectivity is lost during morning projector boot, `catalogManager.loadCSV()` returns `false` or YouTube script injection fails. `bootstrapApp()` aborts at line 45 before `startWatchdog()` runs. Because no global error handler or watchdog is active, the browser remains frozen indefinitely on a blank screen.

3. **Step 3 (Unguarded Storage & Infinite Loops -> Tab Crash)**:
   - *Observation*: Direct `localStorage.setItem` calls lack exception handling, and `findNextLiveIndex()` returns quarantined indices when all items are dead.
   - *Reasoning*: Android WebViews running under FreeKiosk or private mode throw `QuotaExceededError` or `SecurityError` on `localStorage` writes, aborting `firebase.js` operations. If a channel's videos are all removed from YouTube, `playerEngine` enters an infinite recursion of `handlePlayerError` -> `nextVideo()` -> `handlePlayerError`, causing 100% CPU lockup and WebView crashes.

4. **Step 4 (Untyped & Unvalidated Payloads -> State Corruption)**:
   - *Observation*: No `tsconfig.json` exists, and Firestore document updates are applied directly without schema validation.
   - *Reasoning*: Any malformed or corrupted Firestore sync document (e.g. `{ commercialMaxSec: -100 }`) will corrupt the runtime state of all synchronized projectors, leading to continuous skipping or NaN timer calculations.

---

## 3. Caveats

- **FreeKiosk Native Behavior**: FreeKiosk has its own native Android process watchdog that restarts the app if the OS terminates the WebView process. However, FreeKiosk's watchdog does *not* detect when a webpage's JavaScript is frozen in an infinite loop or stalled on a blank page.
- **YouTube Embed Availability**: YouTube videos can become restricted or deleted dynamically by copyright owners; the in-app dead-video quarantine is designed to handle this, but the circuit breaker is necessary to prevent infinite looping when a whole category is blocked.
- **Firestore Authentication Prerequisite**: `firestore.rules` currently denies all client writes (`allow write: if false;`), so multi-projector sync via Firestore is dormant until Firebase Authentication is configured.

---

## 4. Conclusion

The BNSD TV application has a well-conceived domain architecture for vintage video projection, but its reliability and maintainability are severely undermined by the **complete lack of testing infrastructure (0% coverage)**, **vulnerable startup error handling**, and **unguarded storage operations**.

Immediate remediation priorities:
1. **[CRITICAL]** Move `startWatchdog()` to immediate execution on script load and wrap `bootstrapApp()` in a global error/rejection trap with emergency visual recovery UI.
2. **[HIGH]** Install Vitest, jsdom, and create unit test suites for `catalogManager.js` (Fisher-Yates anti-clustering), `playerEngine.js` (A/B double buffering & pacing machine), and `scripts/build-catalog.js` (permutation cypher).
3. **[HIGH]** Introduce `SafeStorage` wrapper and add circuit breakers to `playerEngine.handlePlayerError()` to prevent infinite error loops.
4. **[HIGH]** Add `tsconfig.json`, TypeScript definitions (`src/types/index.ts`), and runtime payload validation guards.
5. **[MEDIUM]** Configure ESLint flat config (`eslint.config.js`), Prettier, and GitHub Actions CI workflow.

---

## 5. Verification Method

To independently verify all findings and test remediations:

1. **Verify Absence of Tests & Linters**:
   - Inspect `package.json` scripts: observe lack of `"test"` and `"lint"`.
   - Inspect filesystem: observe absence of `vitest.config.js`, `tsconfig.json`, `eslint.config.js`, and test folders.

2. **Verify Startup Stall Risk**:
   - In `src/main.js`, simulate network offline or catalog load failure (e.g. modify `catalogManager.loadCSV` to return `false`).
   - Observe that `startWatchdog()` on line 97 is never reached and the screen remains permanently stuck.

3. **Verify Infinite Error Loop Risk**:
   - In `src/playerEngine.js`, pass a queue of 2 video IDs that return YouTube error code 100.
   - Observe high-frequency console error loops as `handlePlayerError` repeatedly invokes `nextVideo()`.

4. **Verify Remediation Test Suite**:
   - After installing Vitest (`npm install -D vitest @testing-library/dom jsdom`), run:
     ```bash
     npx vitest run
     ```
   - Verify that all test cases in `tests/catalogManager.test.js` and `tests/buildCatalog.test.js` pass with 100% assertion success.
