# BNSD TV — Google Android Projector & Kiosk Setup Guide

This guide explains how to configure your Google Android-powered projectors to automatically stream **BNSD TV** on power-up with zero manual interaction.

---

## 1. Required Android App
We recommend using **Fully Kiosk Browser & Launcher** (available on Google Play Store or APK direct download).

---

## 2. Fully Kiosk Browser Configuration

### Step A: Set Start URL
1. Open Fully Kiosk Browser settings on the projector.
2. Go to **Web Browsing** -> **Start URL**.
3. Enter your deployed BNSD TV URL with the projector's channel identifier:
   - For Bar Projector: `https://bnsd-tv.web.app/?channel=projector-bar`
   - For Dining Projector: `https://bnsd-tv.web.app/?channel=projector-dining`
   - For Lounge Projector: `https://bnsd-tv.web.app/?channel=projector-lounge`

---

### Step B: Enable Zero-Gesture Autoplay
1. Go to **Web Browsing** -> **Web Features**.
2. Enable **Autoplay Media Without User Gesture** (set to `ON`).
3. Enable **Play Audio in Background** (if applicable).

---

### Step C: Auto-Start on Boot & Kiosk Mode
1. Go to **Device Management**.
2. Enable **Auto-Start on Boot** (set to `ON`).
3. Enable **Kiosk Mode** (prevents Android status bar or popups from disturbing the wall projection).

---

## 3. Daily Operation Flow

```
+---------------------------+
|  Scheduled Power Plug     | (e.g. Smart Plug turns on projector at 11:00 AM)
+-------------+-------------+
              |
              v
+---------------------------+
|  Android OS Boots         |
+-------------+-------------+
              |
              v
+---------------------------+
| Fully Kiosk Auto-Launches | -> Loads URL: https://bnsd-tv.web.app/?channel=projector-bar
+-------------+-------------+
              |
              v
+---------------------------+
|  BNSD TV Starts Stream    | -> Dual-iFrame double-buffered video stream begins automatically!
+---------------------------+
```

---

## 4. Remote Admin Controls

- Access the control dashboard on any laptop, tablet, or phone by opening:
  `https://bnsd-tv.web.app/?admin=true`
- This is the *only* way in — the projected video itself has no buttons or
  on-screen controls, since it's a wall projection with no input device.
- Toggle categories, adjust clip pacing, or change wall washout projection contrast here.

**Cross-projector sync status:** `src/firebase.js` ships with placeholder
Firebase keys, so today each projector only remembers *its own* settings
locally (in its browser storage) — changing settings on one screen does not
push to the others yet. To make `?admin=true` changes broadcast live to every
projector:
1. Create a real Firebase project and drop its config into `firebaseConfig` in `src/firebase.js`.
2. Add Firebase Authentication in front of the admin panel — it currently has
   no login of any kind, and `firestore.rules` denies all writes by default
   specifically because of that. Loosen the rule to `request.auth != null`
   only once real auth is wired up.
3. Deploy the rules: `firebase deploy --only firestore:rules`.

## 5. Daily Quarantine Reset

Videos that error during playback (deleted, region-locked, etc.) are
automatically skipped and flagged "dead" for the rest of that session. That
flag list is cleared on every fresh page load, so the overnight power-off /
morning relaunch cycle above also doubles as a daily reset — a video that
failed once due to a transient YouTube hiccup gets retried the next day
instead of being permanently blacklisted.

## 6. Updating the Curated Video Catalog

The catalog is a single source of truth: **`90s_playlist.csv`** at the repo
root. To change what plays:
1. Edit `90s_playlist.csv` (columns: `decade,year,channel,video_id,title,start_seconds,end_seconds`).
2. Run `npm run build-catalog` — this regenerates `src/catalogData.js` (the
   bundled catalog the app actually loads) and syncs `public/90s_playlist.csv`.
3. Commit both the CSV and the regenerated files together, then redeploy.

Don't hand-edit `src/catalogData.js` or `public/90s_playlist.csv` directly —
they're generated output and will be overwritten next time the script runs.
