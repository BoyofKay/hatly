/** Known UI validation messages; keep the original text in English and preserve unknown diagnostic messages. */
type Translate = (en: string, ar: string) => string;
const AR: Record<string, string> = {
  "A title is required (it is the banner's description for screen readers).": "العنوان مطلوب (يُستخدم كوصف للبانر لقارئات الشاشة).",
  "Titles can be at most 120 characters.": "يجب ألا يتجاوز العنوان 120 حرفًا.",
  "Display order must be a whole number from 0 to 10000.": "يجب أن يكون ترتيب العرض عددًا صحيحًا من 0 إلى 10000.",
  "The start time is not a valid date.": "تاريخ بداية العرض غير صالح.",
  "The end time is not a valid date.": "تاريخ نهاية العرض غير صالح.",
  "The end time must be after the start time.": "يجب أن تكون نهاية العرض بعد بدايته.",
  "Choose the product this banner opens, or set the action to \"None\".": "اختر المنتج الذي يفتحه البانر أو اختر «بدون إجراء».",
  "Choose the vendor branch this banner opens, or set the action to \"None\".": "اختر فرع المتجر الذي يفتحه البانر أو اختر «بدون إجراء».",
  "Choose the sector this banner opens, or set the action to \"None\".": "اختر القطاع الذي يفتحه البانر أو اختر «بدون إجراء».",
  "Only JPEG, PNG or WebP images are allowed.": "الصيغ المسموح بها هي JPEG وPNG وWebP فقط.",
  "The image is larger than 5 MB.": "حجم الصورة أكبر من 5 ميجابايت.",
  "The file is empty.": "الملف فارغ.",
  "The size of this image could not be read.": "تعذّرت قراءة أبعاد الصورة.",
  "A name is required.": "الاسم مطلوب.",
  "Names can be at most 100 characters.": "يجب ألا يتجاوز الاسم 100 حرف.",
  "A slug is required (lowercase letters, numbers, hyphens), e.g. \"restaurants\".": "المعرّف النصي مطلوب (حروف إنجليزية صغيرة وأرقام وشرطات)، مثل restaurants.",
  "The slug may only contain lowercase letters, numbers, hyphens or underscores (no spaces).": "يسمح المعرّف النصي بحروف إنجليزية صغيرة وأرقام وشرطات أو شرطات سفلية فقط (دون مسافات).",
  "Display order must be a whole number ≥ 0.": "يجب أن يكون ترتيب العرض عددًا صحيحًا لا يقل عن صفر.",
  "Minimum must be a whole number ≥ 0.": "يجب أن يكون الحد الأدنى عددًا صحيحًا لا يقل عن صفر.",
  "Maximum must be a whole number ≥ 1 (or empty for no limit).": "يجب أن يكون الحد الأقصى عددًا صحيحًا لا يقل عن واحد (أو اتركه فارغًا بلا حد)."
};
export function localizeAdminFormMessage(message: string, t: Translate): string {
  const known = AR[message];
  if (known) return t(message, known);
  const image = /^The image is (\d+)×(\d+)\. A banner must be at least (\d+)×(\d+) pixels \(recommended 1080×1080\)\.$/.exec(message);
  if (image) return t(message, `أبعاد الصورة ${image[1]}×${image[2]}. يجب ألا تقل أبعاد البانر عن ${image[3]}×${image[4]} بكسل (الموصى به 1080×1080).`);
  return message;
}
