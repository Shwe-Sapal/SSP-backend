# Plan: Credit Purchase Order Feature

**Date:** 2026-07-30
**Status:** Draft

## Objective

Purchase Order (PO) တွေကို အကြွေးနဲ့ဝယ်ယူနိုင်အောင် ထည့်ပေးခြင်း။ လက်ရှိ Sales Order မှာ `paymentType: "credit"` ရှိသလိုမျိုး Purchasing မှာလည်း ထည့်ပေးမည်။ PO တစ်ခုအတွက် အကြိမ်ကြိမ်ဆပ်လို့ရမည်။ Supplier အလိုက် ကျန်ငွေချေငွေကိုပါကြည့်လို့ရမည်။

## Background

လက်ရှိ Purchasing Model မှာ **ငွေပေးချေမှုဆိုင်ရာ field များမပါရှိပါ။** PO ကို `totalAmount` နဲ့ဖန်တီးပြီး `status` (pending → confirmed → arrived → completed) ပဲပြောင်းလို့ရပါတယ်။

Sales Side မှာတော့ —
- `Order` model မှာ `paymentType`, `paidAmount`, `finalAmount`, `creditPersonId` ရှိပါတယ်
- `CreditRecord` model နဲ့ အကြိမ်ကြိမ်ဆပ်လို့ရပါတယ်
- `createCreditPayment` controller က transaction နဲ့ ACID guarantee လုပ်ပါတယ်

**ဒီ Feature က Sales Side ရဲ့ Credit System ပုံစံကိုပဲ Purchasing ဘက်မှာ အကောင်အထည်ဖော်မှာဖြစ်ပါတယ်။**

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/models/purchasing.model.js` | Modify — add `paymentType`, `paidAmount`, `dueDate` fields |
| `src/models/supplierPayment.model.js` | **Create** — SupplierPayment Model (CreditRecord ပုံစံ) |
| `src/controllers/purchase.controller.js` | Modify — update `createPurchase`, add `getPurchasesByPaymentStatus` filter |
| `src/controllers/supplierPayment.controller.js` | **Create** — payment CRUD functions |
| `src/routes/purchasing.route.js` | Modify — add payment routes |
| `src/app.js` | Modify — register new router (if separate file) |

## Implementation Steps

### Step 1: Modify Purchasing Model

**File:** `src/models/purchasing.model.js`

Add fields to `PurchasingSchema`:

```javascript
paymentType: {
  type: String,
  enum: ["credit", "paid"],
  default: "paid",
},
paidAmount: {
  type: Number,
  default: 0,
  min: [0, "Paid amount cannot be negative"],
},
dueDate: {
  type: Date,
  default: null,
},
```

Add virtual fields:

```javascript
// ကျန်သေးတဲ့ငွေ
purchasingSchema.virtual("remainingBalance").get(function () {
  if (this.totalAmount == null || this.paidAmount == null) return null;
  return Math.max(0, this.totalAmount - this.paidAmount);
});

// အပြည့်ဆပ်ပြီးလား
purchasingSchema.virtual("isFullyPaid").get(function () {
  return this.remainingBalance <= 0;
});

// ငွေပေးချေမှုအခြေအနေ
purchasingSchema.virtual("paymentStatus").get(function () {
  if (!this.paidAmount || this.paidAmount <= 0) return "unpaid";
  if (this.paidAmount >= this.totalAmount) return "paid";
  return "partial";
});
```

Add indexes:

```javascript
purchasingSchema.index({ paymentType: 1 });
purchasingSchema.index({ paidAmount: 1 });
```

### Step 2: Create SupplierPayment Model

**File:** `src/models/supplierPayment.model.js`

```javascript
import mongoose from "mongoose";

