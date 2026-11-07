# Admin and Vendor UX release — 2026-11-07

Release `20261107T223459Z-7b9dd3cbe3b3`. Commits bf9f6e7 … eeaedb6 on `feature/register-release-1`. Rollback is to `20261107T072134Z-b308f21c41d3` (R18); there is no migration.
No business rule changed. The backend additions are read-side, plus one correctness fix (dispatch alerts on ended orders).

## Audit findings (live screens, isolated stack, English and Arabic, desktop and phone)

1. **Home had numbers but no next step.**
   - KPIs and charts only.
   - The red attention banner listed problems as plain text, with no link to any of them.
2. **Alerts for orders that no longer exist.**
   - A cancelled order kept its "no eligible driver" alert open forever, so 234 such alerts sat in "Needs attention".
   - That inflated the banner, the Control Tower and the navigation badge.
3. **Transfer review showed internal ids.**
   - It showed `#81e91405` instead of `HT-…` and the raw word `MANUAL_TRANSFER`.
   - It showed no customer or total, so the reviewer had to open the order to match the customer's WhatsApp message.
4. **Recording a refund required typing an internal payment id (UUID).** No admin could know it without database access.
5. **Payment state was buried.** It sat as small grey text under the total, for example "manual transfer · under review", and transfers waiting for review had no queue of their own.
6. **Work hidden behind tabs.** Nothing showed that transfers or refunds were waiting until each page was opened.
7. **Drivers page.** Every card repeated three full editors (commission, capacity, vehicle). With 200 drivers the page was over 5,000 px tall.
8. **Vendor board.**
   - Cards showed internal ids (`Order #1a2b3c4d`), not the HT number the customer and Hatly use.
   - There was no waiting time.
   - Newest orders were first, so the longest-waiting order was buried.
   - All orders were in one endless page (60,000 px with a backlog).
   - A shared `?order=` link was lost in development mode.
9. **Payments page.** It showed raw codes (`MANUAL_TRANSFER`, `CUSTOMER_CLAIMED_TRANSFER`).
10. **Catalog.** A missing image showed the browser's broken-image icon.

## What changed

**Admin Home — "Needs your action now".**
- One tile per queue: need a driver, store not accepted, preparation late, driver problems, failed deliveries, new orders, ready for pickup, transfers to verify, refunds to send, product requests, store requests.
- Each tile shows a count and opens the exact filtered list in one click.
- Queues with nothing waiting are listed in one line as "All clear".
- Each tile shows only to admins with the matching permission.

**Attention banner.** Every line links to the queue that resolves it. Transfers waiting for verification are now included.

**Section tabs.** "Manual Transfer" and "Refunds" show a red count when something is waiting.

**Orders.**
- New Payment column, in words with a colour: Paid, Transfer to verify, Transfer rejected, Collect on delivery, Awaiting transfer.
- New view "Transfer to verify", with its count.
- New orders not accepted within the alert time show their age in red.

**Manual transfer review.**
- Each card shows the HT number (it opens the order), the customer name and a tappable phone, the method in words, the order total, and how long ago the customer said they paid.
- The Approve confirmation repeats the amount, customer and order number.

**Refund by order number.**
- Type `HT-…` and press Find. The page shows the paid amount and what was already refunded, and pre-fills the remaining amount.
- Record is disabled until a paid transfer is found.
- The confirmation names the order.

**Payments.** Method and status are shown in words, with a direct link to transfer verification.

**Drivers.**
- Compact cards: status, vehicle and commission in one line.
- "Edit settings" opens the editors in place.
- A single search result opens its editors automatically.

**Catalog.** A missing image shows an empty tile instead of a broken icon.

**Vendor board.**
- HT numbers on cards and in the order drawer and order page.
- "Waiting N min / h / days" on new orders, red after 5 minutes, with "please accept or reject".
- Oldest first in "Waiting for you"; earliest ready time first in the other columns.
- Each column scrolls on its own.
- `?order=` links survive.

**Backend.**
- An order that is cancelled, delivered or collected closes its open dispatch alerts.
- Open alerts of ended orders are never counted or listed.
- The transfer list includes order number, status, total and customer.
- New `GET /admin/manual-transfer-payments/by-order/:orderNumber` (VERIFY_MANUAL_PAYMENTS).
- The operations facts include `transfersToVerify`.

## Fewer steps (typical tasks)

| Task | Before | After |
|---|---|---|
| Find what needs doing | Open Orders, Control Tower, Manual Transfer, Product Requests and Store Requests one by one (5+ pages) | Home shows all of it; 1 click to the list |
| Act on a banner problem | Read the banner → Control Tower → find the right list (3) | Click the banner line (1) |
| Verify a transfer | Open the card → open the order to see who and how much → back → approve (4+) | Card shows order, customer, phone, total → Approve → confirm (2) |
| Record a refund | Find the payment UUID (impossible from the UI) | Type HT number → Find → Record → confirm (3) |
| See which orders wait for transfer verification | Not possible as a list | "Transfer to verify" view (1) |
| Vendor: find the oldest waiting order | Scroll to the bottom of an unordered column | It is the top card, with its waiting time |
| Edit one driver | Scroll a 5,000 px page of editors | Search → editors open (1) |

## Tests

- Backend: unit 2,459 ✓, integration 314 ✓, end-to-end 87 suites / 1,156 ✓ (new suite 137-admin-ux-support).
- Dashboard: typecheck ✓, unit 45 ✓, production build ✓.
- Browser (Playwright), 17 files: new admin-ux-release (6), rewritten admin-manual-transfer-refund (1), release1-register 8, order-detail 5, admin-driver-vehicle 4, admin-driver-integrated 1, orders-workspace 12, dashboard-overview 9, admin-nav 8, admin-control-tower 15, admin-order-operations 6, vendor-operations 6, staff-alerts-and-live-updates 4, order-isolation 2, pickup-collection 8, vendor-errors 5, admin-dispatch-alerts 1.
- Fixed during testing:
  - The vendor board dropped a shared `?order=` link in development mode.
  - A staff-alerts test broke once the fixture vendor passed 99 unread alerts ("99+").
  - One stocktake test flaked once (the Start button was clicked before the branch list loaded) and passed on rerun.

## Not changed (deliberately)

- Navigation structure and page names stay as they are, so existing training and links keep working.
- No business rule changed; R1–R45, R23a and R33a are unchanged.
- Customer and Driver apps were not touched.
