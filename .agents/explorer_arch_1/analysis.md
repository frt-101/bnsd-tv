# Exhaustive Architecture & Code Maintainability Review: BNSD TV

**Target Codebase**: `/Users/fraser/antigravity/bnsd-tv`  
**Review Focus**: Architecture, Modularity, State Management, Component Composition, Custom Hooks/Abstractions, Code Maintainability & Technical Debt  
**Date**: 2026-08-21  
**Author**: Architecture & Modularity Explorer Agent (`explorer_arch_1`)

---

## Executive Summary & Scorecard

BNSD TV is a nostalgia television stream simulator built with Vanilla JavaScript (ES Modules), Vite, and Firebase. It employs a dual-iframe double-buffering architecture designed for continuous, unattended projection in restaurant and hospitality environments (kiosks/Android projectors).

While the application achieves its core goal of zero-pause retro streaming, the architecture exhibits substantial architectural debt, tightly coupled god objects, state synchronization breakdowns, memory footprint risks for embedded Android hardware, and stateful side-effects in domain calculations.

### Architectural Health Scorecard

| Dimension | Rating | Summary Assessment |
| :--- | :---: | :--- |
| **Project Modularity & Layout** | **C-** | Flat `src/` directory lacking clean architectural layers (no separation of services, domain models, state stores, and presentation). |
| **Component Composition & Separation of Concerns** | **D+** | God singletons (`PlayerEngine` 687 LOC, `AdminController` 503 LOC) conflate UI rendering, DOM listeners, business logic, state machines, and API wrappers. |
| **State Management & Synchronization** | **F** | Fragmented state across 6 distinct mechanisms; real-time Firestore synchronization fails to update active projector streams; double-buffering state desynchronization on channel skipping. |
| **Abstraction Hygiene & Lifecycles** | **C** | Event listeners and intervals lack teardown/cleanup contracts; calculations have mutating side-effects. |
| **Code Maintainability & Technical Debt** | **C-** | 3.7MB monolithic JS dataset loaded synchronously; zero TypeScript type contracts; dead code & phantom DOM queries; duplicate ingestion pipelines. |

---

## High-Level Architectural Diagram (Current vs. Target)

### Current Tightly-Coupled State & Module Architecture
```
+--------------------------------------------------------------------------------+
|                                    main.js                                     |
|  - Bootstraps App                                                              |
|  - Queries DOM directly (#osd-era-badge, #tel-queue-count, etc.)              |
|  - Manages URL Params & Firestore subscription                                 |
+---------+-------------------+--------------------+-------------------+---------+
          |                   |                    |                   |
          v                   v                    v                   v
+------------------+ +-----------------+ +-------------------+ +---------------+
|  catalogManager  | |  playerEngine   | |    effectsEngine  | |   admin.js    |
| - Ingests 3.7MB  | | - God Singleton | | - 2D Canvas static| | - UI Drawer   |
|   catalogData.js | | - Dual iFrame   | | - CSS Washout     | | - Keyboard    |
| - In-memory maps | | - Surfing State | | - CRT Overlays    | |   Shortcuts   |
| - Wipes storage  | |   (Mutates in   | +-------------------+ | - DOM Builder |
|   on boot        | |    calc methods)|                       | - Sets global |
+------------------+ | - Reads global  |<----------------------|   window.     |
                     |   window.admin  |   window.adminController |   adminCtrl   |
                     +-----------------+                       +---------------+
```

### Proposed Layered, Unidirectional Architecture
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Presentation Layer                              │
│   ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐ │
│   │   CRT Frame & Overlays│  │    OSD HUD Display    │  │   Admin Drawer   │ │
│   └───────────┬───────────┘  └───────────┬───────────┘  └────────┬─────────┘ │
└───────────────┼──────────────────────────┼───────────────────────┼───────────┘
                │                          │                       │
┌───────────────▼──────────────────────────▼───────────────────────▼───────────┐
│                        Application & Controller Layer                         │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │            AppController / ChannelManager (Orchestrator)             │   │
│   └──────────────────────────────────┬───────────────────────────────────┘   │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼───────────────────────────────────────┐
│                           Core State & Event Bus                             │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │   Reactive State Store (ChannelConfig, PlayerState, CatalogIndex)    │   │
│   │   EventBus / Signal Dispatcher (PLAY, SKIP, ERROR, RESYNC, UPDATE)   │   │
│   └───────────────┬──────────────────────────────────────┬───────────────┘   │
└───────────────────┼──────────────────────────────────────┼───────────────────┘
                    │                                      │
