# Tester guide and messages — Google Play closed test (DRAFT; nothing sent)

Fill the `[…]` fields when the closed track exists. **Be honest with testers about what they are testing**: while the closed test runs against the *staging* backend, orders are practice orders and nothing is delivered or charged. If the test runs against production with real customers, say that instead and use the production wording.

## Message to send (Arabic)

> مرحبًا [الاسم]،
> أنا [اسمك] وأطلق تطبيق «هاتلي» لتوصيل الطلبات في [المنطقة]. قبل الإطلاق العام تطلب منصة جوجل بلاي أن يجرّب التطبيق ١٢ شخصًا على الأقل لمدة ١٤ يومًا متواصلة — وأحتاج مساعدتك.
> **المطلوب منك (٣ دقائق للبداية):**
> ١. افتح هذا الرابط من هاتف أندرويد وأنت مسجّل بحساب جوجل **[بريد المختبِر]**: [رابط الانضمام]
> ٢. اضغط «أصبح مختبِرًا» (Become a tester)، ثم ثبّت التطبيق من رابط متجر Play الذي يظهر.
> ٣. **لا تلغِ الانضمام ولا تحذف التطبيق قبل مرور ١٤ يومًا** (حتى [تاريخ الانتهاء]) — إلغاء الانضمام يُسقطك من العدد المطلوب.
> **خلال الأسبوعين:** افتح التطبيق ٣ مرات في الأسبوع على الأقل وجرّب: التسجيل برقم هاتف وكلمة مرور، تصفح المتاجر والبحث، إضافة منتجات إلى السلة، إتمام طلب [تجريبي — لن يُسلَّم ولن يُحاسَب عليه / حقيقي]، تتبع الطلب، تقييم متجر، محفظة هاتلي ونقاط هاتلي، خدمة هاتلي والطلب الخاص، وتغيير اللغة والوضع الداكن.
> **أي ملاحظة أو مشكلة؟** أرسلها لي على واتساب: [رقمك] (صورة شاشة + ماذا كنت تفعل).
> شكرًا من القلب 🙏

## Message to send (English)

> Hi [name], I'm launching Hatly, a delivery app for [area]. Google requires at least 12 people to test it for 14 continuous days before the public release — could you help?
> 1. On an Android phone signed in to **[tester Google account]**, open: [opt-in link]
> 2. Tap **Become a tester**, then install the app from the Play Store link that appears.
> 3. **Please don't opt out or uninstall until [end date]** — opting out removes you from the required count.
> During the two weeks open the app at least 3 times a week and try: registering with phone + password, browsing stores and search, adding to the cart, placing a [practice — nothing will be delivered or charged / real] order, tracking it, rating a store, the Hatly wallet and points, Hatly Service and custom requests, switching language and dark mode.
> Problems or feedback: WhatsApp me at [number] with a screenshot and what you were doing. Thank you!

## Driver-app testers (only if the driver app also runs a qualifying test)

Each driver tester needs **their own** driver account created by Hatly (accounts cannot be shared — one login per account signs the other out). Tasks: sign in, go online/offline, open a delivery, open directions, update statuses, record cash, take the proof-of-delivery photo, report a failed delivery. Delivery orders must be created for them to handle (an admin or the tester customers place them on the staging backend).

## What a good tester log looks like (Google asks how feedback was collected)

Keep one row per tester in `FEEDBACK_LOG_AND_APPLICATION_DRAFT.md` (template there): Google account, device/Android version, opt-in date, last confirmed use, issues reported, issues fixed in which build.
