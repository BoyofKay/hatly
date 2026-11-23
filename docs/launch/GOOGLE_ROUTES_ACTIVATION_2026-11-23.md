# Hatly Google Routes activation — 2026-11-23

## Approved scope

Use Google Maps Platform **Routes API `computeRoutes`** only for real road-distance/duration calculations and **Geocoding API** for assistive lookup. The Driver App keeps opening externally installed Google Maps at saved pickup/drop-off coordinates. **No in-app navigation, live driver map, customer tracking, Fleet Engine, or changes to Hatly/Wasaly carts, order lifecycles, dispatch, or pricing formulas.**

- MANUAL address: selected Zone -> Neighborhood/Village fixed fee, never silently replaced by a GPS fee.
- GPS address: server-calculated road distance; unavailable while Maps is disabled. Never fake road distance.
- Hatly/Wasaly: preserve their already-approved routes and multiplier; order quote and frozen route remain authoritative.
- Existing orders and frozen fees are immutable.

## Verified production status

Read-only `Production ops` run **45243010837** (2026-11-23 18:52 UTC) reported:
- live release `20261123T174407Z-bafe081b4e55`;
- backend and dashboard healthy; PostgreSQL and Redis healthy; 95 migrations applied;
- backend source on disk contains `https://routes.googleapis.com/directions/v2:computeRoutes`;
- `MAPS_PROVIDER=none` (Maps OFF).

This verifies code deployment, **not** live access to Google APIs. The default GitHub branch contains an older provider; use the deployed release and the release/ops branches, not the default-branch file, to judge activation readiness.

## Google Cloud configuration (owner-managed)

The owner reports that Routes and Geocoding APIs are enabled; the server key is restricted to those two APIs and to the production VPS outbound IP; billing alerts are configured. Reconfirm actual access **from inside the backend container** using the workflow's preflight; a successful console save is not evidence of working network/authentication.

Never place the API key in the repository, an issue, a screenshot, or a message. The provider reads a single protected `GOOGLE_MAPS_API_KEY` and `MAPS_PROVIDER=google` from `/opt/hatly-prod/.env.production` (mode 600).

## Required secret / blocker

The read-only `maps-check` Production Ops run **45243360049** returned `PROD_GOOGLE_MAPS_API_KEY secret is not set`; production remained unchanged. The owner must create the GitHub Actions **repository secret** `PROD_GOOGLE_MAPS_API_KEY`, containing the existing restricted server key, through GitHub's Settings -> Secrets and variables -> Actions UI. Do not paste it into any tracked file or chat.

## Safe activation sequence

The existing `.github/workflows/production-ops.yml` is triggered by an `ops/REQUEST` commit on `ops-request`. Its Production environment may require approval. Use the same established workflow and read its `ops-log` result after each action:

1. **ACTION=status**: verify live release health and that the source contains `computeRoutes` and `MAPS_PROVIDER=none`. No production changes.
2. **ACTION=maps-check**: GitHub Actions transfers the secret directly to a mode-600 temporary server file. The production backend container makes one Routes and one Geocoding request, with the secret passed only via stdin. Both must succeed; no env change or restart. If either fails, **stop**.
3. **ACTION=maps-on**: repeat the preflight *before* changing the environment; then back up `.env.production`, set the provider/key, run `env-check`, restart apps, verify backend ready and running container mode. Restore the previous settings and restart on any failure.
4. Validate real customer-address flows in the application: manual fee remains selected neighborhood fee, GPS quote uses road distance, Hatly/Wasaly routing and snapshots remain unchanged, driver opens external Google Maps, and neither historical charges nor orders change.
5. Watch Maps metrics and costs/quotas; note a budget alert is not a hard spending cap.

Rollback is **ACTION=maps-off** using the same Production Ops workflow; the existing manual-zone behavior returns. This action does not reset databases or historical orders. Map-provider changes must never be combined with historical financial cleanup.

## Implementation evidence

- `apps/backend/src/modules/location/providers/google-maps.provider.ts` — `computeRoutes`, drive/traffic-unaware, distance+duration field mask; existing geocode/reverse-geocode, Redis caching.
- `apps/backend/src/modules/location/providers/google-maps.provider.spec.ts` — success, caching, denial, no-route, network timeout and geocoding cases.
- `apps/driver-app/lib/core/utils/maps_helper.dart` — external Google Maps launcher.
- `deploy/production/remote-ops.sh` and `.github/workflows/production-ops.yml` — read-only readiness, maps-check preflight, guarded maps-on/maps-off.
- `.github/workflows/ci.yml` — syntax-checks production operations scripts.

No user-initiated request for Google Maps live tracking was made. Do not build it.

## Live Google validation result (2026-11-23 19:02 UTC)

After the repository secret was added, Production Ops `maps-check` run `45244749365` reached Google Routes from the live backend but was refused: `HTTP 400 INVALID_ARGUMENT`, reason `API_KEY_INVALID`. This indicates the secret value is not a valid Google API key (or the key has been deleted/invalidated), **not** an IP restriction error. `MAPS_PROVIDER` remained `none` and no backend restart was made. Owner action: copy the actual key **value** (not display name or key ID) from the Hatly Google Cloud project and **Update** existing GitHub Actions `PROD_GOOGLE_MAPS_API_KEY` secret. Run `maps-check` again before `maps-on`; do not enable Maps after a failed preflight. No key material is recorded in logs or this document.

## 2026-11-23 follow-up — restricted IP mismatch (confirmed by read-only status)

- Corrected GitHub secret is now accepted as a key, but preflight run **45248219198** failed with `Routes HTTP 403 PERMISSION_DENIED reason=ACCESS_DENIED`. Maps remains disabled.
- Read-only Production Ops status run **45248423794** executed inside the **live backend container** and verified outbound IPv4: **`152.228.240.4`**. Running release is still `20261123T174407Z-bafe081b4e55`, `MAPS_PROVIDER=none`, services healthy.
- User previously configured `151.254.63.33` in the Google Cloud key's IP restriction. This mismatches the server's confirmed outbound IP; likely reason for 403.
- **Required owner action:** In Google Cloud Credentials edit the existing key's **application restriction** to `152.228.240.4`; keep Routes and Geocoding as the only allowed APIs and retain GitHub secret unchanged. Allow restrictions to propagate.
- **After owner changes restriction:** Repeat `ACTION=maps-check`; only if that passes use `ACTION=maps-on` and verify live container mode/health. Never bypass the IP restriction or activate after a failed check.
