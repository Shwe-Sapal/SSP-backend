# SSP Backend (Auto Shop POS) — Project Instructions

## Tech Stack

| Area | Technology |
|------|-----------|
| **Runtime** | Node.js (latest LTS) |
| **Module System** | ES Modules (`"type": "module"` — uses `import`/`export`, **not** CommonJS) |
| **Framework** | Express 5 (`^5.1.0`) |
| **Database** | MongoDB with Mongoose 9 ODM (`^9.0.0`) |
| **Auth** | JWT-based with `jsonwebtoken` + `bcryptjs` (cost factor 12) |
| **File Storage** | Cloudflare R2 (shop logos) + DigitalOcean Spaces (images) via `@aws-sdk/client-s3` |
| **Real-time** | Socket.IO (room-based notifications: kitchen, waiter, cashier, manager, all) |
| **Scheduling** | node-cron (daily report generation) |
| **Deployment** | Vercel (serverless via `api/index.js` with cached MongoDB connection) |

## Actual Project Structure

```
ssp-backend/
├── api/
│   └── index.js                    # Vercel serverless entry point
├── src/
│   ├── configs/                    # Configuration files (PLURAL: configs/)
│   │   ├── db.config.js            # Mongoose connection + index migration
│   │   ├── cors.config.js          # CORS configuration
│   │   ├── doSpaces.config.js      # DigitalOcean Spaces S3 client
│   │   ├── cloudflareR2.config.js  # Cloudflare R2 client + upload helpers
│   │   └── timezoneConvertor.config.js  # UTC → Asia/Yangon on GET
│   ├── controllers/                # Route handlers (23 controllers)
│   │   ├── administrationPolicy.controller.js  # Auth: protect + permissionGranted
│   │   ├── error.controller.js                 # Global error handler
│   │   └── ...entity.controller.js
│   ├── middlewares/                # Express middlewares (3 files)
│   ├── models/                     # Mongoose schemas (17 models)
│   ├── routes/                     # Express route definitions (21 routes)
│   ├── services/                   # Business logic (5 services)
│   ├── utils/                      # Helpers (7 files)
│   ├── app.js                      # Express app setup
│   └── server.js                   # App entry point
├── vercel.json                     # Vercel deployment config
└── package.json
```

## NPM Scripts

| Command | Environment | Watcher |
|---------|------------|---------|
| `npm run dev` | `development` | nodemon |
| `npm run prod` | `production` | nodemon |
| `npm start` | — | none (plain `node`) |

## Expected Environment Variables

| Variable | Required | Default | Used In |
|----------|----------|---------|---------|
| `MONGODB_URI` | Yes | — | DB connection |
| `JWT_SECRET` | Yes | — | Token signing/verification |
| `JWT_EXPIRES_IN` | Yes | — | JWT expiry duration |
| `PASSWORD_CHANGE_TOKEN_EXPIRES_IN` | No | `"10m"` | Password reset token expiry |
| `PORT` | No | `5000` | Server listen port |
| `NODE_ENV` | No | — | `development`/`production` |
| `OPENROUTER_API_KEY` | Yes | — | AI chat (OpenRouter) |
| `OPENROUTER_MODEL` | No | `"google/gemini-2.5-flash"` | AI model |
| `R2_ENDPOINT` | Yes | — | Cloudflare R2 endpoint |
| `R2_ACCESS_KEY_ID` | Yes | — | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Yes | — | R2 secret key |
| `R2_BUCKET_NAME` | Yes | — | R2 bucket |
| `R2_PUBLIC_URL` | Yes | — | R2 public base URL |
| `DO_SPACES_ENDPOINT` | Yes | — | DigitalOcean Spaces endpoint |
| `DO_SPACES_REGION` | Yes | — | DO region |
| `DO_SPACES_ACCESS_KEY` | Yes | — | DO access key |
| `DO_SPACES_SECRET_KEY` | Yes | — | DO secret key |
| `DO_SPACES_BUCKET` | Yes | — | DO bucket name |

## File Naming Convention

All files follow the pattern: **`entity.type.js`** (lowercase, hyphen-separated).

```
admin.controller.js    # Controller
admin.model.js         # Model
admin.route.js         # Route
rateLimiter.middleware.js  # Middleware
jwtToken.service.js    # Service
customError.js         # Utility (no type suffix if standalone)
db.config.js           # Configuration
```

## Key Conventions

### Module System
- **Always use ES Module syntax:** `import`/`export`, **never** `require()`/`module.exports`.
- Named exports for controller functions, services, utilities.
- Default exports for Mongoose models and Express routers.

