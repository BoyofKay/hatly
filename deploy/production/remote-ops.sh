#!/usr/bin/env bash
# Runs ON THE PRODUCTION HOST (sent over SSH by .github/workflows/production-ops.yml). One action per run; prints no secret values.
#   remote-ops.sh status
#   remote-ops.sh deploy <release-id>            (the bundle must already be in /opt/hatly-prod/incoming/<release-id>.tar.gz + .sha256)
#   remote-ops.sh rollback <release-id>          (switch back to a release already on disk; never reverts migrations)
#   remote-ops.sh reset-dry-run "<cutoff>"       (test-data reset: prints what would be removed, changes nothing)
#   remote-ops.sh reset-apply "<cutoff>"         (test-data reset: really deletes; a fresh backup is taken first)
#   remote-ops.sh disk-report                    (read-only: where the disk space goes)
#   remote-ops.sh cleanup                        (removes old releases/images/build cache; keeps the 3 newest releases + live)
# Same order and guards as docs/launch/RELEASE_ADMIN_VENDOR_MAINTENANCE_RUNBOOK.md: verify → build → env-check → plan → backup + restore drill →
# guarded migrate (only when the plan shows pending migrations; prod.sh migrate takes its own backup again) → switch → status → health.
set -euo pipefail
PD=/opt/hatly-prod
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -n"
action="${1:?action}"; arg="${2:-}"
step() { printf '\n==== %s  (%s UTC)\n' "$1" "$(date -u +%H:%M:%S)"; }
is_release() { [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]; }
current() { cat "$PD/RELEASE"; }

