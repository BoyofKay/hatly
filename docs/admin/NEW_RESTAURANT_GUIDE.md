# How to add a new restaurant (store) — step by step

دليل إضافة مطعم جديد خطوة بخطوة. Button names are shown in English with the Arabic in brackets.
**Who:** an **Admin** (the Admin preset has everything needed) or the super admin. Supervisors and the operations team cannot create or edit stores — see `ROLES_AND_PERMISSIONS.md`.
Every name is entered **in English and Arabic** — the forms and the import refuse a missing Arabic name. Money is typed in **EGP** (95 or 12.50), commission in **%** (12.5), weights in **kg** (1.5).

## Before you start — collect from the restaurant

| What | Why it matters |
|---|---|
| Store name in English **and** Arabic, logo (square JPG/PNG) | Customers see both; the logo is on every store card |
| Branch address + its exact location (open Google Maps → long-press the shop → copy the coordinates, or Share → Copy link) | Distance pricing and driver dispatch use it |
| **Hatly commission %** agreed in the contract | Without it, Hatly records **no commission** on delivered orders — and it is never added later |
| Opening hours per day + average preparation time | The store shows open/closed automatically and customers get realistic times |
| Menu: categories, products, prices, sizes/add-ons, Arabic names, photos | Imported in one file (step 5) |
| Who receives orders at the store: name + mobile of the manager (and staff) | They sign in to the store dashboard and accept orders |

## The steps

1. **Check the area exists.** Delivery › Service Areas (مناطق الخدمة) must have the city (e.g. Belbeis), and Delivery › Delivery Zones (مناطق التوصيل) must have active zones in it. Without zones, customers without a map pin cannot order. (Creating a zone or changing its fee is a super-admin step.)
2. **Create the store.** Stores › Vendors (المتاجر) › **New Vendor**: name in English **and** Arabic. Open it, upload the logo, **Save**.
3. **Create the branch.** On the store page › Branches › **New branch** (فرع جديد):
   - branch name in English **and** Arabic, and the address;
   - **Location**: paste the Google Maps link or "lat, lng" — the two coordinate boxes fill themselves;
   - **Service area** (required);
   - **Hatly commission (%)** (required), e.g. `15`.
   After **Create branch** the branch page opens. At its top is the **Go-live checklist** (قائمة الجاهزية للتشغيل): red items must be fixed, amber items are recommended. Press **Re-check** after each step.
4. **Section, hours, acceptance.** On the branch page:
   - **Sector** (القسم): Restaurants (or the right section) → Assign. Without a section the branch does not appear on the customer Home.
   - **Hours**: fill each day and the preparation time → Save.
   - **Who accepts orders**: *Vendor* (the restaurant accepts on its dashboard — needs step 6), *Automatic*, or *Hatly* (our operations team accepts on its behalf).
   - Delivery / pickup ticks as agreed.
5. **Upload the menu.** Products › **Import menu (Excel)** (استيراد المنيو):
   1. **Download template** — a new branch gets two example rows (a burger with sizes/extras and a kofta sold by weight); overwrite or delete them.
   2. Fill the **Menu** sheet: one row per product with `name` (English) **and** `nameAr` (Arabic); leave `productId` empty for new products. A new `category` needs `categoryAr` too and is created automatically. `price` in EGP (95 or 12.50); `unit` = `PIECE` or `WEIGHT` (price per kg); stock `quantity` in pieces, or in **kg** for weighed items (12.5).
   3. Sizes / add-ons in the **Options** sheet: one row per choice (with `choiceAr`), repeat the product and group names (`groupAr` once). For sizes, give the product its **smallest** price and each bigger size the **difference** as `extraPrice` (Margherita 90 → L +20, XL +40). A full worked example: `samples/troika-menu.xlsx` (77 items).
   4. **Photos**: put the .xlsx and the photos in **one .zip**, write each photo's file name in the `image` column. JPG/PNG/WebP, max 5 MB each.
   5. Upload the .xlsx (or the .zip) → **Check file** (فحص الملف). Every problem is listed by sheet and row; nothing is saved yet. Fix and re-check.
   6. When it says **Ready to import** → **Import**. If anything fails, nothing is saved.
   - Later price changes: download the template again (it now carries each product's id), edit, upload. Re-uploading never duplicates products.
6. **Store staff.** Stores › Vendor Staff (موظفو المتاجر) › **New staff account** (حساب موظف جديد): the manager's mobile, name, branch, role *Store manager*, first password. Give them the dashboard link and ask them to change the password (top bar › **Password**).
7. **Settlement terms** (store page): weekly or monthly, if different from the default.
8. **Go live.** When the checklist shows **Ready for customers**: on the store page press **Activate**, on the branch page press **Activate**, then **Open**. Place a test order yourself from the customer app, accept it from the store dashboard, and cancel it.

## After go-live
- Temporary closure (holiday, power cut): branch page › Closures — never deactivate the branch for that.
- Remove a product: **Delete** on its row (it leaves menus and carts; past orders keep it). Hide it for today only: **Deactivate**.
- Close a store for good: **Deactivate**. **Delete** only when you never want it again — it is refused while orders are still in progress, and it also switches off its branches, menu, offers and staff.

## Common mistakes the checklist now catches
| Mistake | What happened before |
|---|---|
| No commission % | Orders delivered with zero Hatly commission, silently |
| No section / no service area | Store invisible to customers |
| Acceptance = Vendor but no store staff account | Orders wait forever for an acceptance nobody can give |
| Branch never switched **Open** | New branches start closed |
| No delivery zones in the area | Customers without a map pin cannot check out |
