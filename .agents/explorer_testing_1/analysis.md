# Comprehensive Testing, Reliability & Quality Assessment Report

**Target Project**: BNSD TV (`/Users/fraser/antigravity/bnsd-tv`)  
**Domain**: Testing Infrastructure, Reliability Engineering, Error Handling Resilience, and Static/Runtime Quality  
**Date**: 2026-08-20  
**Status**: COMPLETE  

---

## Executive Summary

BNSD TV is a specialized, vanilla JavaScript/Vite web application built to stream vintage television archives in an authentic 90s CRT aesthetic on unattended Android projectors in restaurant environments (using FreeKiosk). The application features sophisticated architectural logic: a dual-iframe double-buffered YouTube player engine, dynamic Fisher-Yates anti-clustering shuffle queues, a psychological human remote-surfing state machine, analog CRT canvas shaders, and optional Firestore/LocalStorage real-time sync.

However, an exhaustive audit of the codebase reveals **critical vulnerabilities in testing, error resilience, and static quality validation**:
1. **0% Automated Test Coverage**: There is **not a single test file** in the repository. No unit, integration, E2E, or component tests exist. There is no test framework configured (no Vitest, Jest, Playwright, or Testing Library) and no CI/CD automation.
2. **Fragile Unhandled Error Recovery**: The application lacks global error traps (`window.onerror`, `unhandledrejection`). If an initial catalog load, DOM query, or YouTube API script fails, the application crashes silently, and because the watchdog is started *after* player initialization, the kiosk screen remains frozen or blank permanently without auto-recovery.
3. **Unguarded Storage & Infinite Error Loops**: Direct calls to `localStorage` without exception handling risk throwing `QuotaExceededError` or `SecurityError` in restricted kiosk WebViews. If all videos in a queue are quarantined, `findNextLiveIndex()` creates a synchronous infinite error loop that pegs CPU usage.
4. **Zero Type Safety & Missing Runtime Validation**: The codebase is 100% untyped JavaScript with no `tsconfig.json`, no ESLint, and no runtime schema validation (Zod) for Firestore documents, CSV uploads, or LocalStorage payloads.

Below is the detailed catalog of 13 categorized findings, complete with exact line references, reliability impact assessments, and production-ready remediation code and test harnesses.

---

## Summary Scorecard & Findings Matrix

| ID | Category | Title | Severity | Impact Area | Exact Location |
|---|---|---|---|---|---|
| **TST-01** | Testing Infrastructure | Complete Absence of Automated Test Suite & CI/CD Pipeline | **CRITICAL** | Code Reliability & Regressions | `package.json:6-18`, Missing Configs |
| **TST-02** | Test Coverage | Untested Fisher-Yates Anti-Clustering Shuffle & Pacing State Machine | **HIGH** | Core Streaming Logic | `src/catalogManager.js:306-393`, `src/playerEngine.js:304-434` |
| **TST-03** | Test Coverage | Untested Permutation Cypher & Catalog Ingestion Pipeline | **HIGH** | Data Integrity (30k+ streams) | `scripts/build-catalog.js:24-66, 105-163` |
| **TST-04** | Test Coverage | Missing Dual-Player A/B Double-Buffering & JIT Preload Test Harness | **MEDIUM** | Playback Continuity & Glitches | `src/playerEngine.js:80-175, 214-283, 525-564` |
| **ERR-01** | Error Resilience | Missing Global Error Traps & Late Watchdog Initialization | **CRITICAL** | Unattended Kiosk Freezes | `src/main.js:8-119`, `src/watchdog.js:25-39` |
| **ERR-02** | Error Resilience | Fatal Unhandled Startup Stall on Catalog Load / Fetch Failure | **HIGH** | Boot Resilience & Offline State | `src/main.js:42-46`, `src/catalogManager.js:96-110` |
| **ERR-03** | Error Resilience | Unguarded `localStorage` Writes Crashing Restricted WebViews | **HIGH** | Kiosk Storage Compatibility | `src/firebase.js:46, 78`, `src/admin.js:135, 143` |
| **ERR-04** | Error Resilience | Missing YouTube API Script Failure Handling & Constructor Guard | **HIGH** | Network Outage Recovery | `src/playerEngine.js:69-77, 80-102, 146-174` |
| **ERR-05** | Error Resilience | Infinite Error Loop & CPU Spike When Queue Videos are Quarantined | **MEDIUM** | Kiosk Hardware Stability | `src/playerEngine.js:286-301, 525-564` |
| **ERR-06** | User Experience | Missing Error Messaging & Fallback UI in Admin Control Center | **LOW** | Administrative Usability | `src/admin.js:220-244, 268-280` |
| **TYP-01** | Static Quality | 0% Type Safety, Missing `tsconfig.json`, and Implicit Type Hazards | **HIGH** | Type Coercion & Silent Bugs | Entire Repository (`src/*.js`) |
| **TYP-02** | Runtime Validation | Missing Runtime Schema Validation for Firestore, CSV & Storage Payloads | **HIGH** | Remote Data Integrity | `src/firebase.js:57-86`, `src/catalogManager.js:204-258` |
| **TYP-03** | Code Quality | Missing ESLint and Prettier Automated Enforcement | **MEDIUM** | Codebase Maintainability | Root Configuration |

