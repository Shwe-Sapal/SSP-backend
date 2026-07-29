# Plan: Bulk Supplier-Product Link/Unlink

**Date:** 2026-07-29
**Status:** Implemented

## Objective

Product (Inventory) တွေကို Supplier နဲ့တွဲတဲ့အခါ အခုလက်ရှိဆိုရင် product တစ်ခုချင်းစီထဲဝင်ပြီး supplier ထည့်နေရတယ်။ Bulk Action အနေနဲ့ products အများကြီးကို supplier တစ်ယောက် (သို့) အများကြီးနဲ့ တစ်ခါတည်း link/unlink လုပ်နိုင်အောင်ထည့်ပေးဖို့။

## Context

ဒီ Relationship က **unidirectional** (Inventory → Supplier) ဖြစ်တယ်။ SupplierProfile model ကို မပြင်ဘူး။ Supplier တစ်ယောက်ရဲ့ products တွေကိုကြည့်ချင်ရင် `GET /api/v1/inventory?supplier=SUPPLIER_ID` ဆိုတဲ့ filter ကိုသုံးလို့ရတယ် (branch မှာ ရှိပြီးသား)။

## Files Modified

| File | Action |
|------|--------|
| `src/controllers/inventory.controller.js` | `bulkLinkSuppliers` + `bulkUnlinkSuppliers` functions အသစ်ထည့် |
| `src/routes/inventory.route.js` | Route ၂ ခု အသစ်ထည့် |

Model ပြောင်းစရာမလိုဘူး — `suppliers` array က Inventory model မှာရှိပြီးသား။

## Implementation

### Controller: `src/controllers/inventory.controller.js`

`importInventoryFromExcel` function ရဲ့အပေါ်မှာ function နှစ်ခုထည့်:

**a) `bulkLinkSuppliers`**
- `{ productIds: [...], supplierIds: [...] }` ကို `req.body` ကနေလက်ခံ
- Validate: array နှစ်ခုလုံးရှိဖို့၊ ObjectId format မှန်ဖို့
- `$addToSet` + `$each` သုံးပြီး duplicate မဝင်အောင်
- `{ isDeleted: false }` ကိုပါ filter ထည့်

```js
const result = await Inventory.updateMany(
  { _id: { $in: productIds }, isDeleted: false },
  { $addToSet: { suppliers: { $each: supplierIds } } }
);
```

**b) `bulkUnlinkSuppliers`**
- Same validation pattern
- `$pull` + `$in` သုံးပြီး ဖြုတ်

```js
const result = await Inventory.updateMany(
  { _id: { $in: productIds }, isDeleted: false },
  { $pull: { suppliers: { $in: supplierIds } } }
);
```

### Route: `src/routes/inventory.route.js`

Import မှာ function နှစ်ခုကိုထည့်၊ ပြီးရင် POST routes အသစ်ထည့်:

```js
router.post(
  "/inventory/bulk-link-suppliers",
  protect,
  permissionGranted("owner", "admin"),
  bulkLinkSuppliers
);

router.post(
  "/inventory/bulk-unlink-suppliers",
  protect,
  permissionGranted("owner", "admin"),
  bulkUnlinkSuppliers
);
```

## API Reference

### Bulk Link
```
POST /api/v1/inventory/bulk-link-suppliers
Authorization: Bearer <token>
{
  "productIds": ["60d5...a1", "60d5...a2", "60d5...a3"],
  "supplierIds": ["60d5...b1", "60d5...b2"]
}
```
Response:
```json
{
  "success": true,
  "message": "3 product(s) linked with 2 supplier(s)",
  "data": { "matchedCount": 3, "modifiedCount": 3 }
}
```

### Bulk Unlink
```
POST /api/v1/inventory/bulk-unlink-suppliers
Authorization: Bearer <token>
{
  "productIds": ["60d5...a1", "60d5...a2"],
  "supplierIds": ["60d5...b1"]
}
```
Response:
```json
{
  "success": true,
  "message": "Supplier(s) removed from 2 product(s)",
  "data": { "matchedCount": 2, "modifiedCount": 2 }
}
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Product မှာ supplier ရှိပြီးသား (link) | `$addToSet` — duplicate မဝင်ဘူး |
| Product မှာ supplier မရှိဘူး (unlink) | `$pull` — no-op, error မရှိဘူး |
| Invalid ObjectId | 400 error ပြန် |
| Empty array | 400 error ပြန် |
| Soft-deleted product | `{ isDeleted: false }` filter — ကျော်သွားမယ် |
| Product ID မရှိဘူး | `matchedCount` = 0 |
| Cashier က run | 403 from `permissionGranted("owner", "admin")` |

## Test Plan

1. Server စမ်း: `npm run dev`
2. Supplier တွေ create: `POST /api/v1/supplier-profile`
3. Inventory items တွေ create: `POST /api/v1/inventory`
4. တစ်ခါတည်း link: `POST /api/v1/inventory/bulk-link-suppliers`
5. Filter နဲ့စစ်: `GET /api/v1/inventory?supplier=SUPPLIER_ID` — items တွေပါလားစစ်
6. Unlink: `POST /api/v1/inventory/bulk-unlink-suppliers`
7. ပြန်စစ်: `GET /api/v1/inventory?supplier=SUPPLIER_ID` — ပျောက်သွားလားစစ်
8. Error cases: invalid ID, empty array, token မပါတဲ့ request