const supplierPaymentSchema = new mongoose.Schema(
  {
    purchasingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchasing",
      required: [true, "Purchase order ID is required"],
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierProfile",
      default: null,
    },
    paidAmount: {
      type: Number,
      required: [true, "Paid amount is required"],
      min: [0, "Paid amount cannot be negative"],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      default: "cash",
    },
    notes: {
      type: String,
      default: null,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Added by is required"],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
supplierPaymentSchema.index({ purchasingId: 1 });
supplierPaymentSchema.index({ supplierId: 1 });
supplierPaymentSchema.index({ paymentDate: -1 });
supplierPaymentSchema.index({ purchasingId: 1, isDeleted: 1 });
supplierPaymentSchema.index({ supplierId: 1, isDeleted: 1 });

const SupplierPayment = mongoose.model("SupplierPayment", supplierPaymentSchema);
export default SupplierPayment;
```

### Step 3: Update Purchase Controller

**File:** `src/controllers/purchase.controller.js`

**3a. Update `createPurchase`:**
- Destructure `paymentType`, `paidAmount`, `dueDate` from `req.body`
- Set defaults: `paymentType = "paid"`, `paidAmount = totalAmount` for non-credit
- For credit: `paidAmount` can be 0 or partial

```javascript
const { supplierId, products, note, totalAmount, paymentType, paidAmount, dueDate } = req.body;

// ... existing validation ...

const purchaseData = {
  poNumber,
  supplierId,
  products: productsWithDetails,
  note: note || "No note available",
  totalAmount,
  status: "pending",
  purchasedBy,
  paymentType: paymentType || "paid",
  paidAmount: paymentType === "credit" ? (paidAmount || 0) : totalAmount,
  dueDate: dueDate || null,
};
```

**3b. Update `getAllPurchases`:**
- Add `paymentType` query filter
- Add `paymentStatus` query filter (unpaid/partial/paid)

```javascript
if (req.query.paymentType) {
  query.paymentType = req.query.paymentType;
}
```

### Step 4: Create SupplierPayment Controller

**File:** `src/controllers/supplierPayment.controller.js`

#### 4a. `createSupplierPayment` (Sales → `createCreditPayment` ကိုနမူနာယူ)

```
POST /api/v1/purchase/:id/payment
Body: { paidAmount, paymentMethod, notes }
```

**Logic:**
1. Validate inputs (purchasingId, paidAmount)
2. Validate ObjectId format
3. Start MongoDB session + transaction
4. Inside transaction:
   - Find PO (with session), check exists & not deleted
   - Check `paymentType === "credit"`
   - Calculate remaining balance
   - Validate paidAmount ≤ remainingBalance
   - Auto-populate `supplierId` from PO
   - Create `SupplierPayment` record
   - Update `PO.paidAmount += paidAmount`
   - If fully paid → auto set PO status = "completed"
5. Populate references for response
6. Return response with remainingBalance, isFullyPaid, paymentStatus

#### 4b. `getPaymentsByPurchaseId`

```
GET /api/v1/purchase/:id/payments
```

- Find all `SupplierPayment` records for this PO
- Sort by `paymentDate` descending
- Include running balance calculation
- Populate `addedBy` (name, role)

#### 4c. `getPaymentsBySupplierId`

```
GET /api/v1/supplier/:supplierId/payments
```

- Find all payments for this supplier
- Pagination support
- Summary statistics: totalPaid, totalOutstanding (across all POs)
- Group by PO

#### 4d. `hardDeleteSupplierPayment`

```
DELETE /api/v1/supplier-payment/:id
```

- Transaction: delete payment record + revert PO.paidAmount
- Same pattern as Sales `hardDeleteCreditRecord`

### Step 5: Update Routes

**File:** `src/routes/purchasing.route.js`

```javascript
// Payment routes
router.post(
  "/purchase/:id/payment",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierPayment
);

router.get(
  "/purchase/:id/payments",
  protect,
  permissionGranted("owner", "admin"),
  getPaymentsByPurchaseId
);

router.get(
  "/supplier/:supplierId/payments",
  protect,
  permissionGranted("owner", "admin"),
  getPaymentsBySupplierId
);

router.delete(
  "/supplier-payment/:id",
  protect,
  permissionGranted("owner"),
  hardDeleteSupplierPayment
);
```

## Data Model Changes

### Purchasing Model (Modified)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paymentType` | String (enum) | `"paid"` | `"credit"` or `"paid"` |
| `paidAmount` | Number | `0` | စုစုပေါင်းဆပ်ပြီးငွေ |
| `dueDate` | Date | `null` | နောက်ဆုံးဆပ်ရမည့်ရက် |

### Virtuals (auto-calculated)

| Virtual | Formula |
|---------|---------|
| `remainingBalance` | `max(0, totalAmount - paidAmount)` |
| `isFullyPaid` | `remainingBalance <= 0` |
| `paymentStatus` | `paidAmount === 0 → "unpaid"`, `paidAmount >= totalAmount → "paid"`, else `"partial"` |

### SupplierPayment Model (New)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `purchasingId` | ObjectId (Purchasing) | Yes | ဘယ် PO အတွက်လဲ |
| `supplierId` | ObjectId (SupplierProfile) | No (auto-populate) | ဘယ် Supplier ဆီလဲ |
| `paidAmount` | Number | Yes | ဒီတစ်ခါဆပ်တဲ့ငွေ |
| `paymentDate` | Date | No (default: now) | ဆပ်တဲ့ရက် |
| `paymentMethod` | String | No (default: cash) | ဆပ်တဲ့နည်း (cash/bank/transfer) |
| `notes` | String | No | မှတ်ချက် |
| `addedBy` | ObjectId (Admin) | Yes | ဘယ်သူဆပ်တယ် |

## API Changes

### New Endpoints

| Method | Endpoint | Permission | Function | Description |
|--------|----------|-----------|----------|-------------|
| POST | `/purchase/:id/payment` | owner, admin | `createSupplierPayment` | PO အတွက်ဆပ်ငွေထည့် |
| GET | `/purchase/:id/payments` | owner, admin | `getPaymentsByPurchaseId` | PO ရဲ့ဆပ်ငွေမှတ်တမ်း |
| GET | `/supplier/:supplierId/payments` | owner, admin | `getPaymentsBySupplierId` | Supplier အလိုက်ဆပ်ငွေမှတ်တမ်း |
| DELETE | `/supplier-payment/:id` | owner | `hardDeleteSupplierPayment` | ဆပ်ငွေမှတ်တမ်းဖျက် |

### Modified Endpoints

| Endpoint | Changes |
|----------|---------|
| `POST /purchase` | Body မှာ `paymentType`, `paidAmount`, `dueDate` ထည့်လို့ရ |
| `GET /purchase` | `?paymentType=credit`, `?paymentStatus=unpaid` filter ထည့် |
| `GET /purchase/:id` | Response မှာ `remainingBalance`, `paymentStatus`, `isFullyPaid` ပါမည် |

### Modified Request Body (POST /purchase)

```json
{
  "supplierId": "60d5...",
  "products": [{ "inventoryId": "60d5...", "purchaseQuantity": 50 }],
  "totalAmount": 500000,
  "paymentType": "credit",
  "paidAmount": 200000,
  "dueDate": "2026-09-30",
  "note": "ကျန် ၃၀၀၀၀၀ ကို လာလမကုန်ဆပ်မည်"
}
```

### Modified Response (GET /purchase/:id)

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "poNumber": "PO-2026-07-30-000001",
    "totalAmount": 500000,
    "paidAmount": 200000,
    "remainingBalance": 300000,
    "paymentType": "credit",
    "paymentStatus": "partial",
    "isFullyPaid": false,
    "dueDate": "2026-09-30T00:00:00.000Z",
    "status": "confirmed"
  }
}
```

## Edge Cases & Considerations

| Scenario | Behavior |
|----------|----------|
| PO က credit မဟုတ်ဘူး (paid) | Payment ထည့်လို့မရ — 400 error |
| ကျန်ငွေထက်ပိုဆပ်မိ | 400 error |
| PO က soft-deleted | 400 error |
| PO က fully paid (completed) | Payment ထည့်လို့မရ — 400 error |
| ဆပ်ငွေက 0 | 400 error |
| Cashier က payment ထည့် | 403 error (owner/admin only) |
| တစ်ပြိုင်တည်းဆပ်နှစ်ခါ (race condition) | Transaction ကကာကွယ်မည် |
| ငွေပြန်အမ်းတာမျိုး (negative payment) | Sales မှာပါလို့ထည့်စရာမလို — PO အတွက်မလိုအပ် |
| PO ကို paymentType မထည့်ဘူး | Default → "paid", paidAmount = totalAmount |

## Pre-save Hook (Auto-complete on full payment)

PO ကို အပြည့်ဆပ်ပြီးရင် status ကို "completed" သို့ auto ပြောင်းရန် —

```javascript
purchasingSchema.pre("save", function (next) {
  if (this.isModified("paidAmount") && this.paymentType === "credit") {
    if (this.paidAmount >= this.totalAmount && this.status !== "cancelled") {
      this.status = "completed";
    }
  }
  next();
});
```

## Test Plan

1. Create PO with `paymentType: "paid"` — existing behavior အတိုင်းအလုပ်လုပ်ရမည်
2. Create PO with `paymentType: "credit"`, partial `paidAmount` — credit PO ဆောက်ရမည်
3. `POST /purchase/:id/payment` — ဆပ်ငွေထည့်ရမည်၊ PO.paidAmount တိုးရမည်
4. `GET /purchase/:id/payments` — ဆပ်ငွေမှတ်တမ်းပြရမည်
5. `GET /supplier/:id/payments` — Supplier အလိုက်ဆပ်ငွေမှတ်တမ်းပြရမည်
6. Fully pay a credit PO — status → "completed" auto ပြောင်းရမည်
7. `GET /purchase?paymentType=credit` — credit PO တွေပဲပြရမည်
8. Delete payment — PO.paidAmount ပြန်နုတ်ရမည်
9. Error cases: invalid ID, overpayment, deleted PO, cashier access