---

## Detailed Findings & Remediation Proposals

### 1. Test Coverage & Testing Infrastructure

---

#### [CRITICAL] Finding TST-01: Complete Absence of Automated Test Suite, Test Runner, and CI/CD Verification
- **Exact Location**: `package.json:6-18`, `.github/workflows/` (missing)
- **Description**: The repository contains zero automated test files (`*.test.js` or `*.spec.js`). `package.json` has only `dev`, `build`, `preview`, and `build-catalog` scripts. No test runner (Vitest/Jest), DOM testing utility (`@testing-library/dom`, `jsdom`, `happy-dom`), or mock libraries are installed. Furthermore, there is no continuous integration workflow (e.g. GitHub Actions) to verify that builds compile, catalogs build properly, or tests pass prior to deployment.
- **Reliability Impact**: Any update or refactoring of the complex video queue generator, YouTube player event lifecycle, Firestore subscription, or CRT static shaders can cause catastrophic silent regressions that go undetected until deployed to physical ceiling projectors in the restaurant.
- **Remediation**:
  1. Install Vitest, jsdom, and testing utilities:
     ```bash
     npm install -D vitest @testing-library/dom jsdom
     ```
  2. Configure `vitest.config.js` with DOM environment support and path aliases.
  3. Add test execution scripts to `package.json`.
  4. Create a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs catalog validation, linting, type-checking, and unit tests on every PR and commit.

**Concrete Remediation Snippet (`vitest.config.js`):**
```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      lines: 85,
      functions: 85,
      branches: 80,
      statements: 85
    }
  }
});
```

**Concrete CI/CD Workflow (`.github/workflows/ci.yml`):**
```yaml
name: CI Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - name: Validate Catalog Build
        run: npm run build-catalog
      - name: Run Automated Tests
        run: npm test
      - name: Verify Production Build
        run: npm run build
```

---

#### [HIGH] Finding TST-02: Untested Fisher-Yates Anti-Clustering Shuffle & Pacing State Machine
- **Exact Location**: `src/catalogManager.js:306-393` (`generateChannelQueue`), `src/playerEngine.js:304-434` (`calculateSmartClip`, `pickNextSurfingSession`)
- **Description**: The core visual intelligence of BNSD TV relies on two complex algorithms:
  1. `generateChannelQueue`: Groups videos into category buckets, performs in-place Fisher-Yates shuffles per category, and runs an interleaving algorithm with dynamic weight recalculation to prevent back-to-back identical categories.
  2. `calculateSmartClip` and `pickNextSurfingSession`: Implements a 3-state stochastic psychological surfing machine (`browse_flurry`, `curious_glance`, `settle_in`) with category-specific seek offsets (e.g. skipping MTV intros, cartoon openings) and mode cutoffs.
  Neither algorithm has any unit tests verifying mathematical correctness, termination guarantees, anti-clustering constraints, or edge-case handling (such as single-category queues or empty decade filters).
