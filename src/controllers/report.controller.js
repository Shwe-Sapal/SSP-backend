import Purchasing from "../models/purchasing.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
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

    // Execute all three pipelines concurrently
    const [summaryResult, statusBreakdown, topSuppliers] = await Promise.all([
      Purchasing.aggregate(summaryPipeline),
      Purchasing.aggregate(statusPipeline),
      Purchasing.aggregate(supplierPipeline),
    ]);

    const summary =
      summaryResult.length > 0
        ? summaryResult[0]
        : { totalPurchaseValue: 0, totalOrders: 0, averageValue: 0 };

    res.status(200).json({
      success: true,
      message: "Overall purchase report retrieved successfully",
      data: {
        ...summary,
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
