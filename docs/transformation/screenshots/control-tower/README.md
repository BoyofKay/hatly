# Operations Command Center — before and after (responsive redesign)

Captured from the running app (production build of the dashboard + the real backend), Africa/Cairo, retina scale.

* `before/` — the layout that shipped before this work: the dense desktop dashboard shrunk onto a phone (a squeezed 8-column table, a tall shell banner, absolute durations such as "22825 min ago").
* `after/` — the final layout with three real "ready for pickup" orders waiting and automatic dispatch off:
  * `ct-360-en`, `ct-390-en`, `ct-430-en` — phones (English, LTR); `ct-390-ar` — phone, Arabic (RTL); `ct-390-en-sheet` — the assignment bottom sheet opened from an order card.
  * `ct-tablet-en` / `ct-tablet-ar` — 820 px, cards in two columns.
  * `ct-desktop-en` / `ct-desktop-ar` — 1440 px, the operational table and KPI strip.

Behaviour is asserted by `apps/dashboard/e2e/control-tower-responsive.spec.ts` (layout switch per width, no content outside the screen, touch-sized controls, Arabic RTL, a real assignment through the phone bottom sheet).