- **Reliability Impact**: Algorithmic bugs in `while (totalRemaining > 0)` can cause infinite loops that freeze the browser tab, produce empty playlists, or output back-to-back duplicate categories that ruin the restaurant ambiance.
- **Remediation**: Create a comprehensive unit test suite in `tests/catalogManager.test.js` validating queue generation invariants.

**Concrete Test Harness (`tests/catalogManager.test.js`):**
```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { catalogManager } from '../src/catalogManager.js';

describe('CatalogManager - Queue Generation & Anti-Clustering', () => {
  beforeEach(() => {
    catalogManager.clearDeadVideoFlags();
    // Ingest deterministic test fixture data
    catalogManager.allVideos = [
      { id: 1, category: 'Commercials', decade: '1990s', videoId: 'ad1', title: 'Ad 1', startSec: 0, endSec: 0 },
      { id: 2, category: 'Commercials', decade: '1990s', videoId: 'ad2', title: 'Ad 2', startSec: 0, endSec: 0 },
      { id: 3, category: 'Cartoons', decade: '1990s', videoId: 'toon1', title: 'Toon 1', startSec: 0, endSec: 0 },
      { id: 4, category: 'Cartoons', decade: '1990s', videoId: 'toon2', title: 'Toon 2', startSec: 0, endSec: 0 },
      { id: 5, category: 'Music', decade: '1990s', videoId: 'mus1', title: 'Music 1', startSec: 0, endSec: 0 },
      { id: 6, category: 'Music', decade: '1980s', videoId: 'mus2', title: 'Music 2', startSec: 0, endSec: 0 }
    ];
    // Populate internal maps
    catalogManager.categoriesMap.clear();
    catalogManager.decadesMap.clear();
    catalogManager.allVideos.forEach(v => {
      const c = v.category.toUpperCase();
      if (!catalogManager.categoriesMap.has(c)) catalogManager.categoriesMap.set(c, []);
      catalogManager.categoriesMap.get(c).push(v);

      const d = v.decade.toUpperCase();
      if (!catalogManager.decadesMap.has(d)) catalogManager.decadesMap.set(d, []);
      catalogManager.decadesMap.get(d).push(v);
    });
  });

  it('should never output duplicate consecutive categories when multiple categories exist', () => {
    const queue = catalogManager.generateChannelQueue('projector-bar', ['Commercials', 'Cartoons', 'Music'], ['1990s']);
    expect(queue.length).toBe(5);

    for (let i = 0; i < queue.length - 1; i++) {
      expect(queue[i].category).not.toBe(queue[i + 1].category);
    }
  });

  it('should exclude quarantined dead video IDs from generated queue', () => {
    catalogManager.markVideoDead('ad1', 'Ad 1');
    const queue = catalogManager.generateChannelQueue('projector-bar', ['Commercials', 'Cartoons'], ['1990s']);
    const ids = queue.map(v => v.videoId);
    expect(ids).not.toContain('ad1');
    expect(ids).toContain('ad2');
  });

  it('should gracefully handle single-category filtered queues', () => {
    const queue = catalogManager.generateChannelQueue('projector-bar', ['Commercials'], ['1990s']);
    expect(queue.length).toBe(2);
    expect(queue.every(v => v.category === 'Commercials')).toBe(true);
  });

  it('should return an empty array when filters match no videos without hanging or throwing', () => {
    const queue = catalogManager.generateChannelQueue('projector-bar', ['NonExistentCategory'], ['2000s']);
    expect(queue).toEqual([]);
  });
});
```

---

#### [HIGH] Finding TST-03: Untested Permutation Cypher & Catalog Ingestion Pipeline
- **Exact Location**: `scripts/build-catalog.js:24-66`, `scripts/build-catalog.js:105-163`
- **Description**: `scripts/build-catalog.js` unscrambles YouTube video IDs from a 32-row permutation matrix `CYPHER_MATRIX` and category mapping table. The script transforms `scripts/raw_decades.json` into `bnsd_tv_playlist.csv`, `public/bnsd_tv_playlist.csv`, and the optimized compact tuple JS module `src/catalogData.js`. If any row in `CYPHER_MATRIX` is invalid or category chunk slicing offsets drift, thousands of video IDs become corrupt strings without triggering build errors.
- **Reliability Impact**: A subtle regression in the build script will silently corrupt 30,000+ video IDs, causing YouTube player errors (`error 2` / `error 100`) on live broadcasts.
- **Remediation**: Write automated tests in `tests/buildCatalog.test.js` validating permutation matrix mathematical properties (all rows must be permutations of [0..10]), deterministic decoding of known test fixtures, and news/political filter rules.

