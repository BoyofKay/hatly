// Builds the Troika (تروقة) sample menu in Hatly's menu-import format, transcribed from the owner's two menu photos.
// Multi-size items: ONE product priced at its smallest size + a required "Size" option whose choices add the difference.
const path = require('path');
const XLSX = require(path.join(process.argv[2] ?? path.join(__dirname, '../../../apps/backend'), 'node_modules/xlsx')); // run: node build-troika.js (needs the two .jpg photos next to it)
const fs = require('fs');

const menu = []; // [category, categoryAr, name, nameAr, description, descriptionAr, sizes:[[en, ar, price]...], image]
const add = (cat, catAr, name, nameAr, sizes, desc = '', descAr = '', image = '') => menu.push({ cat, catAr, name, nameAr, sizes, desc, descAr, image });

// ---- الكريب — Medium / Large / Roll
const CR = [['Medium', 'وسط'], ['Large', 'كبير'], ['Roll', 'رول']];
const crepe = (name, nameAr, m, l, r, image) => add('Crepes', 'الكريب', `Crepe – ${name}`, `كريب ${nameAr}`, [m, l, r].map((p, i) => (p ? [...CR[i], p] : null)).filter(Boolean), '', '', image);
crepe('Mozzarella', 'موتزاريلا', 40, 50, null);
crepe('Mixed Cheese', 'ميكس جبن', 50, 60, null);
crepe('Pané', 'بانيه', 40, 60, 100);
crepe('Fries', 'بطاطس', 40, 60, 90);
crepe('Sausage', 'سوسيس', 60, 80, 120);
crepe('Burger', 'برجر', 80, 100, 130);
crepe('Cordon Bleu', 'كوردن بلو', 80, 100, 150);
crepe('Strips', 'استربس', 90, 110, 180);
crepe('Shish Tawook', 'شيش طاووق', 90, 110, 180, 'crepe-shish-tawook.jpg');
crepe('Chicken Shawarma', 'شاورما فراخ', 90, 110, 180);
crepe('Spiced Pané', 'بانيه تتبيلة', 90, 110, 180);
crepe('Beef Shawarma', 'شاورما لحم', 100, 130, 200);
crepe('Chicken Fajita', 'فاهيتا فراخ', 90, 110, 180);
crepe('Beef Fajita', 'فاهيتا لحم', 100, 130, 200);
crepe('Shish + Strips', 'شيش + استربس', 90, 110, 180);
crepe('Burger Sausage', 'برجر سوسيس', 90, 110, 160);
crepe('Sausage Strips', 'سوسيس استربس', 90, 110, 170);

// ---- ميكس كريب — Medium / Large / Roll, with fillings
const mix = (name, nameAr, m, l, r, desc, descAr) => add('Mix Crepes', 'ميكس كريب', `Mix Crepe – ${name}`, nameAr, [[...CR[0], m], [...CR[1], l], [...CR[2], r]], desc, descAr);
mix('Sweet Fried', 'سويت فرايد', 100, 120, 180, 'Spiced pané, fries, cheddar, secret sauce, sweet chili', 'بانيه تتبيلة + بطاطس + فرايز + شيدر + صوص سري + سويت شلي');
mix('Pure Chicken', 'ميكس فراخ بيور', 110, 140, 180, 'Shish, strips, cordon bleu', 'شيش + استربس + كوردن بلو');
mix('Smoked Chicken', 'ميكس فراخ مدخن', 120, 140, 180, 'Shish, strips, smoked turkey, tasty sauce', 'شيش + استربس + تركي مدخن + صوص بيجري تستي');
mix('Meats', 'ميكس لحوم', 120, 150, 180, 'Beef shawarma, beef burger, sausage', 'شاورما لحم + برجر بلدي + سوسيس');
mix('The Joker', 'الجوكر', 110, 140, 180, 'Chicken shawarma, strips, sausage', 'شاورما فراخ + استربس + سوسيس');
mix('VIP', 'VIP', 140, 180, 210, 'Beef shawarma, burger, spiced pané, mixed cheese, sausage, smoky beef', 'شاورما لحم + برجر + بانيه تتبيلة + ميكس جبن + سوسيس + سموكي بيف');
mix('Crunchy', 'المقرمش', 110, 140, 165, '', '');
mix('Troika', 'تروقة', 160, 200, 230, 'Shish, cordon bleu, beef shawarma, smoked turkey, strips, sausage, mixed cheese, mixed sauces', 'شيش + كوردن بلو + شاورما لحم + تركي مدخن + استربس + سوسيس + ميكس جبن + ميكس صوص');
mix('The Whale', 'ميكس الحوت', 120, 150, 180, 'Shish, strips, sausage, turkey, beef bacon, mixed sauces', 'شيش + استربس + سوسيس + تركي + بيف بيكون + ميكس صوص');

