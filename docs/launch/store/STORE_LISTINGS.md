# Store listing drafts (Arabic and English) — NOT submitted, NOT published

Drafted 2026-10-17 from what the apps actually do (customer: `apps/customer-app/lib/features/*` and its ARB strings; driver: `apps/driver-app/lib/features/*`). Claims that need a business fact are in `[OWNER TO CONFIRM …]` brackets — delete the bracket line only after confirming. Character counts are checked against the store limits (Play: title 30, short description 80, full 4,000; App Store: name 30, subtitle 30, promotional text 170, keywords 100, description 4,000).

**Not claimed on purpose (not verified or not built):** delivery speed or coverage, discounts or coupons as a headline feature, online card payment (the app says it is not available yet), live driver tracking on a map (the customer app does not show the driver's position), driver earnings screens (the driver app's earnings screen is not built).

**Names:** the exact titles must be free in each store — check at submission time; alternates are easy (`Hatly: Local Delivery`). **Screenshots, feature graphic and the 1,024/512 px icons:** screenshots must come from the real app on production-like data (not produced here); icon proposals are in `store/icons/` (see `LAUNCH_PROGRESS.md`).

**Accuracy review 2026-10-23 (against the release build):** removed three claims the release build does not deliver — the map address picker (off unless built with `HATLY_MAPS_ENABLED=true`), push notifications (off without Firebase; the in-app notifications list IS real) and an English interface (the app is fixed to Arabic, `main.dart` `locale: Locale('ar')`). Re-add a claim only together with the build/config change that makes it true.


## Customer app


### English

| Field | Text | Chars / limit |
|---|---|---|
| Google Play — app title | Hatly – Order & Delivery | 24 / 30 |
| Google Play — short description | Order from local stores, request what you can't find, and track your delivery. | 78 / 80 |
| App Store — name | Hatly – Order & Delivery | 24 / 30 |
| App Store — subtitle | Local stores, to your door | 26 / 30 |
| App Store — promotional text | Order from stores near you, ask Hatly to buy or deliver anything, and follow every step of your order. | 102 / 170 |
| App Store — keywords | delivery,order,stores,groceries,pharmacy,food,errands,wallet,Egypt,hatly | 72 / 100 |

**Full description (Google Play and App Store)** — 1346 / 4000 characters

```text
Hatly brings the stores around you to your phone.

BROWSE AND ORDER
• Browse stores by category, search for stores and products, and save your favorite stores.
• Build a cart, choose your saved delivery address, and place your order.
• Follow your order from preparation to delivery; every status change appears in the app's notifications.

CAN'T FIND IT?
• Custom request: describe an item a store doesn't list (add a photo if it helps) and the store will confirm it and set the price.
• Hatly Service: ask Hatly to buy something from a place you choose, or to pick something up from your address and deliver it to another place.

PAY THE WAY YOU PREFER
• Cash on delivery, or pay electronically when your order arrives.
• Pay in advance by manual transfer (for example InstaPay or a mobile wallet) and send your payment proof to Hatly.
• Use your Hatly wallet balance on your orders.

REWARDS AND SUPPORT
• Earn Hatly Points on your orders and convert them to wallet balance.
• Rate the stores you order from.
• Contact Hatly on WhatsApp straight from the app.

Hatly is in Arabic, with a light and a dark theme.

You can delete your account from Profile > Delete my account (not while an order is in progress or the Hatly wallet has a balance).

[OWNER TO CONFIRM BEFORE SUBMISSION: the cities/areas Hatly delivers to; support e-mail; website]
```


### Arabic (primary store language — Egypt)

| Field | Text | Chars / limit |
|---|---|---|
| Google Play — app title | هاتلي – اطلب واستلم | 19 / 30 |
| Google Play — short description | اطلب من المتاجر القريبة، واطلب ما لا تجده، وتابع طلبك خطوة بخطوة. | 65 / 80 |
| App Store — name | هاتلي – اطلب واستلم | 19 / 30 |
| App Store — subtitle | متاجر قريبة، لحد بابك | 21 / 30 |
| App Store — promotional text | اطلب من المتاجر القريبة منك، واطلب من هاتلي شراء أو توصيل أي شيء، وتابع طلبك خطوة بخطوة. | 88 / 170 |
| App Store — keywords | توصيل,طلبات,متاجر,بقالة,صيدلية,أكل,مشاوير,محفظة,مصر,هاتلي | 57 / 100 |

**Full description (Google Play and App Store)** — 1110 / 4000 characters

```text
هاتلي بتجيب المتاجر اللي حواليك على موبايلك.

تصفّح واطلب
• تصفّح المتاجر حسب القسم، وابحث عن المتاجر والمنتجات، واحفظ متاجرك المفضلة.
• كوّن سلتك، واختر عنوان التوصيل المحفوظ، وأرسل طلبك.
• تابع طلبك من التحضير حتى التوصيل، وكل تغيير في حالته يظهر في إشعارات التطبيق.

مش لاقي اللي عايزه؟
• طلب خاص: اكتب وصف منتج غير موجود في قائمة المتجر (وأضف صورة لو تساعد) والمتجر يؤكده ويحدد سعره.
• خدمة هاتلي: اطلب من هاتلي شراء شيء من مكان تختاره، أو استلام شيء من عنوانك وتوصيله إلى مكان آخر.

ادفع بالطريقة التي تناسبك
• الدفع نقدًا عند الاستلام، أو الدفع إلكترونيًا عند وصول الطلب.
• الدفع المسبق بتحويل يدوي (مثل إنستاباي أو المحافظ الإلكترونية) وإرسال إثبات الدفع إلى هاتلي.
• استخدم رصيد محفظة هاتلي في طلباتك.

مكافآت ودعم
• اكسب نقاط هاتلي على طلباتك وحوّلها إلى رصيد في المحفظة.
• قيّم المتاجر التي تطلب منها.
• تواصل مع هاتلي على واتساب مباشرة من التطبيق.

هاتلي بالعربية، مع وضع فاتح ووضع داكن.

يمكنك حذف حسابك من الملف الشخصي > حذف حسابي (لا يمكن الحذف أثناء وجود طلب قيد التنفيذ أو رصيد في محفظة هاتلي).

[على المالك التأكيد قبل الإرسال: المدن/المناطق التي يغطيها التوصيل؛ بريد الدعم؛ الموقع الإلكتروني]
```


