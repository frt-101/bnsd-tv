## 2025-05-18 - Control Center Modal & Tab ARIA Pattern
**Learning:** Modal dialogs and tabbed navigation interfaces in retro/kiosk overlays need semantic ARIA roles (`role="dialog"`, `role="tablist"`, `role="tab"`, `role="tabpanel"`) and state attributes (`aria-selected`, `aria-controls`, `aria-labelledby`) so assistive technologies can navigate them seamlessly.
**Action:** Always complement visual tab switching with dynamic `aria-selected` toggles in event listeners.
