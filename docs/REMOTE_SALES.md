# Remote Sales access (dev/tester backend over public HTTPS)

Sales phones and browsers reach the **existing** backend (hatly_dev + Redis on the Mac) from anywhere — 4G or any Wi-Fi —
through Cloudflare Tunnels. Nothing is port-forwarded: `cloudflared` makes an outbound connection to Cloudflare, which
terminates HTTPS and forwards to `localhost` only. PostgreSQL (5432) and Redis (6379) stay bound to loopback.

```
phone / browser ──HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared (Mac) ──▶ localhost:3000 (API + /uploads media)
                                                                       └──▶ localhost:3001 (dashboard, production build)
```

The Mac must stay on, awake, online, with the backend dev server, both tunnels and the dashboard running.

## Current mode: Cloudflare *quick* tunnels (no account)

Hostnames are random `*.trycloudflare.com` names, **new every time a tunnel restarts**, with no uptime guarantee. The
Remote Sales APKs and the remote dashboard build have the API hostname compiled in, so after a tunnel restart they must
be rebuilt (below). For a permanent hostname see "Stable hostname".

### Start / restart

```bash
brew install cloudflared                       # once
mkdir -p ~/Library/Logs/hatly
nohup cloudflared tunnel --no-autoupdate --url http://localhost:3000 > ~/Library/Logs/hatly/tunnel-api.log 2>&1 & disown
nohup cloudflared tunnel --no-autoupdate --url http://localhost:3001 > ~/Library/Logs/hatly/tunnel-dashboard.log 2>&1 & disown
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ~/Library/Logs/hatly/tunnel-*.log   # the two public URLs
```

### Backend settings (`apps/backend/.env`, git-ignored — then restart the backend)

```
ENABLE_API_DOCS=false          # no public Swagger UI
TRUST_PROXY=loopback           # trust only the local cloudflared → real client IPs for rate limits
CORS_ALLOWED_ORIGINS=<dashboard tunnel URL>,http://localhost:3001,http://localhost:3002
```

### Remote dashboard (Vendor / Admin users)

Built into its own folder (`.next-remote`, git-ignored) so it never collides with the local dev/Playwright dashboard:

```bash
cd apps/dashboard
HATLY_DASHBOARD_DIST_DIR=.next-remote NEXT_PUBLIC_API_BASE_URL=<API tunnel URL>/api/v1 npx next build
HATLY_DASHBOARD_DIST_DIR=.next-remote nohup npx next start -p 3001 > ~/Library/Logs/hatly/dashboard-remote.log 2>&1 & disown
```

### Remote Sales APKs (HTTPS only — no cleartext opt-in)

```bash
cd apps/customer-app   # and the same in apps/driver-app
flutter build apk --release --dart-define=API_BASE_URL=<API tunnel URL>/api/v1
mkdir -p build/remote-sales && cp build/app/outputs/flutter-apk/app-release.apk build/remote-sales/hatly-customer-remote-sales-0.1.0+1.apk
```

Never add `--android-project-arg=hatly.allowCleartext=true` to a Remote Sales build: that switch exists only for the LAN
tester build (`http://<LAN IP>:3000`). Without it the release manifest has `usesCleartextTraffic="false"`.
(If a build fails with `package dev.flutter.plugins.integration_test does not exist`, delete the generated
`android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java` left by an on-device test run and rebuild.)

## Stable hostname (recommended for Sales) — needs your Cloudflare account + a domain

A named Cloudflare Tunnel gives permanent hostnames such as `api.<your-domain>` and `dashboard.<your-domain>`, so the
APKs never need rebuilding after a restart and "Always Use HTTPS" can be enforced. It requires:

1. A free Cloudflare account, and a domain whose DNS is managed by Cloudflare.
2. On the Mac: `cloudflared tunnel login` (opens a browser to authorise — the credential stays in `~/.cloudflared/`, never
   in the repo), then `cloudflared tunnel create hatly-sales`, then
   `cloudflared tunnel route dns hatly-sales api.<domain>` and `... dashboard.<domain>`.
3. `~/.cloudflared/config.yml` with ingress `api.<domain> → http://localhost:3000`, `dashboard.<domain> →
   http://localhost:3001`, then `cloudflared tunnel run hatly-sales` (or `sudo cloudflared service install` to start it at boot).
4. Point `CORS_ALLOWED_ORIGINS`, the dashboard build and the APK builds at the new hostnames once, as above.