// ---- البرجر — Single / Double
const burger = (name, nameAr, s, d, desc, descAr) => add('Burgers', 'البرجر', name, nameAr, [['Single', 'سنجل', s], ['Double', 'دوبل', d]], desc, descAr);
burger('Classic Beef', 'كلاسيك بيف', 100, 140, 'Beef burger, lettuce, onion, pickles, secret sauce, cheddar, fries', 'برجر بلدي + خس + بصل + خيار مخلل + صوص سري + شيدر + بطاطس');
burger('Smoky Beef', 'سموكي بيف', 120, 160, 'Beef burger, lettuce, onion, pickles, secret sauce, cheddar, beef bacon, fries', 'برجر بلدي + خس + بصل + خيار مخلل + صوص سري + شيدر بيف بيكون + بطاطس');
burger('Troika Beef', 'تروقة بيف', 140, 170, 'Beef burger, lettuce, onion, pickles, secret sauce, cheddar, beef bacon, fries, mozzarella sticks', 'برجر بلدي + خس + بصل + خيار مخلل + صوص سري + شيدر بيف بيكون + بطاطس + موتزريلا ستيكس');
burger('Classic Chicken', 'كلاسيك تشيكن', 100, 140, 'Fried chicken, lettuce, pickles, cheddar sauce, ranch, secret sauce, fries', 'فرايد تشيكن + خس + خيار مخلل + صوص شيدر + رانش + صوص سري + بطاطس');
burger('Smoky Chicken', 'سموكي تشيكن', 120, 160, 'Fried chicken, lettuce, pickles, cheddar sauce, tasty sauce, ranch, secret sauce, smoked turkey, fries', 'فرايد تشيكن + خس + خيار مخلل + صوص شيدر + بيجري تيستي + رانش + صوص سري + تركي مدخن + بطاطس');
burger('Troika Chicken', 'تروقة تشيكن', 140, 170, 'Fried chicken, smoked turkey, mozzarella stick, lettuce, pickles, ranch, cheddar, fries', 'فرايد تشيكن + تركي مدخن + موتزريلا ستيك + خس + خيار مخلل + رانش + شيدر + بطاطس');

// ---- مكرونة نجرسكو — Medium / Large
const pasta = (name, nameAr, m, l) => add('Negresco Pasta', 'مكرونة نجرسكو', `Pasta – ${name}`, nameAr, [['Medium', 'وسط', m], ['Large', 'كبير', l]]);
pasta('Shish', 'مكرونة شيش', 100, 125);
pasta('Strips', 'مكرونة استربس', 100, 125);
pasta('Sausage', 'مكرونة سوسيس', 90, 110);
pasta('Shish + Strips', 'مكرونة شيش + استربس', 100, 125);
pasta('Beef Shawarma', 'مكرونة شاورما لحم', 120, 145);

// ---- إضافات — Medium / Large (only some have Large)
const extra = (name, nameAr, m, l) => add('Extras', 'إضافات', name, nameAr, l ? [['Medium', 'وسط', m], ['Large', 'كبير', l]] : [['', '', m]]);
extra('Fries', 'بطاطس', 25, 40);
extra('Mozzarella Fries', 'بطاطس موتزريلا', 60);
extra('Cheddar Fries', 'بطاطس شيدر', 50);
extra('Fries with Sauces', 'بطاطس صوصات', 50);
extra('Cheddar + Strips Fries', 'بطاطس شيدر + استربس', 80);
extra('Onion Rings', 'حلقات بصل', 25);
extra('Mozzarella Topping for Crepe', 'وش موتزريلا للكريب', 25);
extra('Sauces', 'صوصات', 25, 40);

// ---- ساندوتشات — Plain / With cheese
const sandwich = (name, nameAr, plain, cheese) => add('Sandwiches', 'ساندوتشات', `Sandwich – ${name}`, `ساندوتش ${nameAr}`, [['Plain', 'سادة', plain], ['With cheese', 'بالجبنة', cheese]]);
sandwich('Pané', 'بانيه', 25, 35);
sandwich('Fries', 'بطاطس', 25, 35);
sandwich('Sausage', 'سوسيس', 35, 50);
sandwich('Spiced Pané', 'بانيه تتبيلة', 40, 50);
sandwich('Strips', 'استربس', 40, 50);
sandwich('Shish', 'شيش', 40, 50);
sandwich('Chicken Shawarma', 'شاورما فراخ', 40, 50);
sandwich('Beef Shawarma', 'شاورما لحم', 50, 60);
sandwich('Cordon Bleu', 'كوردن بلو', 40, 50);