## Driver app


### English

| Field | Text | Chars / limit |
|---|---|---|
| Google Play — app title | Hatly Driver | 12 / 30 |
| Google Play — short description | For Hatly drivers: get deliveries, navigate, and confirm each one with a photo. | 79 / 80 |
| App Store — name | Hatly Driver | 12 / 30 |
| App Store — subtitle | For Hatly delivery drivers | 26 / 30 |
| App Store — promotional text | The Hatly driver app: go online, see your assigned deliveries, open directions, and confirm each delivery. | 106 / 170 |
| App Store — keywords | driver,delivery,courier,hatly,dispatch,orders | 45 / 100 |

**Full description (Google Play and App Store)** — 824 / 4000 characters

```text
Hatly Driver is the app for delivery drivers registered with Hatly. Accounts are created by Hatly — there is no public sign-up.

WHAT YOU CAN DO
• Sign in with the account Hatly gave you.
• Go online when you are ready to work, and offline when you are not. While you are online the app shares your location with Hatly so deliveries can be assigned to you.
• See the deliveries assigned to you with the pickup and drop-off details.
• Open directions in your maps app.
• Update the delivery status step by step.
• Record the cash you collect from the customer.
• Take a photo as proof of delivery.
• Report a delivery that could not be completed, with the reason.

Location is used only while the app is open and you are online.

[OWNER TO CONFIRM BEFORE SUBMISSION: support contact; whether the listing is public or limited]
```


### Arabic (primary store language — Egypt)

| Field | Text | Chars / limit |
|---|---|---|
| Google Play — app title | هاتلي للسائقين | 14 / 30 |
| Google Play — short description | لسائقي هاتلي: استلم الطلبات، واتبع الاتجاهات، وأكّد التسليم بصورة. | 66 / 80 |
| App Store — name | هاتلي للسائقين | 14 / 30 |
| App Store — subtitle | لسائقي توصيل هاتلي | 18 / 30 |
| App Store — promotional text | تطبيق سائقي هاتلي: اتصل بالإنترنت، شاهد الطلبات المسندة إليك، افتح الاتجاهات، وأكّد كل تسليم. | 93 / 170 |
| App Store — keywords | سائق,توصيل,مندوب,هاتلي,طلبات | 28 / 100 |

**Full description (Google Play and App Store)** — 677 / 4000 characters

```text
هاتلي للسائقين هو التطبيق المخصص لسائقي التوصيل المسجّلين لدى هاتلي. الحسابات تُنشأ من هاتلي — لا يوجد تسجيل عام.

ماذا يمكنك أن تفعل
• سجّل الدخول بالحساب الذي زوّدتك به هاتلي.
• اختر "متصل" عندما تكون جاهزًا للعمل و"غير متصل" عندما لا تكون كذلك. أثناء اتصالك يشارك التطبيق موقعك مع هاتلي ليتم إسناد الطلبات إليك.
• شاهد الطلبات المسندة إليك مع تفاصيل الاستلام والتسليم.
• افتح الاتجاهات في تطبيق الخرائط لديك.
• حدّث حالة التوصيل خطوة بخطوة.
• سجّل المبلغ النقدي الذي استلمته من العميل.
• التقط صورة كإثبات للتسليم.
• أبلغ عن طلب تعذّر تسليمه مع ذكر السبب.

يُستخدم الموقع فقط أثناء فتح التطبيق وأنت متصل.

[على المالك التأكيد قبل الإرسال: جهة الدعم؛ هل الإدراج عام أم محدود]
```


## Per-store fields that are not copy (owner or legal input)

| Field | Customer app | Driver app |
|---|---|---|
| Category | Food & Drink or Shopping (Play) / Food & Drink (App Store) — owner's choice | Business or Maps & Navigation — owner's choice |
| Content rating questionnaire | answer truthfully; the app has no user-to-user chat, no gambling, no alcohol/tobacco sales feature of its own (vendors' catalogues are the vendors' — **owner to confirm what vendors may list**) | same |
| Contact e-mail / phone, website | **owner** | **owner** |
| Privacy policy URL | **required — owner/legal** (draft points in `PRIVACY_AND_COMPLIANCE.md`) | **required** |
| Account-deletion URL (Play) | **required** — the page exists in code (`apps/dashboard/app/account-deletion`, see `PRIVACY_AND_COMPLIANCE.md` §2/§8); use its published HTTPS address once deployed | required if the listing offers account creation — driver accounts are created by Hatly, so state that deletion is requested through Hatly support |
| Demo account for reviewers | customer: the reviewer can register with phone + password while OTP is off, or give a prepared account | **required**: driver accounts cannot self-register — a reviewable driver account on a reachable backend must exist |
| Age rating / audience | not directed at children | not directed at children |