**Concrete Test Harness (`tests/buildCatalog.test.js`):**
```javascript
import { describe, it, expect } from 'vitest';

// Extract matrix for validation
const CYPHER_MATRIX = [
  [5, 6, 9, 3, 0, 7, 10, 1, 4, 2, 8],
  [9, 4, 6, 5, 8, 1, 10, 2, 0, 3, 7],
  // ... (all 32 rows)
];

function decodeVideoId(scrambled, matrix) {
  const chars = scrambled.split('');
  const t = matrix.length;
  const getIndex = (arr) => arr.reduce((acc, char) => acc + char.charCodeAt(0), 0) % t;
  const row = matrix[getIndex(chars)];
  return row.map(idx => chars[idx]).join('');
}

describe('Build Catalog Permutation Cipher Invariants', () => {
  it('every row in CYPHER_MATRIX must be a valid permutation of integers 0 to 10', () => {
    CYPHER_MATRIX.forEach((row, rowIndex) => {
      expect(row.length).toBe(11);
      const sorted = [...row].sort((a, b) => a - b);
      expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  it('decodeVideoId must return an 11-character YouTube video ID string', () => {
    const sampleScrambled = 'kYoC0U1TZUV';
    const decoded = decodeVideoId(sampleScrambled, CYPHER_MATRIX);
    expect(decoded.length).toBe(11);
    expect(typeof decoded).toBe('string');
  });
});
```

---

#### [MEDIUM] Finding TST-04: Missing Dual-Player A/B Double-Buffering & JIT Preload Test Harness
- **Exact Location**: `src/playerEngine.js:80-175`, `src/playerEngine.js:214-283`, `src/playerEngine.js:525-564`
- **Description**: PlayerEngine coordinates two physical `YT.Player` instances (Player A and Player B), toggling DOM visibility and executing JIT preloading 6 seconds before channel transition. Currently, there are no mock tests for `playerEngine.js`, leaving event handling, timing intervals, and player destruction untested.
- **Reliability Impact**: Unverified edge cases in player state transitions (e.g. rapid video skipping or unplayable preloaded video error handling) can cause dual-audio bleeds, paused players remaining frozen, or memory leaks on long-running kiosks.
- **Remediation**: Build a mock YouTube iFrame API test fixture to simulate player readiness, error codes, state changes, and A/B container focus toggling.

---

### 2. Error Handling Resilience & Error Boundaries

---

#### [CRITICAL] Finding ERR-01: Missing Global Error Traps & Late Watchdog Initialization
- **Exact Location**: `src/main.js:8-119`, `src/watchdog.js:25-39`
- **Description**: `bootstrapApp()` in `src/main.js` is an asynchronous entry point without a top-level `try/catch` block. The application does not register `window.addEventListener('error')` or `window.addEventListener('unhandledrejection')`. Furthermore, `startWatchdog()` in `src/main.js:97` is only called *after* catalog loading, DOM rendering, and YouTube API initialization succeed.
- **Reliability Impact**: If any uncaught runtime error occurs during startup (e.g. temporary network offline, DOM element mismatch, or script parse failure), the application halts immediately. Because the watchdog was never started, the browser never attempts a reload or recovery, leaving a black or frozen projector screen for the entire day.
- **Remediation**:
  1. Start `startWatchdog()` immediately as the very first operation upon script evaluation.
  2. Install global `window.onerror` and `window.onunhandledrejection` handlers.
  3. Display a user-friendly retro CRT signal-recovery overlay ("SIGNAL LOST • AUTO-RETRYING...") when catastrophic errors occur, with automated backoff retry.

