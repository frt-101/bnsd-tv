# Palette's Journal - Critical UX & Accessibility Learnings

## 2026-09-16 - Control Center Modal Keyboard & Screen Reader Accessibility
**Learning:** Full-screen overlay modals in TV / Kiosk hybrid web apps often omit standard accessibility dialog roles (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`) and standard dismissal shortcuts (`Escape` key press, clicking backdrop). Adding clear ARIA attributes along with keyboard/backdrop dismissal handlers ensures both screen readers and keyboard users can navigate and exit configuration drawers seamlessly without breaking unattended kiosk flows.
**Action:** Always verify `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-label` for close controls, `:focus-visible` ring indicators, and `Escape` keyboard dismissal whenever adding or enhancing modal/drawer components.
