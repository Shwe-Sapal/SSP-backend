# Task: Add Supplier ID Filtering to Inventory API



**Objective:**

Update the existing `getAllInventory` (or equivalent GET all) controller to support filtering inventory items by `supplier` ID.



**File to modify:**

`src/controllers/inventory.controller.js`



**Instructions:**

1. Locate the controller handling `GET /api/v1/inventory`.

2. Extract `supplier` from `req.query` alongside existing filters (like `category`, `status`, `search`).

3. If `supplier` is provided in the query, add it to the database query object. Since the `Inventory` model has a `suppliers` array field, querying `query.suppliers = supplier` will correctly filter products containing that specific supplier ID.

4. Ensure this new filter works seamlessly with the existing `.populate("suppliers")` and pagination logic.



Please provide the updated code snippet for the controller function.