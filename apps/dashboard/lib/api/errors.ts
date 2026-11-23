/**
 * The backend's error envelope is `{ error: { code, message, details } }` (HttpExceptionFilter). Admin pages used to read
 * `response.data.message` — a field that never exists — so every server explanation ("This driver is not online", "This
 * order cannot be reassigned: it is PICKED_UP…") was replaced by a generic fallback. This is the one place that reads it.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: any }; code?: string; message?: string } | null;
  if (!e?.response) {
    // No HTTP response at all — the request never reached / returned from the server.
    if (e?.code === 'ERR_NETWORK') return isArabicUi() ? 'تعذّر الوصول إلى الخادم. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not reach the server. Check your connection and try again.';
    return fallback;
  }
  const data = e.response.data;
  const message = data?.error?.message ?? data?.message;
  const details = data?.error?.details;
  // The server explains in English; the Arabic dashboard shows its own text for every known error code.
  if (isArabicUi()) {
    const ar = arabicErrorFor(details?.code ?? data?.error?.code, details);
    if (ar) return ar;
    if (e.response.status === 403) return 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
    // Not translated yet: an Arabic lead, then the server's own reason so nothing is hidden.
    const english = Array.isArray(message) ? message.join(', ') : typeof message === 'string' ? message.trim() : '';
    return english ? `تعذّر تنفيذ العملية: ${english}` : fallback;
  }
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  if (e.response.status === 403) return 'You do not have permission to perform this action.';
  return fallback;
}

/** The dashboard's language is on <html lang> (set by LangProvider); errors outside React read it from there. */
function isArabicUi(): boolean {
  return typeof document !== 'undefined' && document.documentElement.lang === 'ar';
}

/** The machine-readable code of a backend business error (`error.details.code`), or null. */
export function apiErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: any } } | null)?.response?.data;
  return data?.error?.details?.code ?? null;
}

/**
 * Arabic text for the backend's business errors, keyed by `error.details.code` (and `details.reason` where one code has several
 * meanings). The server writes its explanations in English; in the Arabic dashboard `apiErrorMessage` shows these instead.
 * A code that is missing here falls back to a short Arabic lead plus the server's English explanation — never silently wrong.
 * Numbers come from `details` when the server sends them (e.g. a driver's active orders and limit).
 */
type D = Record<string, any>;
type Entry = string | ((d: D) => string);

/** Why a chosen driver was refused (assign or reassign): the server sends `reason` plus the numbers. */
function driverRefusal(d: D): string {
  if (d.reason === 'AT_CAPACITY') return `هذا المندوب لديه ${d.active ?? ''} طلبات نشطة — الحد الأقصى ${d.capacity ?? ''}. اختر مندوبًا آخر، أو غيّر سعته أولًا.`;
  if (d.reason === 'OFFLINE') return 'هذا المندوب غير متصل. اطلب منه الاتصال، أو اختر مندوبًا آخر.';
  return 'المندوب غير متاح الآن. حاول مرة أخرى أو اختر مندوبًا آخر.';
}

const egp = (minor: unknown) => (typeof minor === 'number' ? `${(minor / 100).toFixed(2)} ج.م` : '');

