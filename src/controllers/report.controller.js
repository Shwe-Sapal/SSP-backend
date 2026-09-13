import Purchasing from "../models/purchasing.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import SupplierReturn from "../models/supplierReturn.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { getEffectiveBaseFactor } from "../utils/uom.utils.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
/**
 * Parse startDate / endDate query strings into a $match-compatible date range.
 * Returns null when neither parameter is provided.
 */
const buildDateFilter = (startDate, endDate) => {
  if (!startDate && !endDate) return null;

  const filter = {};
  if (startDate) {
    const sd = new Date(startDate);
    if (isNaN(sd.getTime())) return "invalid";
    filter.$gte = sd;
  }
  if (endDate) {
    const ed = new Date(endDate);
    if (isNaN(ed.getTime())) return "invalid";
    // Include the entire end day
    ed.setHours(23, 59, 59, 999);
    filter.$lte = ed;
  }
  return filter;
};

// ─── 1. Overall Purchase Report ───────────────────────────────────────────────
export const getPurchaseOverallReport = asyncErrorHandler(
  async (req, res, next) => {
    const { startDate, endDate } = req.query;

    // Build base match: exclude soft-deleted POs
    const baseMatch = { isDeleted: false };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter === "invalid") {
      return next(
        new CustomError(400, "Invalid date format. Use ISO 8601 (YYYY-MM-DD)."),
      );
    }
    if (dateFilter) {
      baseMatch.createdAt = dateFilter;
    }

    // ── Overall summary ─────────────────────────────────────────────────────
    const summaryPipeline = [
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalPurchaseValue: { $sum: "$totalAmount" },
          totalOrders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          totalPurchaseValue: 1,
          totalOrders: 1,
          averageValue: {
            $cond: [
              { $eq: ["$totalOrders", 0] },
              0,
              { $divide: ["$totalPurchaseValue", "$totalOrders"] },
            ],
          },
        },
      },
    ];

    // ── Status breakdown ────────────────────────────────────────────────────
    const statusPipeline = [
      { $match: baseMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
      { $sort: { totalAmount: -1 } },
      {
        $project: {
          _id: 0,
          status: "$_id",
          count: 1,
          totalAmount: 1,
        },
      },
    ];

    // ── Top suppliers ───────────────────────────────────────────────────────
    const supplierPipeline = [
      { $match: baseMatch },
      {
        $group: {
          _id: "$supplierId",
          totalAmount: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
      {
        $lookup: {
          from: "supplierprofiles",
          localField: "_id",
          foreignField: "_id",
          as: "supplier",
        },
      },
      { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          supplierId: "$_id",
          supplierName: { $ifNull: ["$supplier.supplierName", "Unknown"] },
          contactNumber: { $ifNull: ["$supplier.contactNumber", null] },
          totalAmount: 1,
          orderCount: 1,
        },
      },
    ];

    const returnMatch = { isDeleted: false, status: { $ne: "cancelled" } };
    if (dateFilter) returnMatch.createdAt = dateFilter;

    const returnSummaryPipeline = [
      { $match: returnMatch },
      {
        $group: {
          _id: null,
          totalReturnAmount: { $sum: "$totalReturnAmount" },
          totalReturnsCount: { $sum: 1 },
        },
      },
    ];

    // Execute all pipelines concurrently
    const [summaryResult, statusBreakdown, topSuppliers, returnSummaryResult] = await Promise.all([
      Purchasing.aggregate(summaryPipeline),
      Purchasing.aggregate(statusPipeline),
      Purchasing.aggregate(supplierPipeline),
      SupplierReturn.aggregate(returnSummaryPipeline),
    ]);

    const summary =
      summaryResult.length > 0
        ? summaryResult[0]
        : { totalPurchaseValue: 0, totalOrders: 0, averageValue: 0 };

    const returnSummary =
      returnSummaryResult.length > 0
        ? returnSummaryResult[0]
        : { totalReturnAmount: 0, totalReturnsCount: 0 };

    const netPurchaseValue = Math.max(
      0,
      summary.totalPurchaseValue - returnSummary.totalReturnAmount
    );

    res.status(200).json({
      success: true,
      message: "Overall purchase report retrieved successfully",
      data: {
        ...summary,
        totalReturnAmount: returnSummary.totalReturnAmount,
        totalReturnsCount: returnSummary.totalReturnsCount,
        netPurchaseValue,
        statusBreakdown,
        topSuppliers,
      },
    });
  },
);

