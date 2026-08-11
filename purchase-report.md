GET /api/v1/reports/purchases/overall	getPurchaseOverallReport	Accepts startDate/endDate. Returns totalPurchaseValue, totalOrders, averageValue, statusBreakdown (grouped by PO status), and topSuppliers (with $lookup to supplierprofiles, sorted by total amount desc). Runs 3 pipelines concurrently via Promise.all.
GET /api/v1/reports/purchases/products	getPurchaseProductReport	Accepts startDate/endDate/limit. Unwinds products array, groups by inventoryId, calculates quantityPurchased and totalCost, looks up product details. Sorts by quantity desc and optionally applies $limit.
GET /api/v1/reports/inventory/low-stock	getLowStockReport	Accepts threshold (default 50), page, limit. Uses $unionWith to combine warehousestocks + storefrontinventories, sums quantity per product, filters by currentTotalStock <= threshold. Paginated with total count.
[NEW] 

report.route.js
Routes protected with protect + permissionGranted("owner", "admin"), matching the existing pattern from saleReport.route.js.

[MODIFY] 

app.js
Imported and mounted reportRouter at /api/v1.

Key Design Decisions
$unionWith in the low-stock report avoids two separate queries + JS merging — it's a single aggregation pass across both stock collections.
Date validation uses a shared buildDateFilter helper that returns "invalid" for malformed dates, triggering a 400 error before the pipeline runs.
Soft-delete aware — all pipelines filter isDeleted: false on POs and products.isDeleted: { $ne: true } on line items.