# Security Assessment Handoff Report

**Agent:** Security Explorer (`explorer_security_1`)  
**Timestamp:** 2026-08-20T20:25:30-07:00  
**Target Codebase:** `/Users/fraser/antigravity/bnsd-tv`  
**Deliverable File:** `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_security_1/analysis.md`  

---

## 1. Observation

Direct observations from source inspection and execution in the codebase:

1. **`firestore.rules:13-20`**:
   ```firestore
   match /channels/{channelId} {
     allow read: if true;
     allow write: if false;
   }
   match /{document=**} {
     allow read, write: if false;
   }
   ```
   Writes are denied by default (`allow write: if false`), while `src/firebase.js:52` calls `setDoc(channelRef, payload, { merge: true })`. `docs/ANDROID_PROJECTOR_SETUP.md:104-105` instructs developers: *"Loosen the rule to request.auth != null only once real auth is wired up."*
2. **`index.html:78-304` & `src/main.js:24,51-54` & `src/admin.js:28-29,87-99`**:
   The entire Control Center modal is rendered in the public DOM and can be opened without credentials by navigating to `/?admin=true` or pressing `'A'`. `src/admin.js:28` attaches `window.adminController = this`.
3. **`firebase.json:12-30`**:
   The hosting configuration defines `Cache-Control`, `Pragma`, and `Expires`, but lacks `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.
4. **`src/catalogManager.js:79-91`**:
   `exportDeadVideosCSV()` concatenates unvalidated string values into a downloadable CSV (`csv += `"${id}","${new Date().toISOString()}"\n``) without sanitizing spreadsheet formula prefix characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
5. **`src/main.js:57-75`**:
   `subscribeChannelConfig` receives data from Firestore / LocalStorage and mutates runtime state (`commercialMaxSec`, `generalClipMaxSec`, `pacingMode`, etc.) without type checking or bounds validation.
6. **`src/firebase.js:8-15` & `docs/ANDROID_PROJECTOR_SETUP.md:101`**:
   Placeholder Firebase API keys are hardcoded in source code, and documentation directs developers to commit real keys to `src/firebase.js`. No `.env.example` exists.
7. **`package.json:12-18`**:
   Dependencies are `firebase: ^10.12.5`, `papaparse: ^5.4.1`, and `vite: ^5.4.0`. `npm run build` succeeds generating a 4MB single bundle.

---

## 2. Logic Chain

1. **Firestore Vulnerability (SEC-01):**
   - *Premise:* Remote multi-projector sync requires client writes to `/channels/{channelId}`.
   - *Observation:* `firestore.rules` currently blocks all writes (`allow write: if false`).
   - *Documentation Guidance:* The documented upgrade path instructs loosening to `request.auth != null`.
   - *Inference:* Changing the rule to `request.auth != null` without role/email verification and without schema validation creates a critical vulnerability where any authenticated user can overwrite, corrupt, or flood channel configs across all venue projectors.

2. **Admin Panel Exposure (SEC-02):**
   - *Premise:* The Control Center allows changing video playback, injecting YouTube URLs, clearing quarantined dead video flags, and re-uploading catalogs.
   - *Observation:* Access is governed solely by `?admin=true` URL param and keyboard `'A'` press. No auth check or password exists.
   - *Inference:* Anyone with network access to the web page can disrupt venue projections.

3. **Missing HTTP Security Headers (SEC-03):**
   - *Premise:* The application loads external scripts and fonts, embeds YouTube iframes, and connects to Firebase backends.
   - *Observation:* `firebase.json` lacks CSP, framing restrictions, and MIME-sniffing protections.
   - *Inference:* The absence of defense-in-depth headers leaves the app vulnerable to clickjacking, unauthorized script execution, and resource tampering.

4. **CSV Injection (SEC-04):**
   - *Premise:* Spreadsheets execute cells starting with formula symbols (`=`, `+`, `-`, `@`).
   - *Observation:* Video IDs from test inputs or custom CSVs are written raw into the exported dead video CSV.
   - *Inference:* Formula elements will execute upon opening the exported CSV in Excel/Google Sheets.

5. **Remote Config State Corruption (SEC-05):**
   - *Premise:* `playerEngine.startClipTimer` relies on positive numbers for `activeCutoffSec`.
   - *Observation:* Remote config data is assigned directly without type or range checks.
   - *Inference:* Corrupted or negative values cause infinite channel-skip loops that lock up kiosk browsers.

---

## 3. Caveats

- **Firebase Backend Live State:** Real Firebase Cloud Firestore credentials and rules were evaluated based on the local configuration (`firestore.rules`, `firebase.json`, `src/firebase.js`) and documentation, since the repository currently runs in local-storage-only template mode.
- **YouTube IFrame API Internal Policies:** YouTube API's internal rate limiting and embed permission handling (error codes 101/150) were evaluated from client SDK contracts.

---

## 4. Conclusion

The BNSD TV application is secure for standalone, air-gapped offline kiosk playback, but contains critical architectural vulnerabilities if deployed to production multi-projector sync without hardening:
1. **Firestore Rules** require role verification (`isAuthorizedAdmin()`), channel ID whitelisting, and strict schema validation.
2. **Admin Control Center** requires authentication before rendering or handling inputs.
3. **HTTP Security Headers & CSP** must be added to `firebase.json`.
4. **Input Sanitization** must be implemented for CSV export, CSV upload, and remote config ingestion.

All detailed findings, scorecards, exploit scenarios, and ready-to-apply diffs are documented in `/Users/fraser/antigravity/bnsd-tv/.agents/explorer_security_1/analysis.md`.

---

## 5. Verification Method

To independently verify all observations and conclusions:

1. **Verify Firestore Rules:**
   - Inspect `firestore.rules:1-23` and `src/firebase.js:48-56`.
   - Run Firestore rules emulator test or check syntax:
     ```bash
     npx -y firebase-tools@latest emulators:exec --only firestore "echo 'Rules syntax valid'"
     ```
2. **Verify Admin Accessibility:**
   - Run `npm run dev` and open `http://localhost:5173/?admin=true`.
   - Observe that the Control Center modal opens immediately with full controls active.
3. **Verify Build & Asset Bundling:**
   - Run `npm run build` and check `dist/firebase.json` headers in `firebase.json`.
4. **Verify CSV Injection Vector:**
   - Inspect `src/catalogManager.js:79-91`.
