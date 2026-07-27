# Task: Simplify Supplier Profile Address Structure

**Objective:** 
Refactor the `SupplierProfile` address structure from a nested subdocument to flat, top-level string fields.

**Current Structure (to be removed):**
```javascript
address: {
  street: String,
  township: String,
  city: String,
  state: String
}
```

**New Structure (to be implemented):**
```javascript
address: String, // Full address as text string
township: String
```

**Files to modify (find these in the project):** 
1. Supplier Model (e.g.,  `supplierProfile.model.js`)
2. Supplier Controller (e.g., `src/controllers/supplier.controller.js`)
3. Supplier Validation (e.g., `src/validations/supplier.validation.js` - if Joi/Zod is used)

**Instructions:**
1. **Model:** Locate the Supplier schema. Replace the nested `address` object with `address: { type: String }` and `township: { type: String }` at the root level of the schema.
2. **Controller:** Update the `create` and `update` controller functions. Ensure they accept `address` and `township` directly from `req.body` and remove any destructuring or handling of the old nested `address` object (street, city, state).
3. **Validation:** Update the input validation schema (Joi/Zod) to expect `address` (string) and `township` (string) at the root level, removing the old nested object validation rules.
