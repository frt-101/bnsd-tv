# Handoff Report: Architecture & Modularity Review

**Agent**: Architecture & Modularity Explorer (`explorer_arch_1`)  
**Recipient**: Orchestrator  
**Working Directory**: `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_arch_1`  
**Deliverable Report**: `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_arch_1/analysis.md`  
**Date**: 2026-08-21T03:25:00Z  

---

## 1. Observation

1. **`src/main.js:57-75` (Broken Remote Synchronization)**:
   ```javascript
   subscribeChannelConfig(channelParam, (remoteConfig) => {
     if (remoteConfig) {
       if (remoteConfig.enabledDecades) adminController.enabledDecades = remoteConfig.enabledDecades;
       if (remoteConfig.enabledCategories) adminController.enabledCategories = remoteConfig.enabledCategories;
       if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
       ...
       playerEngine.updatePacingRules(...);
     }
   });
   ```
   `main.js` receives `remoteConfig` and updates `adminController` fields and pacing rules, but **never regenerates the playlist queue** via `catalogManager.generateChannelQueue` and **never applies visual settings** (`contrast`, `brightness`, `opacity`, `scanlinesEnabled`, `staticFXEnabled`, `washoutEnabled`, `osdMode`).

2. **`src/playerEngine.js:318-322, 271-278, 458-460` (Stateful Calculation Side-Effects)**:
   ```javascript
   // src/playerEngine.js:318-322
   if (this.sessionClipsRemaining <= 0) {
     this.pickNextSurfingSession();
   }
   this.sessionClipsRemaining--;
   ```
   `calculateSmartClip()` mutates `this.sessionClipsRemaining` and `this.currentSessionType`. It is executed in `preloadNext()` (line 271) and executed a second time on the same item in `nextVideo()` (line 458), advancing the session state machine twice per video and generating mismatching random start/duration values.

3. **`src/playerEngine.js:260-283, 448-475, 617-624` (Double-Buffering Race Condition)**:
   `preloadNext()` is only triggered when `elapsedSeconds >= activeCutoffSec - 6`. If a channel switch occurs before this threshold (e.g. key 'N', browse flurry zapping, or immediate error on load), `nextVideo()` swaps to the inactive player without verifying whether the player is cued or calling `loadVideoById`.

4. **`src/catalogData.js:1-202` & `public/bnsd_tv_playlist.csv` (Monolithic Bundling & Dead Fallback)**:
   `src/catalogData.js` is a 3.7MB JavaScript file containing 153,060 tuples, bundled synchronously into the Vite main chunk. `ingestArrayData()` creates >450,000 object references on boot. The `fetch('/bnsd_tv_playlist.csv')` fallback in `catalogManager.js:103` is unreachable dead code because `BNSD_TV_CATALOG` is statically imported and truthy.

5. **`src/playerEngine.js:650` & `src/admin.js:28` (God Singletons & Window Global Bypass)**:
   `adminController` attaches itself to `window.adminController = this;`. `playerEngine.js` accesses `window.adminController` directly to retrieve `osdMode` and `getChannelNum()`, creating an inverted dependency where streaming infrastructure depends on presentation controllers.

6. **`src/main.js:16` & `src/admin.js:255-266` (Quarantine Purge Conflict)**:
   `main.js:16` calls `catalogManager.clearDeadVideoFlags()` unconditionally at boot. Every watchdog stall reload (5m) or preventive reload (6h) purges quarantined IDs, rendering the Admin CSV export and persistent blacklist ineffective.

7. **`src/main.js:84`, `src/catalogManager.js:398-404`, `src/catalogData.js:200` (Dead Code & Phantom Elements)**:
   `osd-era-badge` queried in `main.js:84` does not exist in `index.html`. `hashString(str)` in `catalogManager.js:398` is unreferenced. `DEFAULT_90S_CATALOG` in `catalogData.js:200` is an unused alias.

---

## 2. Logic Chain