case "$action" in
  status)
    step "current release"; current
    step "status"; "$PD/current/deploy/production/prod.sh" status
    step "migrations"; "$PD/current/deploy/production/prod.sh" plan | tail -5
    step "releases on disk"; ls -1t "$PD/releases" | head -5
    step "disk"; df -h "$PD" | tail -1
    ;;

  deploy)
    REL="$arg"; is_release "$REL" || { echo "bad release id"; exit 2; }
    OLD="$(current)"; echo "current release (rollback target): $OLD"
    [ "$REL" != "$OLD" ] || { echo "already live"; exit 0; }
    [ ! -e "$PD/releases/$REL" ] || { echo "release folder already exists — refusing to overwrite"; exit 2; }
    step "1. verify + extract"
    cd "$PD"
    echo "$(cut -d' ' -f1 "incoming/$REL.tar.gz.sha256")  incoming/$REL.tar.gz" | sha256sum -c -
    mkdir -m 700 "releases/$REL.partial" && tar -xzf "incoming/$REL.tar.gz" -C "releases/$REL.partial" && mv -T "releases/$REL.partial" "releases/$REL"
    chmod 755 "releases/$REL/deploy/production/"*.sh
    NEW="$PD/releases/$REL/deploy/production/prod.sh"
    step "2. build images (the live release keeps serving)"; PROD_RELEASE="$REL" "$NEW" build
    step "3. env check with the new image"; PROD_RELEASE="$REL" "$NEW" env-check
    step "4. migration plan"; plan="$(PROD_RELEASE="$REL" "$NEW" plan)"; echo "$plan" | tail -8
    pending="$(echo "$plan" | grep -c '\[ \]' || true)"; echo "pending migrations: $pending"
    step "5. backup + restore drill"
    PROD_RELEASE="$REL" "$NEW" backup
    dump="$(ls -1t "$PD"/backups/hatly-prod-2*.dump | head -1)"; echo "newest dump: $(basename "$dump")"
    HATLY_COMPOSE_FILE="$PD/releases/$REL/deploy/production/docker-compose.production.yml" HATLY_COMPOSE_PROJECT=hatly-prod \
      HATLY_ENV_FILE="$PD/.env.production" PROD_RELEASE="$REL" bash "$PD/releases/$REL/deploy/production/restore-drill.sh" "$dump"
    if [ "$pending" != 0 ]; then
      step "6. migrate (guarded; additive migrations — the old release stays compatible while it runs)"
      PROD_RELEASE="$REL" CONFIRM_MIGRATE=hatly_prod "$NEW" migrate
    else
      step "6. no migrations to run"
    fi
    step "7. switch release + start the new apps"
    echo "$REL" > "$PD/RELEASE.tmp" && mv "$PD/RELEASE.tmp" "$PD/RELEASE"
    ln -sfn "releases/$REL" "$PD/current"
    "$PD/current/deploy/production/prod.sh" apps
    step "8. health"
    for i in $(seq 1 30); do
      if $SUDO docker exec hatly-prod-backend-1 curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health/ready >/dev/null 2>&1; then break; fi; sleep 5
    done
    # The dashboard starts after the backend; give it up to a minute so the status below reflects it.
    for i in $(seq 1 12); do
      [ "$($SUDO docker inspect -f '{{.State.Health.Status}}' hatly-prod-dashboard-1 2>/dev/null)" = healthy ] && break; sleep 5
    done
    "$PD/current/deploy/production/prod.sh" status
    $SUDO docker exec hatly-prod-backend-1 curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health/ready >/dev/null 2>&1 || {
      echo "BACKEND NOT HEALTHY — rolling back to $OLD (migrations stay applied; they are additive)"
      echo "$OLD" > "$PD/RELEASE"; ln -sfn "releases/$OLD" "$PD/current"; "$PD/current/deploy/production/prod.sh" apps; exit 1; }
    step "9. recent backend errors"; $SUDO docker logs --since 3m hatly-prod-backend-1 2>&1 | grep -c '"level":"error"\|ERROR' || true
    step "10. tidy disk (keeps the 3 newest releases + their images; build cache capped at 5 GB)"
    for r in $(ls -1t "$PD/releases" | grep -v '\.partial$' | tail -n +4); do
      [ "$r" = "$REL" ] || [ "$r" = "$OLD" ] && continue
      $SUDO rm -rf "$PD/releases/$r" "$PD/incoming/$r.tar.gz" "$PD/incoming/$r.tar.gz.sha256"
      $SUDO docker image rm "hatly-prod-backend:$r" "hatly-prod-dashboard:$r" >/dev/null 2>&1 || true
    done
    $SUDO docker builder prune -f --keep-storage 5gb >/dev/null 2>&1 || true
    df -h / | tail -1
    echo "DEPLOYED $REL (previous: $OLD — rollback: request ACTION=rollback RELEASE=$OLD)"
    ;;

  rollback)
    REL="$arg"; is_release "$REL" || { echo "bad release id"; exit 2; }
    [ -d "$PD/releases/$REL" ] || { echo "release $REL is not on disk"; exit 2; }
    OLD="$(current)"; step "switch $OLD -> $REL (database untouched)"
    echo "$REL" > "$PD/RELEASE"; ln -sfn "releases/$REL" "$PD/current"; "$PD/current/deploy/production/prod.sh" apps
    sleep 20; "$PD/current/deploy/production/prod.sh" status
    ;;

  reset-dry-run|reset-apply)
    CUTOFF="$arg"
    [[ "$CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}(:[0-9]{2})?(\+|-)[0-9]{2}$ ]] || { echo "cutoff must look like 2026-11-21 23:59:59+02"; exit 2; }
    SQL="$PD/current/deploy/production/reset-test-orders-and-drivers.sql"
    [ -f "$SQL" ] || { echo "the live release has no reset script — deploy first"; exit 2; }
    APPLY=no
    if [ "$action" = reset-apply ]; then APPLY=yes; step "backup first"; "$PD/current/deploy/production/prod.sh" backup; fi
    step "test-data reset ($([ $APPLY = yes ] && echo APPLY || echo DRY RUN)), cutoff $CUTOFF"
    $SUDO docker exec -i hatly-prod-postgres-1 sh -c "psql -X -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v cutoff=\"'$CUTOFF'\" -v apply=$APPLY -f -" < "$SQL"
    ;;

  disk-report)
    step "filesystem"; df -h / | tail -1
    step "docker (images / containers / volumes / build cache)"; $SUDO docker system df
    step "hatly folders"; $SUDO du -sh "$PD/releases" "$PD/incoming" "$PD/backups" 2>/dev/null
    step "releases on disk"; ls -1 "$PD/releases" | wc -l
    step "largest top-level folders"; $SUDO du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -12
    step "logs"; $SUDO du -sh /var/log /var/lib/docker/containers 2>/dev/null
    ;;

  cleanup)
    # Safe: never touches the database volume, uploads, or the live/previous release. Keeps the 3 newest releases and their images.
    step "before"; df -h / | tail -1
    keep="$(ls -1t "$PD/releases" | grep -v '\.partial$' | head -3; current)"
    for r in $(ls -1 "$PD/releases"); do
      echo "$keep" | grep -qx "$r" && continue
      echo "removing release $r"; $SUDO rm -rf "$PD/releases/$r" "$PD/incoming/$r.tar.gz" "$PD/incoming/$r.tar.gz.sha256"
      $SUDO docker image rm "hatly-prod-backend:$r" "hatly-prod-dashboard:$r" >/dev/null 2>&1 || true
    done
    step "docker build cache"; $SUDO docker builder prune -af 2>&1 | tail -1
    step "unused images (not used by any container, older than 1 day)"; $SUDO docker image prune -af --filter "until=24h" 2>&1 | tail -1
    step "old journal logs (keep 200 MB)"; $SUDO journalctl --vacuum-size=200M 2>&1 | tail -1 || true
    step "after"; df -h / | tail -1
    "$PD/current/deploy/production/prod.sh" status
    ;;

  service-areas)
    # Read-only: the service areas, and how the 10 most recently saved addresses relate to them (mode, zone or not, distance in km
    # from each active area's centre vs its radius). No names, phones or address text are printed.
    $SUDO docker exec -i hatly-prod-postgres-1 sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'