// ---- بيتزا — M / L / XL
const pizza = (name, nameAr, m, l, xl, image) => add('Pizza', 'بيتزا', `Pizza – ${name}`, `بيتزا ${nameAr}`, [['M', 'وسط M', m], ['L', 'كبير L', l], ['XL', 'عائلي XL', xl]], '', '', image);
pizza('Margherita', 'مرجريتا', 90, 110, 130);
pizza('Mixed Cheese', 'ميكس جبن', 100, 120, 140);
pizza('Pané', 'بانيه', 110, 130, 160);
pizza('Sausage', 'سوسيس', 110, 130, 160);
pizza('Salami', 'سلامي', 115, 135, 160);
pizza('Pepperoni', 'بيبروني', 115, 135, 160, 'pizza-pepperoni.jpg');
pizza('Cordon Bleu', 'كوردن بلو', 140, 160, 180);
pizza('Strips', 'استربس', 140, 160, 180);
pizza('Shish Tawook', 'شيش طاووق', 140, 160, 180);
pizza('Chicken Shawarma', 'شاورما فراخ', 140, 160, 180);
pizza('Beef Shawarma', 'شاورما لحم', 150, 170, 190);
pizza('Chicken Fajita', 'فاهيتا فراخ', 140, 160, 180);
pizza('Chicken Ranch', 'تشكن رانش', 150, 170, 190);
pizza('BBQ Chicken', 'تشكن باربكيو', 140, 160, 180);
pizza('Chicken Supreme', 'سوبريم فراخ', 150, 170, 200);
pizza('Beef Supreme', 'سوبريم لحم', 170, 190, 210);
pizza('Sweet Chicken', 'سويت تشكن', 150, 170, 190);
pizza('Sweet Fried', 'سويت فرايد', 150, 170, 190);
pizza('Smoked Chicken Mix', 'ميكس فراخ مدخن', 150, 170, 200);

// ---- بيتزا كريب — one price
const pcrepe = (name, nameAr, p) => add('Pizza Crepe', 'بيتزا كريب', `Pizza Crepe – ${name}`, `بيتزا كريب ${nameAr}`, [['', '', p]]);
pcrepe('Strips', 'استربس', 240);
pcrepe('Shish Tawook', 'شيش طاووق', 240);
pcrepe('Shish Strips', 'شيش استربس', 240);
pcrepe('Troika', 'تروقة', 260);

// ---------------------------------------------------------------- write the workbook in the import format
const menuRows = [['productId', 'category', 'categoryAr', 'name', 'nameAr', 'description', 'descriptionAr', 'price', 'unit', 'stock', 'quantity', 'available', 'image']];
const optionRows = [['product', 'group', 'groupAr', 'required', 'multiple', 'min', 'max', 'choice', 'choiceAr', 'extraPrice']];
for (const m of menu) {
  const base = Math.min(...m.sizes.map((s) => s[2]));
  menuRows.push(['', m.cat, m.catAr, m.name, m.nameAr, m.desc, m.descAr, base, 'PIECE', 'OPEN', '', 'TRUE', m.image]);
  if (m.sizes.length > 1) {
    m.sizes.forEach(([en, ar, price], i) => optionRows.push([m.name, 'Size', 'الحجم', i === 0 ? 'TRUE' : '', i === 0 ? 'FALSE' : '', '', '', en, ar, price - base]));
  }
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(menuRows), 'Menu');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(optionRows), 'Options');
const xlsx = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync('troika-menu.xlsx', xlsx);
const cfb = XLSX.CFB.utils.cfb_new();
XLSX.CFB.utils.cfb_add(cfb, '/troika-menu.xlsx', xlsx);
for (const f of ['pizza-pepperoni.jpg', 'crepe-shish-tawook.jpg']) XLSX.CFB.utils.cfb_add(cfb, '/' + f, fs.readFileSync(f));
fs.writeFileSync('troika-menu-with-photos.zip', XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }));
console.log(`products: ${menu.length}, option rows: ${optionRows.length - 1}, categories: ${new Set(menu.map((m) => m.cat)).size}`);
