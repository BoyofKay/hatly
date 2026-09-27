# Hatly Monorepo

Delivery marketplace for Belbeis, Sharqia, Egypt. See `hatly-phase1-report.md`
(shared alongside this repo) for the full Phase 1 report.

## Product decisions

Locked business rules live in [`docs/PRODUCT_DECISIONS.md`](docs/PRODUCT_DECISIONS.md)
(impact audits alongside, e.g. `docs/IMPACT_AUDIT_POST_GROUP_8.md`).

## Structure

```
apps/
  backend/        NestJS API (modular monolith)
  customer-app/   Flutter — customer application
  driver-app/     Flutter — driver application (separate app, shares backend only)
  dashboard/      Next.js — Vendor + Admin dashboards
packages/
  shared-types/   (reserved — not yet populated in Phase 1)
  design-tokens/  (reserved — not yet populated in Phase 1)
```

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 15+
- Redis 7+
- Flutter 3.24+ (Dart 3.4+)
- A Google Maps API key (for later map integration; not required to run Phase 1)

## Backend

```bash
cd apps/backend
npm install
cp .env.example .env        # fill in DATABASE_URL, REDIS_URL, JWT secrets
npm run migration:run       # applies the initial schema
npm run start:dev           # http://localhost:3000, Swagger at /docs
```

## Dashboard (Next.js)

```bash
cd apps/dashboard
npm install
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1" > .env.local
npm run dev                 # http://localhost:3000 (use a different port if backend is running, e.g. -p 3001)
```

## Customer app (Flutter)

```bash
cd apps/customer-app
flutter pub get
flutter gen-l10n
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

## Driver app (Flutter)

```bash
cd apps/driver-app
flutter pub get
flutter gen-l10n
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

Note: Firebase (`firebase_core`) requires running `flutterfire configure`
in each Flutter app once Firebase projects exist for Hatly — not needed
to build/run Phase 1 screens, only for push notifications later.

## Environment variables (backend)

See `apps/backend/.env.example` for the full list. Nothing in that file
contains a real secret — every value is a placeholder to be filled in
per-environment.
