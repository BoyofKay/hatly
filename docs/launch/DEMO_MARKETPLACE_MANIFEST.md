# Demonstration marketplace — manifest

Generated from the importer's own report (`npm run demo:marketplace`) on a fresh local database. **Every record below is a DEMONSTRATION listing**: invented business names, demonstration prices in EGP, no real phone numbers, street addresses, coordinates or opening hours. The stable identifier of each record is its `demo_key` (table `demo_seed_records`), e.g. `vendor:abu-aly-grills`, `product:abu-aly-grills:kebab`.

Totals: **6 categories · 30 vendors · 30 branches · 221 products** · 71 products with their own picture · 11 vendor logos from the pack · 14 vendors using the generic category picture as logo · 5 banners.

| Category | Vendors | Vendor (EN / AR) | Products | With picture | Logo |
|---|---|---|---|---|---|
| مطاعم ووجبات (restaurants) | 5 | Abu Aly Grills / مطعم أبو علي للمشويات | 9 | 5 | APPLIED |
|  |  | Al Qaser Kebab House / كبابجي القصر | 7 | 4 | GENERIC_FALLBACK |
|  |  | Beit El Sharkia Restaurant / مطعم بيت الشرقية | 8 | 4 | APPLIED |
|  |  | Flatini Pizza / بيتزا فلاتيني | 8 | 5 | APPLIED |
|  |  | Zaman Koshary / كشري زمان | 7 | 0 | GENERIC_FALLBACK |
| سوبر ماركت وبقالة (groceries) | 5 | Al Amana Minimarket / ميني ماركت الأمانة | 9 | 6 | APPLIED |
|  |  | Al Hayah Supermarket / سوبر ماركت الحياة | 7 | 2 | GENERIC_FALLBACK |
|  |  | Belbeis Supermarket / سوبر ماركت بلبيس | 8 | 5 | APPLIED |
|  |  | Delta Mart / دلتا مارت | 7 | 1 | GENERIC_FALLBACK |
|  |  | Family Corner Grocery / بقالة ركن العيلة | 7 | 1 | GENERIC_FALLBACK |
| خضار وفاكهة (produce) | 5 | Al Baraka Greengrocer / خضري البركة | 7 | 4 | GENERIC_FALLBACK |
|  |  | Al Gomhoria Grocery / خضري الجمهورية | 8 | 5 | APPLIED |
|  |  | Al Saada Fruit Shop / فاكهاني السعادة | 8 | 5 | APPLIED |
|  |  | Garden Fresh / جاردن فريش | 7 | 0 | GENERIC_FALLBACK |
|  |  | Sharqia Fruits / فواكه الشرقية | 7 | 1 | GENERIC_FALLBACK |
| صيدليات وعناية شخصية (pharmacy) | 5 | Al Amal Pharmacy / صيدلية الأمل | 7 | 1 | GENERIC_FALLBACK |
|  |  | Al Noor Pharmacy / صيدلية النور | 8 | 5 | APPLIED |
|  |  | Al Sharq Pharmacy / صيدلية الشرق | 7 | 4 | APPLIED |
|  |  | Al Shifa Pharmacy / صيدلية الشفاء | 7 | 1 | GENERIC_FALLBACK |
|  |  | Care Plus Pharmacy / صيدلية كير بلس | 7 | 0 | GENERIC_FALLBACK |
| حلويات ومخبوزات (bakery) | 5 | Al Ahl Al Dahabi Bakery / مخبز أهل الذهبي | 7 | 4 | APPLIED |
|  |  | Al Fayrouz Sweets / حلويات الفيروز | 7 | 1 | GENERIC_FALLBACK |
|  |  | Al Sharkia Patisserie / حلواني الشرقية | 7 | 4 | APPLIED |
|  |  | Cake Corner / ركن التورت | 7 | 1 | GENERIC_FALLBACK |
|  |  | Golden Wheat Bakery / مخبز القمح الذهبي | 7 | 2 | GENERIC_FALLBACK |
| بن وتوابل ومنتجات خاصة (coffee-spices) | 5 | Al Attar Herbs & Spices / العطار للأعشاب والتوابل | 7 | 0 | MISSING |
|  |  | Mokha Coffee Roasters / محمصة موكا | 6 | 0 | MISSING |
|  |  | Nutty Corner / ركن المكسرات | 8 | 0 | MISSING |
|  |  | Spice Route / طريق التوابل | 7 | 0 | MISSING |
|  |  | Tea House / بيت الشاي | 8 | 0 | MISSING |

