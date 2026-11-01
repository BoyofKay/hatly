# Google Play reviewer access ("App access" → sign-in details) — customer app

Status (2026-10-27): **Production reviewer account EXISTS and is verified** — CUSTOMER ****59, registered through the public `customer/password/register` with `CUSTOMER_OTP_ENABLED=false` (set by the first SUPER_ADMIN through `PUT admin/business-config`, owner-approved); Production login → logout → login passed. Phone and password live only in `~/hatly-secrets/` on the owner's Mac (mode 600). Production still has no delivery zones/vendors (§7). Never put the password in Git, a document, a chat or a log.
or Production is a data change that waits for the owner's approval. Never put the password in Git, a document, a chat or a log.

## 1. What a reviewer needs (traced from the code)

| Step | What the app does | Evidence |
|---|---|---|
| Open the app | Arabic only (`locale: Locale('ar')`); a guest can browse the catalogue, but cart, checkout and orders need an account | `apps/customer-app/lib/main.dart`; `auth_gate.dart` (`requireSignIn`) |
| Sign in | the first screen is the registration form; the reviewer taps **"هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك"** ("Already have a password? Log in instead"), types the phone in Egyptian local form (`01…`) and the password, taps **"متابعة"** ("Continue") | `phone_entry_screen.dart` (`_submit` → `passwordLogin`); ARB `passwordHaveAccountInstead`, `continueButton` |
| OTP | **never at sign-in**: password sign-in does not depend on phone verification, also while `CUSTOMER_OTP_ENABLED` is on. A code is needed only once, to *register* an account while OTP is on | `AuthService.loginCustomerWithPassword`; e2e `104` |
| Location permission | optional — only asked if "use my current location" is tapped; addresses can be typed (zone list) | `device_location_service.dart`; `address_pin_picker.dart` (map off in release builds) |
| Order | needs a saved address inside a delivery zone of that environment; payment is cash on delivery (no card, no money moves) | checkout planner; e2e `104` |

## 2. Design — a dedicated, least-privilege ordinary customer

* One account per environment the review build talks to, made through the **normal public registration** (no reviewer code path, no
  backdoor, no OTP bypass, nothing hard-coded). Role CUSTOMER only; no admin/vendor/driver access; wallet 0; no saved payment means.
  Proven by e2e `104-play-reviewer-access` (provisioning with OTP off and on, sign-in without a code, browse → cart → COD order, 403 on
  admin/vendor/driver routes, refused dashboard sign-in, wallet 0).
* **Phone number: a SIM that Hatly controls** (OWNER DECISION — supply it). Never a made-up number (it could be a real person's) and never
  a personal number. With OTP on, the registration code goes to that SIM.
* **Password:** generated once (`openssl rand -base64 18`), stored in the owner's password manager, typed only into the Play Console
  "Sign-in details" field and into the provisioning prompt below. Rotate it after each review if desired (re-provision or change it in the
  app: Profile → password).
* **Name:** "Google Play Reviewer". **Address:** one saved address in the environment's delivery zone (Staging: the seeded "Abu Naseeb"
  zone, Belbeis).

## 3. Which environment

The review build must point at a running backend (`scripts/launch/build-android-release.sh` accepts exactly two):

| Build `--api-url` | State on 2026-10-23 (read-only checks) | Reviewer account there |
|---|---|---|
| `https://api-sales.hatly.dev/api/v1` (Staging) | **live**: HTTPS 200, http→https 308, valid certificate; OTP **off**; seeded catalogue; **does not yet have** the account-deletion web routes (new migration not deployed) | to be provisioned with §4 after approval |
| `https://api.hatly.dev/api/v1` (Production) | **not live**: Cloudflare 525 (no origin) | after Production exists, with §5 |

A Closed-testing review against Staging is consistent with `GOOGLE_PLAY_TESTING_PLAN.md`; Production review needs Production first.

## 4. Provisioning on Staging (⛔ needs approval — writes one account + one address on Staging)

Run from any machine with `curl` and `jq`. Reads the phone and password from the terminal; prints statuses only; deletes its temp files.

```bash
API=https://api-sales.hatly.dev/api/v1
read -r -p "Reviewer phone, international (+201…): " PHONE
read -r -s -p "Reviewer password (from the password manager): " PW; echo
T=$(mktemp -d); chmod 700 "$T"; trap 'rm -rf "$T"' EXIT
jq -n --arg p "$PHONE" --arg pw "$PW" '{phone:$p, fullName:"Google Play Reviewer", password:$pw}' > "$T/reg.json"
curl -sS -X POST "$API/auth/customer/password/register" -H 'content-type: application/json' --data @"$T/reg.json" -o "$T/out.json" -w 'register: %{http_code}\n'
TOKEN=$(jq -r '.data.accessToken // empty' "$T/out.json")       # held in memory only
ZONE=$(curl -sS "$API/delivery-zones" -H "authorization: Bearer $TOKEN" | jq -r '.data[] | select((.name // "") | test("Naseeb|Nasseb";"i")) | .id' | head -1)
jq -n --arg z "$ZONE" '{label:"Review address", line1:"Hatly review address", deliveryZoneId:$z}' > "$T/addr.json"
curl -sS -X POST "$API/addresses" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" --data @"$T/addr.json" -o /dev/null -w 'address: %{http_code}\n'
jq -n --arg p "$PHONE" --arg pw "$PW" '{phone:$p, password:$pw}' > "$T/login.json"
curl -sS -X POST "$API/auth/customer/password/login" -H 'content-type: application/json' --data @"$T/login.json" -o /dev/null -w 'sign-in check: %{http_code}\n'
unset PW TOKEN
```
Expected: `register: 200` (a `401` means the number already has an account), `address: 201`, `sign-in check: 200`. Then sign in once in the
review build on a phone and place one test order to confirm the path end to end. **Only after that is the account "verified working".**

## 5. Provisioning on Production (later; ⛔ approval)

Production keeps OTP on (no weakening): register **in the app** on a phone holding the Hatly SIM (the code arrives by SMS), set the
password, add one address in a real delivery zone, sign in again to confirm. Do not seed Production data for the reviewer.

## 6. Text for Play Console → App content → App access

Select **"All or some functionality in my app is restricted"** → **Add instructions**:

* **Name:** Hatly customer account
* **Username:** the reviewer phone number in local form, e.g. `01XXXXXXXXX` (11 digits)
* **Password:** (paste from the password manager — only here)
* **Any other information required to access the app:** none — no one-time code is needed to sign in.
* **Instructions** (paste; ≤ 500 characters):

> The app is in Arabic. On the first screen tap "هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك" (Already have a password? Log in instead), enter the phone number and password, tap "متابعة" (Continue). A saved address is ready. Browse a restaurant, add an item, open the cart and place a cash-on-delivery order — no payment is taken and nothing is delivered (test environment). Location permission is optional. Please do not delete the account.

## 7. Restrictions the reviewer should know / owner follow-ups

* Ten wrong passwords lock that number's sign-in for 15 minutes (anti-guessing brake).
* If the reviewer deletes the account (Profile → Delete my account), re-provision before the next review.
* Orders placed on Staging reach the Staging test vendor; cancel them afterwards (Staging dashboard) to keep the pilot data tidy.
* Customer support in the app opens WhatsApp — not needed for the review.
