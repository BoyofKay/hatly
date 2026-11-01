# Tester log template and production-access application draft

## 1. Log (one row per tester; fill from real events — do not invent entries)

| # | Tester | Google account (not published) | Device / Android | Opted in (date) | Opt-out? | Last confirmed use | Features tried | Issues (ids) |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

Clock day 0 = date the 12th tester opted in. Eligible to apply = day 0 + 14 days. Recruit 20 so that drop-outs do not break the 12.

| Issue id | Reported by | Date | What happened | Severity | Fixed in build (version+N) | Retest by |
|---|---|---|---|---|---|---|
| | | | | | | |

## 2. Application answers — DRAFT SKELETON (the real answers must describe what actually happened)

Google reviews these against Play Console data and says engagement and genuine use matter; a rejection typically asks you to "continue testing". Do not copy this text unchanged.

**About your closed test**
* *How easy was it to recruit 12+ testers?* [number recruited; how: personal network / pilot customers; how many stayed opted in 14 days]
* *Did testers use all the features your app offers?* [list from the log: registration, browsing/search, cart, order, tracking, wallet/points, Hatly Service, custom requests, language/theme, account deletion tested by …]
* *Did usage match what you expect in production?* [honest comparison: real people in [area] ordering real items on [staging/production]; what differed]
* *Summary of feedback and how you collected it:* [WhatsApp + screenshots, a shared log; N reports, the main themes]

**About your app**
* *Target audience:* adults in [Belbeis / pilot area], Egypt, ordering from local stores and errand services (not directed at children).
* *Value proposition:* order from nearby stores, request items a store does not list, and have Hatly buy or deliver something, paid by cash on delivery, electronic payment on delivery, advance transfer or Hatly wallet; Arabic and English.
* *Estimated first-year installs:* [owner's own estimate — a number you can defend].

**About your production readiness**
* *What changed from closed-test learnings:* [list fixes with build numbers from the issue log]
* *How you determined the app was ready:* [stability (no crashes in Play Console vitals/pre-launch report), the checklist `docs/launch/CRITICAL_PATH.md`, the verified regression suites, production backend smoke tests, backups and restore drill done].
