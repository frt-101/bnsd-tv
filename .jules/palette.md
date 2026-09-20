## 2026-09-20 - Control Center Dialog Accessibility & Focus States
**Learning:** Modal overlay elements and custom tab lists in SPA admin interfaces require explicit ARIA roles (`role="dialog"`, `aria-modal="true"`, `role="tablist"`, `role="tab"`) alongside dynamic `aria-selected` attribute updates and distinct `:focus-visible` styling to ensure screen reader and keyboard accessibility.
**Action:** Always pair visual tab switching with `aria-selected` attribute updates and `:focus-visible` outlines on interactive tab and close elements.