export const AR_ERRORS: Record<string, Entry> = {
  // ---- generic
  VALIDATION_FAILED: 'بعض البيانات غير صحيحة. راجع الحقول وحاول مرة أخرى.',
  NOT_FOUND: 'العنصر غير موجود (ربما حُذف). حدّث الصفحة.',
  FORBIDDEN: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  STATE_CONFLICT: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  SERVICE_UNAVAILABLE: 'الخادم مشغول الآن. حاول مرة أخرى بعد لحظات.',
  INVALID_ID: 'معرّف غير صالح.',
  INVALID_DATE: 'التاريخ غير صالح (الصيغة: سنة-شهر-يوم).',
  INVALID_RANGE: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية.',
  RANGE_REQUIRED: 'اختر فترة زمنية (أو طلبًا).',
  RANGE_TOO_LARGE: (d) => `الفترة أطول من المسموح${d.maxDays ? ` (${d.maxDays} يومًا)` : ''}. اختر فترة أقصر.`,
  REASON_REQUIRED: 'اكتب سببًا (من 3 إلى 300 حرف).',
  QUERY_TOO_SHORT: 'اكتب حرفين على الأقل.',
  UNKNOWN_FILTER: 'أحد الفلاتر غير صالح.',
  UNKNOWN_SORT: 'طريقة الترتيب غير معروفة.',
  INVALID_CHARACTER: 'يحتوي الطلب على حرف غير مسموح.',
  IDEMPOTENCY_CONFLICT: 'تم إرسال هذا الطلب من قبل بمحتوى مختلف. حدّث الصفحة وحاول مرة أخرى.',
  IDEMPOTENCY_KEY_IN_USE: 'هذا الطلب قيد التنفيذ بالفعل. انتظر لحظة.',
  IDEMPOTENCY_KEY_REQUIRED: 'حدّث الصفحة وحاول مرة أخرى.',
  FILE_REQUIRED: 'أرفق الملف أولًا.',
  FILE_TOO_LARGE: 'الملف أكبر من المسموح.',
  TOO_MANY_ROWS: 'الحد الأقصى 500 صف في الملف.',
  REPORT_TIMEOUT: 'استغرق التقرير وقتًا طويلًا. اختر فترة أقصر أو أضف فلترًا.',
  FINANCIAL_ACCESS_REQUIRED: 'هذا المؤشر يحتاج صلاحية الاطلاع على الماليات.',
  MISSING_PERMISSION: 'ليست لديك الصلاحية المطلوبة لهذا الإجراء.',

  // ---- sign-in, passwords, staff
  INVALID_CREDENTIALS: 'رقم الهاتف أو كلمة المرور غير صحيحة.',
  TOO_MANY_FAILED_LOGINS: 'محاولات دخول فاشلة كثيرة. حاول لاحقًا.',
  CURRENT_PASSWORD_INVALID: 'كلمة المرور الحالية غير صحيحة، أو الجديدة مطابقة لها.',
  CURRENT_PASSWORD_REQUIRED: 'أدخل كلمة المرور الحالية لتغييرها.',
  PASSWORD_UNCHANGED: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
  PASSWORD_CHANGE_REQUIRED: 'اختر كلمة مرور جديدة أولاً.',
  PASSWORD_INVALID: 'كلمة المرور غير صحيحة.',
  PASSWORD_REQUIRED: 'أدخل كلمة المرور.',
  WEAK_PASSWORD: 'كلمة المرور يجب أن تكون من 10 إلى 128 حرفًا وتحتوي على حرف ورقم على الأقل.',
  PHONE_IN_USE: 'يوجد حساب آخر بهذا الرقم.',
  PHONE_ALREADY_REGISTERED: 'يوجد حساب آخر بهذا الرقم.',
  MFA_REQUIRED: 'أدخل رمز التحقق.',
  MFA_CODE_INVALID: 'رمز التحقق غير صحيح.',
  MFA_ALREADY_ENABLED: 'تطبيق المصادقة مفعّل بالفعل. أوقفه أولًا لإضافة تطبيق جديد.',
  MFA_NOT_ENABLED: 'لا يوجد تطبيق مصادقة مفعّل.',
  MFA_ENROLLMENT_REQUIRED: 'يجب تفعيل التحقق بخطوتين قبل استخدام هذا الحساب.',
  MFA_NOT_APPLICABLE: 'تطبيق المصادقة لحسابات الإدارة فقط.',
  MFA_RESET_SELF: 'استخدم زر الإيقاف العادي لحسابك أنت.',
  MFA_UNAVAILABLE: 'التحقق بخطوتين غير متاح مؤقتًا. استخدم رمز استرداد أو تواصل مع مدير النظام.',
  STAFF_LEVEL_NOT_BELOW_YOU: 'يمكنك إنشاء أو نقل الموظفين إلى مستوى أقل من مستواك فقط.',
  STAFF_SELF_MANAGEMENT: 'لا يمكنك تعديل حسابك من هنا. استخدم «تغيير كلمة المرور» من اسمك أعلى الصفحة.',
  STAFF_MANAGEMENT_FORBIDDEN: 'ليست لديك صلاحية إدارة هذا الموظف.',
  UNKNOWN_STAFF_LEVEL: 'مستوى الموظف غير معروف.',
  GRANT_EXCEEDS_YOUR_PERMISSIONS: (d) => `يمكنك منح الصلاحيات التي تملكها فقط.${Array.isArray(d.permissions) ? ` غير متاح لك: ${d.permissions.join('، ')}` : ''}`,
  ADMIN_LEVEL_ONLY_PERMISSION: 'هذه الصلاحية للمديرين فقط ولا يمكن منحها للمشرفين أو فريق التشغيل.',
  DELETE_NOT_ALLOWED: 'الحذف يحتاج صلاحية الحذف (للمديرين). أوقف الحساب بدلًا من ذلك.',
  UNKNOWN_PERMISSION: 'صلاحية غير معروفة.',
  UNKNOWN_TEMPLATE: 'قالب الصلاحيات غير معروف.',
  NOT_AN_ADMIN_USER: 'الصلاحيات تُمنح لحسابات الإدارة فقط.',
  SYSTEM_TEMPLATE_IMMUTABLE: 'قوالب النظام لا يمكن تعديلها أو حذفها.',
  TEMPLATE_KEY_EXISTS: 'يوجد قالب بهذا المفتاح بالفعل.',
  SHARED_ACCOUNT: 'هذا الشخص يعمل أيضًا في فرع لا تديره، لذلك هتلي فقط يمكنه تعديل حسابه.',
  ADMIN_ONLY: 'هذا الشخص يعمل أيضًا في فرع لا تديره، لذلك هتلي فقط يمكنه تعديل حسابه.',
  SELF_CHANGE: 'هتلي فقط يمكنه تعديل حساب المدير.',
  MANAGER_ONLY: 'هذا الإجراء لمدير الفرع فقط.',
  LAST_BRANCH: 'هذا هو فرعه الوحيد. أوقف الحساب بدلًا من ذلك.',

  // ---- stores, branches, catalog
  BRANCH_DEACTIVATED: 'هتلي أوقف هذا الفرع، لذلك لا يمكن فتحه.',
  BRANCH_CLOSED: 'المتجر خارج مواعيد العمل ولا يستقبل طلبات الآن.',
  BRANCH_OUTSIDE_OPENING_HOURS: 'المتجر خارج مواعيد العمل ولا يستقبل طلبات الآن.',
  BRANCH_TEMPORARILY_CLOSED: 'الفرع مغلق حاليًا ولا يستقبل طلبات.',
  BRANCH_UNAVAILABLE: 'الفرع غير متاح حاليًا.',
  BRANCH_PICKUP_DISABLED: 'هذا المتجر لا يقدّم الاستلام من الفرع.',
  NO_CHANGE: 'لا يوجد تغيير لحفظه.',
  DIFFERENT_VENDOR: 'هذا الفرع يتبع متجرًا آخر.',
  VENDOR_NOT_FOUND: 'المتجر غير موجود.',
  VENDOR_BRANCH_NOT_FOUND: 'الفرع غير موجود.',
  SECTOR_NOT_ACTIVE: 'لا يمكن ربط فرع بقسم غير مفعّل.',
  SLUG_ALREADY_EXISTS: 'يوجد قسم بنفس المعرّف (slug).',
  SUBCATEGORY_SECTOR_MISMATCH: 'بعض الأقسام الفرعية غير موجودة أو تتبع قسمًا آخر.',
  SERVICE_AREA_NOT_ACTIVE: 'منطقة الخدمة غير موجودة أو غير مفعّلة.',
  SERVICE_AREA_NOT_FOUND: 'منطقة الخدمة غير موجودة.',
  ACCEPTANCE_BY_HATLY: 'هتلي يقبل أو يرفض طلبات هذا الفرع. ابدأ التحضير بعد قبول هتلي.',
  CATEGORY_BRANCH_MISMATCH: 'هذا القسم لا يتبع هذا الفرع.',
  PRODUCT_BRANCH_MISMATCH: 'بعض المنتجات لا تتبع هذا الفرع.',
  PRODUCT_UNAVAILABLE: 'المنتج غير متاح حاليًا.',
  PRODUCT_REJECTED: 'رفض هتلي هذا المنتج. عدّله لإعادة إرساله للمراجعة.',
  PRODUCT_NOT_TRACKED: 'هذا المنتج لا يُحسب مخزونه.',
  TRACKED_QUANTITY_REQUIRED: 'المنتج المحسوب مخزونه يحتاج كمية.',
  PRICING_UNIT_LOCKED: 'لا يمكن تغيير وحدة التسعير (قطعة/وزن) بعد ربط المنتج.',
  PRICING_UNIT_MISMATCH: 'وحدة التسعير (قطعة/وزن) لا تتطابق مع منتج الكتالوج.',
  NEGATIVE_PRICE: 'السعر لا يمكن أن يكون أقل من صفر.',
  CANNOT_WITHDRAW_NEW_PRODUCT: 'المنتج الجديد يبقى في انتظار هتلي؛ أوقفه بدلًا من ذلك إن لم تعد تريده.',
  REQUEST_ALREADY_PENDING: 'يوجد طلب من نفس النوع في انتظار هتلي. اسحبه أولًا لإرسال طلب مختلف.',
  REQUEST_NOT_PENDING: 'تم البت في هذا الطلب بالفعل.',
  CATALOG_BARCODE_ALREADY_EXISTS: 'يوجد منتج في الكتالوج بنفس الباركود.',
  CATALOG_PRODUCT_ALREADY_LISTED_IN_BRANCH: 'هذا الفرع يعرض منتج الكتالوج هذا بالفعل.',
  CATALOG_PRODUCT_INACTIVE: 'منتج الكتالوج غير مفعّل. فعّله أولًا.',
  LISTING_ALREADY_LINKED: 'هذا المنتج مرتبط بالفعل بمنتج كتالوج.',
  LISTING_NOT_LINKED: 'هذا المنتج غير مرتبط بمنتج الكتالوج هذا.',
  OPTION_GROUP_WOULD_BE_EMPTY: 'هذه المجموعة إلزامية ويجب أن تبقى بها اختيارات كافية. عدّل المجموعة أولًا أو احذفها كلها.',
  OPTION_VALUE_NAME_TAKEN: 'يوجد اختيار بنفس الاسم في هذه المجموعة.',
  CONFIRM_COUNT_MISMATCH: 'أكّد عدد المنتجات المحددة.',
  BULK_LIMIT: 'إجراء جماعي غير معروف أو عدد أكبر من المسموح.',
  IMPORT_VALIDATION_FAILED: 'في الملف أخطاء ولم يُحفظ شيء. راجع الأخطاء لكل صف.',
  INVALID_WORKBOOK: 'ملف إكسل غير صالح أو لا يمكن قراءته.',
  INVALID_HEADER: 'عناوين أعمدة الإكسل غير صحيحة. استخدم القالب كما هو.',
  STOCKTAKE_ALREADY_OPEN: 'يوجد جرد مفتوح لهذا الفرع. أنهِه أو ألغِه أولًا.',
  STOCKTAKE_CLOSED: 'هذا الجرد مغلق.',
  NO_TRACKED_PRODUCTS: 'لا توجد في هذا الفرع منتجات يُحسب مخزونها.',
  WOULD_GO_NEGATIVE: 'تطبيق هذا الجرد سيجعل مخزون منتج أقل من صفر (تغيّر المخزون أثناء الجرد). أعد عدّ هذا المنتج.',
  CLOSURE_OVERLAPS: 'يوجد إغلاق آخر يغطي جزءًا من هذه الفترة. ألغِه أو اختر تواريخ أخرى.',
  ALREADY_CANCELLED: 'تم إلغاء هذا بالفعل.',
  ALREADY_ENDED: 'انتهى هذا الإغلاق بالفعل.',

  // ---- media, banners
  IMAGE_TOO_LARGE: 'الصورة أكبر من 5 ميجابايت.',
  UNSUPPORTED_IMAGE_TYPE: 'الصور المقبولة: JPEG أو PNG أو WebP فقط.',
  INVALID_IMAGE_REFERENCE: 'بعض الصور غير صالحة.',
  MEDIA_UNSUPPORTED_TYPE: 'الصور المقبولة: JPEG أو PNG أو WebP فقط (لا GIF ولا SVG ولا HEIC ولا PDF).',
  MEDIA_ANIMATED_NOT_ALLOWED: 'الصور المتحركة غير مقبولة.',
  MEDIA_FILE_TOO_LARGE: 'حجم الملف أكبر من 5 ميجابايت.',
  MEDIA_TOO_SMALL: 'الصورة صغيرة جدًا لهذا الاستخدام. استخدم صورة أكبر (200 × 200 على الأقل).',
  MEDIA_TOO_LARGE_DIMENSIONS: 'أبعاد الصورة أكبر من المسموح لهذا الاستخدام.',
  MEDIA_TOO_MANY_PIXELS: 'الصورة كبيرة جدًا (عدد بكسلات أكبر من المسموح).',
  MEDIA_CORRUPT: 'الصورة تالفة ولا يمكن قراءتها.',
  MEDIA_EMPTY: 'لم يتم استلام ملف.',
  MEDIA_BAD_CROP: 'منطقة القص خارج الصورة.',
  MEDIA_IN_USE: 'الصورة مستخدمة في سجلات أخرى. استبدلها هناك أولًا.',
  MEDIA_NOT_ACTIVE: 'الصورة محذوفة. استرجعها أولًا.',
  MEDIA_NOT_FOUND: 'الصورة غير موجودة أو محذوفة.',
  MEDIA_PURPOSE_FORBIDDEN: 'ليست لديك صلاحية رفع صور لهذا الاستخدام.',
  MEDIA_PURPOSE_MISMATCH: 'هذه الصورة مرفوعة لاستخدام آخر. ارفع صورة لهذا الغرض.',
  MEDIA_PURPOSE_UNKNOWN: 'نوع الاستخدام غير معروف.',
  BANNER_IMAGE_REQUIRED: 'ارفع صورة قبل نشر البانر.',
  BANNER_IMAGE_TOO_SMALL: 'صورة البانر صغيرة. الموصى به 1200 × 600.',
  BANNER_IMAGE_WRONG_SHAPE: 'البانر يجب أن يكون عريضًا بنسبة 2:1 تقريبًا (الموصى به 1200 × 600).',
  BANNER_IMAGE_UNREADABLE: 'تعذّرت قراءة أبعاد الصورة. استخدم JPEG أو PNG أو WebP.',
  BANNER_ACTION_TARGET_REQUIRED: 'اختر ما يفتحه البانر.',
  BANNER_ACTION_TARGET_UNEXPECTED: 'اختر ما يفتحه البانر.',
  BANNER_ACTION_TARGET_NOT_FOUND: 'الوجهة المختارة غير موجودة.',
  BANNER_NOT_FOUND: 'البانر غير موجود.',
  BANNER_SCHEDULE_INVALID: 'وقت النهاية يجب أن يكون بعد وقت البداية.',

  // ---- delivery: zones, drivers, dispatch
  DELIVERY_ZONE_NAME_TAKEN: 'يوجد نطاق توصيل بنفس الاسم في منطقة الخدمة هذه.',
  DELIVERY_ZONE_NOT_FOUND: 'نطاق التوصيل غير موجود.',
  DELIVERY_ZONE_UNAVAILABLE: 'نطاق التوصيل هذا غير متاح.',
  INVALID_REPRESENTATIVE_POINT: 'خط العرض وخط الطول يجب إدخالهما (أو حذفهما) معًا.',
  ADDRESS_OUT_OF_SERVICE_AREA: 'هتلي لا يوصّل إلى هذا الموقع بعد.',
  ADDRESS_ZONE_REQUIRED: 'اختر نطاق التوصيل لهذا العنوان.',
  INVALID_DELIVERY_LOCATION: 'موقع العنوان على الخريطة غير صحيح.',
  DELIVERY_FEE_UNAVAILABLE: 'تعذّر حساب رسوم التوصيل الآن. حاول بعد قليل.',
  DRIVER_UNAVAILABLE: (d) => driverRefusal(d),
  NO_AVAILABLE_DRIVER: (d) => (d.reason ? driverRefusal(d) : 'لا يوجد مندوب متاح للإسناد الآن.'),
  DRIVER_ALREADY_ASSIGNED: 'هذا المندوب مُسند لهذا الطلب بالفعل.',
  ASSIGNMENT_CHANGED: 'تغيّر الإسناد للتو. حدّث الصفحة.',
  DRIVER_NOT_ELIGIBLE_WITHOUT_OVERRIDE: 'هذا المندوب لا يستوفي شروط هذا الطلب. الإسناد رغم ذلك يحتاج صلاحية تجاوز الإسناد.',
  ORDER_NOT_ASSIGNABLE: 'لا يمكن إسناد هذا الطلب في حالته الحالية.',
  PICKUP_ORDER_NOT_DISPATCHABLE: 'طلب الاستلام من الفرع يستلمه العميل بنفسه ولا يُسند لمندوب.',
  VEHICLE_TYPE_INACTIVE: 'نوع المركبة غير مفعّل.',
  VEHICLE_TYPE_NOT_FOUND: 'نوع المركبة غير موجود.',
  INVALID_PROOF_PHOTO: 'صورة إثبات التسليم غير صالحة.',
  INVALID_FAILURE_REASON: 'سبب فشل التوصيل غير معروف.',

  // ---- orders
  ORDER_NOT_FOUND: 'الطلب غير موجود.',
  ORDER_ALREADY_CANCELLED: 'هذا الطلب ملغى بالفعل.',
  ORDER_NOT_EDITABLE: 'لم يعد ممكنًا تعديل هذا الطلب.',
  ORDER_NOT_ACTIVE_FOR_VENDOR: 'لم يعد ممكنًا تغيير أجزاء المتاجر في هذا الطلب.',
  ORDER_ASSIGNED_CANNOT_CANCEL_LAST_SEGMENT: 'تم إسناد مندوب بالفعل — لم يعد ممكنًا إلغاء آخر جزء من الطلب.',
  ORDER_NOT_PRICEABLE: 'لا يمكن تأكيد السعر لطلب منتهٍ أو ملغى.',
  ORDER_STILL_ACTIVE: 'الطلب ما زال نشطًا.',
  ORDER_NOT_AT_HANDOVER: 'يُسجَّل الباقي النقدي بعد خروج المندوب للتوصيل أو إتمامه فقط.',
  ORDER_NOT_FAILED_DELIVERY: 'تم حل هذا الطلب بالفعل.',
  CANCELLATION_NEEDS_SUPERVISOR: 'إلغاء الطلب بالكامل يحتاج صلاحية المشرف (مشكلات الطلبات).',
  VENDOR_MAY_ONLY_CANCEL_OWN_SEGMENT: 'المتجر يلغي جزءه فقط من الطلب متعدد المتاجر.',
  REJECTION_REASON_REQUIRED: 'اكتب سبب الرفض.',
  PAYMENT_NOT_APPROVED: 'هذا الطلب في انتظار اعتماد الدفع قبل التحضير أو الإسناد.',
  UNPRICED_CUSTOM_ITEMS_REMAIN: 'بعض الأصناف الخاصة في الطلب ما زالت تحتاج سعرًا نهائيًا قبل تجهيزه.',
  NOT_A_PICKUP_ORDER: 'فقط طلب الاستلام من الفرع يمكن تسجيله «تم الاستلام».',
  NOT_A_WEIGHT_ITEM: 'هذا الصنف ليس بالوزن.',
  WEIGHT_NOT_APPLICABLE: 'هذا الصنف ليس بالوزن.',
  WEIGHT_ALREADY_RECORDED: 'تم تسجيل الوزن الفعلي لهذا الصنف ولا يمكن تغييره.',
  WEIGHT_NOT_RECORDED: 'سجّل الوزن الفعلي لكل الأصناف الموزونة أولًا.',
  WEIGHT_RECORDING_WINDOW_CLOSED: 'لم يعد ممكنًا تسجيل الوزن — تم استلام الطلب من المتجر.',
  SEGMENT_CANCELLED: 'هذا الجزء من الطلب ملغى.',
  INVALID_WEIGHT_GRAMS: 'الوزن غير صحيح.',
  ITEM_ALREADY_REMOVED: 'أحد الأصناف أُزيل من الطلب بالفعل.',
  ITEM_NOT_IN_PART: 'كل الأصناف المختارة يجب أن تتبع هذا الجزء من الطلب.',
  NOT_A_VENDOR_PART: 'هذا ليس جزء متجر من الطلب.',
  NO_VENDOR_PART: 'هذه الحالة لا تخص جزء متجر.',
  NOT_A_CUSTOM_ITEM: 'لا يمكن تسجيل سعر نهائي لهذا الصنف.',
  PURCHASE_ALREADY_RECORDED: 'تم تسجيل السعر النهائي لهذا الصنف ولا يمكن تغييره.',
  NOT_A_HATLY_SERVICE_ITEM: 'التشغيل يؤكد سعر طلبات خدمة هتلي فقط.',
  EXCEPTION_CLOSED: 'هذه الحالة مغلقة.',
  EXCEPTION_ALREADY_DECIDED: 'العميل ردّ بالفعل؛ لا يمكن إضافة أصناف لهذه الحالة.',
  DECISION_ALREADY_RECORDED: 'تم تسجيل رد لهذه الحالة بالفعل.',
  NOT_A_DECISION_CASE: 'هذه الحالة لا تحتاج رد العميل.',
  NOTHING_TO_REMOVE: 'لا توجد أصناف في هذه الحالة.',
  ALREADY_RESOLVED: 'تم حل هذا الطلب بالفعل.',
  INVALID_REFUND_AMOUNT: 'مبلغ الاسترداد غير صحيح.',
  RESOLUTION_NOT_REFUND_CUSTOMER: 'نتيجة الحل لهذا الطلب ليست «استرداد للعميل».',
  REFUND_EXCEEDS_PAYMENT_AMOUNT: 'مبلغ الاسترداد أكبر من المدفوع فعلًا.',

  // ---- payments, refunds, wallet, cash
  ALREADY_VOIDED: 'تم إلغاء هذه الدفعة بالفعل.',
  PAYMENT_NOT_PAID: 'يمكن استرداد دفعة مدفوعة فقط.',
  REFUND_ALREADY_SENT: 'تم تسجيل إرسال هذا الاسترداد بالفعل.',
  REFUND_AMOUNT_MISMATCH: 'تم تسجيل استرداد بمبلغ مختلف لهذه الدفعة.',
  NO_MANUAL_TRANSFER_PAYMENT: 'الاسترداد التلقائي متاح للتحويل اليدوي فقط.',
  UNSUPPORTED_PAYMENT_METHOD_FOR_AUTOMATIC_REFUND: 'الاسترداد التلقائي متاح للتحويل اليدوي فقط.',
  TRANSFER_NOT_FOUND: 'لا يوجد تحويل يدوي لرقم الطلب هذا.',
  MANUAL_TRANSFER_NOT_CONFIGURED: 'التحويل اليدوي غير متاح الآن.',
  OVERPAYMENT_NOT_AUTHORISED: 'ليست لديك صلاحية اعتماد دفع زائد.',
  OVERPAYMENT_REASON_REQUIRED: 'اعتماد الدفع الزائد يحتاج سببًا (5 أحرف على الأقل).',
  EXCEEDS_REMAINING: 'المبلغ أكبر من المتبقي.',
  INSUFFICIENT_WALLET_BALANCE: 'هذا الخصم سيجعل رصيد محفظة العميل أقل من صفر.',
  WALLET_REASON_REQUIRED: 'اكتب سبب حركة المحفظة.',
  INVALID_WALLET_AMOUNT: 'مبلغ المحفظة غير صحيح.',
  NOT_A_CASH_ORDER: 'الباقي النقدي يُسجَّل للطلبات المدفوعة نقدًا فقط.',
  NO_REMAINDER: 'المبلغ المستلم لا يزيد عن المطلوب — لا يوجد باقٍ لتسجيله.',
  INVALID_CASH_RECEIVED: 'المبلغ المستلم غير صحيح.',
  REMAINDER_NOT_PENDING: 'تم البت في هذا الباقي النقدي بالفعل.',
  INVALID_FINAL_AMOUNT: 'المبلغ غير صحيح.',

  // ---- settlements, finance, loans
  ALREADY_SETTLED: 'تمت تسوية هذه الطلبات للتو في إقفال آخر. حدّث الصفحة.',
  NOTHING_TO_CLOSE: 'لا توجد طلبات أو حركة جديدة للتسوية منذ آخر إقفال.',
  PREVIEW_CHANGED: 'تغيّرت الأرقام منذ المعاينة. حدّث الصفحة وراجعها مرة أخرى.',
  NOTHING_DUE: 'لا يوجد مستحق لهذه الفترة.',
  PERIOD_NOT_CLOSED: 'تُسجَّل الدفعات على فترة مُقفلة فقط.',
  LOAN_ABOVE_MAXIMUM: (d) => `هذه السلفة تتجاوز الحد الأقصى المسموح لما يدين به هذا الشخص${d.capMinor !== undefined ? ` (${egp(d.capMinor)})` : ''}.`,
  REPAYMENT_ABOVE_OUTSTANDING: (d) => `السداد أكبر من المتبقي على هذه السلفة${d.outstandingMinor !== undefined ? ` (${egp(d.outstandingMinor)})` : ''}.`,
  ALREADY_DECIDED: 'تم البت في هذا بالفعل.',
  ADJUSTMENT_TOO_LARGE: 'قيمة التسوية أكبر من المسموح.',
  FOUR_EYES: 'لا يمكنك اعتماد ما أنشأته أو عدّلته بنفسك؛ يحتاج موافقة شخص آخر (والرفض يحتاج سببًا).',

  // ---- offers, coupons
  COUPON_CODE_EXISTS: 'كود الخصم مستخدم في عرض آخر.',
  COUPON_CODE_ALREADY_EXISTS: 'كود الخصم مستخدم بالفعل.',
  COUPON_REQUIRES_SUBTOTAL_DISCOUNT: 'كود الخصم متاح لعروض خصم الإجمالي فقط.',
  OFFER_FIELD_LOCKED: 'تم استخدام العرض بالفعل، لذلك بعض حقوله لا تتغير. انسخ العرض لعمل نسخة جديدة.',
  OFFER_MECHANISM_CONFLICT: 'هذا المنتج عليه عرض نشط من نوع آخر في نفس الفترة.',
  FLASH_SALE_LIMIT_EXCEEDED: 'كمية العرض السريع نفدت بهذا السعر.',
  MISSING_FLASH_SALE_FIELDS: 'العرض السريع يحتاج السعر الخاص.',
  MISSING_SUBTOTAL_DISCOUNT_FIELDS: 'خصم الإجمالي يحتاج نوع وقيمة الخصم.',
  UNEXPECTED_FLASH_SALE_FIELD: 'هذا الحقل لا يخص العرض السريع.',
  UNEXPECTED_SUBTOTAL_DISCOUNT_FIELD: 'هذا الحقل لا يخص خصم الإجمالي.',
  INVALID_DISCOUNT_VALUE: 'قيمة الخصم غير صحيحة.',
  INVALID_VALIDITY_WINDOW: 'نهاية العرض يجب أن تكون بعد بدايته.',
  INVALID_PRICE_RANGE: 'أقل سعر لا يمكن أن يكون أكبر من أعلى سعر.',

  // ---- settings, exports, notifications
  BUSINESS_CONFIG_NOT_SET: 'إعداد مطلوب لم يُضبط بعد.',
  BUSINESS_CONFIG_INVALID: 'أحد إعدادات التسعير غير مضبوط بشكل صحيح.',
  BUSINESS_CONFIG_NOT_CLEARABLE: 'هذا الإعداد لا يمكن مسحه.',
  INVALID_BUSINESS_CONFIG_VALUE: 'القيمة غير صالحة لهذا الإعداد.',
  EXPORT_EXPIRED: 'انتهت صلاحية ملف التصدير. شغّله مرة أخرى.',
  EXPORT_NOT_READY: 'ملف التصدير لم يجهز بعد.',
  EXPORT_NOT_PERMITTED: 'لا يمكن تصدير هذا الملف.',
  EXPORT_TOO_LARGE: 'التقرير أكبر من حد هذا التنسيق. صدّر CSV أو XLSX أو اختر فترة أقصر.',
  WEB_PUSH_NOT_CONFIGURED: 'إشعارات المتصفح غير مضبوطة على الخادم بعد.',
  PUSH_ENDPOINT_NOT_ALLOWED: 'مفاتيح إشعارات المتصفح غير صالحة.',
  CRITICAL_ALERT_CANNOT_BE_MUTED: 'التنبيهات الحرجة تبقى دائمًا في صندوقك.',
  ALERT_NOT_FOUND: 'التنبيه غير موجود.',
  NOTIFICATION_NOT_FOUND: 'الإشعار غير موجود.',
  SMS_PROVIDER_UNAVAILABLE: 'تعذّر إرسال رمز التحقق الآن. حاول بعد قليل.',
  CUSTOM_REQUESTS_NOT_AVAILABLE: 'الطلبات الخاصة غير متاحة لهذا المتجر.',
  NO_ACTIVE_CUSTOMER_ACCOUNT: 'لا يوجد حساب عميل نشط بهذا الرقم.',
  DELETION_REQUEST_NOT_FOUND: 'تم حل هذا الطلب بالفعل.',
  DELETION_REQUEST_NOT_PENDING: 'تم حل هذا الطلب بالفعل.',
  ACCOUNT_HAS_ACTIVE_ORDERS: 'لدى العميل طلب جارٍ.',
  ACCOUNT_HAS_WALLET_BALANCE: 'محفظة العميل ليست فارغة.',
};

/** The Arabic message for a backend error, or null when this code is not translated yet. */
export function arabicErrorFor(code: string | null | undefined, details: D | undefined): string | null {
  if (!code) return null;
  const entry = AR_ERRORS[code];
  if (!entry) return null;
  return typeof entry === 'function' ? entry(details ?? {}) : entry;
}