**Concrete Remediation Snippet (`src/main.js`):**
```javascript
import { startWatchdog } from './watchdog.js';
import { catalogManager } from './catalogManager.js';
import { playerEngine } from './playerEngine.js';
import { effectsEngine } from './effectsEngine.js';
import { adminController } from './admin.js';
import { subscribeChannelConfig } from './firebase.js';

// 1. EARLY WATCHDOG INITIALIZATION: Protect kiosk from startup stalls
startWatchdog();

// 2. GLOBAL ERROR & PROMISE REJECTION TRAPS
window.addEventListener('error', (event) => {
  console.error("Global uncaught error trapped:", event.error || event.message);
  displayEmergencyRecoveryUI("SYSTEM ERROR", "SIGNAL INTERRUPTED • AUTO-RECOVERING");
});

window.addEventListener('unhandledrejection', (event) => {
  console.error("Unhandled Promise rejection trapped:", event.reason);
  displayEmergencyRecoveryUI("NETWORK FAULT", "STREAM BUFFER LOST • RETRYING CONNECTION");
});

function displayEmergencyRecoveryUI(title, message) {
  const catLabel = document.getElementById('osd-category-label');
  const channelLabel = document.getElementById('osd-channel-label');
  if (catLabel) catLabel.textContent = message;
  if (channelLabel) channelLabel.textContent = `CH -- • ${title}`;
}

async function bootstrapApp() {
  try {
    console.log("Initializing BNSD TV...");
    catalogManager.clearDeadVideoFlags();
    effectsEngine.init();

    // Parse URL params & setup admin...
    const urlParams = new URLSearchParams(window.location.search);
    const channelParam = urlParams.get('channel') || 'projector-bar';
    // ...
    const isLoaded = await catalogManager.loadCSV('/bnsd_tv_playlist.csv');
    if (!isLoaded) {
      throw new Error("Failed to load catalog dataset.");
    }
    // ...
  } catch (err) {
    console.error("Fatal startup error in bootstrapApp:", err);
    displayEmergencyRecoveryUI("STARTUP FAILED", "ATTEMPTING AUTO-RELOAD IN 10S...");
    setTimeout(() => window.location.reload(), 10000);
  }
}
```

---

#### [HIGH] Finding ERR-02: Fatal Unhandled Startup Stall on Catalog Load / Fetch Failure
- **Exact Location**: `src/main.js:42-46`, `src/catalogManager.js:96-110`
- **Description**: In `src/catalogManager.js:103-105`:
  ```javascript
  const response = await fetch(csvUrlOrPath + '?v=' + Date.now());
  const csvText = await response.text();
  return this.parseCSVText(csvText);
  ```
  If `BNSD_TV_CATALOG` is falsy and `fetch` runs, `response.ok` is not checked. If the network returns 404 or 500, `response.text()` parses the HTML error page into invalid video objects. If `fetch` throws a network exception, `loadCSV` catches it, logs to console, and returns `false`. `main.js:45` then executes `return`, terminating bootstrap silently without fallback or retry.
- **Reliability Impact**: A momentary network dropout during morning projector boot halts execution permanently.
- **Remediation**: Check `response.ok`, provide a hardcoded emergency offline backup playlist (10–20 guaranteed retro streams), and retry the fetch with exponential backoff before failing.

**Concrete Remediation Snippet (`src/catalogManager.js`):**
```javascript
  async loadCSV(csvUrlOrPath = '/bnsd_tv_playlist.csv') {
    try {
      const catalog = BNSD_TV_CATALOG || DEFAULT_90S_CATALOG;
      if (catalog && (Array.isArray(catalog) || Array.isArray(catalog.streams))) {
        this.ingestArrayData(catalog);
        return true;
      }
      
      const response = await fetch(csvUrlOrPath + '?v=' + Date.now());
      if (!response.ok) {
        throw new Error(`HTTP error fetching catalog: status ${response.status}`);
      }
      const csvText = await response.text();
      return this.parseCSVText(csvText);
    } catch (err) {
      console.error("Failed to load catalog via primary path, activating emergency catalog:", err);
      // Ingest fallback catalog to prevent kiosk death
      if (EMERGENCY_FALLBACK_STREAMS) {
        this.ingestArrayData(EMERGENCY_FALLBACK_STREAMS);
        return true;
      }
      return false;
    }
  }
```

---

