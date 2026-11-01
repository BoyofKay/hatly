// GENERATED ONCE from the development dataset and the demo-vendor definitions, then maintained by hand. Pure data: no logic, no I/O.
// Every record here is a DEMONSTRATION listing (see ./demo-marketplace.ts): invented business names, demonstration prices in EGP, no real
// phone numbers, addresses, coordinates or opening hours. Image keys follow the asset-pack convention (docs/assets/pack/<key>.webp).
import type { DemoSector, DemoVendor } from './demo-types';

export const DEMO_SECTORS: DemoSector[] = [
  { slug: "restaurants", name: "Restaurants & Meals", nameAr: "مطاعم ووجبات", sortOrder: 0, customRequests: false },
  { slug: "groceries", name: "Supermarkets & Groceries", nameAr: "سوبر ماركت وبقالة", sortOrder: 1, customRequests: true },
  { slug: "produce", name: "Fruits & Vegetables", nameAr: "خضار وفاكهة", sortOrder: 2, customRequests: false },
  { slug: "pharmacy", name: "Pharmacies & Personal Care", nameAr: "صيدليات وعناية شخصية", sortOrder: 3, customRequests: true },
  { slug: "bakery", name: "Sweets & Bakeries", nameAr: "حلويات ومخبوزات", sortOrder: 4, customRequests: false },
  { slug: "coffee-spices", name: "Coffee, Spices & Specialty Food", nameAr: "بن وتوابل ومنتجات خاصة", sortOrder: 5, customRequests: false },
];

