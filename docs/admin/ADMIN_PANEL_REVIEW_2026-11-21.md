# Hatly Admin Panel — review and fixes (2026-11-21)

Branch `admin-panel-review` (not merged, not deployed). Everything below marked **Done** is built and covered by automated tests; nothing has been deployed to production.

## 0. Where the project stands (summary of the handoff notes)
- **Product:** delivery marketplace for Belbeis (Sharqia): customer app and driver app (Flutter), NestJS API + PostgreSQL + Redis, Next.js admin/vendor dashboard. Production: `api.hatly.dev` / `admin.hatly.dev`, one Ubuntu server, Docker, releases switched with `deploy/production/prod.sh` and always a rollback release kept.
- **Built:** 82 database migrations; 16-module admin panel; vendor dashboard (order board, products, stock, team, finance); order operations and dispatch; settlements; notifications inside the apps; customer and driver app redesigns. Last recorded release: 2026-11-15.
- **Not configured in production:** SMS (no OTP), push notifications (Firebase), Google Maps, online card payments — customers pay cash / wallet / manual transfer; apps refresh by polling.
- **Mobile distribution:** customer app on Google Play *closed testing* (12 testers); driver app as an APK sent directly; iOS waiting for Apple enrolment.
- **Open owner decisions recorded by the previous developer:** driver cash-in-hand balance, driver↔vendor reimbursement, vendor net payable, whether the manual "closed" switch should block checkout, who may promote managers, vendor offers rule, gross-sales rule (R3).

## 1. General good-practice gaps (your point 1)
| Gap found | Status |
|---|---|
| No way to change your own password; no way to create staff | **Done** (§2) |
| Delete missing everywhere; edit missing or fake (product "edit" was a browser prompt for the name only) | **Done** (§3) |
| Excel template could only update existing products | **Done** (§4) |
| Branch could be saved without commission / section / area → silent revenue loss or invisible store | **Done** (§5 checklist + safer form) |
| Single super admin holds everything (no separation of duties) | Tools now exist (§2) — create the accounts |
| Commission typed in "basis points" (1500 = 15%) | New-branch form now takes %, edit field label clarified |
| Coordinates typed by hand | Paste a Google Maps link or "lat, lng" |

## 2. Staff, passwords and privileges (points 2, 3, 6) — **Done**
- **Change my password** — every dashboard user (super admin, admin, operations, store staff): click your name (admin) or **Password** (store dashboard). Needs the current password; new one 10+ characters with a letter and a digit; audited.
- **Settings › Staff & permissions**: add, edit (name, phone, e-mail, level), reset password (signs the person out), set permissions, deactivate (signs out at once), delete (account removed, history kept, phone freed).
- **Hierarchy enforced by the server:**

| Level | Can manage | Recommended preset (copied on creation, editable per person) |
|---|---|---|
| Super admin | everyone below | — (has everything by role) |
| Admin | supervisors + team | `ADMIN_GENERAL`: menus, zones, drivers, offers, customers, reports, staff below |
| Operations supervisor | operations team | `OPS_SUPERVISOR`: team rights + order issues, dispatch override, drivers, driver closing, transfer checks, customer contact details, reports, managing the team |
| Operations team | nobody | `OPS_TEAM`: follow orders, act for a store, assign drivers, open/close stores (no money, no personal data, no settings) |

  Rules: you only manage levels **below** yours; you can only give permissions **you hold**, and never remove ones given by someone above you; nobody edits their own account there.
  Kept with the super admin and granted one by one (project rule): creating/deleting stores (`MANAGE_VENDORS`), commissions, business settings, approvals, audit log.

## 3. Edit and delete everywhere (point 4) — **Done**
Delete is a **safe soft delete**: the record disappears from the panel and the apps, old orders/settlements/audit keep pointing at it, and the delete is **refused with a reason** when it would break something live.

