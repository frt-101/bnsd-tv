# Palette's Journal - UX & Accessibility Learnings

## 2025-02-20 - Control Center ARIA Modal & Catalog Ingestion Robustness
**Learning:** For modal dialogs overlaying full-screen video players (such as double-buffered iframe TV streamers), standard keyboard dismissal via the Escape key and ARIA roles (`role="dialog"`, `role="tablist"`, `aria-selected`) are essential so screen reader and keyboard users can navigate and exit the modal reliably without pointer events getting intercepted by underlying player shields.
**Action:** Always ensure modal overlays have `role="dialog"`, `aria-modal="true"`, explicit `aria-label` for icon close buttons, dynamic `aria-selected` toggling on tabs, and an Escape key `keydown` listener.
