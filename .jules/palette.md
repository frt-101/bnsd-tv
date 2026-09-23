## 2026-09-23 - Admin Control Center Modal & Tab Accessibility
**Learning:** Adding WAI-ARIA tablist/tab/tabpanel markup, programmatic `aria-selected` state synchronization, `Escape` key listeners, and `:focus-visible` ring indicators ensures seamless keyboard and screen reader accessibility for overlay control drawers.
**Action:** Always include complete ARIA role relationships (`aria-controls`, `aria-labelledby`, `aria-selected`) and `:focus-visible` ring styles whenever building interactive tabbed modal dialogs.
