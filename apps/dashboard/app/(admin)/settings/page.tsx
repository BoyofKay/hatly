'use client';
import { minorToEgpInput, parseEgpToMinorAllowZero } from '../../../lib/money';

import { useEffect, useRef, useState } from 'react';
import { clearBusinessConfigValue, getBusinessConfigValue, setBusinessConfigValue } from '../../../lib/api/admin-business-config';
import {
  EMPTY_ROUTE_DEFAULT_FORM,
  ROUTE_DEFAULT_DEFS,
  buildRouteDefault,
  formFromValue,
  statusOf,
  type RouteDefaultDef,
  type RouteDefaultForm,
  type RouteDefaultStatus,
} from '../../../lib/service-routes/route-defaults';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';

const CUSTOMER_OTP_ENABLED_KEY = 'CUSTOMER_OTP_ENABLED';

/**
 * M3a (Launch-Readiness Gap Audit, G-28). A curated, understood subset
 * of `BusinessConfigKey` (business-config-key.enum.ts) — NOT every key
 * the backend's generic `PUT admin/business-config/:key` would accept.
 * Deliberately excluded (documented in the M3a report, not silently
 * dropped): the Hatly / Wasally default route locations (lat/lng/label objects — they have
 * their own card, `RouteDefaultsCard`, below; PD-012) and
 * `CHECKOUT_ENABLED_ELECTRONIC_METHODS` (an array of a payment-method
 * enum needing a multi-select, not a single scalar control) — both real
 * capabilities, just outside this generic editor's single-scalar shape.
 * `CUSTOMER_OTP_ENABLED` is already its own dedicated control above,
 * not duplicated here.
 */
/** `money`: stored as integer piastres, shown and typed as EGP with up to 2 decimals (10.50). */
type ConfigFieldType = 'boolean' | 'integer' | 'decimal' | 'enum' | 'string' | 'money';

interface ConfigFieldDef {
  key: string;
  label: string;
  labelAr: string;
  type: ConfigFieldType;
  options?: string[];
  unit?: string;
  unitAr?: string;
  help: string;
  helpAr: string;
  /** The setting may be cleared (its absence has a defined meaning, e.g. a default or "off"). */
  clearable?: boolean;
}