export const DEMO_VENDORS: DemoVendor[] = [
  {
    slug: "abu-aly-grills", name: "Abu Aly Grills", nameAr: "مطعم أبو علي للمشويات", sector: "restaurants",
    preparationMinutes: 25, commissionBasisPoints: 1000, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "المشويات", nameAr: "المشويات", products: [
        { name: "Kebab", nameAr: "كباب", priceMinor: 13000 },
        { name: "Kofta", nameAr: "كفتة", priceMinor: 11000 },
      ] },
      { name: "ساندويتشات", nameAr: "ساندويتشات", products: [
        { name: "Chicken Shawarma Sandwich", nameAr: "ساندويتش شاورما فراخ", priceMinor: 4500, options: [{"name": "Choose sauce", "nameAr": "اختر الصوص", "required": true, "multiple": true, "values": [{"name": "Garlic sauce", "nameAr": "ثومية", "priceDeltaMinor": 0}, {"name": "Tahini", "nameAr": "طحينة", "priceDeltaMinor": 0}, {"name": "Ketchup", "nameAr": "كاتشب", "priceDeltaMinor": 0}, {"name": "Mayonnaise", "nameAr": "مايونيز", "priceDeltaMinor": 0}]}] },
        { name: "Kofta Sandwich", nameAr: "ساندويتش كفتة", priceMinor: 4500 },
        { name: "Liver Sandwich", nameAr: "ساندويتش كبدة", priceMinor: 4000 },
      ] },
      { name: "أطباق جانبية", nameAr: "أطباق جانبية", products: [
        { name: "Grilled Rice", nameAr: "أرز محمر", priceMinor: 1800 },
        { name: "Soft Drink Can", nameAr: "مشروب غازي", priceMinor: 1000 },
        { name: "Tahini Salad", nameAr: "سلطة طحينة", priceMinor: 1200 },
        { name: "Baba Ghanoush", nameAr: "بابا غنوج", priceMinor: 2200 },
      ] },
    ],
  },
  {
    slug: "al-qaser-kebab-house", name: "Al Qaser Kebab House", nameAr: "كبابجي القصر", sector: "restaurants",
    preparationMinutes: 25, commissionBasisPoints: 1000, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "المشويات", nameAr: "المشويات", products: [
        { name: "Kebab Plate", nameAr: "طبق كباب", priceMinor: 12000, image: "products/abu-aly-grills/kebab" },
        { name: "Kofta Plate", nameAr: "طبق كفتة", priceMinor: 11000, image: "products/abu-aly-grills/kofta" },
        { name: "Mixed Grill Plate", nameAr: "طبق مشاوي مشكلة", priceMinor: 19000 },
        { name: "Grilled Chicken Quarter", nameAr: "ربع فرخة مشوية", priceMinor: 8500 },
      ] },
      { name: "أطباق جانبية", nameAr: "أطباق جانبية", products: [
        { name: "Grilled Rice", nameAr: "أرز مشوي", priceMinor: 2500, image: "products/abu-aly-grills/grilled-rice" },
        { name: "Tahini Salad", nameAr: "سلطة طحينة", priceMinor: 1500, image: "products/abu-aly-grills/tahini-salad" },
        { name: "Green Salad", nameAr: "سلطة خضراء", priceMinor: 1500 },
      ] },
    ],
  },
  {
    slug: "beit-el-sharkia-restaurant", name: "Beit El Sharkia Restaurant", nameAr: "مطعم بيت الشرقية", sector: "restaurants",
    preparationMinutes: 30, commissionBasisPoints: 1000, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "مشويات", nameAr: "مشويات", products: [
        { name: "Grilled Chicken", nameAr: "فراخ مشوية", priceMinor: 9000, options: [{"name": "Size", "nameAr": "الحجم", "required": true, "multiple": false, "values": [{"name": "Whole chicken", "nameAr": "فرخة كاملة", "priceDeltaMinor": 0}, {"name": "Two whole chickens", "nameAr": "فرختين", "priceDeltaMinor": 9000}]}] },
        { name: "Mixed Grill", nameAr: "مشاوي مشكلة", priceMinor: 15000 },
      ] },
      { name: "مقبلات", nameAr: "مقبلات", products: [
        { name: "Green Salad", nameAr: "سلطة خضراء", priceMinor: 1500 },
        { name: "Rice with Vermicelli", nameAr: "أرز بالشعرية", priceMinor: 2000 },
        { name: "Hummus", nameAr: "حمص", priceMinor: 2000 },
        { name: "Tabbouleh", nameAr: "تبولة", priceMinor: 2500 },
      ] },
      { name: "مشروبات", nameAr: "مشروبات", products: [
        { name: "Soft Drink Can", nameAr: "مشروب غازي", priceMinor: 1000 },
        { name: "Fresh Orange Juice", nameAr: "عصير برتقال طازج", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "flatini-pizza", name: "Flatini Pizza", nameAr: "بيتزا فلاتيني", sector: "restaurants",
    preparationMinutes: 22, commissionBasisPoints: 1000, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "بيتزا", nameAr: "بيتزا", products: [
        { name: "Margherita Pizza", nameAr: "بيتزا مارجريتا", priceMinor: 12000, options: [{"name": "Size", "nameAr": "الحجم", "required": true, "multiple": false, "values": [{"name": "Small", "nameAr": "صغير", "priceDeltaMinor": 0}, {"name": "Medium", "nameAr": "وسط", "priceDeltaMinor": 3000}, {"name": "Large", "nameAr": "كبير", "priceDeltaMinor": 6000}]}, {"name": "Toppings", "nameAr": "الإضافات", "required": false, "multiple": true, "values": [{"name": "Mushrooms", "nameAr": "فطر", "priceDeltaMinor": 1000}, {"name": "Olives", "nameAr": "زيتون", "priceDeltaMinor": 800}, {"name": "Extra cheese", "nameAr": "جبنة إضافية", "priceDeltaMinor": 1500}, {"name": "Jalapeños", "nameAr": "فلفل حار", "priceDeltaMinor": 800}]}] },
        { name: "Pepperoni Pizza", nameAr: "بيتزا ببروني", priceMinor: 14000, options: [{"name": "Size", "nameAr": "الحجم", "required": true, "multiple": false, "values": [{"name": "Small", "nameAr": "صغير", "priceDeltaMinor": 0}, {"name": "Medium", "nameAr": "وسط", "priceDeltaMinor": 3000}, {"name": "Large", "nameAr": "كبير", "priceDeltaMinor": 6000}]}] },
        { name: "Chicken Ranch Pizza", nameAr: "بيتزا دجاج رانش", priceMinor: 14000 },
        { name: "Veggie Pizza", nameAr: "بيتزا خضار", priceMinor: 12000 },
      ] },
      { name: "أطباق جانبية", nameAr: "أطباق جانبية", products: [
        { name: "Caesar Salad", nameAr: "سلطة سيزر", priceMinor: 5500 },
        { name: "Garlic Bread", nameAr: "خبز بالثوم", priceMinor: 4500 },
      ] },
      { name: "مشروبات", nameAr: "مشروبات", products: [
        { name: "Iced Tea", nameAr: "شاي مثلج", priceMinor: 1200 },
        { name: "Mineral Water", nameAr: "مياه معدنية", priceMinor: 800 },
      ] },
    ],
  },
  {
    slug: "zaman-koshary", name: "Zaman Koshary", nameAr: "كشري زمان", sector: "restaurants",
    preparationMinutes: 15, commissionBasisPoints: 1000, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "كشري", nameAr: "كشري", products: [
        { name: "Koshary Small", nameAr: "كشري صغير", priceMinor: 2500 },
        { name: "Koshary Medium", nameAr: "كشري وسط", priceMinor: 3500 },
        { name: "Koshary Large", nameAr: "كشري كبير", priceMinor: 4500 },
        { name: "Extra Fried Onions", nameAr: "بصل مقلي إضافي", priceMinor: 800 },
      ] },
      { name: "حلويات ومشروبات", nameAr: "حلويات ومشروبات", products: [
        { name: "Rice Pudding", nameAr: "أرز بلبن", priceMinor: 2000 },
        { name: "Soft Drink Can", nameAr: "مشروب غازي", priceMinor: 1200 },
        { name: "Mineral Water", nameAr: "مياه معدنية", priceMinor: 800 },
      ] },
    ],
  },
  {
    slug: "al-amana-minimarket", name: "Al Amana Minimarket", nameAr: "ميني ماركت الأمانة", sector: "groceries",
    preparationMinutes: 18, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "بقالة جافة", nameAr: "بقالة جافة", products: [
        { name: "Canned Tuna", nameAr: "تونة معلبة", priceMinor: 4200 },
        { name: "Pasta 1kg", nameAr: "مكرونة 1 كيلو", priceMinor: 3000 },
        { name: "Sugar 1kg", nameAr: "سكر 1 كيلو", priceMinor: 2800 },
        { name: "Tea Bags (100)", nameAr: "شاي أكياس (100)", priceMinor: 8500 },
        { name: "Rice 1kg", nameAr: "أرز 1 كيلو", priceMinor: 3800 },
        { name: "Cooking Oil 1L", nameAr: "زيت طبخ 1 لتر", priceMinor: 7200 },
        { name: "Salt 700g", nameAr: "ملح 700 جرام", priceMinor: 900 },
      ] },
      { name: "خضار وفاكهة", nameAr: "خضار وفاكهة", products: [
        { name: "Onions", nameAr: "بصل", priceMinor: 1200, unit: 'WEIGHT' },
        { name: "Potatoes", nameAr: "بطاطس", priceMinor: 1500, unit: 'WEIGHT' },
      ] },
    ],
  },
  {
    slug: "al-hayah-supermarket", name: "Al Hayah Supermarket", nameAr: "سوبر ماركت الحياة", sector: "groceries",
    preparationMinutes: 20, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "بقالة جافة", nameAr: "بقالة جافة", products: [
        { name: "Spaghetti 400g", nameAr: "مكرونة اسباجتي 400 جرام", priceMinor: 1400 },
        { name: "Sugar 1kg", nameAr: "سكر 1 كيلو", priceMinor: 3200, image: "products/al-amana-minimarket/sugar-1kg" },
        { name: "Tea Bags (100)", nameAr: "شاي أكياس (100)", priceMinor: 7000, image: "products/al-amana-minimarket/tea-bags-100" },
        { name: "Lentils 500g", nameAr: "عدس 500 جرام", priceMinor: 2800 },
      ] },
      { name: "منظفات", nameAr: "منظفات", products: [
        { name: "Dishwashing Liquid 750ml", nameAr: "سائل غسيل أطباق 750 مل", priceMinor: 4500 },
        { name: "Laundry Powder 1kg", nameAr: "مسحوق غسيل 1 كيلو", priceMinor: 6500 },
        { name: "Paper Towels (2)", nameAr: "مناديل مطبخ (2)", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "belbeis-supermarket", name: "Belbeis Supermarket", nameAr: "سوبر ماركت بلبيس", sector: "groceries",
    preparationMinutes: 20, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "خضار وفاكهة", nameAr: "خضار وفاكهة", products: [
        { name: "Tomatoes", nameAr: "طماطم", priceMinor: 2500, unit: 'WEIGHT' },
      ] },
      { name: "ألبان ومعلبات", nameAr: "ألبان ومعلبات", products: [
        { name: "Baladi Eggs (30)", nameAr: "بيض بلدي (30 بيضة)", priceMinor: 9000 },
        { name: "Juhayna Milk 1L", nameAr: "لبن جهينة 1 لتر", priceMinor: 3200 },
        { name: "Rice 1kg", nameAr: "أرز أبو كاس 1 كيلو", priceMinor: 4500 },
        { name: "Sunflower Oil 1L", nameAr: "زيت عباد الشمس 1 لتر", priceMinor: 6000 },
        { name: "Eggs (carton of 30)", nameAr: "بيض (كرتونة 30)", priceMinor: 13000 },
        { name: "Feta Cheese 500g", nameAr: "جبنة فيتا 500 جرام", priceMinor: 6000 },
        { name: "Tomato Paste 135g", nameAr: "صلصة طماطم 135 جرام", priceMinor: 1200 },
      ] },
    ],
  },
  {
    slug: "delta-mart", name: "Delta Mart", nameAr: "دلتا مارت", sector: "groceries",
    preparationMinutes: 20, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "ألبان وبيض", nameAr: "ألبان وبيض", products: [
        { name: "Full-Cream Milk 1L", nameAr: "لبن كامل الدسم 1 لتر", priceMinor: 3400 },
        { name: "Yogurt 170g", nameAr: "زبادي 170 جرام", priceMinor: 900 },
        { name: "Eggs (carton of 30)", nameAr: "بيض (كرتونة 30)", priceMinor: 13000 },
      ] },
      { name: "معلبات", nameAr: "معلبات", products: [
        { name: "Canned Tuna 160g", nameAr: "تونة معلبة 160 جرام", priceMinor: 4200, image: "products/al-amana-minimarket/canned-tuna" },
        { name: "Fava Beans Can", nameAr: "فول معلب", priceMinor: 1800 },
        { name: "Tomato Paste 135g", nameAr: "صلصة طماطم 135 جرام", priceMinor: 1200 },
        { name: "Mixed Pickles 700g", nameAr: "مخلل مشكل 700 جرام", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "family-corner-grocery", name: "Family Corner Grocery", nameAr: "بقالة ركن العيلة", sector: "groceries",
    preparationMinutes: 15, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "بقالة", nameAr: "بقالة", products: [
        { name: "Pasta 1kg", nameAr: "مكرونة 1 كيلو", priceMinor: 3000, image: "products/al-amana-minimarket/pasta-1kg" },
        { name: "Rice 1kg", nameAr: "أرز 1 كيلو", priceMinor: 3800 },
        { name: "Cooking Oil 1L", nameAr: "زيت طبخ 1 لتر", priceMinor: 7200 },
        { name: "Salt 700g", nameAr: "ملح 700 جرام", priceMinor: 900 },
      ] },
      { name: "سناكس ومشروبات", nameAr: "سناكس ومشروبات", products: [
        { name: "Potato Chips", nameAr: "شيبسي", priceMinor: 1000 },
        { name: "Chocolate Wafer", nameAr: "ويفر شوكولاتة", priceMinor: 800 },
        { name: "Orange Juice 1L", nameAr: "عصير برتقال 1 لتر", priceMinor: 3800 },
      ] },
    ],
  },
  {
    slug: "al-baraka-greengrocer", name: "Al Baraka Greengrocer", nameAr: "خضري البركة", sector: "produce",
    preparationMinutes: 10, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "خضروات", nameAr: "خضروات", products: [
        { name: "Tomatoes", nameAr: "طماطم", priceMinor: 2500, unit: 'WEIGHT', image: "products/al-gomhoria-grocery/tomatoes" },
        { name: "Potatoes", nameAr: "بطاطس", priceMinor: 2000, unit: 'WEIGHT', image: "products/al-gomhoria-grocery/potatoes" },
        { name: "Carrots", nameAr: "جزر", priceMinor: 1500, unit: 'WEIGHT', image: "products/al-gomhoria-grocery/carrots" },
        { name: "Green Peppers", nameAr: "فلفل أخضر", priceMinor: 3000, unit: 'WEIGHT', image: "products/al-gomhoria-grocery/green-peppers" },
        { name: "Zucchini", nameAr: "كوسة", priceMinor: 2200, unit: 'WEIGHT' },
        { name: "Lettuce", nameAr: "خس", priceMinor: 1200 },
        { name: "Fresh Mint Bunch", nameAr: "نعناع حزمة", priceMinor: 500 },
      ] },
    ],
  },
  {
    slug: "al-gomhoria-grocery", name: "Al Gomhoria Grocery", nameAr: "خضري الجمهورية", sector: "produce",
    preparationMinutes: 10, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "خضروات", nameAr: "خضروات", products: [
        { name: "Carrots", nameAr: "جزر", priceMinor: 1800, unit: 'WEIGHT' },
        { name: "Green Peppers", nameAr: "فلفل أخضر", priceMinor: 2200, unit: 'WEIGHT' },
        { name: "Lemons", nameAr: "ليمون", priceMinor: 3000, unit: 'WEIGHT' },
        { name: "Potatoes", nameAr: "بطاطس", priceMinor: 1500, unit: 'WEIGHT' },
        { name: "Tomatoes", nameAr: "طماطم", priceMinor: 2500, unit: 'WEIGHT' },
        { name: "Cucumbers", nameAr: "خيار", priceMinor: 1800, unit: 'WEIGHT' },
        { name: "Onions", nameAr: "بصل", priceMinor: 1600, unit: 'WEIGHT' },
        { name: "Eggplant", nameAr: "باذنجان", priceMinor: 2000, unit: 'WEIGHT' },
      ] },
    ],
  },
  {
    slug: "al-saada-fruit-shop", name: "Al Saada Fruit Shop", nameAr: "فاكهاني السعادة", sector: "produce",
    preparationMinutes: 10, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "فاكهة", nameAr: "فاكهة", products: [
        { name: "Apples", nameAr: "تفاح", priceMinor: 3500, unit: 'WEIGHT' },
        { name: "Bananas", nameAr: "موز", priceMinor: 2000, unit: 'WEIGHT' },
        { name: "Grapes", nameAr: "عنب", priceMinor: 4000, unit: 'WEIGHT' },
        { name: "Mangoes", nameAr: "مانجو", priceMinor: 4500, unit: 'WEIGHT' },
        { name: "Oranges", nameAr: "برتقال", priceMinor: 1800, unit: 'WEIGHT' },
        { name: "Figs", nameAr: "تين", priceMinor: 6500, unit: 'WEIGHT' },
        { name: "Watermelon", nameAr: "بطيخ", priceMinor: 1200, unit: 'WEIGHT' },
        { name: "Pomegranate", nameAr: "رمان", priceMinor: 4500, unit: 'WEIGHT' },
      ] },
    ],
  },
  {
    slug: "garden-fresh", name: "Garden Fresh", nameAr: "جاردن فريش", sector: "produce",
    preparationMinutes: 10, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "خضروات وورقيات", nameAr: "خضروات وورقيات", products: [
        { name: "Cucumbers", nameAr: "خيار", priceMinor: 1800, unit: 'WEIGHT' },
        { name: "Spinach", nameAr: "سبانخ", priceMinor: 1400 },
        { name: "Arugula Bunch", nameAr: "جرجير حزمة", priceMinor: 500 },
        { name: "Parsley Bunch", nameAr: "بقدونس حزمة", priceMinor: 500 },
        { name: "Sweet Potatoes", nameAr: "بطاطا", priceMinor: 2200, unit: 'WEIGHT' },
        { name: "Cauliflower", nameAr: "قرنبيط", priceMinor: 2500, unit: 'WEIGHT' },
        { name: "Garlic", nameAr: "ثوم", priceMinor: 6000, unit: 'WEIGHT' },
      ] },
    ],
  },
  {
    slug: "sharqia-fruits", name: "Sharqia Fruits", nameAr: "فواكه الشرقية", sector: "produce",
    preparationMinutes: 10, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "فاكهة", nameAr: "فاكهة", products: [
        { name: "Bananas", nameAr: "موز", priceMinor: 3500, unit: 'WEIGHT' },
        { name: "Apples", nameAr: "تفاح", priceMinor: 5000, unit: 'WEIGHT' },
        { name: "Oranges", nameAr: "برتقال", priceMinor: 2000, unit: 'WEIGHT' },
        { name: "Strawberries", nameAr: "فراولة", priceMinor: 4500, unit: 'WEIGHT' },
        { name: "Mangoes", nameAr: "مانجو", priceMinor: 7000, unit: 'WEIGHT' },
        { name: "Lemons", nameAr: "ليمون", priceMinor: 3000, unit: 'WEIGHT', image: "products/al-gomhoria-grocery/lemons" },
        { name: "Dates", nameAr: "بلح", priceMinor: 5500, unit: 'WEIGHT' },
      ] },
    ],
  },
  {
    slug: "al-amal-pharmacy", name: "Al Amal Pharmacy", nameAr: "صيدلية الأمل", sector: "pharmacy",
    preparationMinutes: 15, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "مستلزمات صحية", nameAr: "مستلزمات صحية", products: [
        { name: "Adhesive Bandages (20)", nameAr: "شريط جروح لاصق (20)", priceMinor: 2200 },
        { name: "Antiseptic Solution 250ml", nameAr: "محلول مطهر 250 مل", priceMinor: 3500, image: "products/al-noor-pharmacy/antiseptic-solution-250ml" },
        { name: "Sterile Gauze (10)", nameAr: "شاش معقم (10)", priceMinor: 1800 },
        { name: "Digital Thermometer", nameAr: "ترمومتر رقمي", priceMinor: 9000 },
      ] },
      { name: "عناية شخصية", nameAr: "عناية شخصية", products: [
        { name: "Soap Bar", nameAr: "صابون قطعة", priceMinor: 1500 },
        { name: "Body Lotion 250ml", nameAr: "لوشن للجسم 250 مل", priceMinor: 6500 },
        { name: "Cotton Pads (100)", nameAr: "قطن مستحضرات (100)", priceMinor: 2800 },
      ] },
    ],
  },
  {
    slug: "al-noor-pharmacy", name: "Al Noor Pharmacy", nameAr: "صيدلية النور", sector: "pharmacy",
    preparationMinutes: 15, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "أدوية", nameAr: "أدوية", products: [
        { name: "Cough Syrup", nameAr: "شراب للكحة", priceMinor: 2800 },
        { name: "Ibuprofen 400mg (strip)", nameAr: "إيبوبروفين 400 مج (شريط)", priceMinor: 1200 },
        { name: "Vitamin D Drops", nameAr: "نقط فيتامين د", priceMinor: 4500 },
      ] },
      { name: "عناية شخصية", nameAr: "عناية شخصية", products: [
        { name: "Antiseptic Solution 250ml", nameAr: "محلول مطهر 250 مل", priceMinor: 3500 },
        { name: "Face Masks (50)", nameAr: "كمامات (50)", priceMinor: 3000 },
        { name: "Hand Sanitizer 100ml", nameAr: "معقم يدين 100 مل", priceMinor: 3500 },
        { name: "Adhesive Bandages (20)", nameAr: "شريط جروح لاصق (20)", priceMinor: 2200 },
        { name: "Toothpaste 100ml", nameAr: "معجون أسنان 100 مل", priceMinor: 4000 },
      ] },
    ],
  },
  {
    slug: "al-sharq-pharmacy", name: "Al Sharq Pharmacy", nameAr: "صيدلية الشرق", sector: "pharmacy",
    preparationMinutes: 15, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "أدوية", nameAr: "أدوية", products: [
        { name: "Paracetamol 500mg (strip)", nameAr: "باراسيتامول 500 مج (شريط)", priceMinor: 1000 },
        { name: "Vitamin C Effervescent", nameAr: "فيتامين سي فوار", priceMinor: 3500 },
      ] },
      { name: "عناية شخصية", nameAr: "عناية شخصية", products: [
        { name: "Baby Shampoo", nameAr: "شامبو أطفال", priceMinor: 5500 },
        { name: "Hand Sanitizer 500ml", nameAr: "معقم أيدي 500 مل", priceMinor: 4000 },
        { name: "Body Lotion 250ml", nameAr: "لوشن للجسم 250 مل", priceMinor: 6500 },
        { name: "Cotton Pads (100)", nameAr: "قطن مستحضرات (100)", priceMinor: 2800 },
        { name: "Soap Bar", nameAr: "صابون قطعة", priceMinor: 1500 },
      ] },
    ],
  },
  {
    slug: "al-shifa-pharmacy", name: "Al Shifa Pharmacy", nameAr: "صيدلية الشفاء", sector: "pharmacy",
    preparationMinutes: 15, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "عناية شخصية", nameAr: "عناية شخصية", products: [
        { name: "Shampoo 400ml", nameAr: "شامبو 400 مل", priceMinor: 8500 },
        { name: "Conditioner 400ml", nameAr: "بلسم 400 مل", priceMinor: 8000 },
        { name: "Shower Gel 500ml", nameAr: "جل استحمام 500 مل", priceMinor: 7000 },
        { name: "Deodorant Spray", nameAr: "مزيل عرق سبراي", priceMinor: 6000 },
        { name: "Sunscreen 50ml", nameAr: "واقي شمس 50 مل", priceMinor: 15000 },
      ] },
      { name: "مستلزمات", nameAr: "مستلزمات", products: [
        { name: "Face Masks (50)", nameAr: "كمامات (50)", priceMinor: 6000, image: "products/al-noor-pharmacy/face-masks-50" },
        { name: "Hand Sanitizer 100ml", nameAr: "معقم يدين 100 مل", priceMinor: 3500 },
      ] },
    ],
  },
  {
    slug: "care-plus-pharmacy", name: "Care Plus Pharmacy", nameAr: "صيدلية كير بلس", sector: "pharmacy",
    preparationMinutes: 15, commissionBasisPoints: 500, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "عناية بالطفل", nameAr: "عناية بالطفل", products: [
        { name: "Baby Diapers (40)", nameAr: "حفاضات أطفال (40)", priceMinor: 22000 },
        { name: "Baby Wipes (80)", nameAr: "مناديل مبللة للأطفال (80)", priceMinor: 4500 },
        { name: "Baby Shampoo 200ml", nameAr: "شامبو أطفال 200 مل", priceMinor: 5500 },
      ] },
      { name: "عناية شخصية", nameAr: "عناية شخصية", products: [
        { name: "Toothbrush", nameAr: "فرشاة أسنان", priceMinor: 2000 },
        { name: "Toothpaste 100ml", nameAr: "معجون أسنان 100 مل", priceMinor: 4000 },
        { name: "Hand Cream 75ml", nameAr: "كريم يدين 75 مل", priceMinor: 5000 },
        { name: "Lip Balm", nameAr: "مرطب شفاه", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "al-ahl-al-dahabi-bakery", name: "Al Ahl Al Dahabi Bakery", nameAr: "مخبز أهل الذهبي", sector: "bakery",
    preparationMinutes: 20, commissionBasisPoints: 700, deliveryEnabled: true, pickupEnabled: false,
    categories: [
      { name: "خبز", nameAr: "خبز", products: [
        { name: "Baladi Bread (kg)", nameAr: "عيش بلدي (كيلو)", priceMinor: 1000, unit: 'WEIGHT' },
        { name: "Toast Bread", nameAr: "عيش توست", priceMinor: 2500 },
        { name: "Fino Bread (6)", nameAr: "عيش فينو (6)", priceMinor: 1200 },
      ] },
      { name: "معجنات", nameAr: "معجنات", products: [
        { name: "Almond Biscuits", nameAr: "بسكويت باللوز", priceMinor: 6000 },
        { name: "Cheese Croissant", nameAr: "كرواسون جبنة", priceMinor: 1500, options: [{"name": "Extras", "nameAr": "إضافات", "required": false, "multiple": true, "values": [{"name": "Extra cheese", "nameAr": "جبنة إضافية", "priceDeltaMinor": 500}, {"name": "Zaatar", "nameAr": "زعتر", "priceDeltaMinor": 300}]}] },
        { name: "Chocolate Cake", nameAr: "كيك شوكولاتة", priceMinor: 18000 },
        { name: "Pizza Pastry Slice", nameAr: "فطيرة بيتزا", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "al-fayrouz-sweets", name: "Al Fayrouz Sweets", nameAr: "حلويات الفيروز", sector: "bakery",
    preparationMinutes: 20, commissionBasisPoints: 700, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "حلويات شرقية", nameAr: "حلويات شرقية", products: [
        { name: "Kunafa Portion", nameAr: "طبق كنافة", priceMinor: 5500 },
        { name: "Basbousa Tray", nameAr: "صينية بسبوسة", priceMinor: 12000 },
        { name: "Baklava Box (500g)", nameAr: "علبة بقلاوة (500 جرام)", priceMinor: 22000 },
        { name: "Om Ali", nameAr: "أم علي", priceMinor: 4500 },
        { name: "Konafa with Cream", nameAr: "كنافة بالقشطة", priceMinor: 6000 },
      ] },
      { name: "بسكويت", nameAr: "بسكويت", products: [
        { name: "Almond Biscuits", nameAr: "بسكويت باللوز", priceMinor: 9000, image: "products/al-ahl-al-dahabi-bakery/almond-biscuits" },
        { name: "Date Maamoul (Box)", nameAr: "علبة معمول بالتمر", priceMinor: 10000 },
      ] },
    ],
  },
  {
    slug: "al-sharkia-patisserie", name: "Al Sharkia Patisserie", nameAr: "حلواني الشرقية", sector: "bakery",
    preparationMinutes: 20, commissionBasisPoints: 700, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "حلويات شرقية", nameAr: "حلويات شرقية", products: [
        { name: "Baklava Box", nameAr: "علبة بقلاوة", priceMinor: 9000 },
        { name: "Basbousa", nameAr: "بسبوسة", priceMinor: 1200, unit: 'WEIGHT' },
        { name: "Kunafa", nameAr: "كنافة", priceMinor: 1800, unit: 'WEIGHT' },
        { name: "Basbousa Tray", nameAr: "صينية بسبوسة", priceMinor: 12000 },
        { name: "Kunafa Portion", nameAr: "طبق كنافة", priceMinor: 5500 },
      ] },
      { name: "تورت", nameAr: "تورت", products: [
        { name: "Birthday Cake", nameAr: "تورتة عيد ميلاد", priceMinor: 25000, options: [{"name": "Size", "nameAr": "الحجم", "required": true, "multiple": false, "values": [{"name": "Serves 8", "nameAr": "يكفي 8 أفراد", "priceDeltaMinor": 0}, {"name": "Serves 15", "nameAr": "يكفي 15 فرد", "priceDeltaMinor": 15000}, {"name": "Serves 25", "nameAr": "يكفي 25 فرد", "priceDeltaMinor": 30000}]}, {"name": "Toppings", "nameAr": "التوبينج", "required": false, "multiple": true, "values": [{"name": "Chocolate", "nameAr": "شوكولاتة", "priceDeltaMinor": 2000}, {"name": "Strawberry", "nameAr": "فراولة", "priceDeltaMinor": 2500}, {"name": "Mixed nuts", "nameAr": "مكسرات", "priceDeltaMinor": 3000}]}] },
        { name: "Mini Cake Box", nameAr: "علبة ميني تورتة", priceMinor: 9000 },
      ] },
    ],
  },
  {
    slug: "cake-corner", name: "Cake Corner", nameAr: "ركن التورت", sector: "bakery",
    preparationMinutes: 30, commissionBasisPoints: 700, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "تورت", nameAr: "تورت", products: [
        { name: "Chocolate Cake", nameAr: "تورتة شوكولاتة", priceMinor: 25000, image: "products/al-ahl-al-dahabi-bakery/chocolate-cake" },
        { name: "Vanilla Cake", nameAr: "تورتة فانيليا", priceMinor: 23000 },
        { name: "Red Velvet Slice", nameAr: "قطعة ريد فيلفت", priceMinor: 5500 },
        { name: "Cheesecake Slice", nameAr: "قطعة تشيز كيك", priceMinor: 6000 },
      ] },
      { name: "كب كيك ودونات", nameAr: "كب كيك ودونات", products: [
        { name: "Cupcake", nameAr: "كب كيك", priceMinor: 2500 },
        { name: "Cupcake Box (6)", nameAr: "علبة كب كيك (6)", priceMinor: 13500 },
        { name: "Donut", nameAr: "دونات", priceMinor: 1800 },
      ] },
    ],
  },
  {
    slug: "golden-wheat-bakery", name: "Golden Wheat Bakery", nameAr: "مخبز القمح الذهبي", sector: "bakery",
    preparationMinutes: 15, commissionBasisPoints: 700, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "خبز", nameAr: "خبز", products: [
        { name: "Baladi Bread (kg)", nameAr: "عيش بلدي (كيلو)", priceMinor: 1000, unit: 'WEIGHT', image: "products/al-ahl-al-dahabi-bakery/baladi-bread-kg" },
        { name: "Toast Bread", nameAr: "عيش توست", priceMinor: 2500 },
        { name: "Fino Bread (6)", nameAr: "عيش فينو (6)", priceMinor: 1200 },
        { name: "Brioche Rolls (6)", nameAr: "ساندويتش بريوش (6)", priceMinor: 3000 },
      ] },
      { name: "معجنات", nameAr: "معجنات", products: [
        { name: "Cheese Croissant", nameAr: "كرواسون جبنة", priceMinor: 1500, image: "products/al-ahl-al-dahabi-bakery/cheese-croissant" },
        { name: "Chocolate Croissant", nameAr: "كرواسون شوكولاتة", priceMinor: 1800 },
        { name: "Zaatar Pie", nameAr: "فطيرة زعتر", priceMinor: 1200 },
      ] },
    ],
  },
  {
    slug: "al-attar-herbs-and-spices", name: "Al Attar Herbs & Spices", nameAr: "العطار للأعشاب والتوابل", sector: "coffee-spices",
    preparationMinutes: 10, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "أعشاب للمشروبات", nameAr: "أعشاب للمشروبات", products: [
        { name: "Hibiscus (Karkade) 100g", nameAr: "كركديه 100 جرام", priceMinor: 2500 },
        { name: "Dried Mint 50g", nameAr: "نعناع مجفف 50 جرام", priceMinor: 1500 },
        { name: "Chamomile 50g", nameAr: "بابونج 50 جرام", priceMinor: 2500 },
        { name: "Anise Seeds 100g", nameAr: "يانسون 100 جرام", priceMinor: 2000 },
        { name: "Fenugreek 100g", nameAr: "حلبة 100 جرام", priceMinor: 1800 },
      ] },
      { name: "بهارات", nameAr: "بهارات", products: [
        { name: "Cardamom 50g", nameAr: "حبهان 50 جرام", priceMinor: 6000 },
        { name: "Cloves 50g", nameAr: "قرنفل 50 جرام", priceMinor: 4000 },
      ] },
    ],
  },
  {
    slug: "mokha-coffee-roasters", name: "Mokha Coffee Roasters", nameAr: "محمصة موكا", sector: "coffee-spices",
    preparationMinutes: 10, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "بن", nameAr: "بن", products: [
        { name: "Turkish Coffee 250g", nameAr: "قهوة تركي 250 جرام", priceMinor: 13000 },
        { name: "Espresso Beans 250g", nameAr: "حبوب إسبريسو 250 جرام", priceMinor: 19000 },
        { name: "Light Roast Beans 250g", nameAr: "بن محمص فاتح 250 جرام", priceMinor: 17000 },
        { name: "Hazelnut Coffee 250g", nameAr: "قهوة بالبندق 250 جرام", priceMinor: 15000 },
        { name: "Cardamom Coffee 250g", nameAr: "قهوة بالهيل 250 جرام", priceMinor: 16000 },
        { name: "Ground Coffee 500g", nameAr: "بن مطحون 500 جرام", priceMinor: 24000 },
      ] },
    ],
  },
  {
    slug: "nutty-corner", name: "Nutty Corner", nameAr: "ركن المكسرات", sector: "coffee-spices",
    preparationMinutes: 10, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "مكسرات", nameAr: "مكسرات", products: [
        { name: "Roasted Almonds 250g", nameAr: "لوز محمص 250 جرام", priceMinor: 13000 },
        { name: "Cashews 250g", nameAr: "كاجو 250 جرام", priceMinor: 15000 },
        { name: "Pistachios 250g", nameAr: "فستق 250 جرام", priceMinor: 21000 },
        { name: "Hazelnuts 250g", nameAr: "بندق 250 جرام", priceMinor: 14000 },
        { name: "Peanuts 500g", nameAr: "فول سوداني 500 جرام", priceMinor: 6000 },
        { name: "Mixed Nuts 500g", nameAr: "مكسرات مشكلة 500 جرام", priceMinor: 26000 },
      ] },
      { name: "فواكه مجففة", nameAr: "فواكه مجففة", products: [
        { name: "Dried Apricots 250g", nameAr: "قمر الدين 250 جرام", priceMinor: 5000 },
        { name: "Raisins 250g", nameAr: "زبيب 250 جرام", priceMinor: 4000 },
      ] },
    ],
  },
  {
    slug: "spice-route", name: "Spice Route", nameAr: "طريق التوابل", sector: "coffee-spices",
    preparationMinutes: 10, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "توابل", nameAr: "توابل", products: [
        { name: "Cumin 100g", nameAr: "كمون 100 جرام", priceMinor: 2000 },
        { name: "Black Pepper 100g", nameAr: "فلفل أسود 100 جرام", priceMinor: 3500 },
        { name: "Coriander 100g", nameAr: "كزبرة 100 جرام", priceMinor: 1500 },
        { name: "Cinnamon Sticks 50g", nameAr: "قرفة أعواد 50 جرام", priceMinor: 2500 },
        { name: "Turmeric 100g", nameAr: "كركم 100 جرام", priceMinor: 2000 },
        { name: "Paprika 100g", nameAr: "بابريكا 100 جرام", priceMinor: 2500 },
        { name: "Seven Spices Mix 100g", nameAr: "بهارات سبعة 100 جرام", priceMinor: 3000 },
      ] },
    ],
  },
  {
    slug: "tea-house", name: "Tea House", nameAr: "بيت الشاي", sector: "coffee-spices",
    preparationMinutes: 10, commissionBasisPoints: 800, deliveryEnabled: true, pickupEnabled: true,
    categories: [
      { name: "شاي", nameAr: "شاي", products: [
        { name: "Black Tea 250g", nameAr: "شاي أسود 250 جرام", priceMinor: 6500 },
        { name: "Green Tea Bags (25)", nameAr: "شاي أخضر أكياس (25)", priceMinor: 5500 },
        { name: "Mint Tea Bags (25)", nameAr: "شاي بالنعناع أكياس (25)", priceMinor: 4500 },
        { name: "Earl Grey Bags (25)", nameAr: "شاي ايرل جراي أكياس (25)", priceMinor: 6000 },
        { name: "Ginger Tea Bags (25)", nameAr: "شاي بالزنجبيل أكياس (25)", priceMinor: 5000 },
        { name: "Loose Leaf Tea 100g", nameAr: "شاي أوراق 100 جرام", priceMinor: 4800 },
      ] },
      { name: "سكر وإضافات", nameAr: "سكر وإضافات", products: [
        { name: "Honey 250g", nameAr: "عسل 250 جرام", priceMinor: 11000 },
        { name: "Rock Sugar 250g", nameAr: "سكر نبات 250 جرام", priceMinor: 3000 },
      ] },
    ],
  },
];
