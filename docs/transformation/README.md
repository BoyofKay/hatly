# Hatly Marketplace Transformation — documentation map (single source of truth)

Status of the program is tracked in **one place per concern**. Do not copy rules between documents; link to them.

| Concern | Authoritative document | Notes |
|---|---|---|
| Business decisions (order, payment, cancellation, weights, exceptions) | `docs/PRODUCT_DECISIONS.md` | PD-001…PD-016. **PD-016** = final decisions of 2026-10-31 (C4 approved as defined, no substitution, unavailable-product workflow). |
| Admin-revamp decision register | `docs/admin-revamp/FINAL_DECISION_REGISTER.md` | D-26 is superseded; section J (D-76…D-79) = the 2026-10-31 decisions and wins over earlier text. |
| Admin specification, API/data plan, roadmap, acceptance | `docs/admin-revamp/FINAL_*.md` | Still valid except where the register says otherwise. `IMPLEMENTATION_ADDENDUM.md` lists what was built and the scope changes. |
| Phase 0 findings, baseline, dependencies | `docs/transformation/PHASE_0_REPORT.md` | This program. |
| Requirement → app → API → table → permission → UI → test → status | `docs/transformation/REQUIREMENTS_TRACEABILITY.md` | Updated at the end of every slice. |
| Per-slice implementation reports | `docs/transformation/SLICE_REPORTS.md` | Exact files, tests, blockers. |
| Launch / deployment record | `docs/launch/LAUNCH_PROGRESS.md` | Nothing from this program is deployed unless a section there says so. |

Rules for this program (from the owner): nothing is committed, tagged, pushed, deployed, migrated in Production or changed in Production data without separate explicit authorization; existing uncommitted work is never discarded; campaign stacking, vendor-funded discount maths, driver settlement frequency and driver-to-vendor financial treatment stay isolated and are not invented.