| Record | Delete refused when… | Also switched off |
|---|---|---|
| Store | any branch has orders in progress | its branches, menus, categories, offers, staff only working there |
| Branch | orders in progress | its menu, categories, offers, its staff |
| Product | — | removed from carts |
| Category | it still has products | — |
| Section | stores are in it | its subcategories |
| Service area | it has stores or delivery zones | — |
| Delivery zone | — (saved addresses ask the customer to choose another zone) | — |
| Vehicle type | drivers use it | — |
| Driver | deliveries in progress | sign-in account (phone freed) |
| Store staff | — | sign-in account (phone freed) |
| Offer | — (orders keep their discount) | — |

New edits: full product edit (names, descriptions, category, price, stock), category edit, section edit, driver details, store staff details and role. Offers already had a safe **Edit / Clone** on their row (discount rules change via Clone) — kept as is. Activate/Deactivate kept everywhere.
Note: decision PD-009 said zones are "deactivated, never deleted"; the new zone delete is a soft delete that PD-009's "deleted zone → unavailable" rule already handles. Confirm you are happy with that.

## 4. Excel templates and bulk photos (points 5, 11) — **Done**
**Why your upload failed:** the old template only *updated* products that already existed (every row needed a product id), so a new restaurant's menu could never be imported.
New **Import menu (Excel)** on each branch: one file creates/updates categories, products (piece or per-kg), Arabic names, descriptions, stock, availability, **option groups** (sizes, add-ons with extra price) and **photos** (.zip with the Excel + photos). Check first (all problems by row, nothing saved), then Import (all or nothing). Re-uploading never duplicates. The old vendor-side template (price/stock updates with approval) is unchanged.

## 5. New-restaurant cycle (point 7) — **Done**, guide: `docs/admin/NEW_RESTAURANT_GUIDE.md`
Gaps found: commission optional (orders then record **zero** commission, never back-filled); section and service area not part of creation (store invisible); "store accepts" mode with no staff account (orders stuck); branch starts closed with nothing telling you; no delivery zones → pin-less customers cannot order; coordinates by hand.
Fixes: **Go-live checklist** at the top of every branch page (9 must-fix + 6 recommended checks with links); new-branch form requires area and commission %, accepts a Maps link, and opens the branch page afterwards.

## 6. Clearing test data (point 8) — **script ready, you run it**
`deploy/production/reset-test-orders-and-drivers.sh` + `.sql`. Removes every order up to a cutoff time and everything attached to it, and every driver (accounts switched off, phones freed); keeps customers, stores, menus, settings; resets sales counters, ratings and offer usage. Dry run by default; stops if any order is newer than the cutoff; asks you to type DELETE. Tested end to end (e2e 143).
I cannot reach the production server from here, and production must only be changed by you:
```
./prod.sh backup                       # copy the dump off the server
./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02"         # dry run, read the numbers
./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02" apply   # really delete
```
Not changed by it (decide yourself): tracked stock quantities (do a stock count), wallet/loyalty entries not tied to an order, employee loans, uploaded photo files.

## 7. Delivery zones and service areas — proposal (point 9)
How it works today: a **service area** is a circle (centre + radius) that decides which stores a customer sees; **delivery zones** are named places inside it, each with its own fee — used when the customer has no map pin (with a pin, the distance fee applies).
**Proposal for launch — one service area, zones in rings:**

| Ring | Zones (names to confirm on the ground) | Suggested fee |
|---|---|---|
| A — city centre | وسط البلد، القيسارية، الزعبلاوي، شارع سعد زغلول، شارع جمال عبد الناصر، شارع بورسعيد | base fee (e.g. your current minimum) |
| B — rest of the city | أبو نصيب (already in the system) and the other city districts your drivers name | base + 5 EGP |
| C — near villages | البلاشون، العدلية، غيتة، ميت حمل، الزوامل | base + 10–15 EGP |
| D — far villages (open later) | سلمنت، الجوسق، ميت جابر، بني صالح، قرملة، شبرا النخلة، منشأة السلام | base + 20 EGP or keep inactive |