const CONFIG_FIELDS: ConfigFieldDef[] = [
  {
    "key": "AUTOMATIC_DISPATCH_ENABLED",
    "label": "Automatic dispatch",
    "labelAr": "التوزيع التلقائي للطلبات",
    "type": "boolean",
    "help": "On: eligible orders are assigned automatically. Off: Operations assigns them manually from Dispatch. Unset defaults to On.",
    "helpAr": "عند التفعيل تُسند الطلبات المؤهلة تلقائيًا. عند الإيقاف يتولى فريق العمليات إسنادها يدويًا من صفحة التوزيع. الإعداد الافتراضي عند عدم التحديد: مفعّل."
  },
  {
    "key": "MULTI_VENDOR_ORDERS_ENABLED",
    "label": "Multi-vendor orders",
    "labelAr": "الطلبات متعددة المتاجر",
    "type": "boolean",
    "help": "On: checkout accepts up to three vendor groups. Off: checkout rejects carts with more than one group without deleting cart contents. Unset defaults to On.",
    "helpAr": "عند التفعيل يُسمح بإتمام طلب يضم حتى ثلاث مجموعات متاجر. عند الإيقاف يُرفض إتمام طلب يضم أكثر من مجموعة دون حذف محتويات السلة. الافتراضي عند عدم التحديد: مفعّل."
  },
  {
    "key": "VENDOR_SETTLEMENT_FREQUENCY",
    "label": "Default vendor settlement frequency",
    "labelAr": "دورة تسوية المتاجر الافتراضية",
    "type": "enum",
    "options": [
      "WEEKLY",
      "MONTHLY"
    ],
    "help": "Weekly or monthly fallback for vendors without their own contractual frequency. Vendor-specific terms override it for all branches. New closings record the effective frequency; no automatic closing or change to closed periods. Required if no vendor override exists.",
    "helpAr": "الدورة الأسبوعية أو الشهرية الافتراضية للمتاجر التي لا تملك دورة تعاقدية خاصة. شروط المتجر الخاصة لها الأولوية لجميع فروعه. يُسجَّل الإعداد الفعلي عند التقفيل الجديد، دون تقفيل تلقائي أو تعديل الفترات المغلقة. يلزم تحديده إذا لم توجد شروط خاصة."
  },
  {
    "key": "DRIVER_SETTLEMENT_FREQUENCY",
    "label": "Driver settlement frequency (legacy)",
    "labelAr": "دورة تسوية المندوبين (إعداد سابق)",
    "type": "enum",
    "options": [
      "WEEKLY",
      "MONTHLY"
    ],
    "help": "Weekly/monthly legacy setting. Current courier closings are recorded as daily financial closings, independent of starting or ending a shift. This setting does not schedule or control current closings.",
    "helpAr": "إعداد سابق أسبوعي أو شهري. تُسجَّل التقفيلات المالية الحالية للمندوبين كتقفيلات يومية مستقلة عن بدء الوردية أو إنهائها. لا يتحكم هذا الإعداد في توقيت التقفيلات الحالية."
  },
  {
    "key": "REGISTERED_VENDOR_PRICE_PER_100M_MINOR",
    "label": "Delivery price per 100 m",
    "labelAr": "سعر التوصيل لكل 100 متر",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Required EGP rate for road-distance pricing, applied to the rounded route distance per 100 m. Also used to calculate the GPS base fee for Hatly and Wasally. Not applied to fixed delivery-area fees.",
    "helpAr": "سعر إلزامي بالجنيه المصري لكل 100 متر من مسافة الطريق بعد التقريب. يُستخدم أيضًا لحساب أساس رسوم هاتلي ووصّلي عند اختيار الموقع على الخريطة. لا يُطبَّق على الرسوم الثابتة لمنطقة التوصيل."
  },
  {
    "key": "REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR",
    "label": "Minimum distance-based delivery fee",
    "labelAr": "الحد الأدنى لرسوم التوصيل حسب المسافة",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Required EGP floor for the distance-based base fee; the larger of distance charge and minimum is used. Fixed area fees are not raised to this minimum.",
    "helpAr": "حد أدنى إلزامي بالجنيه المصري لأجرة التوصيل حسب المسافة؛ يُستخدم الأكبر من أجرة المسافة والحد الأدنى. لا تُرفع الرسوم الثابتة للمنطقة إلى هذا الحد."
  },
  {
    "key": "REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR",
    "label": "Additional vendor delivery fee",
    "labelAr": "رسوم التوصيل لكل متجر إضافي",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Required EGP surcharge for each additional registered-vendor group after the first, on both fixed-area and GPS orders. Zero permits additional groups without a surcharge.",
    "helpAr": "رسوم إلزامية بالجنيه المصري لكل مجموعة متجر مسجل إضافية بعد الأولى، سواء بالتسعير الثابت للمنطقة أو حسب المسافة. الصفر يعني عدم إضافة رسوم."
  },
  {
    "key": "VOICE_NOTE_MAX_SECONDS",
    "label": "Voice note limit",
    "labelAr": "الحد الأقصى للرسالة الصوتية",
    "type": "integer",
    "unit": "seconds",
    "unitAr": "ثانية",
    "help": "The longest voice note a customer can record on a Hatly, Wasaly or store custom request. Blank = 300 seconds (5 minutes); allowed 30–600 seconds. Applies to new recordings.",
    "helpAr": "أطول رسالة صوتية يستطيع العميل تسجيلها في طلب هاتلي أو وصّلي أو الطلب المخصص من متجر. الافتراضي 300 ثانية (5 دقائق)؛ المسموح 30–600 ثانية. يسري على التسجيلات الجديدة.",
    "clearable": true
  },
  {
    "key": "HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER",
    "label": "Hatly & Wasally delivery fee multiplier",
    "labelAr": "معامل رسوم توصيل هاتلي ووصّلي",
    "type": "decimal",
    "unit": "× base fee",
    "unitAr": "× الرسم الأساسي",
    "help": "Applies once to the base delivery fee for both services: fixed delivery-area fee for manual addresses or road-distance base fee for GPS. Approved seeded value 1.5; positive, up to 10. Required. New quotes only; existing orders keep frozen fees.",
    "helpAr": "يُطبّق مرة واحدة على أساس رسوم الخدمتين: رسوم منطقة التوصيل الثابتة للعنوان اليدوي أو رسوم الطريق الأساسية للموقع على الخريطة. القيمة المعتمدة عند التهيئة 1.5، ويجب أن تكون موجبة ولا تتجاوز 10. إلزامي. يسري على عروض الأسعار الجديدة فقط وتظل رسوم الطلبات القائمة كما هي."
  },
  {
    "key": "DRIVER_CASH_WARNING_MINOR",
    "label": "Driver cash exposure warning",
    "labelAr": "حد التنبيه للنقدية المستحقة على المندوب",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Alerts Operations when unclosed plus closed-uncollected cash reaches the warning limit. Must not exceed the hard cap.",
    "helpAr": "يُرسل تنبيهًا للعمليات عند بلوغ مجموع النقدية غير المقفلة والنقدية المقفلة غير المحصّلة حد التنبيه. يجب ألا يتجاوز الحد الأقصى."
  },
  {
    "key": "DRIVER_CASH_CAP_MINOR",
    "label": "Maximum driver cash exposure",
    "labelAr": "الحد الأقصى للنقدية المستحقة على المندوب",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Blocks new assignments at the cap or when projected COD collections would exceed it. Existing orders may be completed.",
    "helpAr": "يمنع إسناد طلبات جديدة عند بلوغ الحد أو إذا كانت التحصيلات النقدية المتوقعة ستتجاوزه. يمكن إتمام الطلبات القائمة."
  },
  {
    "key": "DRIVER_ALLOWANCE_CAP_MINOR",
    "label": "Maximum outstanding daily allowance",
    "labelAr": "الحد الأقصى للعهدة اليومية القائمة",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Blocks additional allowance issuance if the current outstanding allowance plus the new amount would exceed the cap. Zero prevents issuance.",
    "helpAr": "يمنع صرف عهدة إضافية إذا تجاوز مجموع العهدة القائمة والمبلغ الجديد الحد الأقصى. الصفر يمنع الصرف."
  },
  {
    "key": "EMPLOYEE_LOAN_MAX_OUTSTANDING_MINOR",
    "label": "Maximum outstanding driver loans",
    "labelAr": "الحد الأقصى للسلف القائمة للمندوب",
    "type": "money",
    "unit": "EGP",
    "unitAr": "ج.م",
    "help": "Limits a driver's outstanding loans plus any new loan. Blank means no configured cap; Operations decides each loan. Loans remain separate from financial closing.",
    "helpAr": "يحدد الحد الأقصى لمجموع السلف القائمة والسلفة الجديدة للمندوب. عدم التحديد يعني عدم وجود حد مبرمج، وتُقرر العمليات كل سلفة. تظل السلف منفصلة عن التقفيل المالي.",
    "clearable": true
  },
  {
    "key": "MAX_BICYCLE_PICKUP_DISTANCE_METERS",
    "label": "Maximum bicycle pickup distance",
    "labelAr": "أقصى مسافة لاستلام الطلب بالدراجة",
    "type": "integer",
    "unit": "meters",
    "unitAr": "متر",
    "help": "Maximum eligible pickup distance for bicycle drivers, in meters. If unset, bicycle drivers are excluded from automatic ranking.",
    "helpAr": "أقصى مسافة مؤهلة لاستلام الطلب لمندوبي الدراجات بالمتر. عند عدم التحديد يُستبعد مندوبو الدراجات من الترتيب التلقائي."
  },
  {
    "key": "DISPATCH_PREFERRED_RADIUS_METERS",
    "label": "Preferred dispatch radius",
    "labelAr": "نطاق التوزيع المفضّل",
    "type": "integer",
    "unit": "meters",
    "unitAr": "متر",
    "help": "Among eligible drivers within this radius of the first pickup, prefer the fewest active orders, then the nearest. If none is within the radius, use the nearest eligible driver. Blank = 3000 m; allowed 300–50000 m.",
    "helpAr": "يفضّل النظام من بين المندوبين المؤهلين داخل هذا النطاق من نقطة الاستلام الأولى الأقل في الطلبات النشطة، ثم الأقرب. عند عدم وجود مندوب داخله يختار أقرب مندوب مؤهل. الافتراضي 3000 متر؛ المسموح 300–50000 متر.",
    "clearable": true
  },
  {
    "key": "EARLY_DISPATCH_ENABLED",
    "label": "Early dispatch",
    "labelAr": "التوزيع المبكر",
    "type": "boolean",
    "help": "On: assign while the store prepares, at the later of store acceptance and expected ready time minus the lead time. Requires automatic dispatch. Unset defaults to Off. Requires a compatible driver app (build 11 or later).",
    "helpAr": "عند التفعيل يُسند الطلب أثناء التجهيز في الوقت الأبعد بين قبول المتجر وموعد الجاهزية المتوقع ناقص مهلة التوزيع المبكر. يتطلب التوزيع التلقائي. الافتراضي متوقف. يتطلب إصدارًا متوافقًا من تطبيق المندوب (البناء 11 أو أحدث)."
  },
  {
    "key": "DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES",
    "label": "Early dispatch lead time",
    "labelAr": "مهلة التوزيع المبكر",
    "type": "integer",
    "unit": "minutes",
    "unitAr": "دقيقة",
    "help": "Minutes before expected readiness when early dispatch is enabled; never before store acceptance. Blank = 10; allowed 0–120 minutes.",
    "helpAr": "عدد الدقائق قبل موعد الجاهزية المتوقع عند تفعيل التوزيع المبكر؛ لا يتم الإسناد قبل قبول المتجر. الافتراضي 10 دقائق؛ المسموح 0–120 دقيقة.",
    "clearable": true
  },
  {
    "key": "DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES",
    "label": "Driver acknowledgement window",
    "labelAr": "مهلة تأكيد استلام الإسناد",
    "type": "integer",
    "unit": "minutes",
    "unitAr": "دقيقة",
    "help": "Time for a driver to acknowledge a manual or automatic assignment. Overdue assignments alert Operations; with automatic dispatch enabled, eligible unacknowledged orders can be reoffered to another available driver. Blank = 5; allowed 1–30 minutes. New assignments only.",
    "helpAr": "مهلة تأكيد المندوب للإسناد اليدوي أو التلقائي. عند تجاوزها تُنبّه العمليات؛ ومع تفعيل التوزيع التلقائي يمكن إعادة إسناد الطلب المؤهل غير المؤكّد إلى مندوب آخر متاح. الافتراضي 5 دقائق؛ المسموح 1–30 دقيقة. للإسنادات الجديدة فقط.",
    "clearable": true
  },
  {
    "key": "DRIVER_PRESENCE_STALE_MINUTES",
    "label": "Driver app silent alert",
    "labelAr": "تنبيه انقطاع اتصال تطبيق المندوب",
    "type": "integer",
    "unit": "minutes",
    "unitAr": "دقيقة",
    "help": "Alerts Operations when a driver with an active order has not contacted the server for this many minutes. Blank disables the inactivity alert; switching offline can still alert. Allowed 2–240 minutes. Does not cancel or reassign orders.",
    "helpAr": "يُنبه العمليات عند انقطاع اتصال تطبيق مندوب لديه طلب نشط بالخادم لهذه المدة. عدم التحديد يوقف تنبيه الانقطاع، وقد يظل تغيير الحالة إلى غير متصل سببًا للتنبيه. المسموح 2–240 دقيقة. لا يُلغى الطلب أو يُعاد إسناده تلقائيًا بسبب هذا التنبيه.",
    "clearable": true
  },
  {
    "key": "MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES",
    "label": "Transfer verification window",
    "labelAr": "مهلة التحقق من التحويل",
    "type": "integer",
    "unit": "minutes",
    "unitAr": "دقيقة",
    "help": "Unverified InstaPay/Vodafone Cash orders are automatically cancelled after this time from placement; stock is released. Late money is reviewed for refund, not order reactivation. Blank disables automatic cancellation; allowed 15–10080 minutes.",
    "helpAr": "تُلغى تلقائيًا طلبات إنستاباي أو فودافون كاش غير المتحقق من تحويلها بعد هذه المدة من إنشاء الطلب، ويُحرّر المخزون. تُراجع التحويلات المتأخرة لاستردادها لا لإعادة تنشيط الطلب. عدم التحديد يوقف الإلغاء التلقائي؛ المسموح 15–10080 دقيقة.",
    "clearable": true
  },
  {
    "key": "LOYALTY_POINTS_PER_EGP",
    "label": "Loyalty points per EGP",
    "labelAr": "نقاط الولاء لكل جنيه",
    "type": "integer",
    "unit": "points",
    "unitAr": "نقطة",
    "help": "Points earned per EGP of eligible product spending. Blank = 1 point per EGP; separate from the wallet conversion rate.",
    "helpAr": "عدد النقاط المكتسبة لكل جنيه من قيمة المنتجات المؤهلة. الافتراضي نقطة واحدة لكل جنيه؛ وهو مستقل عن معدل التحويل إلى المحفظة."
  },
  {
    "key": "LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP",
    "label": "Loyalty-to-wallet conversion rate",
    "labelAr": "معدل تحويل نقاط الولاء للمحفظة",
    "type": "integer",
    "unit": "points per EGP",
    "unitAr": "نقطة لكل جنيه",
    "help": "Number of points needed to obtain 1 EGP of wallet credit; also the minimum conversion threshold. Blank = 100 points per EGP.",
    "helpAr": "عدد النقاط اللازمة للحصول على جنيه واحد في المحفظة، وهو أيضًا الحد الأدنى للتحويل. الافتراضي 100 نقطة لكل جنيه."
  },
  {
    "key": "CHECKOUT_QUOTE_TTL_SECONDS",
    "label": "Checkout quote validity",
    "labelAr": "مدة صلاحية عرض سعر الطلب",
    "type": "integer",
    "unit": "seconds",
    "unitAr": "ثانية",
    "help": "How long a checkout delivery quote remains valid, in seconds. Blank = 900 seconds (15 minutes). A new quote is needed after expiry.",
    "helpAr": "مدة صلاحية عرض رسوم التوصيل عند إتمام الطلب بالثواني. الافتراضي 900 ثانية (15 دقيقة). يلزم عرض جديد بعد انتهاء الصلاحية."
  },
  {
    "key": "ETA_RANGE_BUFFER_MINUTES",
    "label": "Estimated delivery time buffer",
    "labelAr": "هامش نطاق وقت التوصيل المتوقع",
    "type": "integer",
    "unit": "minutes",
    "unitAr": "دقيقة",
    "help": "Adds minutes to the estimated delivery time to form its upper bound. Blank means show one estimate rather than invent a range.",
    "helpAr": "عدد الدقائق المضافة إلى وقت التوصيل المتوقع لتحديد الحد الأعلى للنطاق. عدم التحديد يعني عرض وقت تقديري واحد دون اختلاق نطاق."
  },
  {
    "key": "CUSTOMER_SERVICE_WHATSAPP_NUMBER",
    "label": "Customer service WhatsApp number",
    "labelAr": "رقم واتساب خدمة العملاء",
    "type": "string",
    "help": "Customer support contact; required alongside the transfer destination for manual transfer. Also the fallback contact for drivers if no Operations phone is set.",
    "helpAr": "رقم التواصل مع خدمة العملاء؛ يلزم مع بيانات وجهة التحويل لتفعيل التحويل اليدوي. ويُستخدم أيضًا بديلًا لرقم العمليات للمندوبين إذا لم يُحدَّد."
  },
  {
    "key": "OPERATIONS_CONTACT_PHONE",
    "label": "Operations phone for drivers",
    "labelAr": "رقم العمليات للمندوبين",
    "type": "string",
    "help": "Number dialed by Call Operations in the driver app. Blank uses customer service contact; if both are absent the action is hidden.",
    "helpAr": "الرقم الذي يتصل به المندوب من زر الاتصال بالعمليات. عند عدم التحديد يُستخدم رقم خدمة العملاء؛ وإذا لم يتوفر الرقمان يُخفى الزر.",
    "clearable": true
  }
];

