# Lucky Draw Redemption Feature Plan

**Date:** 2026-07-23
**Status:** Draft

## Context

ဆိုင်မှာ promotion အရ မဲပေါက်တဲ့အတွက် customer က မဲလက်မှတ်လာပေးရင် ပစ္စည်းတစ်ခုပေးရတယ်။

- ပစ္စည်းပေးတဲ့အတွက် **stock မှာနှုတ်ရမယ်** (StorefrontInventory)
- Customer က **ကျသင့်ငွေ (redemption fee)** ပေးရတယ် (လုံးဝအခမဲ့မဟုတ်)
- **ဆိုင်ရှင်က manual** လုပ်ရမယ် — ticket name, stock item, ကျသင့်ငွေ ချိတ်ပေးရမယ်

**Project alignment:** This plan must follow the conventions in `CLAUDE.md` and `.claude/rules/project-conventions.md` — ES Modules, `asyncErrorHandler`/`CustomError`, standard response envelope, and Mongoose schema patterns.

---

## Feature Overview

### အပိုင်း (၂) ပိုင်း

| အပိုင်း | ရှင်းလင်းချက် |
|---|---|
| **၁။ Promotion Setup** | ဆိုင်ရှင်က မဲအမည် + ပစ္စည်း + ကျသင့်ငွေ ချိတ်ဆက်ပြီး ဖန်တီးတာ (CRUD) |
| **၂။ Redemption** | Customer လာတဲ့အခါ staff က ရွေးပြီး stock နှုတ် + ငွေကောက် |

---

## Data Model

### LuckyDrawPromotion (Configuration)

```javascript
{
  promotionName: { type: String, required: [true, "Promotion name is required"], trim: true },
  ticketName: { type: String, required: [true, "Ticket name is required"], trim: true },
  inventoryId: { type: ObjectId, ref: "Inventory", required: [true, "Product is required"] },
  redemptionPrice: { type: Number, required: [true, "Redemption price is required"], min: 0 },
  quantityPerRedeem: { type: Number, default: 1, min: 1 },
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  storefrontId: { type: ObjectId, ref: "LocationProfile" },
  createdBy: { type: ObjectId, ref: "Admin" }
}
```

**Schema options:** `timestamps: true, id: false, toJSON: { virtuals: true }, toObject: { virtuals: true }`

### LuckyDrawRedemption (Transaction Record)

```javascript
{
  redemptionNumber: { type: String, unique: true, uppercase: true },  // "LDR-YYYYMMDD-NNNNNN"
  promotionId: { type: ObjectId, ref: "LuckyDrawPromotion", required: true },
  inventoryId: { type: ObjectId, ref: "Inventory", required: true },
  quantity: { type: Number, default: 1, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },            // snapshot of redemptionPrice
  totalAmount: { type: Number, required: true, min: 0 },           // unitPrice * quantity
  storefrontId: { type: ObjectId, ref: "LocationProfile", required: true },
  ticketCode: { type: String },                                    // actual ticket code (optional)
  customerName: { type: String },                                  // who redeemed (optional)
  redeemedBy: { type: ObjectId, ref: "Admin", required: true },
  note: { type: String, trim: true },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null }
}
```

**Schema options:** `timestamps: true, id: false, toJSON: { virtuals: true }, toObject: { virtuals: true }`

**Auto-number generation (static method):** Follow existing pattern from `goodsRecievedNote.model.js` — format `LDR-YYYYMMDD-NNNNNN`:

```javascript
redemptionSchema.statics.generateRedemptionNumber = async function () {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const count = await this.countDocuments({ isDeleted: false });
  return `LDR-${y}${m}${d}-${String(count + 1).padStart(6, "0")}`;
};
```

---

## Data Flow

```
Promotion Setup:
  Admin က Create Promotion Form ဖြည့်
    → ပစ္စည်းရွေး (Inventory product)
    → ticket name, ကျသင့်ငွေ ထည့်
    → Database မှာ သိမ်း (isActive: true)

Redemption Flow:
  Customer က မဲလက်မှတ်လာပေး
    → Staff က Lucky Draw စာမျက်နှာဖွင့်
    → Promotion ကိုရွေး (dropdown from active promotions)
    → ticket code + customer name ထည့် (optional)
    → "Redeem" နှိပ်
    → Backend:
        ၁။ Validate promotion (isActive, isDeleted)
        ၂။ Validate stock (StorefrontInventory quantity >= requested qty)
        ၃။ Start MongoDB session transaction
        ၄။ StorefrontInventory.quantity ကို နှုတ် (atomic $inc)
        ၅။ Redemption record ဖန်တီး
        ၆။ Commit transaction
    → အောင်မြင်ကြောင်းပြပေး
    → Customer က ကျသင့်ငွေပေး
```

---

## Files to Create & Modify

### Backend (this project — `ssp-backend`)