┌───────────────────▼──────────────┐      ┌────────────────▼───────────────────┐
│           Domain Layer           │      │        Infrastructure Layer        │
│ ┌──────────────────────────────┐ │      │ ┌────────────────────────────────┐ │
│ │ PacingCalculator (Pure Funcs)│ │      │ │ DualPlayerService (YouTube API)│ │
│ ├──────────────────────────────┤ │      │ ├────────────────────────────────┤ │
│ │ SurfingStateMachine (FSM)    │ │      │ │ FirestoreSyncService           │ │
│ ├──────────────────────────────┤ │      │ ├────────────────────────────────┤ │
│ │ CatalogService & ShuffleSeed │ │      │ │ LocalStorageAdapter            │ │
│ └──────────────────────────────┘ │      │ └────────────────────────────────┘ │
└──────────────────────────────────┘      └────────────────────────────────────┘
```

---

## Detailed Findings & Remediation Guide

---

### Finding 1: Broken Real-Time Remote State Synchronization in Multi-Projector Architecture
- **Severity**: `[CRITICAL]`
- **Category**: State Management & Architecture
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/main.js:57-75`
  - `/Users/fraser/antigravity/bnsd-tv/src/admin.js:473-491`
  - `/Users/fraser/antigravity/bnsd-tv/src/firebase.js:60-88`

#### Description & Root Cause
The core selling point of the multi-projector setup (documented in `README.md` and `docs/ANDROID_PROJECTOR_SETUP.md`) is that an operator can change channel categories, decades, and CRT vibes at `/?admin=true` on a laptop/tablet and have the settings immediately sync to wall projectors over Firestore/LocalStorage.

However, the subscription logic in `main.js` contains fatal omissions:
1. **Decade and Category filter updates are ignored by the stream**: When `remoteConfig` arrives with modified `enabledDecades` or `enabledCategories`, `main.js` sets the properties on `adminController`, but **never regenerates the playback queue** (`catalogManager.generateChannelQueue`) and **never notifies `playerEngine`**. As a result, the projector continues playing from its stale initial queue indefinitely.
2. **Visual and CRT settings are dropped**: `admin.js` packages `contrast`, `brightness`, `opacity`, `scanlinesEnabled`, `staticFXEnabled`, `washoutEnabled`, and `osdMode` into the Firestore payload. However, `main.js:58-74` completely ignores all 7 of these visual properties. They are never forwarded to `effectsEngine` or `playerEngine`.
3. **Admin form controls are not reactively synced**: If the admin modal is open on a device while another remote update occurs, the UI input elements do not update their values.

#### Architectural Impact
Multi-projector centralized administration is non-functional. Projectors never update their content or visual vibe in response to remote control actions without a hard manual page refresh.