#### [HIGH] Finding ERR-03: Unguarded `localStorage` Writes Crashing Restricted WebViews
- **Exact Location**: `src/firebase.js:46, 78`, `src/admin.js:135, 143`, `src/main.js:27-28`
- **Description**: Direct calls to `localStorage.setItem` and `localStorage.getItem` exist throughout `firebase.js`, `admin.js`, and `main.js` without `try/catch` protection. When running inside restricted Android WebView environments, private browsing tabs, or when storage quotas are exceeded, `localStorage.setItem` throws `DOMException: QuotaExceededError` or `SecurityError`.
- **Reliability Impact**: Modifying admin settings or receiving Firestore synchronization updates crashes the script synchronously on restricted devices.
- **Remediation**: Implement a safe storage abstraction layer with an in-memory fallback.

**Concrete Remediation Snippet (`src/utils/safeStorage.js`):**
```javascript
class SafeStorage {
  constructor() {
    this.memoryMap = new Map();
  }

  getItem(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch (e) {
      console.warn(`safeStorage: getItem failed for ${key}, falling back to memory:`, e);
    }
    return this.memoryMap.get(key) || null;
  }

  setItem(key, value) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`safeStorage: setItem failed for ${key}, storing in memory:`, e);
    }
    this.memoryMap.set(key, String(value));
  }

  removeItem(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn(`safeStorage: removeItem failed for ${key}:`, e);
    }
    this.memoryMap.delete(key);
  }
}

export const safeStorage = new SafeStorage();
```

---

#### [HIGH] Finding ERR-04: Missing YouTube API Script Failure Handling & Constructor Guard
- **Exact Location**: `src/playerEngine.js:69-77`, `src/playerEngine.js:80-102`, `src/playerEngine.js:146-174`
- **Description**: `playerEngine.init()` creates a `<script>` tag for `https://www.youtube.com/iframe_api` without an `onerror` handler. If the YouTube API fails to load due to DNS filtering, ad-blockers, or connectivity loss, the 400ms fallback timeout in `createPlayers()` executes `new window.YT.Player()`. Because `window.YT` is undefined, this throws an unhandled `TypeError: Cannot read properties of undefined (reading 'Player')`.
- **Reliability Impact**: Complete application failure when YouTube domain connectivity is delayed or blocked.
- **Remediation**: Add `script.onerror`, verify `window.YT?.Player` existence before calling constructor, and implement an exponential retry loop with on-screen OSD status feedback ("CONNECTING TO YOUTUBE API...").

---

#### [MEDIUM] Finding ERR-05: Infinite Error Loop & CPU Spike When Queue Videos are Quarantined
- **Exact Location**: `src/playerEngine.js:286-301` (`findNextLiveIndex`), `src/playerEngine.js:525-564` (`handlePlayerError`)
- **Description**: In `findNextLiveIndex()`, if all videos in the queue have been marked dead, it prints a console warning and returns `startIndex`. When `playerEngine` attempts to play that video, YouTube fires `onError`, triggering `handlePlayerError`, which immediately calls `nextVideo()`. `nextVideo()` invokes `findNextLiveIndex()`, which returns the same dead index again, creating an infinite synchronous loop.
- **Reliability Impact**: Severe browser tab freeze, 100% CPU lockup, and overheating of projector hardware.
- **Remediation**: Add a circuit breaker in `handlePlayerError`: if error frequency exceeds 5 errors in 10 seconds, pause playback, reset dead video flags, display an OSD alert ("AUTO-RECOVERING CHANNELS..."), and apply a 10-second backoff delay.

---

#### [LOW] Finding ERR-06: Missing Error Messaging & Fallback UI in Admin Control Center
- **Exact Location**: `src/admin.js:220-244`, `src/admin.js:268-280`
- **Description**: The Admin Control Center relies on modal browser `alert()` and `confirm()` dialogs for CSV ingestion and dead video resets. If a user pastes an invalid YouTube URL into the direct video tester or selects a non-CSV file, errors fail silently or trigger modal freezes.
- **Reliability Impact**: Suboptimal operator experience and potential disruption to background video playback while modal dialogs pause the event loop.
- **Remediation**: Replace blocking `alert()`/`confirm()` with non-blocking retro CRT toast banners.

