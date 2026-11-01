import type { Metadata } from 'next';
import { DRAFT_MARKER, PRIVACY_CONTACT_EMAIL, PRIVACY_EFFECTIVE_DATE, PUBLIC_PAGES_ARE_DRAFT } from '../../lib/legal/public-site';

/**
 * PUBLIC privacy policy (Google Play requires a public privacy-policy URL). Server-rendered, no sign-in, no API call, no customer data.
 * Arabic first (RTL), English below (LTR). Every statement here mirrors the audited behaviour (docs/launch/PRIVACY_AND_COMPLIANCE.md and
 * docs/launch/PLAY_DATA_SAFETY_WORKSHEET.md); keep them in step when behaviour changes. Contact and effective date come from
 * lib/legal/public-site.ts (the owner-approved values, overridable at build time) — never invented; while either is missing or invalid
 * the page carries a visible DRAFT banner.
 */
export const metadata: Metadata = {
  title: 'سياسة الخصوصية — Hatly Privacy Policy',
  description: 'How the Hatly customer app collects, uses, shares and deletes personal data.',
};

type Section = { id: string; title: string; paragraphs?: string[]; items?: string[] };

const AR: { title: string; updated: string; draft: string; contactLabel: string; contactPending: string; sections: Section[] } = {
  title: 'سياسة الخصوصية لتطبيق Hatly',
  updated: 'تاريخ السريان',
  draft: 'مسودة — لم يؤكَّد بعد بريد التواصل أو تاريخ السريان. هذه الصفحة ليست للنشر.',
  contactLabel: 'البريد الإلكتروني للخصوصية',
  contactPending: 'سيُضاف بعد تأكيده.',
  sections: [
    {
      id: 'ar-who',
      title: '1. من نحن ونطاق هذه السياسة',
      paragraphs: [
        'تشرح هذه السياسة كيف يجمع تطبيق Hatly للعملاء (طلبات من المطاعم والمتاجر وخدمة «Hatly Service» للتوصيل والمشاوير) البيانات الشخصية ويستخدمها ويشاركها ويحذفها. وتنطبق على التطبيق وعلى الخوادم التي يتصل بها.',
      ],
    },
    {
      id: 'ar-collect',
      title: '2. البيانات التي نجمعها ولماذا',
      items: [
        'بيانات الحساب (مطلوبة): الاسم ورقم الهاتف المحمول ومعرّف الحساب. رقم الهاتف هو وسيلة تسجيل الدخول ووسيلة تواصل المندوب معك بخصوص طلبك. لا نطلب بريدًا إلكترونيًا.',
        'كلمة المرور: لا نخزّنها كما هي؛ نخزّن فقط بصمة مُشفّرة باتجاه واحد (bcrypt). رموز الدخول في هاتفك محفوظة في التخزين الآمن للجهاز.',
        'العناوين (مطلوبة لطلبات التوصيل): الشارع والمبنى والدور والشقة والعلامة المميزة والتعليمات والمنطقة، وإحداثيات اختيارية. تُنسخ نسخة من العنوان على كل طلب.',
        'الموقع الدقيق (اختياري): لا يُقرأ موقع جهازك إلا عندما تضغط «استخدام موقعي الحالي» عند إضافة عنوان، ويُحفظ كإحداثيات لذلك العنوان. لا نتتبع موقعك في الخلفية. ويمكنك كتابة العنوان بدلًا من ذلك.',
        'الطلبات: الأصناف والكميات والخيارات والأسعار وطريقة الدفع والحالة والتواريخ، وملاحظات الطلب، وسبب الإلغاء، ونص الطلبات الخاصة، وأماكن وإحداثيات مشاوير «Hatly Service».',
        'الصور (اختيارية): فقط الصور التي تختارها من معرض الصور لطلب خاص أو لخدمة «Hatly Service».',
        'التقييمات: عدد النجوم وتعليق اختياري، والمفضلة والسلة.',
        'المحفظة ونقاط الولاء: سجل الحركات والأرصدة. لا نجمع بيانات بطاقات الدفع؛ لا يوجد دفع إلكتروني داخل التطبيق.',
        'الإشعارات: إن كانت الإشعارات الفورية مفعّلة في الإصدار الذي تستخدمه، نحفظ رمز الإشعارات الخاص بجهازك لإرسال تحديثات طلباتك.',
        'البحث: نستخدم نص البحث لعرض النتائج فقط ولا نحفظه.',
        'سجلات الخادم: المسار والحالة والتوقيت لكل طلب، ومعرّف المستخدم وعنوان IP في سجلات الأمان (محاولات الدخول المرفوضة وما شابه)، لحماية الخدمة وتشغيلها.',
      ],
    },
    {
      id: 'ar-share',
      title: '3. من يتلقى بياناتك',
      items: [
        'المندوب المكلَّف بطلبك: اسمك ورقم هاتفك وعنوان التوصيل ومحتوى الطلب والمبلغ المطلوب تحصيله — لتوصيل الطلب.',
        'المتجر/المطعم: محتوى الطلب والخيارات وملاحظاتك للمتجر ونص الطلبات الخاصة وصورها — لتجهيز الطلب. لا يرى المتجر اسمك ولا رقم هاتفك ولا عنوانك.',
        'فريق Hatly المخوَّل: لخدمة العملاء والتشغيل، وفق صلاحيات محددة ومع سجل تدقيق للإجراءات الإدارية.',
        'مزوّد الاستضافة: تُخزَّن البيانات وتُعالَج على خوادم يديرها لنا مزوّد استضافة.',
        'خدمات Google Maps Platform: يرسل خادمنا نص العنوان أو الإحداثيات لتحديد الموقع وحساب المسافة ورسوم التوصيل.',
        'Firebase Cloud Messaging من Google: فقط إذا كانت الإشعارات الفورية مفعّلة؛ يتلقى رمز جهازك ونص الإشعار.',
        'مزوّد الرسائل القصيرة (Unifonic): فقط إذا كان التحقق من رقم الهاتف برسالة مفعّلًا؛ يتلقى رقمك ورمز التحقق.',
        'Google Fonts: يحمّل التطبيق ملفات الخطوط من خوادم Google، فتصل Google معلومات الاتصال المعتادة (مثل عنوان IP) دون بيانات حسابك.',
        'واتساب: فقط عندما تختار التواصل معنا أو إرسال إثبات تحويل عبر واتساب؛ وتنطبق عندها سياسة واتساب.',
        'لا نبيع بياناتك الشخصية، ولا نستخدمها للإعلانات، ولا نستخدم أدوات تتبع إعلاني.',
      ],
    },
    {
      id: 'ar-security',
      title: '4. حماية البيانات',
      paragraphs: [
        'يتصل التطبيق بخوادمنا عبر HTTPS المشفّر، وتُخزَّن كلمات المرور كبصمات bcrypt، والوصول الإداري محدد بالأدوار والصلاحيات مع سجل تدقيق لا يمكن تعديله. لا توجد وسيلة حماية مثالية، ولا نَعِد بأمان مطلق.',
      ],
    },
    {
      id: 'ar-retention',
      title: '5. مدة الاحتفاظ',
      items: [
        'بيانات حسابك تبقى ما دام حسابك قائمًا.',
        'بعد حذف الحساب نحتفظ — دون ما يدل عليك — بسجلات الطلبات والمدفوعات والمحفظة والنقاط والاسترداد (المبالغ والأصناف والتواريخ وأرقام الطلبات)، وعدد النجوم في التقييمات، واسم المكان في طلبات «Hatly Service»، وإثبات التسليم الذي يلتقطه المندوب؛ وذلك للمحاسبة وحل النزاعات والالتزامات القانونية.',
        'قد تبقى نسخ من البيانات في النسخ الاحتياطية وسجلات الخادم إلى أن تُستبدل أو تُحذف وفق جدول الاحتفاظ لدينا.',
      ],
    },
    {
      id: 'ar-delete',
      title: '6. حذف الحساب',
      items: [
        'من التطبيق: الملف الشخصي ← حذف حسابي، مع إدخال كلمة المرور.',
        'بدون التطبيق: من صفحة حذف الحساب (الرابط أدناه) برقم الهاتف وكلمة المرور، فيُحذف الحساب فورًا.',
        'إذا لم تستطع تسجيل الدخول: أرسل طلبًا من الصفحة نفسها برقم هاتفك. يتواصل معك فريق Hatly على الرقم نفسه (اتصال أو رسالة واتساب منه) للتأكد أنه رقمك قبل أي حذف. لن نطلب منك كلمة المرور أبدًا.',
        'يُحذف: الاسم ورقم الهاتف وكلمة المرور والعناوين والإشعارات والمفضلة والسلة وتعليقات التقييم والصور التي رفعتها، ونص الطلبات الخاصة والملاحظات وسبب الإلغاء، وعنوان التوصيل وإحداثيات المشاوير في طلباتك المنتهية.',
        'لا يمكن الحذف أثناء وجود طلب قيد التنفيذ أو رصيد في المحفظة لا يساوي صفرًا (تُسوّى مع الدعم أولًا). تُلغى نقاط الولاء عند الحذف.',
        'السجلات التي نحتفظ بها بعد الحذف موضحة في البند 5.',
      ],
    },
    {
      id: 'ar-rights',
      title: '7. حقوقك',
      paragraphs: [
        'يمكنك عرض بيانات حسابك وعناوينك وطلباتك في التطبيق، وتعديل عناوينك وكلمة مرورك، وحذف حسابك. ولطلب الاطلاع على بياناتك أو تصحيح اسمك أو أي طلب آخر يتعلق بالخصوصية، تواصل معنا عبر وسيلة التواصل أدناه أو عبر دعم واتساب في التطبيق. نتعامل مع الطلبات وفق القانون المعمول به، بما فيه قانون حماية البيانات الشخصية المصري رقم 151 لسنة 2020.',
      ],
    },
    {
      id: 'ar-children',
      title: '8. الأطفال',
      paragraphs: ['تطبيق Hatly غير موجّه للأطفال.'],
    },
    {
      id: 'ar-changes',
      title: '9. التغييرات على هذه السياسة',
      paragraphs: ['قد نحدّث هذه السياسة. ننشر النسخة الجديدة على هذه الصفحة مع تاريخ السريان الجديد.'],
    },
  ],
};