### Controller Pattern
Every controller function must be wrapped with `asyncErrorHandler`:

```js
export const createEntity = asyncErrorHandler(async (req, res, next) => {
  const { field1, field2 } = req.body;

  // Validate — early return on failure
  if (!field1) return next(new CustomError(400, "field1 is required"));

  const doc = await EntityModel.create({ field1, field2 });

  res.status(201).json({
    success: true,
    message: "Entity created successfully",
    data: { entity: doc }
  });
});
```

### Response Envelope
All API responses follow this format:

**Success:**
```json
{ "success": true, "message": "string", "data": { ... } }
```

**List (with pagination):**
```json
{ "success": true, "message": "string", "data": { "entities": [...] }, "pagination": { "currentPage": 1, "totalPages": 5, "totalItems": 100, "itemsPerPage": 20 } }
```

**Error:**
```json
{ "success": false, "message": "string" }
```
(In development, `stackTrace` and `error` fields are also included.)

### Error Handling
- **CustomError** class in `src/utils/customError.js`: carries `statusCode`, `success` (auto-computed from status), `isOperational: true`.
- **asyncErrorHandler** in `src/utils/asyncErrorHandler.js`: wraps async controllers to auto-forward rejected promises to Express `next(err)`.
- **Global error handler** in `src/controllers/error.controller.js`:
  - Development: returns full error with stack trace.
  - Production: transforms `CastError` → 400, duplicate key (11000) → 400, `ValidationError` → 400, JWT errors → 401.
- **Forward errors** with `return next(new CustomError(statusCode, "message"))`.

### Authentication & Authorization
- **`protect`** middleware (from `administrationPolicy.controller.js`):
  - Extracts Bearer token from `Authorization` header.
  - Verifies with `jwt.verify` (promisified via `util.promisify`).
  - Loads admin from DB by decoded `id`, checks role and `softDeleted` flag.
  - Sets `req.user` with `{ id, role, locationId }`.
- **`permissionGranted(...roles)`** middleware:
  - Checks `req.user.role` against allowed roles.
  - Returns 401 if no role, 403 if not authorized.
- **Route chain:** `protect` always precedes `permissionGranted`.

### Route Structure
All routes mounted under `/api/v1` in `app.js`. Routes define their own full paths.

```js
import express from "express";
import { createEntity, getEntities } from "../controllers/entity.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.post("/entity", protect, permissionGranted("owner", "admin"), createEntity);
router.get("/entity", protect, permissionGranted("owner", "admin", "cashier"), getEntities);
// ...

export default router;
```

### Mongoose Schema Default
```js
const schema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    // ...
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);
```
- Always `timestamps: true` and `id: false`.
- Use `virtuals: true` in both serialization options.
- Compound indexes and text indexes defined explicitly.
- Soft-delete fields: `isDeleted: Boolean` (default `false`), `deletedAt: Date` (default `null`).

### MongoDB Transactions
Two patterns used:

**Pattern A — `session.withTransaction()` (auto-retry):**
```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // operations with { session }
  });
} catch (error) { /* handle */ }
finally { await session.endSession(); }
```

**Pattern B — Manual commit/abort:**
```js
const session = await mongoose.startSession();
session.startTransaction();
try {
  // operations
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
} finally {
  session.endSession();
}
```

### Soft Delete Patterns
- **Preferred (most models):** `isDeleted: { type: Boolean, default: false }` + `deletedAt: { type: Date, default: null }`.
- **Legacy (Admin, Expense):** `softDeleted: { type: Boolean, default: false }` + `deletedAt: { type: Date, default: null }`.
- Always filter queries: `{ isDeleted: false }` or `{ softDeleted: false }`.
- Restore sets: `{ isDeleted: false, deletedAt: null }`.

## Critical Rules

1.  **Never include `appName` in MongoDB connection strings** — the URI must be a clean `mongodb://` or `mongodb+srv://` string without the `appName` parameter.
2.  **Strictly check and follow all rules inside `.claude/rules/`** before beginning any task. These override this file.
3.  **Before writing any code**, check `.claude/plans/` for an existing plan; if none exists, create one following the rules in `.claude/rules/planning-rules.md`.
4.  **Align all new code with the layer-specific templates documented in `.claude/rules/project-conventions.md`.**

## Behavior Guidelines

- Write clean code matching the surrounding style in the existing codebase.
- Descriptive variable/function names over comments.
- One responsibility per function — keep them small.
- Handle edge cases: empty results, invalid `ObjectId`, missing fields, soft-deleted records.
- Use HTTP status codes: 201 for creation, 200 for success/update/read, 400/401/403/404/500 for errors.