---

### 3. Static Quality & Validation Setups

---

#### [HIGH] Finding TYP-01: 0% Type Safety, Missing `tsconfig.json`, and Implicit Type Hazards
- **Exact Location**: Entire Repository (`src/*.js`, `scripts/build-catalog.js`)
- **Description**: The codebase is written entirely in untyped JavaScript without TypeScript or JSDoc type checking. Critical data structures (such as video items, channel configs, pacing modes, and telemetry packets) have no formal contracts. Examples of implicit type hazards:
  - `item.year`: string in CSV records (`"1995"`), integer in bundled arrays (`1995`).
  - `startSec` / `endSec`: `parseInt(row.start_seconds) || 0` (evaluates to 0 on non-numeric strings, but unchecked in bundled array paths).
  - Pacing mode strings (`'channel-surfer'`, `'balanced'`, `'deep-cuts'`) lack string union typing, risking silent fallback to defaults on typos.
- **Reliability Impact**: Unchecked type coercion leads to subtle runtime bugs, missing properties on video items, and broken comparisons.
- **Remediation**: Introduce a strict `tsconfig.json` enabling `checkJs: true` and `allowJs: true` (or convert source files to `.ts`), and define core domain type declarations in `src/types/index.ts`.

**Concrete Remediation Snippet (`tsconfig.json`):**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "moduleResolution": "Node",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": true
  },
  "include": ["src", "scripts", "tests"]
}
```

**Domain Type Definitions (`src/types/index.ts`):**
```typescript
export type Decade = '1980s' | '1990s' | '2000s';

export type Category = 
  | 'Cartoons'
  | 'Comedy'
  | 'Commercials'
  | 'Drama'
  | 'Gameshows'
  | 'Kids'
  | 'Movies'
  | 'Music'
  | 'Other'
  | 'Soaps'
  | 'Specials'
  | 'Sports'
  | 'Talkshows'
  | 'Trailers';

export type PacingMode = 'channel-surfer' | 'balanced' | 'deep-cuts';
export type SurfingSessionType = 'browse_flurry' | 'curious_glance' | 'settle_in';
export type OsdMode = 'crt-header' | 'vcr-watermark' | 'full-info' | 'hidden';

export interface VideoItem {
  id: number;
  decade: Decade;
  year: string;
  category: Category;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
}

