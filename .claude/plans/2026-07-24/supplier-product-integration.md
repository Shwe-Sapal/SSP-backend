# Plan: Supplier Township & Product-Supplier Integration

**Date:** 2026-07-24
**Status:** Implemented

## Objective
1. Add `address` (including `township`) to the `SupplierProfile` schema.
2. Add `suppliers` array to the `Inventory` (product) schema to link products with their suppliers.

## Files to Create / Modify
- `src/models/supplierProfile.model.js` — Add `address` embedded subdocument with `street`, `township`, `city`, `state` fields
- `src/models/inventory.model.js` — Add `suppliers` array of ObjectId refs to `SupplierProfile`
- `src/controllers/supplier.controller.js` — Accept `address` (with `township`) on create/update
- `src/controllers/inventory.controller.js` — Populate `suppliers` on product fetches

## Implementation Steps

### Step 1: Schema Changes (this step)
1. **supplierProfile.model.js** — Add `address` embedded object with `street`, `township`, `city`, `state` (all optional, trimmed strings). Add index on `address.township`.
2. **inventory.model.js** — Add `suppliers` array of ObjectId refs to `"SupplierProfile"`.

### Step 2: Controller Changes (next step)
1. **supplier.controller.js** — Destructure and pass `address` on create/update.
2. **inventory.controller.js** — Add `.populate()` for `suppliers` on read queries.

## Data Model Changes
- `SupplierProfile.address` — new embedded subdocument (all fields optional for backward compatibility)
- `Inventory.suppliers` — new array field (defaults to empty array)

## Edge Cases & Considerations
- Existing supplier docs will have `address: undefined` — all sub-fields are optional, no migration needed.
- Existing inventory docs will have `suppliers: []` — empty array default, no migration needed.
- Plan references `"Supplier"` as ref name but actual model is `"SupplierProfile"` — corrected.
- Plan references `product.model.js` but actual file is `inventory.model.js` — corrected.
- Soft-deleted suppliers should be filtered out in populate queries via `match: { isDeleted: false }`.

## Test Plan
- Verify server starts without errors after schema changes.
- Test via Postman: create/update supplier with township, create product with supplier IDs.