// ─── 2. Product Purchase Report ──────────────────────────────────────────────
export const getPurchaseProductReport = asyncErrorHandler(
  async (req, res, next) => {
    const { startDate, endDate, limit } = req.query;

    // Build base match: exclude soft-deleted POs
    const baseMatch = { isDeleted: false };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter === "invalid") {
      return next(
        new CustomError(400, "Invalid date format. Use ISO 8601 (YYYY-MM-DD)."),
      );
    }
    if (dateFilter) {
      baseMatch.createdAt = dateFilter;
    }

    const pipeline = [
      { $match: baseMatch },
      // Unwind line items
      { $unwind: "$products" },
      // Exclude soft-deleted line items
      { $match: { "products.isDeleted": { $ne: true } } },
      // Group by product
      {
        $group: {
          _id: "$products.inventoryId",
          items: {
            $push: {
              purchaseUnit: "$products.purchaseUnit",
              purchaseQuantity: "$products.purchaseQuantity",
            }
          },
          totalCost: {
            $sum: {
              $multiply: [
                "$products.purchaseQuantity",
                "$products.purchaseUnitPrice",
              ],
            },
          },
          orderCount: { $sum: 1 },
        },
      },
      // Lookup product details from Inventory collection
      {
        $lookup: {
          from: "inventories",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          productName: { $ifNull: ["$product.productName", "Unknown"] },
          productCode: { $ifNull: ["$product.productCode", "N/A"] },
          category: { $ifNull: ["$product.category", "N/A"] },
          unitOfMeasure: { $ifNull: ["$product.unitOfMeasure", "N/A"] },
          uomConversions: "$product.uomConversions",
          items: 1,
          totalCost: 1,
          orderCount: 1,
        },
      },
    ];

    const productsAgg = await Purchasing.aggregate(pipeline);

    // Calculate true base quantity and sort in JS
    let formattedProducts = productsAgg.map(p => {
       let trueQty = 0;
       for (const item of p.items) {
          const factor = getEffectiveBaseFactor(item.purchaseUnit, p.uomConversions, p.unitOfMeasure);
          trueQty += (item.purchaseQuantity || 0) * factor;
       }
       return {
          productId: p.productId,
          productName: p.productName,
          productCode: p.productCode,
          category: p.category,
          unitOfMeasure: p.unitOfMeasure,
          // baseUnit is the smallest tracked unit (e.g. "piece").
          // Included so the frontend can label quantityPurchased correctly.
          baseUnit: p.unitOfMeasure,
          // uomConversions lets the frontend break a raw base-unit total
          // into larger units (e.g. 14 pieces → 1 dozen + 2 pieces).
          uomConversions: p.uomConversions || [],
          quantityPurchased: trueQty,
          totalCost: p.totalCost,
          orderCount: p.orderCount,
       };
    });

    // Sort by quantityPurchased DESC
    formattedProducts.sort((a, b) => b.quantityPurchased - a.quantityPurchased);

    // Apply limit if provided
    const limitNum = parseInt(limit);
    if (!isNaN(limitNum) && limitNum > 0) {
      formattedProducts = formattedProducts.slice(0, limitNum);
    }

    res.status(200).json({
      success: true,
      message: "Product purchase report retrieved successfully",
      data: formattedProducts,
    });
  },
);

