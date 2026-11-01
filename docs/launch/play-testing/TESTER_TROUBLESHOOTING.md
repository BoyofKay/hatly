# Tester troubleshooting — "the app doesn't open / I can't get it" (written 2026-10-28)

**Arabic, concise owner checklist: `SAUDI_TESTER_CHECKLIST_AR.md`.** Use this when a closed-test participant reports a problem. Its purpose is to find out **which of five different situations** it is — they have different owners and different fixes — **without asking for anything private** (no password, no phone number, no OTP code, no ID). Send the tester the short list at the bottom and compare their answers with the table.

## Which situation is it?

| What the tester sees | Meaning | Who fixes it |
|---|---|---|
| In the Play Store: *"not available in your country"*, *"item not found"* or no Install button after tapping the opt-in link | **Play-side availability or eligibility** — the tester's Play country is not in the closed track's country list, or they are not on the tester list/Google Group, or they used a different Google account | **Owner, in Play Console** (see below). Nothing in the app can fix it. |
| Play shows *"your device isn't compatible"* | The phone is below Android 7.0 (the app's minimum is API 24) or lacks a supported CPU (arm64-v8a / armeabi-v7a / x86_64 are included) | Nothing to fix; use another phone |
| Installs, the icon appears, but tapping it closes the app immediately | A crash on launch — **not seen in any local test**; needs the Android version, phone model and, if possible, the time of the crash | Developer (collect the facts below) |
| Opens, then a spinner that never ends | The phone cannot reach the server. Fixed in code on 2026-10-28 (a stalled connection now ends in an error with **Retry** after about 30 s) | Check the network (below) |
| Opens and shows only the *Hatly service* card and a message *"No stores are available yet"* | The app is fine; **Production has no stores/zones yet** (operations data, not a defect) | Operations (see `PRODUCTION_READINESS.md` §0.2) |
| Opens, but the phone number is refused ("Egyptian numbers only") | Registration/sign-in currently accepts **Egyptian mobile numbers only (+20)**. A Saudi or other foreign number cannot register | Product decision — see `LAUNCH_PROGRESS.md` §3p |

**A detail that causes confusion:** Google Play decides availability by the **country of the tester's Google Play account/payments profile**, not by where the phone physically is. A person living in Saudi Arabia with an Egyptian Play profile is treated as Egypt; an Egyptian-profile account is *not* blocked by a track that lists only Egypt even while abroad. Ask for the **Play country** (below), not the city.

## Owner checklist in Play Console (read-only first)
UI wording changes; these are the intent, not exact labels — and nothing has been verified here because Claude has no Console access.
1. **Testing → Closed testing → your track → "Countries/regions" tab.** Is the tester's Play country listed? (Each testing track has its **own** country list; the production "Countries/regions" setting does not apply to it.) If it is missing, add it there — this is the most common reason one tester in another country cannot install while everyone else can.
2. **Testers tab:** is the tester's exact Google account (or the Google Group containing it) on the list the track uses? Did they open the **opt-in link** while signed in with that account and press *Become a tester*?
3. **Release status:** is the release on that track *available to testers* (not "in review", not a draft)? A tester sees nothing until it is.
4. **Device catalog** (Release → Device catalog / "Devices"): does the tester's model appear as *supported*, or is it excluded?
5. Make sure the tester is **not** the developer account that is also using the **internal** track (a person cannot be on both tracks for the same app).

## What to ask the tester (copy-paste; none of it is private)
*English*
> Please send me (a screenshot of each is perfect — do **not** include your password, phone number or any code):
> 1. The exact message you see in the Play Store after tapping the link (or on the screen if the app opens).
> 2. Play Store → your profile picture → Settings → General → *Account and device preferences* → **Country and profiles**: which country is shown?
> 3. Which Google account (e-mail) did you open the link with — is it the one I gave you? 
> 4. Settings → About phone: the **Android version** and the **phone model**.
> 5. Does the Hatly icon appear on your phone after installing? What happens when you tap it (closes at once / spins forever / shows a screen)?
> 6. Does the phone have internet right now (does a website open)? Wi-Fi or mobile data? Any VPN or "DNS" app running?
> 7. Roughly what time did you try (so I can look at the server)?

*العربية*
> من فضلك ابعتلي (لقطة شاشة لكل نقطة كفاية — **من غير** ما تبعت كلمة المرور أو رقم تليفونك أو أي كود):
> ١. الرسالة بالظبط اللي بتظهرلك في متجر Play بعد ما تفتح الرابط (أو على الشاشة لو التطبيق اتفتح).
> ٢. متجر Play ← صورتك الشخصية ← الإعدادات ← عام ← *تفضيلات الحساب والجهاز* ← **البلد والملفات الشخصية**: أي بلد مكتوب؟
> ٣. فتحت الرابط بأنهي حساب جوجل (الإيميل) — هو نفس اللي أنا ادّيتهولك؟
> ٤. الإعدادات ← حول الهاتف: **إصدار أندرويد** و**موديل الهاتف**.
> ٥. أيقونة هاتلي ظهرت على الهاتف بعد التثبيت؟ ولما تفتحها بيحصل إيه (بتقفل فورًا / لف مالوش آخر / بتظهر شاشة)؟
> ٦. الهاتف عليه إنترنت دلوقتي (موقع بيفتح)؟ واي فاي ولا داتا؟ في VPN أو تطبيق DNS شغال؟
> ٧. جربت تقريبًا الساعة كام (عشان أبص على السيرفر)؟

## If a developer needs more (still no private data)
Android Studio → Device Explorer, or on the phone **Settings → Developer options → Take bug report**; the crash line mentioning `dev.hatly.customer` is what matters. For network checks from the tester's phone, opening `https://api.hatly.dev/api/v1/health` in the phone's browser should show `{"data":{"status":"ok"}}` (a public, read-only health URL).
