# Hatly UI and image standards — 2026-11-24

Release candidate: customer 1.1.0+18; driver 1.1.0+20. Based on d91d42be.

- Home: remove address selector, use active artwork behind pinned logo/search/actions, remove sector tint and excess gaps. Checkout address handling remains unchanged.
- Vendor routes: persistent header and status-bar inset; 16:9 sector and store artwork; compact search and branch details; store-specific Hatly Service action remains vendor-scoped and open-only.
- Product: compact landscape hero, back arrow on image, linked circular vendor logo, retain change-store action and purchase rules. Cart trailing actions, profile edit corner, offers empty state only when no entries.
- Driver: shared shift clock, remove redundant titles, compact history/earnings KPIs, previous period search and date controls, collapsed wallet summary. No financial calculation changes.
- Admin recommendations: promotion 1080×1080 (top 35% clear); sector/store banners 1280×720; product 1000×1000; sector tile/store logo 512×512. Existing assets remain valid. Crop previews and automatic validation are future enhancements.

Validation required: Android cold start and back navigation, LTR/RTL, smaller phones, image crops, guest/authenticated states, vendor closed restrictions, cart and pending-price flows, history and earnings filters, wallet and shift totals. Release only after CI/build success; production deploy follows the existing gated runbook.