const EN: typeof AR = {
  title: 'Hatly Privacy Policy',
  updated: 'Effective date',
  draft: 'DRAFT — the contact e-mail or effective date has not been confirmed yet. This page is not for publication.',
  contactLabel: 'Privacy contact e-mail',
  contactPending: 'To be added once confirmed.',
  sections: [
    {
      id: 'en-who',
      title: '1. Who we are and what this policy covers',
      paragraphs: [
        'This policy explains how the Hatly customer app (orders from restaurants and shops, and the "Hatly Service" delivery and errand service) collects, uses, shares and deletes personal data. It applies to the app and to the servers it talks to.',
      ],
    },
    {
      id: 'en-collect',
      title: '2. What we collect and why',
      items: [
        'Account details (required): your name, mobile phone number and account ID. The phone number is how you sign in and how the driver can reach you about your order. We do not ask for an e-mail address.',
        'Password: we never store it as typed; we store only a one-way bcrypt hash. Sign-in tokens on your phone are kept in the device\'s secure storage.',
        'Addresses (required for delivery orders): street, building, floor, apartment, landmark, instructions and area, plus optional coordinates. A copy of the address is kept on each order.',
        'Precise location (optional): your device location is read only when you tap "use my current location" while adding an address, and is saved as that address\'s coordinates. We do not track your location in the background. You can type the address instead.',
        'Orders: items, quantities, options, prices, payment method, status and dates; order notes; cancellation reasons; custom-request text; and Hatly Service place names and coordinates.',
        'Photos (optional): only photos you choose from your gallery for a custom request or Hatly Service.',
        'Ratings: stars and an optional comment; your favourites and cart.',
        'Wallet and loyalty points: transaction history and balances. We do not collect payment-card data; there is no in-app electronic payment.',
        'Notifications: if push notifications are enabled in the version you use, we keep your device\'s push token to send order updates.',
        'Search: search text is used only to show results; it is not stored.',
        'Server logs: the path, status and timing of each request, and your user ID and IP address in security logs (refused sign-ins and similar), to protect and operate the service.',
      ],
    },
    {
      id: 'en-share',
      title: '3. Who receives your data',
      items: [
        'The driver assigned to your order: your name, phone number, delivery address, the order contents and the amount to collect — to deliver it.',
        'The shop or restaurant: the order contents, options, your notes to them, and custom-request text and photos — to prepare it. The shop does not see your name, phone number or address.',
        'Authorised Hatly staff: for customer support and operations, with role-based permissions and an audit trail of administrative actions.',
        'Our hosting provider: data is stored and processed on servers a hosting provider runs for us.',
        'Google Maps Platform: our server sends address text or coordinates to locate addresses and compute distance and delivery fees.',
        'Google Firebase Cloud Messaging: only if push notifications are enabled; it receives your device token and the notification text.',
        'Our SMS provider (Unifonic): only if phone verification by text message is enabled; it receives your number and the code.',
        'Google Fonts: the app downloads font files from Google\'s servers, so Google receives ordinary connection information (such as your IP address), not your account data.',
        'WhatsApp: only when you choose to contact us or send a transfer proof through WhatsApp; WhatsApp\'s own policy then applies.',
        'We do not sell your personal data, do not use it for advertising and do not use advertising trackers.',
      ],
    },
    {
      id: 'en-security',
      title: '4. How we protect data',
      paragraphs: [
        'The app talks to our servers over encrypted HTTPS, passwords are stored as bcrypt hashes, and administrative access is limited by role and permission with a tamper-resistant audit trail. No protection is perfect, and we do not promise absolute security.',
      ],
    },
    {
      id: 'en-retention',
      title: '5. How long we keep data',
      items: [
        'Your account data is kept while your account exists.',
        'After you delete your account we keep — without anything that identifies you — order, payment, wallet, loyalty and refund records (amounts, items, dates and order numbers), rating stars, the place name on Hatly Service orders, and the driver\'s proof of delivery, for accounting, dispute resolution and legal obligations.',
        'Copies may remain in backups and server logs until they are overwritten or deleted under our retention schedule.',
      ],
    },
    {
      id: 'en-delete',
      title: '6. Deleting your account',
      items: [
        'In the app: Profile → Delete my account, then enter your password.',
        'Without the app: on the account-deletion page (link below), with your phone number and password — the account is deleted at once.',
        'If you cannot sign in: send a request on the same page with your phone number. The Hatly team will contact you on that number (a call, or a WhatsApp message from it) to confirm it is yours before anything is deleted. We will never ask for your password.',
        'Deleted: your name, phone number, password, addresses, notifications, favourites, cart, review comments and the photos you uploaded, plus custom-request text, notes, cancellation reasons, and the delivery address and errand coordinates on your finished orders.',
        'Deletion is not possible while an order is in progress or while your wallet balance is not zero (settle it with support first). Loyalty points are forfeited.',
        'What we keep after deletion is listed in section 5.',
      ],
    },
    {
      id: 'en-rights',
      title: '7. Your rights',
      paragraphs: [
        'You can view your account, addresses and orders in the app, change your addresses and password, and delete your account. To request a copy of your data, correct your name or make any other privacy request, contact us using the contact below or the WhatsApp support in the app. We handle requests under applicable law, including Egypt\'s Personal Data Protection Law No. 151 of 2020.',
      ],
    },
    { id: 'en-children', title: '8. Children', paragraphs: ['Hatly is not directed at children.'] },
    {
      id: 'en-changes',
      title: '9. Changes to this policy',
      paragraphs: ['We may update this policy. We publish the new version on this page with its new effective date.'],
    },
  ],
};