## Image needs (exact)

Picture coverage on the demonstration data: **71 of 221 products** have their own picture from the asset pack (73 pack pictures exist; the rest of the products are new demonstration items). The other 150 products show the app's themed placeholder — never a broken image. **11 vendor logos** come from the pack; **14 vendors** use their category picture as a generic logo; **5 vendors (all in `coffee-spices`) have no logo** because that category has no picture either.

To close the gap: add `<key>.webp` files (products 1200×1090 with the subject inside the central square; logos and category tiles 512×512) under `docs/assets/pack/` using exactly the keys below, then apply them on a fresh environment or by uploading the picture to the product / vendor in the Admin Dashboard. The importer never replaces anything that already exists, so a picture added later reaches an environment that already has the record through the Dashboard, not through a re-run.

Still missing, besides the product keys listed below: `sectors/coffee-spices` (category tile) and `vendors/<vendor-slug>/logo` for the 19 vendors that are not in the original development dataset.

<details><summary>All missing product picture keys</summary>

```
products/abu-aly-grills/baba-ghanoush
products/abu-aly-grills/kofta-sandwich
products/abu-aly-grills/liver-sandwich
products/abu-aly-grills/soft-drink-can
products/al-ahl-al-dahabi-bakery/fino-bread-6
products/al-ahl-al-dahabi-bakery/pizza-pastry-slice
products/al-ahl-al-dahabi-bakery/toast-bread
products/al-amal-pharmacy/adhesive-bandages-20
products/al-amal-pharmacy/body-lotion-250ml
products/al-amal-pharmacy/cotton-pads-100
products/al-amal-pharmacy/digital-thermometer
products/al-amal-pharmacy/soap-bar
products/al-amal-pharmacy/sterile-gauze-10
products/al-amana-minimarket/cooking-oil-1l
products/al-amana-minimarket/rice-1kg
products/al-amana-minimarket/salt-700g
products/al-attar-herbs-and-spices/anise-seeds-100g
products/al-attar-herbs-and-spices/cardamom-50g
products/al-attar-herbs-and-spices/chamomile-50g
products/al-attar-herbs-and-spices/cloves-50g
products/al-attar-herbs-and-spices/dried-mint-50g
products/al-attar-herbs-and-spices/fenugreek-100g
products/al-attar-herbs-and-spices/hibiscus-karkade-100g
products/al-baraka-greengrocer/fresh-mint-bunch
products/al-baraka-greengrocer/lettuce
products/al-baraka-greengrocer/zucchini
products/al-fayrouz-sweets/baklava-box-500g
products/al-fayrouz-sweets/basbousa-tray
products/al-fayrouz-sweets/date-maamoul-box
products/al-fayrouz-sweets/konafa-with-cream
products/al-fayrouz-sweets/kunafa-portion
products/al-fayrouz-sweets/om-ali
products/al-gomhoria-grocery/cucumbers
products/al-gomhoria-grocery/eggplant
products/al-gomhoria-grocery/onions
products/al-hayah-supermarket/dishwashing-liquid-750ml
products/al-hayah-supermarket/laundry-powder-1kg
products/al-hayah-supermarket/lentils-500g
products/al-hayah-supermarket/paper-towels-2
products/al-hayah-supermarket/spaghetti-400g
products/al-noor-pharmacy/adhesive-bandages-20
products/al-noor-pharmacy/hand-sanitizer-100ml
products/al-noor-pharmacy/toothpaste-100ml
products/al-qaser-kebab-house/green-salad
products/al-qaser-kebab-house/grilled-chicken-quarter
products/al-qaser-kebab-house/mixed-grill-plate
products/al-saada-fruit-shop/figs
products/al-saada-fruit-shop/pomegranate
products/al-saada-fruit-shop/watermelon
products/al-sharkia-patisserie/basbousa-tray
products/al-sharkia-patisserie/kunafa-portion
products/al-sharkia-patisserie/mini-cake-box
products/al-sharq-pharmacy/body-lotion-250ml
products/al-sharq-pharmacy/cotton-pads-100
products/al-sharq-pharmacy/soap-bar
products/al-shifa-pharmacy/conditioner-400ml
products/al-shifa-pharmacy/deodorant-spray
products/al-shifa-pharmacy/hand-sanitizer-100ml
products/al-shifa-pharmacy/shampoo-400ml
products/al-shifa-pharmacy/shower-gel-500ml
products/al-shifa-pharmacy/sunscreen-50ml
products/beit-el-sharkia-restaurant/fresh-orange-juice
products/beit-el-sharkia-restaurant/hummus
products/beit-el-sharkia-restaurant/soft-drink-can
products/beit-el-sharkia-restaurant/tabbouleh
products/belbeis-supermarket/eggs-carton-of-30
products/belbeis-supermarket/feta-cheese-500g
products/belbeis-supermarket/tomato-paste-135g
products/cake-corner/cheesecake-slice
products/cake-corner/cupcake
products/cake-corner/cupcake-box-6
products/cake-corner/donut
products/cake-corner/red-velvet-slice
products/cake-corner/vanilla-cake
products/care-plus-pharmacy/baby-diapers-40
products/care-plus-pharmacy/baby-shampoo-200ml
products/care-plus-pharmacy/baby-wipes-80
products/care-plus-pharmacy/hand-cream-75ml
products/care-plus-pharmacy/lip-balm
products/care-plus-pharmacy/toothbrush
products/care-plus-pharmacy/toothpaste-100ml
products/delta-mart/eggs-carton-of-30
products/delta-mart/fava-beans-can
products/delta-mart/full-cream-milk-1l
products/delta-mart/mixed-pickles-700g
products/delta-mart/tomato-paste-135g
products/delta-mart/yogurt-170g
products/family-corner-grocery/chocolate-wafer
products/family-corner-grocery/cooking-oil-1l
products/family-corner-grocery/orange-juice-1l
products/family-corner-grocery/potato-chips
products/family-corner-grocery/rice-1kg
products/family-corner-grocery/salt-700g
products/flatini-pizza/chicken-ranch-pizza
products/flatini-pizza/mineral-water
products/flatini-pizza/veggie-pizza
products/garden-fresh/arugula-bunch
products/garden-fresh/cauliflower
products/garden-fresh/cucumbers
products/garden-fresh/garlic
products/garden-fresh/parsley-bunch
products/garden-fresh/spinach
products/garden-fresh/sweet-potatoes
products/golden-wheat-bakery/brioche-rolls-6
products/golden-wheat-bakery/chocolate-croissant
products/golden-wheat-bakery/fino-bread-6
products/golden-wheat-bakery/toast-bread
products/golden-wheat-bakery/zaatar-pie
products/mokha-coffee-roasters/cardamom-coffee-250g
products/mokha-coffee-roasters/espresso-beans-250g
products/mokha-coffee-roasters/ground-coffee-500g
products/mokha-coffee-roasters/hazelnut-coffee-250g
products/mokha-coffee-roasters/light-roast-beans-250g
products/mokha-coffee-roasters/turkish-coffee-250g
products/nutty-corner/cashews-250g
products/nutty-corner/dried-apricots-250g
products/nutty-corner/hazelnuts-250g
products/nutty-corner/mixed-nuts-500g
products/nutty-corner/peanuts-500g
products/nutty-corner/pistachios-250g
products/nutty-corner/raisins-250g
products/nutty-corner/roasted-almonds-250g
products/sharqia-fruits/apples
products/sharqia-fruits/bananas
products/sharqia-fruits/dates
products/sharqia-fruits/mangoes
products/sharqia-fruits/oranges
products/sharqia-fruits/strawberries
products/spice-route/black-pepper-100g
products/spice-route/cinnamon-sticks-50g
products/spice-route/coriander-100g
products/spice-route/cumin-100g
products/spice-route/paprika-100g
products/spice-route/seven-spices-mix-100g
products/spice-route/turmeric-100g
products/tea-house/black-tea-250g
products/tea-house/earl-grey-bags-25
products/tea-house/ginger-tea-bags-25
products/tea-house/green-tea-bags-25
products/tea-house/honey-250g
products/tea-house/loose-leaf-tea-100g
products/tea-house/mint-tea-bags-25
products/tea-house/rock-sugar-250g
products/zaman-koshary/extra-fried-onions
products/zaman-koshary/koshary-large
products/zaman-koshary/koshary-medium
products/zaman-koshary/koshary-small
products/zaman-koshary/mineral-water
products/zaman-koshary/rice-pudding
products/zaman-koshary/soft-drink-can
sectors/coffee-spices
vendors/al-attar-herbs-and-spices/logo
vendors/mokha-coffee-roasters/logo
vendors/nutty-corner/logo
vendors/spice-route/logo
vendors/tea-house/logo
```

</details>
