# Project Conventions — Actual Patterns from Codebase

> **⚠️ IMPORTANT:** Every rule below is derived from the actual SSP Backend source code. When adding new code, match these exact patterns — including naming, file extensions, import style, and error handling.

---

## 1. File Naming Convention

All files follow the pattern: **`entity.type.js`** (lowercase, dot-separated).

| Layer | Pattern | Example |
|-------|---------|---------|
| Controller | `*.controller.js` | `admin.controller.js`, `creditPersona.controller.js` |
| Model | `*.model.js` | `admin.model.js`, `goodsRecievedNote.model.js` |
| Route | `*.route.js` | `admin.route.js`, `storefrontInventory.route.js` |
| Middleware | `*.middleware.js` | `rateLimiter.middleware.js`, `multerImageupload.middleware.js` |
| Service | `*.service.js` | `jwtToken.service.js`, `stockAuditLog.service.js` |
| Utility | `*.utils.js` | `dateFilter.utils.js`, `phoneValidation.utils.js` |
| Config | `*.config.js` | `db.config.js`, `cors.config.js`, `cloudflareR2.config.js` |

**Exception:** Standalone utilities with no layer type may omit the type suffix (e.g., `customError.js`, `asyncErrorHandler.js`).

---

## 2. Module System (ES Modules)

The project uses `"type": "module"` in `package.json`. **Always use ES Module syntax.**

### ✅ Correct (ESM)
```js
import express from "express";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import Admin from "../models/admin.model.js";

export const createEntity = asyncErrorHandler(async (req, res, next) => { ... });
export default router;
```

### ❌ Never use (CommonJS)
```js
const express = require("express");          // WRONG
module.exports = router;                      // WRONG
exports.createEntity = ...;                   // WRONG
```

### Export Rules
- **Named exports** for: controller functions, service functions, utility functions, individual middleware exports.
- **Default exports** for: Mongoose models, Express routers.

```js
// Named export — controller
export const getEntities = asyncErrorHandler(async (req, res, next) => { ... });

// Named export — utility
export const validatePhoneNumber = (phone, region) => { ... };

// Default export — model
export default Admin;

// Default export — router
export default router;
```

### Import Order
Group imports in this order: 3rd-party → config → utils → services → models → controllers.

```js
import express from "express";                          // 3rd-party
import jwt from "jsonwebtoken";
import { promisify } from "util";

import CustomError from "../../utils/customError.js";   // utils
import { signToken } from "../../services/jwtToken.service.js"; // services
import Admin from "../../models/admin.model.js";         // models
```

---

## 3. Error Handling System

### CustomError Class (`src/utils/customError.js`)
```js
class CustomError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.success = statusCode >= 400 && statusCode < 500 ? false : true;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
export default CustomError;
```

- `statusCode`: HTTP status code.
- `success`: auto-computed — `false` for 4xx, `true` for 5xx.
- `isOperational`: always `true` (distinguishes from programming bugs).

### asyncErrorHandler Wrapper (`src/utils/asyncErrorHandler.js`)
```js
export const asyncErrorHandler = (func) => {
  return (req, res, next) => {
    func(req, res, next).catch((err) => next(err));
  };
};
```

Every controller function MUST be wrapped:
```js
export const getEntities = asyncErrorHandler(async (req, res, next) => { ... });
```

### Error Forwarding
Always use `return next(new CustomError(...))` — the `return` is required to stop execution:
```js
if (!name) return next(new CustomError(400, "Name is required"));
if (!mongoose.Types.ObjectId.isValid(id)) return next(new CustomError(400, "Invalid ID format"));
const doc = await Model.findById(id);
if (!doc) return next(new CustomError(404, "Resource not found"));
```

### Global Error Handler (`src/controllers/error.controller.js`)
- **Development mode:** returns `{ success, message, stackTrace, error }`.
- **Production mode:** transforms known errors:
  - `CastError` → 400 "Invalid value for field X".
  - Duplicate key (code 11000) → 400 "Field X already in use".
  - `ValidationError` → 400 (concatenated field error messages).
  - `TokenExpiredError` → 401 "JWT has expired".
  - `JsonWebTokenError` → 401 "Invalid JWT".
  - Non-operational errors → 500 "Something went wrong" (details logged server-side).

---

## 4. Authentication & Authorization

Both middlewares live in `src/controllers/administrationPolicy.controller.js`:

### `protect` Middleware
1. Extracts token from `Authorization: Bearer <token>` header.
2. Verifies with `jwt.verify` (promisified via `util.promisify`).
3. Checks decoded token contains `id` and `role`.
4. Loads admin from DB: `await Admin.findById(decoded.id).select("+password")`.
5. Checks admin exists and is not soft-deleted (`softDeleted: false`).
6. Sets `req.user = { id: decoded.id, role: decoded.role, locationId: decoded.locationId }`.

### `permissionGranted(...roles)` Middleware
```js
export const permissionGranted = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return next(new CustomError(401, "Not authenticated"));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new CustomError(403, "You do not have permission"));
    }
    next();
  };
};
```

### Usage in Routes
```js
router.post("/entity", protect, permissionGranted("owner", "admin"), createEntity);
```

### Role Hierarchy
- `"owner"` — full access (delete, sensitive operations).
- `"admin"` — most CRUD operations.
- `"cashier"` — read-only, basic operations, order management.

---

## 5. Layer-by-Layer Templates

### 5A. Configs (`src/configs/*.config.js`)

```js
import dotenv from "dotenv";
import mongoose from "mongoose";

const Db = async () => {
  dotenv.config({ path: "./.env" });
  mongoose.set("strictQuery", false);
  const conn = await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connection successful");
  // Optional: one-time index migrations
  // await conn.connection.db.collection("collection").dropIndex("indexName");
};

export default Db;
```

**Key patterns:**
- `dotenv.config({ path: "./.env" })` at top.
- `mongoose.set("strictQuery", false)` before connect.
- Named export for middleware factories (e.g., `configureCors`, `mmTimeZoneMiddleware`).
- Default export for DB connection function.

### 5B. Models (`src/models/*.model.js`)

#### Schema Skeleton
```js
import mongoose from "mongoose";

const entitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      unique: true,
      lowercase: true
    },
    quantity: {
      type: Number,
      default: 0,
      min: [0, "Quantity cannot be negative"]
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive", "archived"],
        message: "Status must be active, inactive, or archived"
      },
      default: "active"
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OtherModel"
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,     // adds createdAt, updatedAt
    id: false,            // suppresses virtual "id" field
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtuals
entitySchema.virtual("computedField").get(function () {
  return this.field1 + this.field2;
});

// Indexes
entitySchema.index({ referenceId: 1, status: 1 });
entitySchema.index({ name: "text", description: "text" });

// Pre-save hooks
entitySchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.confirmPassword = undefined;
  next();
});

// Instance methods
entitySchema.methods.instanceMethod = function () { ... };

// Static methods
entitySchema.statics.staticMethod = async function () { ... };

const Entity = mongoose.model("Entity", entitySchema);
export default Entity;
```

#### Soft Delete — Two Conventions

| Convention | Fields | Used In |
|-----------|--------|---------|
| **Standard** | `isDeleted: Boolean` + `deletedAt: Date` | Inventory, Order, Supplier, Purchasing, etc. |
| **Legacy** | `softDeleted: Boolean` + `deletedAt: Date` | Admin, Expense |

Always filter queries for active records:
```js
const items = await Model.find({ isDeleted: false });
const admin = await Admin.findOne({ _id: id, softDeleted: false });
```

Restore pattern:
```js
await Model.findByIdAndUpdate(id, { isDeleted: false, deletedAt: null });
```

#### Auto-Number Generation (Static Methods)
```js
purchasingSchema.statics.generatePONumber = async function () {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const count = await this.countDocuments({ isDeleted: false });
  return `PO-${y}-${m}-${d}-${String(count + 1).padStart(6, "0")}`;
};
```

Formats used in the project: `PO-YYYY-MM-DD-NNNNNN`, `GRN-YYYY-MM-DD-NNNNNN`, `ORD-YYYY-MM-DD-NNNNNN`, `TRF-YYYY-NNNN`.

### 5C. Routes (`src/routes/*.route.js`)

```js
import express from "express";
import {
  createEntity,
  getEntities,
  getEntity,
  updateEntity,
  deleteEntity
} from "../controllers/entity.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// CRUD — owner + admin
router.post("/entity", protect, permissionGranted("owner", "admin"), createEntity);
router.get("/entity", protect, permissionGranted("owner", "admin", "cashier"), getEntities);
router.get("/entity/:id", protect, permissionGranted("owner", "admin", "cashier"), getEntity);
router.patch("/entity/:id", protect, permissionGranted("owner", "admin"), updateEntity);
router.delete("/entity/:id", protect, permissionGranted("owner"), deleteEntity);

export default router;
```

