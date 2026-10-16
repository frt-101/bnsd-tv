## 2025-05-18 - Retro OSD HUD ARIA Live Regions & Dynamic Text Contrast
**Learning:** Dynamic retro video overlays (VCR/CRT On-Screen Displays) rendered over variable-brightness media require both `aria-live="polite"` for screen reader accessibility and layered dark drop-shadows behind phosphor glows to ensure continuous text legibility across light and dark frames.
**Action:** Always pair glowing retro HUD overlays with strong dark drop-shadows (`0 2px 5px rgba(0,0,0,0.9)`) and add `aria-live="polite"` / `aria-atomic="true"` on live status overlay containers.