\echo '== service areas'
SELECT name, is_active, round(center_latitude::numeric, 5) AS lat, round(center_longitude::numeric, 5) AS lng, radius_meters FROM service_areas WHERE deleted_at IS NULL ORDER BY name;
\echo '== delivery zones'
SELECT z.name, z.is_active, z.delivery_fee_minor / 100.0 AS fee_egp, a.name AS area FROM delivery_zones z JOIN service_areas a ON a.id = z.service_area_id ORDER BY a.name, z.display_order;
\echo '== active store branches: delivery on? in which service area?'
SELECT v.name AS store, b.name AS branch, b.is_active, b.is_open, b.delivery_enabled, b.pickup_enabled, coalesce(a.name, '(none)') AS service_area
  FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN service_areas a ON a.id = b.service_area_id
 WHERE b.deleted_at IS NULL AND v.is_active ORDER BY v.name, b.name;
\echo '== the address(es) matching the checkout screenshot (settings only)'
SELECT to_char(ad.created_at, 'YYYY-MM-DD HH24:MI') AS saved, ad.is_active, coalesce(ad.mode, 'legacy') AS mode, (ad.delivery_zone_id IS NOT NULL) AS has_zone,
       coalesce(z.is_active::text, '-') AS zone_active, (ad.latitude IS NOT NULL) AS has_pin,
       round(ad.latitude::numeric, 3) AS lat3, round(ad.longitude::numeric, 3) AS lng3
  FROM addresses ad LEFT JOIN delivery_zones z ON z.id = ad.delivery_zone_id
 WHERE ad.line1 ILIKE '%فتحي خليل%' OR ad.street ILIKE '%فتحي خليل%' OR ad.formatted_address ILIKE '%فتحي خليل%' ORDER BY ad.created_at DESC LIMIT 5;
\echo '== latest saved addresses vs active areas (km from centre / radius km)'
SELECT to_char(ad.created_at, 'YYYY-MM-DD HH24:MI') AS saved, coalesce(ad.mode, 'legacy') AS mode, (ad.delivery_zone_id IS NOT NULL) AS has_zone,
       (ad.latitude IS NOT NULL) AS has_pin, a.name AS area,
       round((6371 * acos(least(1, cos(radians(a.center_latitude)) * cos(radians(ad.latitude)) * cos(radians(ad.longitude) - radians(a.center_longitude)) + sin(radians(a.center_latitude)) * sin(radians(ad.latitude)))))::numeric, 2) AS km_from_centre,
       round(a.radius_meters / 1000.0, 2) AS radius_km
  FROM (SELECT * FROM addresses WHERE is_active ORDER BY created_at DESC LIMIT 10) ad
  LEFT JOIN service_areas a ON a.is_active AND a.deleted_at IS NULL AND ad.latitude IS NOT NULL
 ORDER BY ad.created_at DESC;
SQL
    ;;

  maps-on|maps-off)
    # maps-on: the key was uploaded by the workflow to $PD/.maps-key (mode 600) — never on a command line or in a log.
    ENVF="$PD/.env.production"
    BAK="$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"; $SUDO cp -p "$ENVF" "$BAK"
    $SUDO sed -i '/^MAPS_PROVIDER=/d; /^GOOGLE_MAPS_API_KEY=/d' "$ENVF"
    if [ "$action" = maps-on ]; then
      KEYF="$PD/.maps-key"; [ -s "$KEYF" ] || { echo "no key uploaded"; exit 2; }
      KEY="$(cat "$KEYF")"; rm -f "$KEYF"
      [[ "$KEY" =~ ^[A-Za-z0-9_-]{30,60}$ ]] || { echo "that does not look like a Google API key"; exit 2; }
      printf 'MAPS_PROVIDER=google\nGOOGLE_MAPS_API_KEY=%s\n' "$KEY" | $SUDO tee -a "$ENVF" >/dev/null
      echo "Google Maps: ON (key ending …${KEY: -4})"
    else
      echo 'MAPS_PROVIDER=none' | $SUDO tee -a "$ENVF" >/dev/null
      echo "Google Maps: OFF (delivery fees come from zones only)"
    fi
    step "env check"
    if ! "$PD/current/deploy/production/prod.sh" env-check; then
      echo "ENV CHECK FAILED — the previous settings are restored and nothing was restarted"; $SUDO cp -p "$BAK" "$ENVF"; exit 1
    fi
    step "restart apps"; "$PD/current/deploy/production/prod.sh" apps
    sleep 20; "$PD/current/deploy/production/prod.sh" status
    ;;

  *) echo "unknown action $action"; exit 2;;
esac
