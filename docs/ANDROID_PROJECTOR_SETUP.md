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
- Toggle categories, adjust clip pacing, or change wall washout projection contrast live; all connected projectors update instantly via Firebase Firestore sync.