export interface ChannelConfig {
  channelId: string;
  enabledDecades: Decade[];
  enabledCategories: Category[];
  pacingMode: PacingMode;
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
  osdMode: OsdMode;
  updatedAt?: string;
}
```

---

#### [HIGH] Finding TYP-02: Missing Runtime Schema Validation for Firestore, CSV & Storage Payloads
- **Exact Location**: `src/firebase.js:57-86`, `src/catalogManager.js:204-258`, `src/admin.js:460-491`
- **Description**: External data entering BNSD TV from Firestore snapshots, LocalStorage caches, and CSV uploads is consumed without schema validation.
  - In `src/admin.js:460-461`: `this.commercialMaxSec = parseInt(commInput.value, 10) || 30;` allows negative integers (e.g. `-100`), resulting in negative video clip durations and continuous skipping.
  - In `src/firebase.js:57-75`: Corrupted or malicious Firestore payload documents (e.g. `{ commercialMaxSec: "invalid", enabledCategories: 123 }`) will corrupt the `adminController` state and break channel queue generation across all synchronized projectors.
- **Reliability Impact**: Malformed Firestore documents or invalid CSV uploads can brick all connected restaurant projectors simultaneously.
- **Remediation**: Implement runtime validation guards (or Zod schemas) for all external data inputs.

**Concrete Remediation Snippet (`src/utils/schemaValidator.js`):**
```javascript
export function validateChannelConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const validDecades = new Set(['1980s', '1990s', '2000s']);
  const validPacing = new Set(['channel-surfer', 'balanced', 'deep-cuts']);
  const validOsd = new Set(['crt-header', 'vcr-watermark', 'full-info', 'hidden']);

  return {
    channelId: typeof raw.channelId === 'string' ? raw.channelId : 'projector-bar',
    enabledDecades: Array.isArray(raw.enabledDecades) 
      ? raw.enabledDecades.filter(d => validDecades.has(d)) 
      : ['1980s', '1990s', '2000s'],
    enabledCategories: Array.isArray(raw.enabledCategories) 
      ? raw.enabledCategories.filter(c => typeof c === 'string') 
      : [],
    pacingMode: validPacing.has(raw.pacingMode) ? raw.pacingMode : 'channel-surfer',
    zapBurstEnabled: typeof raw.zapBurstEnabled === 'boolean' ? raw.zapBurstEnabled : true,
    commercialMaxSec: Math.max(10, Math.min(180, parseInt(raw.commercialMaxSec, 10) || 30)),
    generalClipMaxSec: Math.max(15, Math.min(600, parseInt(raw.generalClipMaxSec, 10) || 60)),
    randomOffsetEnabled: typeof raw.randomOffsetEnabled === 'boolean' ? raw.randomOffsetEnabled : true,
    contrast: Math.max(40, Math.min(120, parseInt(raw.contrast, 10) || 75)),
    brightness: Math.max(80, Math.min(150, parseInt(raw.brightness, 10) || 110)),
    opacity: Math.max(30, Math.min(100, parseInt(raw.opacity, 10) || 90)),
    scanlinesEnabled: typeof raw.scanlinesEnabled === 'boolean' ? raw.scanlinesEnabled : true,
    staticFXEnabled: typeof raw.staticFXEnabled === 'boolean' ? raw.staticFXEnabled : true,
    washoutEnabled: typeof raw.washoutEnabled === 'boolean' ? raw.washoutEnabled : true,
    osdMode: validOsd.has(raw.osdMode) ? raw.osdMode : 'crt-header'
  };
}
```

---

#### [MEDIUM] Finding TYP-03: Missing ESLint and Prettier Automated Enforcement
- **Exact Location**: Root configuration files
- **Description**: The project has no linter or code formatter configurations (`eslint.config.js`, `.prettierrc`). Inconsistent formatting, unused imports, undeclared globals, and accidental syntax errors can easily enter the codebase.
- **Reliability Impact**: Code drift, hard-to-debug runtime syntax errors, and inconsistent team development.
- **Remediation**: Add standard ESLint 9+ flat configuration (`eslint.config.js`) and `.prettierrc` with an automated `npm run lint` script.

**Concrete Remediation Snippet (`eslint.config.js`):**
```javascript
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        Uint32Array: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-undef': 'error'
    }
  }
];
```

---

## Action Plan & Remediation Roadmap

```
+-------------------------------------------------------------------------------+
| PHASE 1: Critical Reliability & Error Trapping (Immediate / High Urgency)     |
+-------------------------------------------------------------------------------+
  1. Move `startWatchdog()` to top-level script evaluation in `main.js`.
  2. Install global `window.onerror` and `window.onunhandledrejection` handlers.
  3. Create `safeStorage.js` abstraction and replace all direct `localStorage` calls.
  4. Implement Circuit Breaker in `playerEngine.handlePlayerError` to prevent infinite loops.

+-------------------------------------------------------------------------------+
| PHASE 2: Test Suite & Infrastructure Setup                                    |
+-------------------------------------------------------------------------------+
  1. Install Vitest, jsdom, and `@testing-library/dom`.
  2. Create `vitest.config.js` and add `"test": "vitest run"` script.
  3. Add unit test suites for `catalogManager` (shuffle, anti-clustering, quarantine).
  4. Add unit test suites for `buildCatalog` (permutation cipher, row parsing).
  5. Add playerEngine double-buffering state transition tests.
  6. Create `.github/workflows/ci.yml` for automated CI test execution.

+-------------------------------------------------------------------------------+
| PHASE 3: Static Quality, Typing & Runtime Validation                          |
+-------------------------------------------------------------------------------+
  1. Add `tsconfig.json` with strict type checking enabled (`checkJs: true`).
  2. Define domain type definitions in `src/types/index.ts`.
  3. Add runtime schema validation guard (`validateChannelConfig`) for Firestore/CSV.
  4. Install and configure ESLint flat config (`eslint.config.js`) and Prettier.
```