// ─── 3. Low-Stock Inventory Report ───────────────────────────────────────────
export const getLowStockReport = asyncErrorHandler(
  async (req, res, next) => {
    const {
      threshold = "50",
      page,
      limit,
    } = req.query;

    const thresholdNum = parseInt(threshold);
    if (isNaN(thresholdNum) || thresholdNum < 0) {
      return next(
        new CustomError(400, "Threshold must be a non-negative number."),
      );
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    // ── Aggregate total stock from BOTH warehouses & storefronts ─────────
    // Use $unionWith to combine both collections in a single pipeline.
    const pipeline = [
      // Start from WarehouseStock
      {
        $project: {
          inventoryId: 1,
          quantity: 1,
        },
      },
      // Merge StorefrontInventory documents
      {
        $unionWith: {
          coll: "storefrontinventories",
          pipeline: [
            {
              $project: {
                inventoryId: 1,
                quantity: 1,
              },
            },
          ],
        },
      },
      // Sum across all locations
      {
        $group: {
          _id: "$inventoryId",
          currentTotalStock: { $sum: "$quantity" },
        },
      },
      // Filter by threshold
      {
        $match: {
          currentTotalStock: { $lte: thresholdNum },
        },
      },
      // Lookup product details
      {
        $lookup: {
          from: "inventories",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      // Only include active products
      { $match: { "product.status": "active" } },
      // Shape output
      {
        $project: {
          _id: 0,
          productId: "$_id",
          productCode: "$product.productCode",
          productName: "$product.productName",
          category: "$product.category",
          unitOfMeasure: "$product.unitOfMeasure",
          buyingPrice: "$product.buyingPrice",
          sellingPrice: "$product.sellingPrice",
          reorderPoint: "$product.reorderPoint",
          currentTotalStock: 1,
        },
      },
      { $sort: { currentTotalStock: 1 } },
    ];

    // Count total matching products (before pagination)
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await WarehouseStock.aggregate(countPipeline);
    const totalItems = countResult.length > 0 ? countResult[0].total : 0;

    // Apply pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    const products = await WarehouseStock.aggregate(pipeline);

    res.status(200).json({
      success: true,
      message: "Low-stock inventory report retrieved successfully",
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalItems / limitNum),
        totalItems,
        itemsPerPage: limitNum,
      },
    });
  },
);

// ─── 4. Purchase Returns & Damages Report ────────────────────────────────────
export const getPurchaseReturnsReport = asyncErrorHandler(
  async (req, res, next) => {
    const { startDate, endDate } = req.query;

    const baseMatch = { isDeleted: false, status: { $ne: "cancelled" } };
    const poMatch = { isDeleted: false };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter === "invalid") {
      return next(
        new CustomError(400, "Invalid date format. Use ISO 8601 (YYYY-MM-DD)."),
      );
    }
    if (dateFilter) {
      baseMatch.createdAt = dateFilter;
      poMatch.createdAt = dateFilter;
    }

    // 1. Gross Purchases Summary
    const poSummary = await Purchasing.aggregate([
      { $match: poMatch },
      {
        $group: {
          _id: null,
          totalGrossPurchase: { $sum: "$totalAmount" },
          totalPOCount: { $sum: 1 },
        },
      },
    ]);
    const totalGrossPurchase =
      poSummary.length > 0 ? poSummary[0].totalGrossPurchase : 0;
    const totalPOCount = poSummary.length > 0 ? poSummary[0].totalPOCount : 0;

    // 2. Returns Overall Summary
    const returnsSummary = await SupplierReturn.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalReturnAmount: { $sum: "$totalReturnAmount" },
          totalReturnsCount: { $sum: 1 },
          totalRefundedAmount: { $sum: "$refundDetails.refundAmount" },
          completedReturnsCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          pendingReturnsCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          pendingReturnAmount: {
            $sum: {
              $cond: [{ $eq: ["$status", "pending"] }, "$totalReturnAmount", 0],
            },
          },
        },
      },
    ]);

    const totalReturnAmount =
      returnsSummary.length > 0 ? returnsSummary[0].totalReturnAmount : 0;
    const totalReturnsCount =
      returnsSummary.length > 0 ? returnsSummary[0].totalReturnsCount : 0;
    const totalRefundedAmount =
      returnsSummary.length > 0 ? returnsSummary[0].totalRefundedAmount : 0;
    const completedReturnsCount =
      returnsSummary.length > 0 ? returnsSummary[0].completedReturnsCount : 0;
    const pendingReturnsCount =
      returnsSummary.length > 0 ? returnsSummary[0].pendingReturnsCount : 0;
    const pendingReturnAmount =
      returnsSummary.length > 0 ? returnsSummary[0].pendingReturnAmount : 0;

    // 3. Exchange replacement value
    const exchangeSummary = await SupplierReturn.aggregate([
      { $match: baseMatch },
      { $unwind: "$exchangeItems" },
      {
        $lookup: {
          from: "inventories",
          localField: "exchangeItems.inventoryId",
          foreignField: "_id",
          as: "prod",
        },
      },
      { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalExchangeValue: {
            $sum: {
              $multiply: [
                "$exchangeItems.quantity",
                { $ifNull: ["$prod.buyingPrice", 0] },
              ],
            },
          },
          totalExchangeQuantity: { $sum: "$exchangeItems.quantity" },
        },
      },
    ]);

    const totalExchangeValue =
      exchangeSummary.length > 0 ? exchangeSummary[0].totalExchangeValue : 0;
    const totalExchangeQuantity =
      exchangeSummary.length > 0 ? exchangeSummary[0].totalExchangeQuantity : 0;

    const totalRecoveredValue = totalRefundedAmount + totalExchangeValue;
    const recoveryRate =
      totalReturnAmount > 0
        ? Math.min(100, (totalRecoveredValue / totalReturnAmount) * 100)
        : 0;
    const netPurchaseValue = Math.max(0, totalGrossPurchase - totalReturnAmount);

    // 4. Breakdown by Reason (Expired vs GRN Bad vs Other)
    const reasonBreakdown = await SupplierReturn.aggregate([
      { $match: baseMatch },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.reason",
          totalAmount: { $sum: "$items.totalAmount" },
          totalQuantity: { $sum: "$items.quantity" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          reason: "$_id",
          totalAmount: 1,
          totalQuantity: 1,
          count: 1,
        },
      },
    ]);

    // 5. Supplier Return Breakdown
    const supplierBreakdown = await SupplierReturn.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: "$supplierId",
          totalReturnAmount: { $sum: "$totalReturnAmount" },
          returnsCount: { $sum: 1 },
          refundedAmount: { $sum: "$refundDetails.refundAmount" },
        },
      },
      {
        $lookup: {
          from: "supplierprofiles",
          localField: "_id",
          foreignField: "_id",
          as: "supplier",
        },
      },
      { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          supplierId: "$_id",
          supplierName: {
            $ifNull: [
              "$supplier.name",
              { $ifNull: ["$supplier.supplierName", "Unknown"] },
            ],
          },
          contactNumber: {
            $ifNull: [
              "$supplier.phone",
              { $ifNull: ["$supplier.contactNumber", null] },
            ],
          },
          totalReturnAmount: 1,
          returnsCount: 1,
          refundedAmount: 1,
        },
      },
      { $sort: { totalReturnAmount: -1 } },
    ]);

    // 6. Top Returned Products (Top 10)
    const topReturnedProducts = await SupplierReturn.aggregate([
      { $match: baseMatch },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.inventoryId",
          productName: { $first: "$items.productName" },
          productCode: { $first: "$items.productCode" },
          unitOfMeasure: { $first: "$items.unitOfMeasure" },
          totalQuantity: { $sum: "$items.quantity" },
          totalLossAmount: { $sum: "$items.totalAmount" },
          reasons: { $addToSet: "$items.reason" },
          returnCount: { $sum: 1 },
        },
      },
      { $sort: { totalLossAmount: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          inventoryId: "$_id",
          productName: 1,
          productCode: 1,
          unitOfMeasure: 1,
          totalQuantity: 1,
          totalLossAmount: 1,
          reasons: 1,
          returnCount: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      message: "Purchase returns and damages report retrieved successfully",
      data: {
        summary: {
          totalGrossPurchase,
          totalPOCount,
          totalReturnAmount,
          totalReturnsCount,
          netPurchaseValue,
          totalRefundedAmount,
          totalExchangeValue,
          totalExchangeQuantity,
          totalRecoveredValue,
          recoveryRate: Math.round(recoveryRate * 100) / 100,
          pendingReturnsCount,
          pendingReturnAmount,
          completedReturnsCount,
        },
        reasonBreakdown,
        supplierBreakdown,
        topReturnedProducts,
      },
    });
  },
);