function PolicyBody({ t, lang }: { t: typeof AR; lang: 'ar' | 'en' }) {
  return (
    <article dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid={`privacy-${lang}`}>
      <h2 className="text-xl font-bold text-gray-900">{t.title}</h2>
      <p className="mt-1 text-sm text-gray-600">
        {t.updated}: {PRIVACY_EFFECTIVE_DATE ?? '—'}
      </p>
      {t.sections.map((s) => (
        <section key={s.id} id={s.id} className="mt-5">
          <h3 className="font-semibold text-gray-900">{s.title}</h3>
          {s.paragraphs?.map((p) => <p key={p} className="mt-2 text-sm leading-7 text-gray-700">{p}</p>)}
          {s.items && (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm leading-7 text-gray-700">
              {s.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          )}
        </section>
      ))}
      <section className="mt-5" id={`${lang}-contact`}>
        <h3 className="font-semibold text-gray-900">{lang === 'ar' ? '10. التواصل' : '10. Contact'}</h3>
        <p className="mt-2 text-sm text-gray-700">
          {t.contactLabel}:{' '}
          {PRIVACY_CONTACT_EMAIL ? (
            <a className="text-hatly-orange underline" href={`mailto:${PRIVACY_CONTACT_EMAIL}`} dir="ltr" data-testid="privacy-contact">{PRIVACY_CONTACT_EMAIL}</a>
          ) : (
            <span>{t.contactPending}</span>
          )}
        </p>
        <p className="mt-2 text-sm text-gray-700">
          <a className="text-hatly-orange underline" href="/account-deletion" data-testid={`privacy-deletion-link-${lang}`}>
            {lang === 'ar' ? 'صفحة حذف الحساب' : 'Account-deletion page'}
          </a>
        </p>
      </section>
    </article>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {PUBLIC_PAGES_ARE_DRAFT && (
          <div {...{ [DRAFT_MARKER]: 'true' }} role="note" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="privacy-draft">
            <p dir="rtl" lang="ar">{AR.draft}</p>
            <p dir="ltr" lang="en">{EN.draft}</p>
          </div>
        )}
        <nav className="flex gap-4 text-sm" aria-label="Language">
          <a href="#privacy-ar" className="text-hatly-orange underline">العربية</a>
          <a href="#privacy-en" className="text-hatly-orange underline">English</a>
        </nav>
        <div id="privacy-ar"><PolicyBody t={AR} lang="ar" /></div>
        <div id="privacy-en"><PolicyBody t={EN} lang="en" /></div>
      </div>
    </main>
  );
}