| File | Action | Details |
|---|---|---|
| **`src/models/luckyDrawPromotion.model.js`** | **CREATE** | Promotion config schema |
| **`src/models/luckyDrawRedemption.model.js`** | **CREATE** | Redemption transaction schema with auto-number generation |
| **`src/controllers/luckyDraw.controller.js`** | **CREATE** | CRUD promotions + `processRedemption` controller (stock deduction via transaction) |
| **`src/routes/luckyDraw.route.js`** | **CREATE** | All routes with `protect` + `permissionGranted` middlwares |
| **`src/app.js`** | **MODIFY** | Add `import luckyDrawRouter` + `app.use("/api/v1", luckyDrawRouter)` |
| **`src/services/stockAuditLog.service.js`** | **MODIFY** | Add `"lucky_draw_redemption"` as recognized `relatedTransactionType` |

---

## API Routes

### Promotions CRUD

| Method | Route | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/lucky-draw/promotions` | admin, owner, cashier | List all promotions (filter by `isActive`, `isDeleted: false`) |
| `GET` | `/api/v1/lucky-draw/promotions/:id` | admin, owner, cashier | Get single promotion |
| `POST` | `/api/v1/lucky-draw/promotions` | owner | Create promotion |
| `PATCH` | `/api/v1/lucky-draw/promotions/:id` | owner | Update promotion (name, price, status) |
| `DELETE` | `/api/v1/lucky-draw/promotions/:id` | owner | Soft delete promotion |

### Redemptions

| Method | Route | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/lucky-draw/redemptions` | cashier, admin, owner | Process redemption (deduct stock + create record in transaction) |
| `GET` | `/api/v1/lucky-draw/redemptions` | admin, owner, cashier | List redemptions with date range and `isDeleted: false` |

### Stock Deduction Logic (in Redemption Controller)

```javascript
// Follow the ACID transaction pattern from project-conventions.md §6 (Pattern A)
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // 1. Validate promotion is active and not deleted
    const promotion = await LuckyDrawPromotion.findOne({
      _id: promotionId, isActive: true, isDeleted: false
    }).session(session);
    if (!promotion) throw new CustomError(400, "Promotion not active or not found");

    // 2. Find StorefrontInventory and check stock
    const storefrontStock = await StorefrontInventory.findOne({
      inventoryId: promotion.inventoryId,
      storefrontId
    }).session(session);
    if (!storefrontStock || storefrontStock.quantity < quantity) {
      throw new CustomError(400, "Insufficient stock");
    }

    // 3. Deduct stock (atomic $inc)
    await StorefrontInventory.findByIdAndUpdate(
      storefrontStock._id,
      { $inc: { quantity: -quantity } },
      { session, new: true }
    );

    // 4. Generate redemption number
    const redemptionNumber = await LuckyDrawRedemption.generateRedemptionNumber();

    // 5. Create redemption record
    await LuckyDrawRedemption.create([{
      redemptionNumber, promotionId, inventoryId: promotion.inventoryId,
      quantity, unitPrice: promotion.redemptionPrice,
      totalAmount: promotion.redemptionPrice * quantity,
      storefrontId, ticketCode, customerName,
      redeemedBy: req.user.id
    }], { session });
  });
} catch (error) {
  return next(error);
} finally {
  await session.endSession();
}
```

---

## Implementation Sequence

| Phase | Files | Effort | Notes |
|---|---|---|---|
| **၁။ Backend Models** | `luckyDrawPromotion.model.js`, `luckyDrawRedemption.model.js` | Small | Follow existing model patterns from `project-conventions.md` §5B |
| **၂။ Backend Controller + Routes** | `luckyDraw.controller.js`, `luckyDraw.route.js`, `app.js` | Medium | Use `asyncErrorHandler`, `CustomError`, `protect` + `permissionGranted` |
| **၃။ Testing** | Run full flow: create promotion → redeem → verify stock deduction | Small | See verification steps |

---

## Verification

1. `npm run dev` — backend starts without errors
2. `POST /api/v1/lucky-draw/promotions` — create promotion (admin/owner)
3. `GET /api/v1/lucky-draw/promotions` — list promotions
4. `POST /api/v1/lucky-draw/redemptions` — redeem with valid promotion ID → check:
   - Redemption record created
   - StorefrontInventory quantity decreased
   - Response includes redemption number
5. `POST /api/v1/lucky-draw/redemptions` — try with insufficient stock → error returned
6. `GET /api/v1/lucky-draw/redemptions` — list with date filter

---

## References & Dependencies

- **Project conventions:** `CLAUDE.md`, `.claude/rules/project-conventions.md`
- **Existing patterns to follow:**
  - Auto-number generation: `purchasing.model.js` (PO-number), `goodsRecievedNote.model.js` (GRN-number)
  - Transaction stock deduction: `transfer.model.js` `updateStock()` method
  - Controller pattern: any controller in `src/controllers/`
- **Dependencies:** Inventory API, StorefrontInventory API, LocationProfile API
- **Tools:** MongoDB session transactions (`project-conventions.md` §6), `dateFilter.utils.js` for date range filtering
