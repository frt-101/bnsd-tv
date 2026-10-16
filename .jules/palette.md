## 2025-02-17 - Tabbed Modal ARIA & Keyboard Navigation Pattern
**Learning:** Custom tabbed modals require explicit `role="tablist"`, `role="tab"`, `role="tabpanel"`, and dynamic `aria-selected` attributes, as well as `Escape` key handlers and `:focus-visible` styling for proper keyboard and screen reader accessibility.
**Action:** When building or enhancing tabbed modal components, sync `aria-selected` state on click/key events and ensure all interactive elements have visible focus outlines.