1. **Remote Sync Failure**: From Observation #1, when an operator modifies content categories or CRT washouts at `/?admin=true`, the Firestore document `/channels/{channelId}` updates. The subscriber in `main.js` receives the payload, but because it only invokes `playerEngine.updatePacingRules` and ignores visual properties and queue regeneration, the wall projector never updates its video queue or visual filters without a manual page reload.
2. **Surfing State Machine Corruption**: From Observation #2, `calculateSmartClip()` is invoked both when preloading in the background and when swapping to the foreground. Because it mutates session counters and picks new random durations, the session state machine progresses at 2x intended speed, and the active cutoff timer is set to a different random duration than what was originally cued on the player.
3. **Double-Buffering Glitches**: From Observation #3, fast channel surfing (or manual 'N' key presses) bypasses the 6-second JIT preloading window. When `nextVideo()` swaps player focus, the newly active player is either blank or plays a stale clip from a previous cycle, while the OSD updates to the new video title.
4. **Memory Footprint & Kiosk Crashes**: From Observation #4, allocating ~450,000 object references synchronously on Android WebView (1GB–2GB RAM) causes heap pressure, garbage collection freezes during channel swaps, and risks OOM crashes.
5. **Coupling & Maintainability**: From Observations #5, #6, and #7, circular dependencies are masked using `window.adminController`, dead code remains in production bundles, and quarantine persistence is broken by watchdog boot cycles.

---

## 3. Caveats

1. **Live Firebase Backend**: The review was performed in offline/local-storage mode because `src/firebase.js` currently contains placeholder API keys (`AIzaSyBNSDTVConfigApiKeyHere`). However, the Firestore subscriber code path was fully traced and simulated.
2. **YouTube Player API Sandboxing**: YouTube iframe behavior was evaluated based on the official YouTube IFrame Player API specifications and the double-buffering implementation logic in `playerEngine.js`.
3. **Android Device Profiles**: Memory impact assessments are based on standard Android TV / Chromium WebView constraints (1GB–2GB RAM) typical for smart projectors running FreeKiosk.

---

## 4. Conclusion

The `bnsd-tv` codebase demonstrates an innovative retro projection concept and effective iframe double-buffering foundation, but suffers from critical state synchronization failures, god-object coupling, memory bloat from a 3.7MB monolithic dataset, and stateful side-effects in calculation logic.

Remediation should follow a 3-phase roadmap:
- **Phase 1 (Immediate Fixes)**: Fix Firestore sync in `main.js` (queue regeneration & visual settings), make `calculateSmartClip` pure, add preloading fallback in `nextVideo`, and fix quarantine daily rollover.
- **Phase 2 (Decoupling & Modularity)**: Break down `PlayerEngine` and `AdminController`, remove `window.adminController` global, extract `channelUtils.js` and `OsdHudView.js`, and add engine lifecycle cleanup methods.
- **Phase 3 (Optimization & Typing)**: Chunk catalog data by decade, remove duplicate CSV distributions, introduce TypeScript interfaces, and pre-allocate canvas buffers.

---

## 5. Verification Method

To independently verify the observations:
1. **Verify Remote Sync Omission**: Inspect `src/main.js:57-75`. Notice that `catalogManager.generateChannelQueue` and `effectsEngine.updateWashoutSettings` are never called within the `subscribeChannelConfig` callback.
2. **Verify Stateful Calculation Bug**: Inspect `src/playerEngine.js:318-322` and trace calls from `preloadNext` (line 271) and `nextVideo` (line 458).
3. **Verify Double-Buffering Stale Swap**: Inspect `src/playerEngine.js:448-475`. Notice `nextVideo()` performs no check on `this.cuedItems[this.activePlayerId]` before bringing the container to the front.
4. **Verify Phantom Element**: Run `grep -rn "osd-era-badge" .` to confirm the element exists in `src/main.js` but is missing from `index.html`.
5. **Verify Dead Code**: Run `grep -rn "hashString" .` to confirm `hashString` is declared in `src/catalogManager.js:398` but never called.
6. **Verify Build & Bundle**: Run `npm run build` to observe that `src/catalogData.js` generates a >3.7MB chunk and `public/bnsd_tv_playlist.csv` (7.7MB) is copied to `dist/`.