#### Actionable Remediation Diff
In `src/main.js`, update the Firestore listener to dispatch full state updates:

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -57,21 +57,36 @@ async function bootstrapApp() {
   subscribeChannelConfig(channelParam, (remoteConfig) => {
     if (remoteConfig) {
+      let queueNeedsRegen = false;
+
       if (remoteConfig.enabledDecades) {
+        queueNeedsRegen = JSON.stringify(adminController.enabledDecades) !== JSON.stringify(remoteConfig.enabledDecades);
         adminController.enabledDecades = remoteConfig.enabledDecades;
       }
       if (remoteConfig.enabledCategories) {
+        queueNeedsRegen = queueNeedsRegen || (JSON.stringify(adminController.enabledCategories) !== JSON.stringify(remoteConfig.enabledCategories));
         adminController.enabledCategories = remoteConfig.enabledCategories;
       }
+
       if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
       if (remoteConfig.generalClipMaxSec) adminController.generalClipMaxSec = remoteConfig.generalClipMaxSec;
       if (remoteConfig.randomOffsetEnabled !== undefined) adminController.randomOffsetEnabled = remoteConfig.randomOffsetEnabled;
       if (remoteConfig.pacingMode) adminController.pacingMode = remoteConfig.pacingMode;
       if (remoteConfig.zapBurstEnabled !== undefined) adminController.zapBurstEnabled = remoteConfig.zapBurstEnabled;
+
+      // Apply visual CRT vibe settings
+      if (remoteConfig.washoutEnabled !== undefined || remoteConfig.contrast !== undefined) {
+        effectsEngine.updateWashoutSettings(
+          remoteConfig.contrast ?? adminController.contrast,
+          remoteConfig.brightness ?? adminController.brightness,
+          remoteConfig.opacity ?? adminController.opacity,
+          remoteConfig.washoutEnabled ?? adminController.washoutEnabled
+        );
+      }
+      if (remoteConfig.scanlinesEnabled !== undefined) {
+        effectsEngine.toggleScanlines(remoteConfig.scanlinesEnabled);
+      }
+      if (remoteConfig.staticFXEnabled !== undefined) {
+        effectsEngine.staticFXEnabled = remoteConfig.staticFXEnabled;
+      }
+      if (remoteConfig.osdMode) {
+        adminController.osdMode = remoteConfig.osdMode;
+        if (playerEngine.currentVideoItem) {
+          playerEngine.updateOSD(playerEngine.currentVideoItem);
+        }
+      }
       
       playerEngine.updatePacingRules(
         adminController.commercialMaxSec,
         adminController.generalClipMaxSec,
         adminController.randomOffsetEnabled,
         adminController.pacingMode,
         adminController.zapBurstEnabled
       );
+
+      // If catalog filtering changed, regenerate queue and transition cleanly
+      if (queueNeedsRegen) {
+        const newQueue = catalogManager.generateChannelQueue(
+          channelParam,
+          adminController.enabledCategories,
+          adminController.enabledDecades
+        );
+        playerEngine.updateQueue(newQueue);
+      }
     }
   });
```

---

### Finding 2: Stateful Side-Effects in `calculateSmartClip()` Corrupts Surfing State Machine
- **Severity**: `[CRITICAL]`
- **Category**: Component Composition & State Management
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:310-382` (calculation & mutation)
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:271-278` (preloader invocation)
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:458-460` (`nextVideo` invocation)

#### Description & Root Cause
`calculateSmartClip(videoItem)` is named like a pure utility function, but it modifies internal state:
```javascript
// src/playerEngine.js:318-322
if (this.sessionClipsRemaining <= 0) {
  this.pickNextSurfingSession();
}
this.sessionClipsRemaining--;
```
In the double-buffering architecture:
1. `preloadNext()` calls `calculateSmartClip(nextItem)` to obtain `startSec` for the hidden iframe. This decrements `this.sessionClipsRemaining` and potentially transitions the surfing mode (e.g. from `settle_in` to `browse_flurry`).
2. When the active clip finishes 6 seconds later and `nextVideo()` is invoked, `nextVideo()` calls `this.calculateSmartClip(this.currentVideoItem)` **a second time for the exact same video item**.
3. This second call:
   - Decrements `this.sessionClipsRemaining` again, progressing the psychological state machine at double speed.
   - Computes a **new random duration and offset**. The background player was already initialized at `startSec` from call #1, but call #2 calculates a different duration `maxDurationSec` and sets `activeCutoffSec` to a mismatching value.

#### Architectural Impact
Domain logic calculations are coupled to state transitions. Video playback offsets and timer cutoffs become desynchronized, and the browsing session engine cycles erratically.

#### Actionable Remediation Diff
Separate state transition from pure duration/offset calculations:

```diff
--- a/src/playerEngine.js
+++ b/src/playerEngine.js
@@ -310,17 +310,13 @@ class PlayerEngine {
-  calculateSmartClip(videoItem) {
+  calculateSmartClip(videoItem, sessionType = this.currentSessionType) {
     if (!videoItem) return { startSec: 0, maxDurationSec: 30 };
 
     const cat = (videoItem.category || '').toLowerCase();
     let startSec = videoItem.startSec || 0;
     let maxDurationSec = 30;
 
-    // 1. Advance or establish the Human Surfing Session state
-    if (this.sessionClipsRemaining <= 0) {
-      this.pickNextSurfingSession();
-    }
-    this.sessionClipsRemaining--;
-
     // 2. Mode-based pacing multipliers
     const mode = this.pacingMode || 'channel-surfer';
     const isDeepCuts = mode === 'deep-cuts';
     const isBalanced = mode === 'balanced';
 
-    if (this.currentSessionType === 'browse_flurry' && this.zapBurstEnabled) {
+    if (sessionType === 'browse_flurry' && this.zapBurstEnabled) {
       this.isZapClip = true;
       maxDurationSec = Math.floor(Math.random() * 5) + 5;
       if (this.randomOffsetEnabled && startSec === 0) {
@@ -331,7 +327,7 @@ class PlayerEngine {
     this.isZapClip = false;
 
-    if (this.currentSessionType === 'curious_glance') {
+    if (sessionType === 'curious_glance') {
       if (cat === 'commercials') {
...
@@ -384,6 +380,13 @@ class PlayerEngine {
+  advanceSurfingSession() {
+    if (this.sessionClipsRemaining <= 0) {
+      this.pickNextSurfingSession();
+    }
+    this.sessionClipsRemaining--;
+  }
```

---

### Finding 3: Double-Buffering Race Condition and Stale Video Desynchronization on Channel Advance
- **Severity**: `[HIGH]`
- **Category**: State Management & Player Engine Lifecycle
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:260-283` (`preloadNext`)
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:439-475` (`nextVideo`)
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:520-565` (`handlePlayerError`)
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:617-624` (JIT preloading condition)

#### Description & Root Cause
The double-buffered playback model uses a JIT (just-in-time) preloading scheme where `preloadNext()` is only triggered when `this.elapsedSeconds >= this.activeCutoffSec - 6` (line 620).
If a transition occurs before this window:
1. **User presses 'N' (Next Video) or rapid zap flurry triggers**: If only 2 seconds have elapsed on a 45-second clip, `preloadNext()` was never called. `nextVideo()` immediately flips `this.activePlayerId` from `A` to `B`.
2. **Player B has stale content**: Player B is either uninitialized or holding a clip from multiple cycles ago. `nextVideo()` does not check whether Player B is actually loaded with the expected item, nor does it call `loadVideoById` on Player B.
3. **Playback desynchronization**: Player B continues playing old content or remains black, while the OSD HUD displays the newly queued title.
4. **Immediate video errors**: If an active video errors immediately on load (e.g. YouTube error 150), `handlePlayerError` immediately calls `this.nextVideo()`, swapping to an un-cued background player.

#### Architectural Impact
Causes black frames, frozen screens, and desynchronization between audio/video and the on-screen display during channel surfing, keyboard navigation, and error recovery.

#### Actionable Remediation Diff
Ensure `nextVideo()` validates the cued state of the incoming player and forces an immediate load if preloading has not occurred:

```diff
--- a/src/playerEngine.js
+++ b/src/playerEngine.js
@@ -448,15 +448,27 @@ class PlayerEngine {
     effectsEngine.triggerChannelSwitch(staticDuration, () => {
       // 1. Swap active player container focus
       this.toggleActivePlayerFocus();
 
       // 2. Advance to the next live queue index
       this.currentIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
       this.currentVideoItem = this.queue[this.currentIndex];
-      this.cuedItems[this.activePlayerId] = this.currentVideoItem;
       this.lastAdvanceAt = Date.now();
 
+      // Ensure incoming active player is actually playing the expected video
+      const activePlayer = this.getActivePlayer();
+      const isCuedCorrectly = this.cuedItems[this.activePlayerId]?.videoId === this.currentVideoItem?.videoId;
+      
+      this.advanceSurfingSession();
+      const { startSec, maxDurationSec } = this.calculateSmartClip(this.currentVideoItem);
+      this.activeCutoffSec = maxDurationSec;
+      this.elapsedSeconds = 0;
+      this.hasPreloadedForCurrentClip = false;
+
+      if (!isCuedCorrectly && activePlayer && typeof activePlayer.loadVideoById === 'function') {
+        activePlayer.loadVideoById({
+          videoId: this.currentVideoItem.videoId,
+          startSeconds: startSec
+        });
+      }
+      this.cuedItems[this.activePlayerId] = this.currentVideoItem;
 
       // 4. Update OSD green HUD display
       this.updateOSD(this.currentVideoItem);
```

---

### Finding 4: Massive 3.7MB Static Data Bundle Blocking Main Thread & Dual-Catalog Ingestion Conflict
- **Severity**: `[HIGH]`
- **Category**: Project Modularity & Code Maintainability
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogData.js:1-202` (3.7MB JS file)
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogManager.js:96-199`
  - `/Users/fraser/antigravity/bnsd-tv/scripts/build-catalog.js:178-204`
  - `/Users/fraser/antigravity/bnsd-tv/public/bnsd_tv_playlist.csv` (7.7MB CSV file)

#### Description & Root Cause
1. **Synchronous JavaScript parsing of 153k records**: `src/catalogData.js` embeds 153,060 tuples in a 3.7MB file that Vite bundles into the main chunk. On startup, `ingestArrayData()` instantiates over 450,000 object references across `allVideos`, `categoriesMap`, and `decadesMap`. On low-power Android TV devices (typically 1GB–2GB RAM), this causes memory spikes and UI thread jank.
2. **Dead fetch fallback**: `catalogManager.loadCSV('/bnsd_tv_playlist.csv')` contains code to `fetch` the CSV file, but this branch is dead because `BNSD_TV_CATALOG` is statically imported and truthy.
3. **Data loss during catalog compilation**: `scripts/build-catalog.js` maps raw CSV rows to `[decIdx, year, catIdx, videoId]`, discarding `title`, `start_seconds`, and `end_seconds`. In `catalogManager.js:137`, `title` is generated as generic `${category} (${year})`.
4. **Bandwidth waste**: `public/bnsd_tv_playlist.csv` (7.7MB) is deployed to hosting despite being unused at runtime.

#### Architectural Impact
Severe memory overhead and boot latency on embedded hardware; data loss during compilation; dead network fallback code.

#### Actionable Remediation Recommendations
1. **Dynamic Chunking / IndexedDB Cache**: Split the dataset into per-decade JSON chunks (`catalog_1980s.json`, `catalog_1990s.json`, `catalog_2000s.json`) and lazy-load only the active decades requested by the channel configuration.
2. **Retain Metadata in Tuple**: Include start offset and title index if needed, or stream chunks via IndexedDB.
3. **Remove Duplicate Public CSV**: Exclude `public/bnsd_tv_playlist.csv` from the deployment bundle if the bundled JSON/JS approach is used.

---

### Finding 5: God Objects and Spaghetti Coupling Between Core Modules (`PlayerEngine` & `AdminController`)
- **Severity**: `[HIGH]`
- **Category**: Component Composition & Separation of Concerns
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:1-687`
  - `/Users/fraser/antigravity/bnsd-tv/src/admin.js:1-503`
  - `/Users/fraser/antigravity/bnsd-tv/src/main.js:38, 86`

#### Description & Root Cause
1. **`PlayerEngine` is an overloaded God Object**:
   - Manages YouTube iframe API scripts and lifecycle.
   - Manages double-buffering iframe DOM containers and opacity swapping.
   - Executes psychological session state machine logic.
   - Calculates visual pacing rules and math.
   - Drives interval timers and cutoffs.
   - Performs DOM manipulation on OSD green HUD elements.
   - Reads global `window.adminController` directly to circumvent circular imports.
2. **`AdminController` is an overloaded God Object**:
   - Imperatively constructs DOM subtrees (`document.createElement`) and injects HTML.
   - Listens to global `window` keyboard shortcuts.
   - Manages CSV file reading and parsing.
   - Controls stream refresh and queue generation.
   - Hosts unrelated utility functions like `getChannelNum()`, which `main.js` and `playerEngine.js` import.
3. **Global `window.adminController` anti-pattern**:
   - In `admin.js:28`: `window.adminController = this;`
   - In `playerEngine.js:650`: `const admin = window.adminController;`
   This global attachment exists solely to avoid a circular dependency between `admin.js` and `playerEngine.js`.

#### Architectural Impact
High coupling makes independent testing impossible; architectural layers are inverted (core streaming engines depend on UI controllers); changes to presentation code break core playback.

#### Actionable Remediation Strategy
1. **Extract Channel Utilities**: Move `getChannelNum()` and channel metadata helpers to a dedicated `src/utils/channelUtils.js`.
2. **Extract HUD View Component**: Move OSD DOM updates out of `PlayerEngine` into an `OsdHudView` component.
3. **Introduce EventBus / State Store**: Decouple `AdminController` and `PlayerEngine` through an event emitter (`EventBus.on('PACING_CHANGED', ...)`) rather than attaching controllers to `window`.

```javascript
// Example: src/utils/channelUtils.js
export const CHANNEL_PRESETS = {
  'projector-bar': { num: '01', label: 'Bar Projector' },
  'projector-dining': { num: '02', label: 'Dining Room Projector' },
  'projector-lounge': { num: '03', label: 'Lounge Projector' },
  'projector-patio': { num: '04', label: 'Patio Projector' },
};

export function getChannelNumber(channelId) {
  return CHANNEL_PRESETS[channelId]?.num || '05';
}
```

---

### Finding 6: Quarantine Inconsistency: Unconditional Storage Purge on Boot vs Admin Quarantine Management
- **Severity**: `[MEDIUM]`
- **Category**: State Management & Technical Debt
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/main.js:16`
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogManager.js:13-74`
  - `/Users/fraser/antigravity/bnsd-tv/src/admin.js:254-266`

#### Description & Root Cause
There is an architectural contradiction in how quarantined "dead" videos are managed:
1. `catalogManager.js:13` calls `this.loadDeadVideoFlags()` during construction to restore quarantined IDs from `localStorage`.
2. `admin.js:255-266` provides buttons to "Export Dead Videos (.csv)" and "Clear All Dead Flags", suggesting persistent management across days.
3. However, `main.js:16` unconditionally calls `catalogManager.clearDeadVideoFlags()` at startup (`bootstrapApp()`).
4. Because `watchdog.js` reloads the page on stalls (5 minutes) and periodically (every 6 hours), the quarantine set is continually erased throughout the day. Quarantined videos that failed due to region locks or permanent takedowns are immediately reintroduced into the active queue after every watchdog reload.

#### Architectural Impact
The quarantine mechanism fails to protect the kiosk from repeatedly re-encountering broken videos after routine watchdog reloads. The Admin export feature is rendered nearly useless.

#### Actionable Remediation Recommendation
Remove the unconditional `clearDeadVideoFlags()` call from `main.js`. If daily reset is desired, store a `lastResetDate` in `localStorage` and only clear flags when a calendar day rollover is detected.

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -11,7 +11,12 @@ async function bootstrapApp() {
-  catalogManager.clearDeadVideoFlags();
+  // Only reset quarantine on a fresh calendar day, not on watchdog reloads
+  const today = new Date().toISOString().slice(0, 10);
+  const lastReset = localStorage.getItem('bnsd_last_quarantine_reset');
+  if (lastReset !== today) {
+    catalogManager.clearDeadVideoFlags();
+    localStorage.setItem('bnsd_last_quarantine_reset', today);
+  }
```

---

### Finding 7: Dead Code, Phantom DOM Queries, and Unused Utilities
- **Severity**: `[MEDIUM]`
- **Category**: Code Maintainability & Technical Debt
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/main.js:84-87` (`osd-era-badge`)
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogManager.js:398-404` (`hashString`)
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogManager.js:306, 322` (`channelId` in `generateChannelQueue`)
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogData.js:200` (`DEFAULT_90S_CATALOG`)

#### Description & Root Cause
1. **Phantom DOM Query**: `src/main.js:84` queries `document.getElementById('osd-era-badge')`. This ID does not exist anywhere in `index.html`.
2. **Dead Hash Function**: `src/catalogManager.js:398-404` implements `hashString(str)`, which is never invoked anywhere in the codebase.
3. **Unused Channel Parameter**: `generateChannelQueue(channelId, ...)` accepts `channelId`, but only uses it to log to the console. The docstrings and UI promise deterministic channel desynchronization, but the function relies exclusively on unseeded `Math.random()`.
4. **Dead Export Alias**: `catalogData.js:200` exports `DEFAULT_90S_CATALOG = BNSD_TV_CATALOG`, which is an unused legacy alias.

#### Architectural Impact
Misleading API signatures, phantom code maintenance overhead, and unfulfilled architectural promises (channel-based deterministic shuffling).

#### Actionable Remediation Diff
Clean up phantom references and implement seeded deterministic shuffling for channels:

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -84,3 +84,2 @@ async function bootstrapApp() {
-  const eraBadge = document.getElementById('osd-era-badge');
   const catLabel = document.getElementById('osd-category-label');
   const chNum = adminController.getChannelNum(channelParam);
-  if (eraBadge) eraBadge.textContent = 'POWER ON';
   if (catLabel) catLabel.textContent = `TUNING CH ${chNum} BROADCAST...`;
```

---

### Finding 8: Missing Event Listener & Timer Teardown / Memory Leak Vectors
- **Severity**: `[MEDIUM]`
- **Category**: Custom Hooks & Abstraction Hygiene
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/effectsEngine.js:24-25`
  - `/Users/fraser/antigravity/bnsd-tv/src/admin.js:87-99`
  - `/Users/fraser/antigravity/bnsd-tv/src/watchdog.js:25-39`
  - `/Users/fraser/antigravity/bnsd-tv/src/main.js:101-106`
  - `/Users/fraser/antigravity/bnsd-tv/src/playerEngine.js:569-585`

#### Description & Root Cause
Singletons register event listeners on global targets (`window`, `document`) and initiate asynchronous timers with no lifecycle cleanup:
1. `effectsEngine.init()` binds `window.addEventListener('resize', ...)` with no unbind method.
2. `adminController.bindEvents()` binds `window.addEventListener('keydown', ...)` globally with no cleanup.
3. `watchdog.js` provides `startWatchdog()` which sets intervals and timeouts on module-scoped variables, but exposes no `stopWatchdog()` or `teardownWatchdog()`.
4. `playerEngine.destroy()` tears down YouTube player instances, but fails to nullify `onProgressCallback`, leaving dangling references.

#### Architectural Impact
Complicates unit testing, creates memory retention during Vite HMR (Hot Module Replacement) in development, and makes programmatic restarts brittle.

#### Actionable Remediation Snippet
Add complete `destroy()` / `cleanup()` methods across all singletons:

```javascript
// src/watchdog.js
export function stopWatchdog() {
  if (stallCheckIntervalId) {
    clearInterval(stallCheckIntervalId);
    stallCheckIntervalId = null;
  }
  if (preventiveReloadTimeoutId) {
    clearTimeout(preventiveReloadTimeoutId);
    preventiveReloadTimeoutId = null;
  }
}
```

---

### Finding 9: Lack of TypeScript, Type Contracts, and Data Model Standardization
- **Severity**: `[MEDIUM]`
- **Category**: Code Maintainability & Technical Debt
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/catalogManager.js:131-140, 166-175, 229-238`
  - `/Users/fraser/antigravity/bnsd-tv/scripts/build-catalog.js:152-160`
  - `/Users/fraser/antigravity/bnsd-tv/src/admin.js:231-240`

#### Description & Root Cause
The repository has no TypeScript compiler configuration (`tsconfig.json`) or JSDoc type definitions. Data structures representing video items and channel configurations are created in five different places with divergent property names and casing:
- In `build-catalog.js`: `{ decade, year, channel, video_id, title, start_seconds, end_seconds }`
- In `catalogManager.js` (tuple): `{ id, decade, year, category, videoId, title, startSec, endSec }`
- In `catalogManager.js` (CSV): `{ id, videoId, category, decade, year, title, startSec, endSec }`
- In `admin.js` (test video): `{ id: 99999, videoId, category: 'Test Stream', decade: '1990s', year: '1995', title, startSec: 0, endSec: 0 }`

#### Architectural Impact
Lack of static type checking leads to runtime property access bugs (e.g. `item.channel` vs `item.category`, `item.video_id` vs `item.videoId`), and makes large-scale refactoring error-prone.

#### Actionable Remediation Recommendation
Introduce JSDoc `@typedef` annotations or migrate to TypeScript with standardized domain interfaces:

```typescript
// types/catalog.ts
export interface VideoItem {
  id: number;
  videoId: string;
  category: string;
  decade: '1980s' | '1990s' | '2000s';
  year: string;
  title: string;
  startSec: number;
  endSec: number;
}

export interface ChannelConfig {
  channelId: string;
  enabledDecades: string[];
  enabledCategories: string[];
  pacingMode: 'channel-surfer' | 'balanced' | 'deep-cuts';
  zapBurstEnabled: boolean;
  commercialMaxSec: number;
  generalClipMaxSec: number;
  randomOffsetEnabled: boolean;
  contrast: number;
  brightness: number;
  opacity: number;
  scanlinesEnabled: boolean;
  staticFXEnabled: boolean;
  washoutEnabled: boolean;
  osdMode: 'crt-header' | 'vcr-watermark' | 'full-info' | 'hidden';
}
```

---

### Finding 10: Inefficient Canvas Buffer Allocation in 2D Static Noise Generator
- **Severity**: `[LOW]`
- **Category**: Performance & Component Composition
- **File & Line Numbers**:
  - `/Users/fraser/antigravity/bnsd-tv/src/effectsEngine.js:36-57`

#### Description & Root Cause
In `renderNoiseFrame()`, `this.ctx.createImageData(w, h)` is allocated on every single frame of `requestAnimationFrame` (60fps). For a 960x540 canvas buffer, this allocates ~2MB per frame (over 120MB/second of transient memory allocations). On memory-constrained Android hardware, this triggers frequent Garbage Collection (GC) pauses during channel transitions.

#### Architectural Impact
Frame stutter during analog CRT static transitions on embedded kiosk chipsets.

#### Actionable Remediation Diff
Reuse a pre-allocated `ImageData` buffer:

```diff
--- a/src/effectsEngine.js
+++ b/src/effectsEngine.js
@@ -15,6 +15,7 @@ class EffectsEngine {
+    this.cachedImageData = null;
+    this.cachedBuffer = null;
   }
 
   resizeCanvas() {
     if (!this.canvas) return;
     this.canvas.width = Math.floor(window.innerWidth / 2);
     this.canvas.height = Math.floor(window.innerHeight / 2);
+    if (this.ctx) {
+      this.cachedImageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
+      this.cachedBuffer = new Uint32Array(this.cachedImageData.data.buffer);
+    }
   }
 
   renderNoiseFrame() {
-    if (!this.ctx || !this.isStaticActive) return;
+    if (!this.ctx || !this.isStaticActive || !this.cachedImageData) return;
 
-    const w = this.canvas.width;
-    const h = this.canvas.height;
-    const imgData = this.ctx.createImageData(w, h);
-    const buffer = new Uint32Array(imgData.data.buffer);
-    const len = buffer.length;
+    const buffer = this.cachedBuffer;
+    const len = buffer.length;
     for (let i = 0; i < len; i++) {
       const color = Math.floor(Math.random() * 255);
       buffer[i] = (255 << 24) | (color << 16) | (color << 8) | color;
     }
 
-    this.ctx.putImageData(imgData, 0, 0);
+    this.ctx.putImageData(this.cachedImageData, 0, 0);
 
     if (this.isStaticActive) {
       this.animationFrameId = requestAnimationFrame(() => this.renderNoiseFrame());
     }
   }
```

---

## Suggested Phased Refactoring Plan

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 1: Immediate Bug & Sync Fixes                      │
│ - Fix Firestore remoteConfig listener in main.js to update queue and vibe fx. │
│ - Decouple side-effects from calculateSmartClip() in playerEngine.js.         │
│ - Fix double-buffering preloading fallback in nextVideo().                    │
│ - Align quarantine reset logic in main.js with daily rollover.                │
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼────────────────────────────────────────┐
│                   PHASE 2: Decoupling & Modular Architecture                  │
│ - Extract channelUtils.js, OsdHudView.js, and AdminModalView.js.              │
│ - Replace window.adminController global with an EventBus / StateStore.        │
│ - Add stopWatchdog() and cleanup lifecycle methods to all engines.            │
│ - Remove dead code (hashString, DEFAULT_90S_CATALOG, phantom osd-era-badge).  │
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼────────────────────────────────────────┐
│               PHASE 3: Memory Optimization & Domain Type Safety               │
│ - Chunk catalogData.js into lazy-loaded decade bundles.                       │
│ - Remove unused public/bnsd_tv_playlist.csv from production distribution.     │
│ - Introduce TypeScript types/interfaces for VideoItem and ChannelConfig.      │
│ - Pre-allocate 2D canvas ImageData buffers in effectsEngine.js.               │
└───────────────────────────────────────────────────────────────────────────────┘
```
