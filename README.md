# BNSD TV — Master System Documentation & Architectural Specification

> **Ambient, multi-decade retro television streamer engineered for silent architectural projection and nostalgic hospitality environments.**

---

## Table of Contents

1. [Executive Summary & Vision](#1-executive-summary--vision)
2. [Venue & Playback Environment](#2-venue--playback-environment)
3. [System Architecture & Data Flow](#3-system-architecture--data-flow)
4. [Core Engines & Functionality](#4-core-engines--functionality)
   - [Dual-iFrame Double-Buffered Playback](#41-dual-iframe-double-buffered-playback-playerenginejs)
   - [Anti-Clustering Shuffle & Broadcast Pacing](#42-anti-clustering-shuffle--broadcast-pacing-catalogmanagerjs)
   - [Smart Visual Seeking & Zap Bursts](#43-smart-visual-seeking--zap-bursts)
   - [Dead Video Quarantine & Self-Healing](#44-dead-video-quarantine--self-healing)
   - [Analog CRT & Wall Projection Effects](#45-analog-crt--wall-projection-effects-effectsenginejs)
   - [Watchdog & Long-Running Reliability](#46-watchdog--long-running-reliability-watchdogjs)
5. [Configuration, Variables & URL Parameters](#5-configuration-variables--url-parameters)
   - [URL Query Parameters](#51-url-query-parameters)
   - [Pacing & Rhythm Modes](#52-pacing--rhythm-modes)
   - [Visual & Projection Filters](#53-visual--projection-filters)
   - [Persistent Storage Keys](#54-persistent-storage-keys)
   - [Operator Keyboard Shortcuts](#55-operator-keyboard-shortcuts)
6. [Catalog Pipeline & Unscrambler](#6-catalog-pipeline--unscrambler)
7. [Admin Control Center & Multi-Projector Sync](#7-admin-control-center--multi-projector-sync)
8. [Hardware & Kiosk Deployment Guide](#8-hardware--kiosk-deployment-guide)
9. [Future Roadmap: POS & Business Hours Sync](#9-future-roadmap-pos--business-hours-sync)
10. [Repository Structure](#10-repository-structure)

---

## 1. Executive Summary & Vision

### What is BNSD TV?
**BNSD TV** is a web-based, continuous retro television broadcast simulator designed for ambient architectural wall projection across **BNSD** hospitality venues (bars, lounges, dining rooms, patios). 

It dynamically loops through a curated catalog of thousands of authentic video streams spanning the **1980s, 1990s, and 2000s** — including vintage commercials, cartoons, music videos, movie trailers, sports highlights, comedy, game shows, and retro specials.

### The Intent: Dynamic Visual Wall Art
In high-energy restaurant and bar settings, traditional TVs with sound cause acoustic conflict with the venue's curated music playlist. Conversely, static artwork remains unchanging. 

**BNSD TV serves as moving, nostalgic wall art designed strictly for silent projection:**
- **100% Muted Audio:** The stream operates entirely silent, leaving venue audio control to the house sound system.
- **Visual Action Focus:** Content is tailored for immediate visual impact. Algorithms jump past slow intros, title cards, and talking heads to land directly on choreographies, slapstick animation, and neon retro toy/cereal commercials.
- **Authentic Broadcast Vibe:** Emulates authentic late-night channel surfing on an old-school CRT TV with scanlines, curved glass vignette, white-noise static burst transitions, green HUD watermarks, and intermittent rapid "zap bursts."
- **Zero Human Intervention:** Powers on with the morning smart plug, streams reliably all day without freezing or black screens, and powers down at closing.

---

## 2. Venue & Playback Environment

| Dimension | Specification |
|---|---|
| **Hardware Platform** | Android-powered smart projectors (or Android TV / HDMI compute sticks plugged into ceiling/wall projectors). |
| **Display Surface** | Textured brick, painted drywall, or ambient venue projection surfaces. |
| **Kiosk Host Software** | [FreeKiosk](https://github.com/RushB-fr/freekiosk) (open-source Android WebView kiosk) in Device Owner / Full Immersive Lockdown mode. |
| **Power Schedule** | Smart Wi-Fi plugs timed to venue operating hours (e.g., 11:00 AM ON – 11:00 PM OFF). |
| **Input Modality** | **Headless / Zero On-Screen UI:** Projected walls have no touchscreens or mice. Control is handled remotely via `?admin=true` from an operator's phone/laptop or keyboard hotkeys. |
| **Multi-Screen Layout** | Multiple independent projector channels (`projector-bar`, `projector-dining`, `projector-lounge`, `projector-patio`), each with a unique mathematical seed to ensure screens never play the same video concurrently. |

---

## 3. System Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                              CATALOG BUILD PIPELINE                               |
|                                                                                   |
|  scripts/raw_decades.json                                                         |
|         |                                                                         |
|         v                                                                         |
|  scripts/build-catalog.js  ==>  [32-Row Permutation Unscrambler]                   |
|         |                  ==>  [Filter News & Politics]                          |
|         v                                                                         |
|  bnsd_tv_playlist.csv  &  src/catalogData.js (High-Performance Compact Tuples)    |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                             RUNTIME CLIENT BROWSER                                |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | CatalogManager (catalogManager.js)                                          |  |
|  | - Ingests compact catalog                                                   |  |
|  | - Filters by active Decades & Categories                                    |  |
|  | - Executes Anti-Clustering Shuffle & Anti-Duplicate Interleave             |  |
|  | - Manages Dead Video Quarantine Set                                         |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  | PlayerEngine (playerEngine.js)                                              |  |
|  | - Double-Buffered Dual-iFrame Architecture (#player-a & #player-b)          |  |
|  | - Smart Visual Seek (offsets past MTV logos & intros)                       |  |
|  | - Pacing Timer & Zap Burst Mode Controller                                  |  |
|  | - Autoplay Fallback & Consecutive Error Recovery                            |  |
|  +-----------------------------------------------------------------------------+  |
|                         |                                 |                       |
|                         v                                 v                       |
|  +-------------------------------+   +-----------------------------------------+  |
|  | EffectsEngine                 |   | AdminController & Watchdog              |  |
|  | - 2D HTML5 Canvas Static Noise|   | - Remote Admin Panel (?admin=true)      |  |
|  | - CRT Scanlines & Vignette    |   | - 5-min Stall & 6-hr Preventive Reload  |  |
|  | - Projector Washout Filter    |   | - Firebase Firestore / LocalStorage Sync|  |
|  +-------------------------------+   +-----------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Core Engines & Functionality

### 4.1 Dual-iFrame Double-Buffered Playback (`playerEngine.js`)
Standard embedded web players suffer from black flashes, loading spinners, and buffering delays when switching videos. BNSD TV eliminates this completely using a **double-buffering dual-iframe architecture**:

1. **Two Physical iFrames:** `#player-a` and `#player-b` overlap on the screen.
2. **Active vs Preloading State:** While Player A is actively visible and streaming to the projector, Player B loads and cues the next upcoming video muted in the background.
3. **Glitch Switch:** When the clip timer ends, `effectsEngine.triggerChannelSwitch()` overlays an analog CRT static noise burst. At the midpoint (peak static), CSS focus flips:
   ```javascript
   // Active player becomes inactive (opacity: 0, pointer-events: none)
   // Inactive player becomes active (opacity: 1, visibility: visible)
   ```
4. **Seamless Perception:** The static clears instantly onto the preloaded frame of the new video with **0ms visual delay** and no YouTube UI artifacts.

---

### 4.2 Anti-Clustering Shuffle & Broadcast Pacing (`catalogManager.js`)
Pure random shuffling often results in repetitive content (e.g., 3 cereal commercials in a row or 4 cartoons back-to-back). BNSD TV implements an **intelligent broadcast scheduler**:

- **Category Bucketing & Fisher-Yates Randomization:** Videos are grouped into decade and category pools, then randomized individually.
- **Weighted Interleaving:** Draws from available buckets using weighted random distribution while enforcing a hard rule: **the next video cannot share the category of the previous video** (`c !== lastCat`).
- **Commercial Pacing:** Commercials are strictly interleaved between entertainment segments, mimicking authentic broadcast television.

---

### 4.3 Smart Visual Seeking & Zap Bursts
To keep silent video visually engaging, the player avoids dead air and slow intros:

- **Smart Visual Seek Offsets (`randomOffsetEnabled: true`):**
  - **Music Videos (`cat === 'music'`):** Jumps `30s` to `90s` ahead to skip MTV title cards and opening dialogue, dropping directly into choreography or chorus.
  - **Cartoons (`cat === 'cartoons'`):** 25% chance of playing the iconic theme song at `0s`; 75% chance of jumping `45s` to `200s` into the middle of slapstick kinetic animation.
  - **Sports / Action (`cat === 'sports'`):** Jumps `60s` to `300s` into high-action game highlights.
  - **Commercials & Trailers:** Start at `0s` for instant hook recognition.
- **Channel Surfing Zap Bursts (`zapBurstEnabled: true`):**
  - Every 5 to 8 clips, the engine triggers a "Zap Burst" simulating a viewer rapidly clicking through channels.
  - 2 to 3 consecutive clips play for only **6 to 10 seconds each** with fast 160ms static glitch transitions before the TV settles back into standard playback.

---

### 4.4 Dead Video Quarantine & Self-Healing
If a video in the catalog is removed by YouTube, made private, or restricted from embedded playback (errors 100, 101, 150):

1. `handlePlayerError()` immediately catches the event.
2. The failing video ID is added to `catalogManager.deadVideoIds` in memory and saved to `localStorage`.
3. The dead video is stripped from the active runtime catalog so it is never cued again during that session.
4. The stream advances instantly to the next working video with **0ms delay**.
5. **Consecutive Error Protection:** If 3 consecutive errors occur (e.g., network blip), the engine automatically fast-forwards 5 live slots ahead to clear bad streaks.
6. **Daily Quarantine Reset:** On morning boot, `catalogManager.clearDeadVideoFlags()` runs, giving transient YouTube errors a clean slate.

---

### 4.5 Analog CRT & Wall Projection Effects (`effectsEngine.js` & `style.css`)
- **Procedural CRT Static Noise:** A 2D HTML5 <canvas> generates random grayscale 32-bit pixel buffers on demand during channel transitions.
- **Scanlines & Vignette:** CSS overlays render 50% opacity scanlines and a radial gradient vignette simulating curved CRT glass.
- **Washed-Out Wall Art Mode:** Real-time CSS filter matrix (`contrast(75%) brightness(110%) saturate(90%) opacity(0.9)`) prevents projected video from blinding patrons or overwhelming the ambient dining atmosphere.
- **Trinitron Red Chassis Mode (`?tv=true`):** Wraps the viewport in a retro BNSD-branded red Sony Trinitron TV chassis with stereo badges.

---

### 4.6 Watchdog & Long-Running Reliability (`watchdog.js`)
Designed to operate unattended 365 days a year:

- **Stall Watchdog:** Runs every 30 seconds. If no channel change has occurred in **5 minutes** (far exceeding any maximum clip cap), the system identifies a wedged embed/event loop and triggers `window.location.reload()`.
- **Preventive 6-Hour Reload:** Executes a clean page refresh every 6 hours to clear accumulated memory or DOM leaks in Chromium WebViews.
- **Autoplay Retry:** If a video is stuck in an unstarted/cued state 2 seconds after loading, `scheduleAutoplayFallback()` explicitly calls `.playVideo()`.

---

## 5. Configuration, Variables & URL Parameters

### 5.1 URL Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `channel` | `string` | `projector-bar` | Sets the projector identifier (`projector-bar`, `projector-dining`, `projector-lounge`, `projector-patio`). Generates distinct shuffle seeds for multi-screen setups. |
| `admin` | `boolean` | `false` | When `?admin=true`, automatically opens the Admin Control Center modal on page load. |
| `tv` / `frame` / `mode` | `string` | `false` | When set to `true`, `trinitron`, or `red`, wraps the display inside the retro BNSD Trinitron TV chassis. |

#### Example URLs:
- **Bar Projector:** `https://bnsd-tv.web.app/?channel=projector-bar`
- **Dining Projector:** `https://bnsd-tv.web.app/?channel=projector-dining`
- **Lounge Projector:** `https://bnsd-tv.web.app/?channel=projector-lounge`
- **Remote Admin Dashboard:** `https://bnsd-tv.web.app/?admin=true`
- **Themed Display Screen:** `https://bnsd-tv.web.app/?tv=true`

---

### 5.2 Pacing & Rhythm Modes

| Pacing Mode | Commercials Duration | General Clips Duration | Vibe Description |
|---|---|---|---|
| `channel-surfer` | 15–25s | 15–35s | **Fast & punchy:** Rapid visual changes, high-energy nostalgia. |
| `balanced` | 20–30s | 25–50s | **Ambient lounge:** Steady visual groove, ideal for dining rooms. |
| `deep-cuts` | 30–45s | 40–75s | **Extended play:** Longer music videos and full cartoon scenes. |

---

### 5.3 Visual & Projection Filters

| Variable | Type | Default | Range | Description |
|---|---|---|---|---|
| `contrast` | `number` | `75%` | `40% – 120%` | Softens video contrast against wall texture. |
| `brightness` | `number` | `110%` | `80% – 150%` | Adjusts luminance for ambient room lighting. |
| `opacity` | `number` | `90%` | `30% – 100%` | Master opacity overlay for projection blending. |
| `washoutEnabled` | `boolean` | `true` | `true / false` | Toggles the ambient wall projection filter. |
| `scanlinesEnabled`| `boolean` | `true` | `true / false` | Toggles retro CRT scanlines and glass curvature. |
| `staticFXEnabled` | `boolean` | `true` | `true / false` | Toggles analog white-noise static transitions. |
| `osdMode` | `string` | `crt-header` | See below | On-Screen Display watermark layout. |

#### OSD Watermark Modes (`osdMode`):
- `crt-header`: Clean retro top-left badge (`CH 03 • BNSD TV [1990s]`).
- `vcr-watermark`: Ultra-minimalist green OSD text (`BNSD TV • PLAY ►`).
- `full-info`: Full display including category and video title.
- `hidden`: Completely hides all OSD elements.

---

### 5.4 Persistent Storage Keys

| Key | Storage | Description |
|---|---|---|
| `bnsd_channel_<channelId>` | `localStorage` & Firestore | Stores active channel config (decades, categories, pacing, filter levels). |
| `bnsd_dead_video_ids` | `localStorage` | Array of quarantined video IDs flagged due to playback errors. |
| `bnsd_osd_mode` | `localStorage` | Current OSD watermark preference. |
| `bnsd_tv_frame` | `localStorage` | Boolean flag for Trinitron TV chassis display. |

---

### 5.5 Operator Keyboard Shortcuts

When testing on a laptop or with a connected keyboard (no on-screen buttons exist on wall projections):
- **`A`**: Toggle Admin Control Center modal.
- **`N`**: Skip immediately to the next video with static glitch.
- **`O`**: Toggle OSD HUD on/off.
- **`W`**: Toggle Wall Washout filter on/off.

---

## 6. Catalog Pipeline & Unscrambler

The master catalog is built and compiled from raw archive snapshots using a custom cryptographic decoding step.

```
scripts/raw_decades.json
          │
          ▼
scripts/build-catalog.js
  ├── Decodes 11-char permutation-ciphered YouTube IDs
  ├── Excludes News & Political broadcasts
  ├── Canonical CSV: bnsd_tv_playlist.csv & public/bnsd_tv_playlist.csv
  └── Bundled JS Module: src/catalogData.js
```

### Rebuilding the Catalog:
To update, re-index, or re-compile the video database:
```bash
npm run build-catalog
```

### Supported Categories:
- **Cartoons** (`c`)
- **Comedy** (`s`)
- **Commercials** (`a`)
- **Drama** (`d`)
- **Gameshows** (`g`)
- **Kids** (`k`)
- **Movies** (`e`)
- **Music** (`m`)
- **Soaps** (`z`)
- **Specials** (`p`)
- **Sports** (`r`)
- **Talkshows** (`t`)
- **Trailers** (`f`)
- *(News `n` is automatically filtered out to preserve pure entertainment/nostalgia).*

---

## 7. Admin Control Center & Multi-Projector Sync

The Admin Panel is accessible on any device via `https://bnsd-tv.web.app/?admin=true`.

### Features:
- **Projector Channels:** Switch presets, view real-time telemetry (active queue size, current video title, elapsed vs. cutoff time), and test arbitrary YouTube URLs directly.
- **Decades & Categories:** Filter content to specific eras (80s only, 90s only, 2000s only) or select/deselect individual content categories.
- **Pacing & Clip Rules:** Change pacing modes, toggle Zap Bursts, adjust commercial/clip maximum caps, and enable/disable smart visual seeking.
- **Projection & CRT Vibe:** Live sliders for contrast, brightness, opacity, scanlines, static FX, OSD mode, and TV chassis.
- **Catalog Management:** View active stream count, inspect quarantined dead videos, export dead video CSVs, clear quarantine flags, or upload replacement CSV files.

### Cross-Projector Remote Sync Setup:
`src/firebase.js` is structured for real-time multi-screen sync via Cloud Firestore.
1. Place your Firebase project configuration in `firebaseConfig` inside `src/firebase.js`.
2. Configure Firebase Authentication for the admin dashboard.
3. Update `firestore.rules` from `allow write: if false;` to `allow write: if request.auth != null;`.
4. Deploy rules: `firebase deploy --only firestore:rules`.

---

## 8. Hardware & Kiosk Deployment Guide

For full step-by-step Android projector setup, refer to [`docs/ANDROID_PROJECTOR_SETUP.md`](docs/ANDROID_PROJECTOR_SETUP.md).

### Daily Automated Operational Flow:
```
+---------------------------+
|  Scheduled Smart Plug     |  (e.g., Turns ON at 11:00 AM)
+-------------+-------------+
              │
              ▼
+---------------------------+
|  Android Projector Boots  |
+-------------+-------------+
              │
              ▼
+---------------------------+
| FreeKiosk Auto-Launches   |  -> Opens URL: https://bnsd-tv.web.app/?channel=projector-bar
+-------------+-------------+
              │
              ▼
+---------------------------+
| BNSD TV Streams All Day   |  -> Dual-iFrame double-buffered nostalgic video stream!
+---------------------------+
              │
              ▼
+---------------------------+
| Scheduled Smart Plug Off  |  (e.g., Cuts power at 11:00 PM; clears daily session state)
+---------------------------+
```

---

## 9. Future Roadmap: POS & Business Hours Sync

Refer to [`docs/BUSINESS_HOURS_SYNC.md`](docs/BUSINESS_HOURS_SYNC.md) for the planned integration with BNSD's **REBA** application and Square POS API:
- Automatically pause streams during unexpected early closures or off-schedule hours.
- Direct read-only Firestore subscription to REBA's `isOpen` status.

---

## 10. Repository Structure

```
bnsd-tv/
├── README.md                     # Master documentation & architectural specification
├── index.html                    # Root HTML layout, CRT wrappers, OSD HUD & Admin Modal
├── package.json                  # Vite build scripts & dependencies (Firebase, PapaParse)
├── firebase.json                 # Firebase Hosting & Firestore configuration
├── firestore.rules               # Cloud Firestore security rules
├── bnsd_tv_playlist.csv          # Root master CSV playlist (source of truth)
│
├── docs/                         # Operational & architectural guides
│   ├── ANDROID_PROJECTOR_SETUP.md# Complete FreeKiosk & Android projector hardware guide
│   └── BUSINESS_HOURS_SYNC.md    # Square POS & REBA business hours integration spec
│
├── scripts/                      # Build & data curation tools
│   ├── build-catalog.js          # Cipher unscrambler & multi-decade catalog generator
│   └── raw_decades.json          # Raw encrypted database archives (1980–2009)
│
├── public/                       # Static assets
│   └── bnsd_tv_playlist.csv      # Deployed CSV fallback
│
└── src/                          # Application source code
    ├── main.js                   # Application bootstrap & lifecycle coordinator
    ├── playerEngine.js           # Double-buffered YouTube iFrame engine & pacing timer
    ├── catalogManager.js         # CSV ingestion, anti-clustering shuffle, dead quarantine
    ├── catalogData.js            # High-performance compact tuple catalog bundle
    ├── effectsEngine.js          # HTML5 Canvas static noise & projection filter manager
    ├── admin.js                  # Control Center modal controller & telemetry bindings
    ├── watchdog.js               # In-app stall detector & 6-hour preventive reloader
    ├── firebase.js               # Firestore real-time channel sync & LocalStorage fallback
    └── style.css                 # CRT scanlines, vignette, Trinitron frame & admin styling
```
