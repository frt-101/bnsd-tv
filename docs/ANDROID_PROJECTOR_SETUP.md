# BNSD TV — Android Projector & Kiosk Setup Guide (FreeKiosk)

This guide explains how to configure your Android-powered projectors to automatically stream **BNSD TV** on power-up with zero manual interaction, using [FreeKiosk](https://github.com/RushB-fr/freekiosk) — a free, open-source Android kiosk-mode app.

---

## 1. Required Android App
Install **FreeKiosk** from the Google Play Store (`com.freekiosk`) or by sideloading a release APK from the [GitHub releases page](https://github.com/RushB-fr/freekiosk/releases).

---

## 2. FreeKiosk Configuration

### Step A: Set Mode & Start URL
1. Open FreeKiosk on the projector and set the display **Mode** to **WebView**.
2. Set the **Start URL** to your deployed BNSD TV URL with the projector's channel identifier:
   - For Bar Projector: `https://bnsd-tv.web.app/?channel=projector-bar`
   - For Dining Projector: `https://bnsd-tv.web.app/?channel=projector-dining`
   - For Lounge Projector: `https://bnsd-tv.web.app/?channel=projector-lounge`

---

### Step B: Autoplay
BNSD TV's video is muted end-to-end (URL param, JS `.mute()` call, and the
iframe's `allow="autoplay"` permission), which is the one universal exception
Chromium-based WebViews (what FreeKiosk, like virtually every Android kiosk
browser, is built on) make to their autoplay-blocking policy — so this should
just work with no configuration. If a video ever needs a manual tap to start,
look for a media/autoplay/user-gesture toggle in FreeKiosk's WebView settings
(not documented in FreeKiosk's public docs as of this writing). As a second
layer of defense, the app itself now retries via the YouTube Player API's
`playVideo()` call if a video hasn't actually started ~2 seconds after
loading — see Section 5.

---

### Step C: Auto-Start on Boot & Lockdown
1. Enable **Auto-start on boot**.
2. Enable **immersive fullscreen / kiosk lockdown** (hides the Android nav
   and status bars so nothing but the projected video is ever visible).
3. Optionally enable **Device Owner mode** for full lockdown and set a PIN
   on FreeKiosk's own settings, so nobody can back out of kiosk mode from
   the touchscreen (there's no touchscreen anyway on a wall projection, but
   it also protects against an accidental settings change if a laptop/mouse
   is ever plugged in for maintenance).
4. Confirm FreeKiosk's built-in **Watchdog Service** is enabled — it
   auto-relaunches FreeKiosk if the OS kills it under memory pressure. This
   is separate from (and complements) BNSD TV's own in-page watchdog in
   Section 5, which catches a frozen player without the app itself crashing.

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
| FreeKiosk Auto-Launches   | -> Loads URL: https://bnsd-tv.web.app/?channel=projector-bar
+-------------+-------------+
              |
              v
+---------------------------+
|  BNSD TV Starts Stream    | -> Dual-iFrame double-buffered video stream begins automatically!
+---------------------------+
```

**Note:** this is currently the *only* thing that stops BNSD TV from
streaming — the app itself has no concept of open/closed hours and will
loop the catalog forever as long as it's running. That's a non-issue if the
schedule above fully powers the Android device off, but if FreeKiosk/the
projector ever only blanks the screen while the device keeps running in the
background, the app would keep streaming unseen. See
[`BUSINESS_HOURS_SYNC.md`](./BUSINESS_HOURS_SYNC.md) for a planned (not yet
built) fix that syncs real open/closed state from Square via REBA's
Firestore data instead of relying solely on the power schedule.

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

## 5. In-App Reliability Watchdog

Since this runs unattended for an entire business day, `src/watchdog.js`
adds two self-healing behaviors on top of FreeKiosk's own process-level
watchdog (Section 2, Step C):
- **Stall detection:** if no channel change has happened in 5 minutes — far
  longer than any configured clip cutoff — the player is assumed wedged
  (frozen embed, dead event loop, etc.) and the page does a full reload.
- **Preventive reload:** the page reloads itself every 6 hours regardless,
  as cheap insurance against slow memory/state buildup in a long-lived
  WebView tab.

Both just call `window.location.reload()`, which re-runs the same boot flow
in Section 3 — no manual intervention needed either way.

## 6. Daily Quarantine Reset

Videos that error during playback (deleted, region-locked, etc.) are
automatically skipped and flagged "dead" for the rest of that session. That
flag list is cleared on every fresh page load, so the overnight power-off /
morning relaunch cycle above also doubles as a daily reset — a video that
failed once due to a transient YouTube hiccup gets retried the next day
instead of being permanently blacklisted.

## 7. Updating the Curated Video Catalog

The catalog is a single source of truth: **`bnsd_tv_playlist.csv`** (BNSD TV PLAYLIST) at the repo
root. To change what plays:
1. Edit `bnsd_tv_playlist.csv` (columns: `decade,year,channel,video_id,title,start_seconds,end_seconds`).
2. Run `npm run build-catalog` — this regenerates `src/catalogData.js` (the
   bundled catalog the app actually loads) and syncs `public/bnsd_tv_playlist.csv`.
3. Commit both the CSV and the regenerated files together, then redeploy.

Don't hand-edit `src/catalogData.js` or `public/bnsd_tv_playlist.csv` directly —
they're generated output and will be overwritten next time the script runs.