function ConfigRow({ field }: { field: ConfigFieldDef }) {
  const { t } = useLang();
  const [value, setValue] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Once the admin has edited the field, a load that resolves later (e.g. React StrictMode's second effect run in development)
  // must never overwrite what they typed — otherwise "Save" could silently store the old value instead of theirs.
  const edited = useRef(false);

  async function load() {
    setError(null);
    try {
      const raw = await getBusinessConfigValue<unknown>(field.key);
      if (!edited.current) setValue(raw === null || raw === undefined ? '' : field.type === 'money' ? minorToEgpInput(Number(raw)) : String(raw));
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load.', 'تعذّر التحميل.')));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.key]);

  async function handleSave() {
    if (isSaving) return;
    setError(null);
    setSaved(false);
    let parsed: unknown = value;
    if (field.type === 'integer') {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n)) {
        setError(t('Enter a valid number.', 'أدخل رقمًا صالحًا.'));
        return;
      }
      parsed = n;
    } else if (field.type === 'money') {
      const p = parseEgpToMinorAllowZero(value);
      if (!p.ok) {
        setError(t('Enter an amount in EGP, e.g. 10 or 10.50.', 'أدخل مبلغًا بالجنيه المصري، مثل 10 أو 10.50.'));
        return;
      }
      parsed = p.minor;
    } else if (field.type === 'decimal') {
      const n = Number(value);
      if (!/^\d+(\.\d{1,4})?$/.test(value.trim()) || !(n > 0) || n > 10) {
        setError(t('Enter a positive number up to 10 (e.g. 1.5).', 'أدخل رقمًا موجبًا لا يتجاوز 10 (مثل 1.5).'));
        return;
      }
      parsed = n;
    } else if (field.type === 'boolean') {
      if (!value) { setError(t('Select On or Off.', 'اختر التفعيل أو الإيقاف.')); return; }
      parsed = value === 'true';
    }
    setIsSaving(true);
    try {
      await setBusinessConfigValue(field.key, parsed);
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to save.', 'تعذّر الحفظ.')));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    if (isSaving) return;
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await clearBusinessConfigValue(field.key);
      edited.current = false;
      setValue('');
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to clear.', 'تعذّر المسح.')));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div data-testid={`config-row-${field.key}`} className="grid min-w-0 gap-2 border-b py-3 last:border-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,auto)] lg:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t(field.label, field.labelAr)}</p>
        <p className="mt-1 break-words text-xs text-gray-500">{t(field.help, field.helpAr)}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!loaded ? (
          <span className="text-xs text-gray-400">{t('Loading...', 'جارٍ التحميل...')}</span>
        ) : field.type === 'boolean' ? (
          <select
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">{t('Unset', 'غير محدد')}</option>
            <option value="true">{t('ON', 'مفعّل')}</option>
            <option value="false">{t('OFF', 'متوقف')}</option>
          </select>
        ) : field.type === 'enum' && field.options ? (
          <select
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">{t('Unset', 'غير محدد')}</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o === 'WEEKLY' ? t('Weekly', 'أسبوعيًا') : o === 'MONTHLY' ? t('Monthly', 'شهريًا') : o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={field.type === 'integer' ? 'number' : 'text'}
            inputMode={field.type === 'decimal' || field.type === 'money' ? 'decimal' : undefined}
            data-testid={`config-input-${field.key}`}
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] w-40 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          />
        )}
        {field.unit && <span className="text-xs text-gray-400">{t(field.unit, field.unitAr ?? field.unit)}</span>}
        <button
          onClick={handleSave}
          disabled={isSaving || !loaded}
          className="min-h-[40px] rounded-lg bg-hatly-orange px-4 py-1 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {isSaving ? t('Saving...', 'جارٍ الحفظ...') : t('Save', 'حفظ')}
        </button>
        {field.clearable && (
          <button
            onClick={handleClear}
            disabled={isSaving || !loaded}
            data-testid={`config-clear-${field.key}`}
            className="min-h-[40px] rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 hover:bg-gray-50"
          >
            {t('Clear', 'مسح')}
          </button>
        )}
        {saved && <span className="text-xs text-green-700">{t('Saved', 'تم الحفظ')}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}


const ROUTE_AR: Record<string, [string, string]> = {"HATLY_SERVICE_DEFAULT_PICKUP_LOCATION":["هاتلي — نقطة البداية الافتراضية","نقطة بداية طلب هاتلي من مكان عندما لا يحدد العميل نقطة بداية أخرى."],"HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION":["هاتلي — الوجهة الافتراضية","وجهة طلب هاتلي عندما لا يحدد العميل وجهة أخرى."],"WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION":["وصّلي — الوجهة الافتراضية","وجهة طلب وصّلي لمكان عندما لا يحدد العميل وجهة أخرى. يختار العميل دائمًا مكان الاستلام."]};
const routeValidationAr: Record<string, string> = {"Enter the label customers will see (e.g. the place name).":"أدخل الاسم الذي سيظهر للعملاء (مثل اسم المكان).","The label can be at most 120 characters.":"يجب ألا يتجاوز الاسم 120 حرفًا.","Latitude and longitude must be decimal numbers (e.g. 30.4181 and 31.5622).":"يجب إدخال خط العرض وخط الطول كأرقام عشرية (مثل 30.4181 و31.5622).","Latitude must be between 21.9 and 31.7 (Egypt). Latitude and longitude may be swapped.":"يجب أن يكون خط العرض بين 21.9 و31.7 (مصر). تحقق من عدم عكس الإحداثيات.","Longitude must be between 24.6 and 36.9 (Egypt). Latitude and longitude may be swapped.":"يجب أن يكون خط الطول بين 24.6 و36.9 (مصر). تحقق من عدم عكس الإحداثيات."};
const STATUS_TEXT: Record<RouteDefaultStatus, { text: string; className: string }> = {
  NOT_CONFIGURED: { text: 'Not configured — customers must choose this point themselves', className: 'text-amber-700' },
  CONFIGURED: { text: 'Configured', className: 'text-green-700' },
  INVALID: { text: 'Stored value is invalid — it is ignored until you save a valid one', className: 'text-red-700' },
};

/** One default route location: status, the three fields, Save (validated here and again by the backend) and Clear. */
function RouteDefaultRow({ def, onChanged }: { def: RouteDefaultDef; onChanged: (key: string, raw: unknown) => void }) {
  const { t } = useLang();
  const [form, setForm] = useState<RouteDefaultForm>({ ...EMPTY_ROUTE_DEFAULT_FORM });
  const [status, setStatus] = useState<RouteDefaultStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await getBusinessConfigValue<unknown>(def.key);
        if (cancelled) return;
        setStatus(statusOf(raw));
        setForm(formFromValue(raw));
        onChanged(def.key, raw);
      } catch (err: any) {
        if (!cancelled) setError(apiErrorMessage(err, t("Failed to load.", "تعذّر التحميل.")));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key]);

  function edit(patch: Partial<RouteDefaultForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setNote(null);
  }

  async function save() {
    if (busy) return;
    setError(null);
    setNote(null);
    const built = buildRouteDefault(form);
    if (!built.ok) {
      setError(t(built.error, routeValidationAr[built.error] ?? built.error));
      return;
    }
    setBusy(true);
    try {
      await setBusinessConfigValue(def.key, built.value);
      setStatus('CONFIGURED');
      setForm(formFromValue(built.value));
      onChanged(def.key, built.value);
      setNote(t("Saved. New quotes use it immediately; placed orders keep the route they were frozen with.", "تم الحفظ. تستخدم عروض الأسعار الجديدة هذا الموقع فورًا، وتحتفظ الطلبات القائمة بمسارها الأصلي."));
    } catch (err: any) {
      setError(apiErrorMessage(err, t("Failed to save.", "تعذّر الحفظ.")));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    if (!window.confirm(t(`Clear "${def.title}"? Customers will then have to choose this point themselves.`, `مسح «${ROUTE_AR[def.key]?.[0] ?? def.title}»؟ سيحتاج العملاء إلى اختيار هذه النقطة بأنفسهم.`))) return;
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await clearBusinessConfigValue(def.key);
      setStatus('NOT_CONFIGURED');
      setForm({ ...EMPTY_ROUTE_DEFAULT_FORM });
      onChanged(def.key, null);
      setNote(t("Cleared.", "تم المسح."));
    } catch (err: any) {
      setError(apiErrorMessage(err, t("Failed to clear.", "تعذّر المسح.")));
    } finally {
      setBusy(false);
    }
  }

  const s = status ? STATUS_TEXT[status] : null;
  return (
    <div className="border-b py-3 last:border-0" data-testid={`route-default-${def.key}`}>
      <p className="text-sm font-medium">{t(def.title, ROUTE_AR[def.key]?.[0] ?? def.title)}</p>
      <p className="text-xs text-gray-500">{t(def.help, ROUTE_AR[def.key]?.[1] ?? def.help)}</p>
      <p className={`mt-1 text-xs ${s?.className ?? 'text-gray-400'}`} data-testid={`route-default-status-${def.key}`}>
        {s && status ? t(s.text, { NOT_CONFIGURED: 'غير محدد — يجب أن يختار العملاء هذه النقطة بأنفسهم', CONFIGURED: 'تم التحديد', INVALID: 'القيمة المحفوظة غير صالحة — يتم تجاهلها حتى حفظ قيمة صالحة' }[status]) : t('Loading...', 'جارٍ التحميل...')}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_8rem_1fr]">
        <input
          aria-label={`${def.title} latitude`}
          data-testid={`route-default-lat-${def.key}`}
          inputMode="decimal"
          placeholder={t("Latitude", "خط العرض")}
          value={form.latitude}
          onChange={(e) => edit({ latitude: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
        <input
          aria-label={`${def.title} longitude`}
          data-testid={`route-default-lng-${def.key}`}
          inputMode="decimal"
          placeholder={t("Longitude", "خط الطول")}
          value={form.longitude}
          onChange={(e) => edit({ longitude: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
        <input
          aria-label={`${def.title} label`}
          data-testid={`route-default-label-${def.key}`}
          maxLength={120}
          placeholder={t("Label customers see (e.g. the place name)", "الاسم الذي يظهر للعملاء (مثل اسم المكان)")}
          value={form.label}
          onChange={(e) => edit({ label: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy || status === null} className="rounded-lg bg-hatly-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {busy ? t("Working...", "جارٍ التنفيذ...") : t("Save", "حفظ")}
        </button>
        <button onClick={clear} disabled={busy || status === null || status === 'NOT_CONFIGURED'} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50 border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {t("Clear", "مسح")}
        </button>
        {note && <span className="text-xs text-green-700">{note}</span>}
        {error && <span className="text-xs text-red-600" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/**
 * PD-012. Where Hatly and Wasally routes start and end when the customer does not choose. Hatly has an origin and a destination
 * default; Wasally only a destination default (a Wasally pick-up is always the customer's choice). Nothing is pre-filled or invented:
 * until a default is saved the customer app asks the customer to choose that point.
 */
function RouteDefaultsCard() {
  const { t } = useLang();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const onChanged = (key: string, raw: unknown) => {
    setValues((v) => ({ ...v, [key]: raw }));
    setLoadedKeys((k) => new Set(k).add(key));
  };
  const missing = ROUTE_DEFAULT_DEFS.filter((d) => loadedKeys.has(d.key) && statusOf(values[d.key]) !== 'CONFIGURED');
  return (
    <div className="mt-6 rounded-xl border bg-white p-4 border-gray-200 shadow-sm" data-testid="route-defaults-card">
      <h2 className="font-semibold">{t("Hatly & Wasally default route points", "نقاط المسار الافتراضية لهاتلي ووصّلي")}</h2>
      <p className="mt-1 text-xs text-gray-500">
        {t("Every Hatly / Wasally request goes from an origin to a destination. Each end is the customer's own choice; when they do not choose one, the default below is used. Hatly and Wasally keep separate defaults. A default is never taken from the customer's address, and nothing is filled in for you: enter the real coordinates and the name customers will see.", "ينطلق كل طلب هاتلي أو وصّلي من نقطة بداية إلى وجهة. يختار العميل كل نقطة، وعندما لا يختارها تُستخدم القيمة الافتراضية أدناه. لكل خدمة إعداداتها المستقلة. لا يُستخدم عنوان العميل تلقائيًا ولا تُملأ القيم مسبقًا: أدخل الإحداثيات الفعلية واسم الموقع الذي سيظهر للعملاء.")}
      </p>
      {missing.length > 0 && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="route-defaults-missing">
          {t('Still to enter:', 'لم يتم تحديد:')} {missing.map((d) => t(d.title, ROUTE_AR[d.key]?.[0] ?? d.title)).join(' · ')}.
        </p>
      )}
      <div className="mt-2">
        {ROUTE_DEFAULT_DEFS.map((def) => (
          <RouteDefaultRow key={def.key} def={def} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

/** M3a (Launch-Readiness Gap Audit, G-28). `{ label, phoneOrAccountNumber, accountName? }` — see BusinessConfigKey's own doc comment. Until set, Manual Transfer fails closed. */
function ManualTransferDestinationForm() {
  const { t } = useLang();
  const KEY = 'MANUAL_TRANSFER_DESTINATION';
  const [label, setLabel] = useState('');
  const [phoneOrAccountNumber, setPhoneOrAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const raw = await getBusinessConfigValue<{ label?: string; phoneOrAccountNumber?: string; accountName?: string }>(KEY);
      setLabel(raw?.label ?? '');
      setPhoneOrAccountNumber(raw?.phoneOrAccountNumber ?? '');
      setAccountName(raw?.accountName ?? '');
    } catch (err: any) {
      setError(apiErrorMessage(err, t("Failed to load.", "تعذّر التحميل.")));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!label.trim() || !phoneOrAccountNumber.trim()) {
      setError(t("Label and phone/account number are required.", "اسم الوجهة ورقم الهاتف أو الحساب مطلوبان."));
      return;
    }
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await setBusinessConfigValue(KEY, { label: label.trim(), phoneOrAccountNumber: phoneOrAccountNumber.trim(), accountName: accountName.trim() || undefined });
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, t("Failed to save.", "تعذّر الحفظ.")));
    } finally {
      setIsSaving(false);
    }
  }

  if (!loaded) return <p className="text-sm text-gray-500">{t("Loading...", "جارٍ التحميل...")}</p>;

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} placeholder={t("Label (e.g. InstaPay)", "اسم الوجهة (مثل إنستاباي)")} className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      <input value={phoneOrAccountNumber} onChange={(e) => { setPhoneOrAccountNumber(e.target.value); setSaved(false); }} placeholder={t("Phone or account number", "رقم الهاتف أو الحساب")} className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      <input value={accountName} onChange={(e) => { setAccountName(e.target.value); setSaved(false); }} placeholder={t("Account name (optional)", "اسم صاحب الحساب (اختياري)")} className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">{t("Saved.", "تم الحفظ.")}</p>}
      <button type="submit" disabled={isSaving} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
        {isSaving ? t("Saving...", "جارٍ الحفظ...") : t("Save", "حفظ")}
      </button>
    </form>
  );
}

/**
 * Customer Authentication Modes (master implementation) + M3a
 * (Launch-Readiness Gap Audit, G-28) Operational Configuration section.
 * Reuses the existing generic GET/PUT admin/business-config/:key
 * endpoints and MANAGE_BUSINESS_CONFIG permission throughout (enforced
 * server-side; a 403 here shows as a plain error, never bypassed).
 */
export default function SettingsPage() {
  const { t: tl } = useLang();
  const [otpEnabled, setOtpEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const value = await getBusinessConfigValue<boolean>(CUSTOMER_OTP_ENABLED_KEY);
      // Matches the backend's own default: unset (null) means OTP mode (true).
      setOtpEnabled(value ?? true);
    } catch (err: any) {
      setError(apiErrorMessage(err, tl("Failed to load setting.", "تعذّر تحميل الإعداد.")));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle() {
    if (otpEnabled === null || isSaving) return;
    const next = !otpEnabled;
    if (!next) {
      // Lightweight confirmation before switching OFF — window.confirm,
      // matching this Dashboard's existing convention (no new
      // confirmation-dialog infrastructure introduced).
      const confirmed = window.confirm(
        tl('Turn OFF phone verification by OTP? New customers will still register and sign in with Phone + Password, but they will not be asked to verify their phone number with a code until this is turned back on. Existing accounts and sessions are not affected.', 'هل تريد إيقاف التحقق من الهاتف برمز لمرة واحدة؟ سيستمر العملاء الجدد في التسجيل والدخول برقم الهاتف وكلمة المرور، لكن لن يُطلب منهم تأكيد الرقم برمز حتى إعادة التفعيل. لن تتأثر الحسابات أو الجلسات الحالية.'),
      );
      if (!confirmed) return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await setBusinessConfigValue(CUSTOMER_OTP_ENABLED_KEY, next, 'Controls first-time phone verification by OTP during customer registration. It never changes sign-in: customers always sign in with phone + password.');
      setOtpEnabled(next);
    } catch (err: any) {
      setError(apiErrorMessage(err, tl("Failed to update setting.", "تعذّر تحديث الإعداد.")));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="min-w-0"><h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{tl('Settings', 'الإعدادات')}</h1><p className="mt-1 max-w-3xl text-sm text-gray-500">{tl('Platform-wide settings. A change applies immediately to every customer and vendor.', 'إعدادات على مستوى المنصة. يسري أي تغيير فورًا على كل العملاء والمتاجر.')}</p></div>

      <nav aria-label={tl('Settings sections', 'أقسام الإعدادات')} className="-mx-1 mt-4 flex flex-wrap gap-2 bg-gray-50/95 px-1 py-2 backdrop-blur" data-testid="settings-nav">
        {([['sec-auth', tl('Authentication', 'تسجيل الدخول')], ['sec-config', tl('Operational configuration', 'الإعدادات التشغيلية')], ['sec-routes', tl('Hatly & Wasally routes', 'مسارات هاتلي ووصّلي')], ['sec-payments', tl('Manual transfer', 'التحويل اليدوي')]] as const).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">{label}</a>
        ))}
      </nav>

      <div id="sec-auth" className="mt-4 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{tl('Customer Authentication — OTP', 'التحقق من هاتف العميل برمز لمرة واحدة')}</p>
            <p className="mt-1 text-sm text-gray-500">
              {tl('OTP is used only for first-time phone verification during registration. Sign-in always uses phone + password.', 'يُستخدم رمز التحقق لمرة واحدة لتأكيد رقم الهاتف عند التسجيل أول مرة فقط. تسجيل الدخول دائمًا برقم الهاتف وكلمة المرور.')}
            </p>
            {otpEnabled === true && (
              <p className="mt-1 text-sm text-gray-500">{tl('ON: new customers verify their phone number with a code.', 'مفعّل: يُطلب من العملاء الجدد تأكيد رقم الهاتف برمز.')}</p>
            )}
            {otpEnabled === false && (
              <p className="mt-1 text-sm text-gray-500">
                {tl('OFF: new customers register with phone + password without a code; the number remains unverified until verification is enabled and completed.', 'متوقف: يسجل العملاء الجدد برقم الهاتف وكلمة المرور دون رمز؛ ويظل الرقم غير مؤكد إلى أن يُعاد تفعيل التحقق ويُستكمل.')}
              </p>
            )}
          </div>
          {otpEnabled !== null && (
            <button
              onClick={handleToggle}
              disabled={isSaving}
              className={`min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                otpEnabled ? 'bg-hatly-orange' : 'bg-gray-500'
              }`}
            >
              {isSaving ? tl('Saving...', 'جارٍ الحفظ...') : otpEnabled ? tl('ON', 'مفعّل') : tl('OFF', 'متوقف')}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}{' '}
            <button onClick={load} className="underline">
              {tl("Retry", "إعادة المحاولة")}
            </button>
          </div>
        )}
        {otpEnabled === null && !error && <p className="mt-3 text-sm text-gray-500">{tl("Loading...", "جارٍ التحميل...")}</p>}
      </div>

      <div id="sec-config" className="mt-6 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 className="font-semibold">{tl('Operational Configuration', 'الإعدادات التشغيلية')}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {tl('Each setting is saved independently. Blank means no stored value. The instructions below explain the actual default or restriction for each setting.', 'يُحفظ كل إعداد بشكل مستقل. عدم التحديد يعني عدم وجود قيمة محفوظة. توضح التعليمات أدناه القيمة الافتراضية الفعلية أو القيد الخاص بكل إعداد.')}
        </p>
        <div className="mt-2">
          {CONFIG_FIELDS.map((field) => (
            <ConfigRow key={field.key} field={field} />
          ))}
        </div>
      </div>

      <div id="sec-routes" className="scroll-mt-16"><RouteDefaultsCard /></div>

      <div id="sec-payments" className="mt-6 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 className="font-semibold">{tl('Manual Transfer Destination', 'وجهة التحويل اليدوي')}</h2>
        <p className="mt-1 text-xs text-gray-500">{tl('Manual transfer requires a configured destination and customer support number.', 'يتطلب التحويل اليدوي تحديد وجهة التحويل ورقم خدمة العملاء.')}</p>
        <div className="mt-2">
          <ManualTransferDestinationForm />
        </div>
      </div>
    </div>
  );
}