**Rules:**
- `protect` always comes first in the middleware chain.
- Paths use kebab-case for multi-word segments: `/storefront-inventory`, `/stock-audit-logs`.
- All path segments are plural nouns.
- Always `export default router`.

### 5D. Controllers (`src/controllers/*.controller.js`)

```js
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import Entity from "../models/entity.model.js";
import { someService } from "../services/some.service.js";

// CREATE
export const createEntity = asyncErrorHandler(async (req, res, next) => {
  const { field1, field2 } = req.body;

  if (!field1) return next(new CustomError(400, "field1 is required"));

  const entity = await Entity.create({ field1, field2 });

  res.status(201).json({
    success: true,
    message: "Entity created successfully",
    data: { entity }
  });
});

// READ ALL (with pagination)
export const getEntities = asyncErrorHandler(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  const entities = await Entity.find({ isDeleted: false })
    .skip(skip)
    .limit(limit);

  const total = await Entity.countDocuments({ isDeleted: false });

  res.status(200).json({
    success: true,
    message: "Entities fetched successfully",
    data: { entities },
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: Number(limit)
    }
  });
});

// READ ONE
export const getEntity = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid ID format"));
  }

  const entity = await Entity.findOne({ _id: id, isDeleted: false });
  if (!entity) return next(new CustomError(404, "Entity not found"));

  res.status(200).json({
    success: true,
    message: "Entity fetched successfully",
    data: { entity }
  });
});

// UPDATE
export const updateEntity = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid ID format"));
  }

  const entity = await Entity.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true
  });

  if (!entity) return next(new CustomError(404, "Entity not found"));

  res.status(200).json({
    success: true,
    message: "Entity updated successfully",
    data: { entity }
  });
});

// SOFT DELETE
export const deleteEntity = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  const entity = await Entity.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true }
  );

  if (!entity) return next(new CustomError(404, "Entity not found"));

  res.status(200).json({
    success: true,
    message: "Entity deleted successfully",
    data: { entity }
  });
});
```

**Controller Rules:**
1. Every function wrapped with `asyncErrorHandler`.
2. Destructure `req.body`, `req.params`, `req.query` at the top.
3. Validate inputs manually with early `return next(new CustomError(...))`.
4. Check `ObjectId.isValid()` for params that are MongoDB IDs.
5. Always filter out soft-deleted records: `{ isDeleted: false }`.
6. Response always uses `res.status(code).json({ success, message, data })`.
7. Status codes: `201` for creation, `200` for success/update/read.
8. List endpoints should include optional pagination in response.

### 5E. Services (`src/services/*.service.js`)

Services contain reusable business logic extracted from controllers.

```js
import Entity from "../models/entity.model.js";

export const getAllEntities = async (filter = {}) => {
  return Entity.find({ isDeleted: false, ...filter }).lean();
};

export const createStockAuditLog = async ({
  inventoryId, adminId, locationId, locationType,
  stockRecordId, beforeQuantity, afterQuantity,
  quantityChange, action, reason,
  relatedTransactionId, relatedTransactionType,
  session
}) => {
  // Validate all fields
  if (!inventoryId) throw new CustomError(400, "inventoryId is required");
  // ...

  return StockAuditLog.create([{ ... }], { session });
};
```

**Service Rules:**
- Services should not access `req`/`res` objects.
- Services can accept raw data objects and return results.
- Services can use `session` parameter for transactional operations.
- Use `.lean()` for read-only queries to get plain JS objects (faster, less memory).
- Functions are named exports.

### 5F. Middlewares (`src/middlewares/*.middleware.js`)

**Rate limiter (factory pattern):**
```js
import rateLimit from "express-rate-limit";

export const apiRateLimiter = (maxRequests, timeWindow) => {
  return rateLimit({
    max: maxRequests,
    windowMs: timeWindow,
    handler: (req, res) => {
      res.status(429).json({
        code: 429,
        status: "failed",
        message: "Too many requests. Please try again later."
      });
    }
  });
};
```

**Auth middleware** lives in `src/controllers/administrationPolicy.controller.js` (not in middlewares folder).

---

## 6. MongoDB Transactions

