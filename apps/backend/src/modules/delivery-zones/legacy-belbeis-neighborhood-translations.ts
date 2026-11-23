/**
 * Product owner-approved starting fee: 1,500 Egyptian piastres = 15 EGP.
 * Source: the actual eleven Production delivery_zones inventory rows as of 2026-11-23.
 *
 * Arabic names are copied verbatim from the original areas JSON arrays.
 * English names are transliterations/short English renderings (editable later in Admin).
 * Do not normalize or discard an Arabic value. The migration validates every original
 * array entry against these exact names and aborts on an unreviewed difference.
 */
export const INITIAL_NEIGHBORHOOD_FEE_MINOR = 1500;
export interface LegacyZoneTranslation {
  parentEn: string;
  parentAr: string;
  children: Array<{nameAr: string; name: string}>;
}
export const LEGACY_ZONE_TRANSLATIONS: LegacyZoneTranslation[] = [
  {
    "parentEn": "Belbeis City",
    "parentAr": "مدينة بلبيس",
    "children": [
      {
        "nameAr": "حي الزهور",
        "name": "Al-Zohour Neighborhood"
      },
      {
        "nameAr": "حي النادي",
        "name": "Al-Nadi Neighborhood"
      },
      {
        "nameAr": "حي علوان",
        "name": "Alwan Neighborhood"
      },
      {
        "nameAr": "المنطقة الصناعية",
        "name": "Industrial Area"
      },
      {
        "nameAr": "حي أبو نصيب",
        "name": "Abu Naseeb Neighborhood"
      },
      {
        "nameAr": "حي سعدون",
        "name": "Saadoun Neighborhood"
      },
      {
        "nameAr": "حي المنشية",
        "name": "Al-Manshiya Neighborhood"
      },
      {
        "nameAr": "حي المركز",
        "name": "Al-Markaz Neighborhood"
      },
      {
        "nameAr": "حي السوق القديم",
        "name": "Old Market Neighborhood"
      },
      {
        "nameAr": "حي السوق",
        "name": "Market Neighborhood"
      },
      {
        "nameAr": "حي المركز الطبي",
        "name": "Medical Center Neighborhood"
      },
      {
        "nameAr": "حي المحطة",
        "name": "Station Neighborhood"
      },
      {
        "nameAr": "حي الساحة",
        "name": "Al-Saha Neighborhood"
      },
      {
        "nameAr": "حي الكلية الجوية",
        "name": "Air Academy Neighborhood"
      },
      {
        "nameAr": "حي المطحن",
        "name": "Al-Mat'han Neighborhood"
      },
      {
        "nameAr": "حي الثانوي العسكرية",
        "name": "Military Secondary School Neighborhood"
      },
      {
        "nameAr": "حي المساكن الجديدة",
        "name": "New Housing Neighborhood"
      },
      {
        "nameAr": "حي المحكمة القديمة",
        "name": "Old Court Neighborhood"
      },
      {
        "nameAr": "حي المحكمة الجديدة",
        "name": "New Court Neighborhood"
      },
      {
        "nameAr": "وسط البلد",
        "name": "Downtown"
      },
      {
        "nameAr": "حي المتاجر الشعبية",
        "name": "Popular Shops Neighborhood"
      },
      {
        "nameAr": "الشارع الجديد",
        "name": "New Street"
      },
      {
        "nameAr": "الشارع القديم",
        "name": "Old Street"
      },
      {
        "nameAr": "حي المظلوم",
        "name": "Al-Mazloum Neighborhood"
      },
      {
        "nameAr": "حي رب العالمين",
        "name": "Rabb Al-Alameen Neighborhood"
      }
    ]
  },
  {
    "parentEn": "Kafr Ayoub Soliman",
    "parentAr": "كفر أيوب سليمان",
    "children": [
      {
        "nameAr": "كفر أيوب سليمان",
        "name": "Kafr Ayoub Soliman"
      },
      {
        "nameAr": "الكتيبة",
        "name": "Al-Katiba"
      },
      {
        "nameAr": "السعادات",
        "name": "Al-Saadat"
      },
      {
        "nameAr": "بساتين سراج الدين",
        "name": "Basatin Siraj El-Din"
      },
      {
        "nameAr": "الطحاوية",
        "name": "Al-Tahaweya"
      }
    ]
  },
  {
    "parentEn": "Kafr Ibrahim El-Aydy",
    "parentAr": "كفر إبراهيم العايدي",
    "children": [
      {
        "nameAr": "الكفر القديم",
        "name": "Old Kafr"
      },
      {
        "nameAr": "كفر إبراهيم العايدي",
        "name": "Kafr Ibrahim El-Aydy"
      },
      {
        "nameAr": "كفر بني عليم",
        "name": "Kafr Bani Aleem"
      },
      {
        "nameAr": "منية سنتا",
        "name": "Minyat Santa"
      }
    ]
  },
  {
    "parentEn": "El-Balashon",
    "parentAr": "البلاشون",
    "children": [
      {
        "nameAr": "البلاشون",
        "name": "El-Balashon"
      },
      {
        "nameAr": "ميت جابر",
        "name": "Mit Gaber"
      },
      {
        "nameAr": "بني صالح",
        "name": "Bani Saleh"
      },
      {
        "nameAr": "قرملة",
        "name": "Qarmala"
      },
      {
        "nameAr": "منشأة السلام",
        "name": "Manshaat El-Salam"
      },
      {
        "nameAr": "كفر مسعود حجازي",
        "name": "Kafr Masoud Hegazy"
      },
      {
        "nameAr": "ميت معلا",
        "name": "Mit Maalla"
      },
      {
        "nameAr": "كفر حفنا",
        "name": "Kafr Hafna"
      }
    ]
  },
  {
    "parentEn": "Awlad Seif",
    "parentAr": "أولاد سيف",
    "children": [
      {
        "nameAr": "أولاد سيف",
        "name": "Awlad Seif"
      },
      {
        "nameAr": "أولاد مهنا",
        "name": "Awlad Mehanna"
      },
      {
        "nameAr": "ميت ربيعة البيضا",
        "name": "Mit Rabia Al-Bayda"
      },
      {
        "nameAr": "نوبة الدهاشنة",
        "name": "Nuba Al-Dahashna"
      },
      {
        "nameAr": "كفر الشيخ عيسى",
        "name": "Kafr El-Sheikh Eissa"
      },
      {
        "nameAr": "المنشية",
        "name": "Al-Manshiya"
      },
      {
        "nameAr": "الروضة",
        "name": "Al-Rawda"
      },
      {
        "nameAr": "العرايشية",
        "name": "Al-Arayeshya"
      },
      {
        "nameAr": "حوض الندى",
        "name": "Hawd Al-Nada"
      }
    ]
  },
  {
    "parentEn": "El-Adleya",
    "parentAr": "العدلية",
    "children": [
      {
        "nameAr": "العدلية",
        "name": "El-Adleya"
      },
      {
        "nameAr": "ميت حمل",
        "name": "Mit Hamal"
      },
      {
        "nameAr": "الشغانبة",
        "name": "Al-Shaghanba"
      },
      {
        "nameAr": "ميت حبيب",
        "name": "Mit Habib"
      },
      {
        "nameAr": "كفر أكياد",
        "name": "Kafr Akyad"
      },
      {
        "nameAr": "سندنهور",
        "name": "Sandanhour"
      },
      {
        "nameAr": "قهلة الجبلة",
        "name": "Qahla Al-Gabla"
      },
      {
        "nameAr": "كفر العرب",
        "name": "Kafr El-Arab"
      }
    ]
  },
  {
    "parentEn": "Ghita",
    "parentAr": "غيتة",
    "children": [
      {
        "nameAr": "غيتة",
        "name": "Ghita"
      },
      {
        "nameAr": "السلام",
        "name": "Al-Salam"
      },
      {
        "nameAr": "تل روزن",
        "name": "Tell Rozen"
      },
      {
        "nameAr": "الشولية",
        "name": "Al-Shawliya"
      }
    ]
  },
  {
    "parentEn": "El-Zawamel",
    "parentAr": "الزوامل",
    "children": [
      {
        "nameAr": "الزوامل",
        "name": "El-Zawamel"
      },
      {
        "nameAr": "بساتين الإسماعيلية",
        "name": "Basatin Al-Ismailia"
      },
      {
        "nameAr": "منية سلمنت",
        "name": "Minyat Salmant"
      }
    ]
  },
  {
    "parentEn": "Anshas El-Raml",
    "parentAr": "أنشاص الرمل",
    "children": [
      {
        "nameAr": "أنشاص الرمل",
        "name": "Anshas El-Raml"
      },
      {
        "nameAr": "سلمنت",
        "name": "Salmant"
      },
      {
        "nameAr": "بير عمارة",
        "name": "Bir Emara"
      },
      {
        "nameAr": "السعيدية",
        "name": "Al-Saeediya"
      }
    ]
  },
  {
    "parentEn": "Shubra El-Nakhla",
    "parentAr": "شبرا النخلة",
    "children": [
      {
        "nameAr": "شبرا النخلة",
        "name": "Shubra El-Nakhla"
      },
      {
        "nameAr": "حفنا",
        "name": "Hafna"
      },
      {
        "nameAr": "الجوسق",
        "name": "Al-Gawsak"
      },
      {
        "nameAr": "العبسي",
        "name": "Al-Absi"
      }
    ]
  },
  {
    "parentEn": "Unlisted Zone",
    "parentAr": "نطاق غير موجود",
    "children": [
      {
        "nameAr": "منطقة توصيل غير مدرجة",
        "name": "Unlisted Delivery Area"
      }
    ]
  }
];