- One service area "Belbeis" centred on the city with a radius that reaches ring C; add a second area later rather than one huge circle.
- Fill each zone's representative point (helps driver ranking), keep zones you do not serve **inactive** rather than unpriced, and review fees after two weeks of real orders.
- Names come from Sharqia governorate/press sources (below) and the existing seed; the fees are a structure for you to set — I did not invent prices as facts.

Sources: [Youm7 — Belbeis streets and districts](https://www.youm7.com/story/2021/2/4/%D9%85%D8%B4%D8%B1%D9%88%D8%B9%D8%A7%D8%AA-%D8%AA%D8%BA%D9%8A%D8%B1-%D8%B4%D9%83%D9%84-%D8%A8%D9%84%D8%A8%D9%8A%D8%B3-%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D9%8A%D8%A9-%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9-%D8%AD%D8%B6%D8%A7%D8%B1%D9%8A%D8%A9-%D8%AA%D8%B9%D8%B1%D9%81-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%AA%D9%81%D8%A7%D8%B5%D9%8A%D9%84/5188614), [Sharqia governorate — Belbeis](http://sharkia.gov.eg/areas/belbes/divison.aspx?ID=1), [Wikipedia — villages of Belbeis](https://ar.wikipedia.org/wiki/%D8%AA%D8%B5%D9%86%D9%8A%D9%81:%D9%82%D8%B1%D9%89_%D8%A8%D9%84%D8%A8%D9%8A%D8%B3), [Elbalad — Belbeis](https://www.elbalad.news/4048699).

## 8. Operations review — the full cycle (point 10)
| Step | Today | Risk | Recommendation |
|---|---|---|---|
| Order placed | Customer app; cash / wallet / manual transfer | No SMS/push: customer only sees updates in-app | Configure Firebase (push) first — biggest operational gain |
| Store accepts | Vendor board with sound, or Hatly accepts for the store, or automatic | Stores without staff/phone attention → stuck orders | Use **Hatly** acceptance for stores that take orders by phone; checklist now flags "no staff" |
| Preparing / ready | Store marks it; operations can act on its behalf | — | Set preparation times on every branch |
| Dispatch | Automatic (if on) or manual; drivers cannot refuse | Driver app relies on polling, no push | Firebase push for drivers; keep the Operations board open on a dedicated, charged device with sound |
| Pickup & weighing | Actual weight required before pickup | — | — |
| Delivery & cash | Proof of delivery; cash with the driver | Driver cash balance / remittance rule still an **open decision** | Decide it; until then close drivers daily in **Delivery › Drivers today / Closing** |
| Problems | Exceptions, failed deliveries, refunds recorded (not sent automatically) | — | Assign one supervisor to these queues each shift |
| Settlement | Weekly/monthly closing for stores and drivers | Vendor net payable rule still open | Decide it before the first store payout |
| People | One super admin did everything | No separation of duties | Create admin / supervisor / team accounts now (§2); give `VIEW_CUSTOMER_PII` and money permissions sparingly |

Suggested shift routine: supervisor opens **Orders › Operations board** at shift start → checks "Stores now" (which stores are open) → watches unassigned orders and alerts → closes drivers at shift end in **Drivers today** → hands over open exceptions.

## 9. What is NOT done / needs you
- **Deploy**: not deployed. One new migration (`StaffLevels`, additive). Follow the usual release procedure (backup → bundle → build → plan shows 1 pending → migrate → apps), keeping the previous release for rollback.
- Push/SMS providers, the open money decisions (§0), zone names and fees on the ground (§7), running the reset (§6).
- Local test note: the package `xlsx` downloads from `cdn.sheetjs.com`; this cloud session's network blocks that host, so tests here used the npm build of the same library. Production builds are unaffected.

## 10. Tests
New end-to-end tests: `140-staff-accounts` (12), `141-admin-safe-delete` (11), `142-menu-import` (7), `143-reset-test-orders-script` (4); dashboard unit test for the Maps-link reader. Backend unit suite 2,488/2,488 green. Full e2e and browser click-throughs (staff creation, menu import with photo, password change in Arabic) — see the final results in the session report.