### Pattern A: `session.withTransaction()` (auto-retry on transient errors)
```js
import mongoose from "mongoose";

const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    const doc1 = await Model1.create([data1], { session });
    const doc2 = await Model2.create([data2], { session });
    // Throw CustomError to abort: throw new CustomError(400, "reason");
  });
} catch (error) {
  // Transaction was aborted — handle or re-throw
  return next(error);
} finally {
  await session.endSession();
}
```

### Pattern B: Manual commit/abort
```js
const session = await mongoose.startSession();
session.startTransaction();
try {
  const doc1 = await Model1.create([data1], { session });
  const doc2 = await Model2.create([data2], { session });
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
  return next(error);
} finally {
  session.endSession();
}
```

---

## 7. Response Envelope Reference

### Success Responses
| Scenario | Status | `success` | `data` shape | Pagination? |
|----------|--------|-----------|-------------|-------------|
| Create | 201 | true | `{ entity: doc }` | No |
| Read single | 200 | true | `{ entity: doc }` | No |
| Read list | 200 | true | `{ entities: [...] }` | Optional |
| Update | 200 | true | `{ entity: doc }` | No |
| Soft delete | 200 | true | `{ entity: doc }` | No |

### Error Responses
| Scenario | Status | `success` |
|----------|--------|-----------|
| Validation failure | 400 | false |
| Not authenticated | 401 | false |
| Not authorized | 403 | false |
| Not found | 404 | false |
| Rate limited | 429 | false |
| Server error | 500 | false |

### `data` field convention
The `data` field is **always an object** with named keys. Even lists are wrapped:
```js
// ✅ Correct — always object with named key
{ data: { accounts: [...] } }
{ data: { inventory } }
{ data: { orders, creditRecord } }

// ❌ Avoid — bare array or scalar in data
{ data: [...] }        // WRONG
{ data: "string" }     // WRONG
```

---

## 8. Timezone Convention

- **Storage:** All dates are stored in MongoDB as UTC.
- **Display:** The `mmTimeZoneMiddleware` (`src/configs/timezoneConvertor.config.js`) intercepts `res.json` on **GET requests only** and converts these fields from UTC to Asia/Yangon:
  - `createdAt`, `updatedAt`, `deletedAt`, `passwordChangedAt`, `loginAt`, `lastActiveAt`.
- The conversion uses `moment-timezone` and deep-clones via `JSON.parse(JSON.stringify(data))`.

---

## 9. Rate Limiting

| Limiter | Rate | Applies To |
|---------|------|-----------|
| Global API | 60 req/min | All routes (configured in `app.js`) |
| AI Chat | 10 req/min | `/api/v1/sale-report/ai-chat` only |

---

## 10. Known Inconsistencies & Issues

These are real issues found in the codebase. **Do not replicate them in new code.**

1. **Soft delete field naming inconsistent:** Most models use `isDeleted`, but Admin and Expense use `softDeleted`. Stick to `isDeleted` for new models.

2. **Missing `logger.utils.js`:** Both `initSocket.utils.js` and `doSpaces.utils.js` import from `"./logger.utils.js"`, but this file does not exist. This will crash at runtime when those modules execute.

3. **`supplier.controller.js` dead code (lines 175-199):** Code after `res.status(200).json(...)` in `deleteSupplierProfile` is unreachable — it contains a duplicate response and unused error check.

4. **`hardDeleteOrder` route has no auth middleware:** The DELETE `/order/:orderId` endpoint in `order.route.js` lacks `protect` and `permissionGranted` middlewares. All new routes must include auth.

5. **CORS config uses string `"*"` with `allowedOrigins.includes()`:** The `cors.config.js` logic `allowedOrigins.includes(origin)` where `allowedOrigins = "*"` always returns `true` but is technically incorrect — prefer `origin: "*"` directly.

6. **`asyncErrorHandler` import style inconsistent:** Some files import as default (`import asyncErrorHandler from "..."`) and others as named (`import { asyncErrorHandler } from "..."`). Both work because the module exports both ways, but prefer named imports for consistency.

7. **Pagination:** Not all list endpoints implement pagination consistently. When paginating, always use the standard envelope: `{ currentPage, totalPages, totalItems, itemsPerPage }`.

---

## 11. HTTP Method Usage

This project uses `PATCH` (not `PUT`) for partial updates:
- `POST` — create
- `GET` — read (single + list)
- `PATCH` — update (partial update)
- `DELETE` — soft delete (or hard delete only when explicitly named, e.g., `hardDeleteOrder`)
