import mongoose from "mongoose";
import SupplierReturn from "../models/supplierReturn.model.js";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import SupplierProfile from "../models/supplierProfile.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

/**
 * @desc Get all returnable bad items from GRNs (badQuantity > returnedQuantity)
 * @route GET /api/v1/supplier-returns/returnable-grn-items
 * @access Private (Owner, Manager)
 */
export const getReturnableGrnBadItems = asyncErrorHandler(async (req, res, next) => {
  const grns = await GoodsRecievedNote.find({
    isDeleted: false,
    status: { $in: ["verified", "partial", "pending"] },
  })
    .populate({
      path: "purchasingId",
      select: "poNumber supplierId totalAmount",
      populate: {
        path: "supplierId",
        select: "name phone email address isDeleted",
      },
    })
    .populate({
      path: "lineItems.inventoryId",
      select: "productName productCode buyingPrice sellingPrice unitOfMeasure",
    })
    .sort({ grnDate: -1 })
    .lean();

  const returnableItems = [];

  for (const grn of grns) {
    if (!grn.purchasingId || !grn.purchasingId.supplierId) continue;

    for (const item of grn.lineItems) {
      const badQty = item.badQuantity || 0;
      const retQty = item.returnedQuantity || 0;
      const availableBadQty = Math.max(0, badQty - retQty);

      if (availableBadQty > 0 && item.inventoryId) {
        returnableItems.push({
          grnId: grn._id,
          grnNumber: grn.grnNumber,
          grnDate: grn.grnDate,
          poId: grn.purchasingId._id,
          poNumber: grn.purchasingId.poNumber,
          supplier: grn.purchasingId.supplierId,
          lineItemId: item._id,
          inventoryId: item.inventoryId._id,
          productName: item.inventoryId.productName,
          productCode: item.inventoryId.productCode,
          unitOfMeasure: item.receivedUnit || item.inventoryId.unitOfMeasure || "piece",
          batchNumber: item.batchNumber || null,
          expiryDate: item.expiryDate || null,
          totalBadQuantity: badQty,
          alreadyReturnedQuantity: retQty,
          availableBadQuantity: availableBadQty,
          unitCost: item.unitPrice,
          totalCost: availableBadQty * item.unitPrice,
          notes: item.notes,
        });
      }
    }
  }

  res.status(200).json({
    success: true,
    message: "Returnable GRN bad items retrieved successfully",
    data: {
      items: returnableItems,
      totalItems: returnableItems.length,
    },
  });
});

/**
 * @desc Get all expired and near-expiry stock from Warehouse and Storefront
 * @route GET /api/v1/supplier-returns/returnable-expired-items
 * @access Private (Owner, Manager)
 */
export const getReturnableExpiredItems = asyncErrorHandler(async (req, res, next) => {
  const { daysAhead = 30, locationType, locationId } = req.query;

  const now = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + parseInt(daysAhead, 10));

  const returnableStock = [];

  // 1. Warehouse stock
  if (!locationType || locationType === "warehouse") {
    const warehouseFilter = {
      quantity: { $gt: 0 },
      expiryDate: { $ne: null, $lte: thresholdDate },
    };
    if (locationId) {
      warehouseFilter.warehouseId = locationId;
    }

    const warehouseStocks = await WarehouseStock.find(warehouseFilter)
      .populate({
        path: "inventoryId",
        select: "productName productCode buyingPrice sellingPrice unitOfMeasure suppliers",
        populate: {
          path: "suppliers",
          select: "name phone email",
        },
      })
      .populate({
        path: "warehouseId",
        select: "locationName locationCode locationAddress type isDeleted",
      })
      .lean();

    for (const stock of warehouseStocks) {
      if (!stock.inventoryId || !stock.warehouseId) continue;

      const expiry = new Date(stock.expiryDate);
      const diffTime = expiry.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isExpired = diffDays <= 0;

      returnableStock.push({
        stockRecordId: stock._id,
        locationType: "warehouse",
        locationId: stock.warehouseId._id,
        locationName: stock.warehouseId.locationName || stock.warehouseId.name || "Warehouse",
        inventoryId: stock.inventoryId._id,
        productName: stock.inventoryId.productName,
        productCode: stock.inventoryId.productCode,
        unitOfMeasure: stock.inventoryId.unitOfMeasure || "piece",
        batchNumber: stock.batchNumber,
        expiryDate: stock.expiryDate,
        quantity: stock.quantity,
        unitCost: stock.inventoryId.buyingPrice,
        totalCost: stock.quantity * stock.inventoryId.buyingPrice,
        suppliers: stock.inventoryId.suppliers || [],
        daysUntilExpiry: diffDays,
        isExpired,
      });
    }
  }

  // 2. Storefront stock
  if (!locationType || locationType === "storefront") {
    const storefrontFilter = {
      quantity: { $gt: 0 },
      expiryDate: { $ne: null, $lte: thresholdDate },
    };
    if (locationId) {
      storefrontFilter.storefrontId = locationId;
    }

    const storefrontStocks = await StorefrontInventory.find(storefrontFilter)
      .populate({
        path: "inventoryId",
        select: "productName productCode buyingPrice sellingPrice unitOfMeasure suppliers",
        populate: {
          path: "suppliers",
          select: "name phone email",
        },
      })
      .populate({
        path: "storefrontId",
        select: "locationName locationCode locationAddress type isDeleted",
      })
      .lean();

    for (const stock of storefrontStocks) {
      if (!stock.inventoryId || !stock.storefrontId) continue;

      const expiry = new Date(stock.expiryDate);
      const diffTime = expiry.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isExpired = diffDays <= 0;

      returnableStock.push({
        stockRecordId: stock._id,
        locationType: "storefront",
        locationId: stock.storefrontId._id,
        locationName: stock.storefrontId.locationName || stock.storefrontId.storefrontName || stock.storefrontId.name || "Storefront",
        inventoryId: stock.inventoryId._id,
        productName: stock.inventoryId.productName,
        productCode: stock.inventoryId.productCode,
        unitOfMeasure: stock.inventoryId.unitOfMeasure || "piece",
        batchNumber: stock.batchNumber,
        expiryDate: stock.expiryDate,
        quantity: stock.quantity,
        unitCost: stock.inventoryId.buyingPrice,
        totalCost: stock.quantity * stock.inventoryId.buyingPrice,
        suppliers: stock.inventoryId.suppliers || [],
        daysUntilExpiry: diffDays,
        isExpired,
      });
    }
  }

  // Sort: Expired items first (smallest daysUntilExpiry), then near expiry
  returnableStock.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  res.status(200).json({
    success: true,
    message: "Returnable expired items retrieved successfully",
    data: {
      items: returnableStock,
      totalItems: returnableStock.length,
    },
  });
});

/**
 * @desc Create a new Supplier Return ticket
 * @route POST /api/v1/supplier-returns
 * @access Private (Owner, Manager)
 */
export const createSupplierReturn = asyncErrorHandler(async (req, res, next) => {
  const {
    supplierId,
    sourceType,
    sourceGrnId,
    sourceLocationId,
    items,
    notes,
  } = req.body;
  const adminId = req.user._id;

  if (!supplierId) {
    return next(new CustomError(400, "Supplier is required"));
  }
  if (!sourceType || !["grn", "warehouse", "storefront"].includes(sourceType)) {
    return next(new CustomError(400, "Valid sourceType (grn, warehouse, storefront) is required"));
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(new CustomError(400, "At least one item is required for return"));
  }

  // Verify supplier exists
  const supplier = await SupplierProfile.findOne({ _id: supplierId, isDeleted: false });
  if (!supplier) {
    return next(new CustomError(404, "Supplier not found or deleted"));
  }

  // Generate return number
  const returnNumber = await SupplierReturn.generateReturnNumber();

  let calculatedTotalAmount = 0;
  const validatedItems = [];

  // Start Mongoose session for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const item of items) {
      if (!item.inventoryId || !item.quantity || item.quantity <= 0) {
        throw new CustomError(400, "Each item must have a valid inventoryId and positive quantity");
      }

      const product = await Inventory.findById(item.inventoryId).session(session);
      if (!product) {
        throw new CustomError(404, `Product ${item.inventoryId} not found`);
      }

      const unitCost = item.unitCost !== undefined ? Number(item.unitCost) : product.buyingPrice;
      const totalAmount = item.quantity * unitCost;
      calculatedTotalAmount += totalAmount;

      const returnReason = item.reason || (sourceType === "grn" ? "grn_bad" : "expired");

      // Handle stock deduction based on sourceType
      if (sourceType === "warehouse") {
        let stockRecord = null;
        let warehouseId = item.locationId || sourceLocationId;

        // 1. Direct lookup by stockRecordId if provided
        if (item.stockRecordId) {
          stockRecord = await WarehouseStock.findById(item.stockRecordId).session(session);
          if (stockRecord) {
            warehouseId = stockRecord.warehouseId;
          }
        }

        // 2. Query by inventoryId, warehouseId, and batchNumber
        if (!stockRecord) {
          if (!warehouseId) {
            throw new CustomError(400, "Warehouse location is required for warehouse return");
          }

          const query = {
            inventoryId: product._id,
            warehouseId,
          };
          if (item.batchNumber) {
            query.batchNumber = item.batchNumber;
          } else {
            query.batchNumber = "__LEGACY__";
          }
          stockRecord = await WarehouseStock.findOne(query).session(session);

          // 3. Fallback: try finding any stock record for this product in warehouse
          if (!stockRecord) {
            stockRecord = await WarehouseStock.findOne({
              inventoryId: product._id,
              warehouseId,
            }).sort({ quantity: -1 }).session(session);
          }
        }

        if (!stockRecord || stockRecord.quantity < item.quantity) {
          throw new CustomError(
            400,
            `Insufficient warehouse stock for product '${product.productName}' (Batch: ${item.batchNumber || "Default"}). Available: ${stockRecord ? stockRecord.quantity : 0}, Requested: ${item.quantity}`
          );
        }

        const beforeQuantity = stockRecord.quantity;
        const afterQuantity = beforeQuantity - item.quantity;
        stockRecord.quantity = afterQuantity;
        stockRecord.lastUpdated = new Date();
        await stockRecord.save({ session });

        // Record stock audit log
        await createStockAuditLog({
          inventoryId: product._id,
          adminId,
          locationId: warehouseId || stockRecord.warehouseId,
          locationType: "warehouse",
          stockRecordId: stockRecord._id,
          beforeQuantity,
          afterQuantity,
          quantityChange: -item.quantity,
          action: "remove",
          reason: `Supplier return (${returnNumber}): ${item.notes || returnReason}`,
          relatedTransactionType: "supplier_return",
          session,
        });

        validatedItems.push({
          inventoryId: product._id,
          productName: product.productName,
          productCode: product.productCode,
          batchNumber: item.batchNumber || stockRecord.batchNumber || null,
          expiryDate: item.expiryDate || stockRecord.expiryDate || null,
          unitOfMeasure: product.unitOfMeasure || "piece",
          quantity: item.quantity,
          unitCost,
          totalAmount,
          reason: returnReason,
          notes: item.notes || null,
          stockRecordId: stockRecord._id,
        });
      } else if (sourceType === "storefront") {
        let stockRecord = null;
        let storefrontId = item.locationId || sourceLocationId;

        // 1. Direct lookup by stockRecordId if provided
        if (item.stockRecordId) {
          stockRecord = await StorefrontInventory.findById(item.stockRecordId).session(session);
          if (stockRecord) {
            storefrontId = stockRecord.storefrontId;
          }
        }

        // 2. Query by inventoryId, storefrontId, and batchNumber
        if (!stockRecord) {
          if (!storefrontId) {
            throw new CustomError(400, "Storefront location is required for storefront return");
          }

          const query = {
            inventoryId: product._id,
            storefrontId,
          };
          if (item.batchNumber) {
            query.batchNumber = item.batchNumber;
          } else {
            query.batchNumber = "__LEGACY__";
          }
          stockRecord = await StorefrontInventory.findOne(query).session(session);

          // 3. Fallback: try finding any stock record in storefront
          if (!stockRecord) {
            stockRecord = await StorefrontInventory.findOne({
              inventoryId: product._id,
              storefrontId,
            }).sort({ quantity: -1 }).session(session);
          }
        }

        if (!stockRecord || stockRecord.quantity < item.quantity) {
          throw new CustomError(
            400,
            `Insufficient storefront stock for product '${product.productName}'. Available: ${stockRecord ? stockRecord.quantity : 0}, Requested: ${item.quantity}`
          );
        }

        const beforeQuantity = stockRecord.quantity;
        const afterQuantity = beforeQuantity - item.quantity;
        stockRecord.quantity = afterQuantity;
        stockRecord.lastUpdated = new Date();
        await stockRecord.save({ session });

        // Record stock audit log
        await createStockAuditLog({
          inventoryId: product._id,
          adminId,
          locationId: storefrontId || stockRecord.storefrontId,
          locationType: "storefront",
          stockRecordId: stockRecord._id,
          beforeQuantity,
          afterQuantity,
          quantityChange: -item.quantity,
          action: "remove",
          reason: `Supplier return (${returnNumber}): ${item.notes || returnReason}`,
          relatedTransactionType: "supplier_return",
          session,
        });

        validatedItems.push({
          inventoryId: product._id,
          productName: product.productName,
          productCode: product.productCode,
          batchNumber: item.batchNumber || stockRecord.batchNumber || null,
          expiryDate: item.expiryDate || stockRecord.expiryDate || null,
          unitOfMeasure: product.unitOfMeasure || "piece",
          quantity: item.quantity,
          unitCost,
          totalAmount,
          reason: returnReason,
          notes: item.notes || null,
          stockRecordId: stockRecord._id,
        });
      } else if (sourceType === "grn") {
        if (!sourceGrnId) {
          throw new CustomError(400, "sourceGrnId is required for GRN bad items return");
        }

        const grn = await GoodsRecievedNote.findById(sourceGrnId).session(session);
        if (!grn) {
          throw new CustomError(404, `GRN with ID ${sourceGrnId} not found`);
        }

        let grnLineItem = null;
        if (item.grnLineItemId) {
          grnLineItem = grn.lineItems.id(item.grnLineItemId);
        } else {
          grnLineItem = grn.lineItems.find(
            (li) => li.inventoryId.toString() === product._id.toString()
          );
        }

        if (!grnLineItem) {
          throw new CustomError(404, `GRN line item for product '${product.productName}' not found`);
        }

        const availableBad = (grnLineItem.badQuantity || 0) - (grnLineItem.returnedQuantity || 0);
        if (availableBad < item.quantity) {
          throw new CustomError(
            400,
            `Cannot return ${item.quantity} units of '${product.productName}'. Available bad units: ${availableBad}`
          );
        }

        grnLineItem.returnedQuantity = (grnLineItem.returnedQuantity || 0) + item.quantity;
        await grn.save({ session });

        validatedItems.push({
          inventoryId: product._id,
          productName: product.productName,
          productCode: product.productCode,
          batchNumber: grnLineItem.batchNumber || null,
          expiryDate: grnLineItem.expiryDate || null,
          unitOfMeasure: grnLineItem.receivedUnit || product.unitOfMeasure || "piece",
          quantity: item.quantity,
          unitCost: grnLineItem.unitPrice || unitCost,
          totalAmount: item.quantity * (grnLineItem.unitPrice || unitCost),
          reason: "grn_bad",
          notes: item.notes || null,
          grnLineItemId: grnLineItem._id,
        });
      }
    }

    const supplierReturn = new SupplierReturn({
      returnNumber,
      supplierId,
      sourceType,
      sourceGrnId: sourceType === "grn" ? sourceGrnId : null,
      sourceLocationId: sourceType !== "grn" ? sourceLocationId : null,
      items: validatedItems,
      totalReturnAmount: calculatedTotalAmount,
      settlementType: "pending",
      status: "pending",
      handledBy: adminId,
      notes: notes || "Supplier return request created",
    });

    await supplierReturn.save({ session });
    await session.commitTransaction();

    const populatedReturn = await SupplierReturn.findById(supplierReturn._id)
      .populate("supplierId", "supplierName contactNumber address township")
      .populate("handledBy", "name email role")
      .populate("sourceLocationId", "locationName locationCode locationAddress type");

    res.status(201).json({
      success: true,
      message: "Supplier return request created successfully",
      data: {
        supplierReturn: populatedReturn,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * @desc Get all Supplier Returns (with filtering & pagination)
 * @route GET /api/v1/supplier-returns
 * @access Private (Owner, Manager, Cashier)
 */
export const getAllSupplierReturns = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    search,
    supplierId,
    status,
    settlementType,
    sourceType,
    startDate,
    endDate,
  } = req.query;

  const filter = { isDeleted: false };

  if (supplierId) filter.supplierId = supplierId;
  if (status) filter.status = status;
  if (settlementType) filter.settlementType = settlementType;
  if (sourceType) filter.sourceType = sourceType;

  if (search) {
    filter.$or = [
      { returnNumber: { $regex: search, $options: "i" } },
      { "items.productName": { $regex: search, $options: "i" } },
      { "items.productCode": { $regex: search, $options: "i" } },
    ];
  }

  // Date filtering
  const dateFilter = createDateFilter({ startDate, endDate }, "createdAt", false);
  Object.assign(filter, dateFilter);

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const skip = (pageNum - 1) * limitNum;

  const totalItems = await SupplierReturn.countDocuments(filter);
  const totalPages = Math.ceil(totalItems / limitNum) || 1;

  const returns = await SupplierReturn.find(filter)
    .populate("supplierId", "supplierName contactNumber address township")
    .populate("handledBy", "name email role")
    .populate("items.inventoryId", "productName productCode buyingPrice sellingPrice unitOfMeasure")
    .populate("exchangeItems.inventoryId", "productName productCode unitOfMeasure")
    .populate("exchangeItems.destinationWarehouseId", "locationName locationCode locationAddress type")
    .populate("sourceGrnId", "grnNumber grnDate")
    .populate("sourceLocationId", "locationName locationCode locationAddress type")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  res.status(200).json({
    success: true,
    message: "Supplier returns retrieved successfully",
    data: {
      returns,
    },
    pagination: {
      currentPage: pageNum,
      totalPages,
      totalItems,
      itemsPerPage: limitNum,
    },
  });
});

/**
 * @desc Get Supplier Return by ID
 * @route GET /api/v1/supplier-returns/:id
 * @access Private (Owner, Manager, Cashier)
 */
export const getSupplierReturnById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  const supplierReturn = await SupplierReturn.findOne({ _id: id, isDeleted: false })
    .populate("supplierId", "supplierName contactNumber address township")
    .populate("handledBy", "name email role")
    .populate("items.inventoryId", "productName productCode buyingPrice sellingPrice unitOfMeasure category")
    .populate("exchangeItems.inventoryId", "productName productCode unitOfMeasure category")
    .populate("exchangeItems.destinationWarehouseId", "locationName locationCode locationAddress type")
    .populate("sourceGrnId", "grnNumber grnDate purchasingId")
    .populate("sourceLocationId", "locationName locationCode locationAddress type");

  if (!supplierReturn) {
    return next(new CustomError(404, "Supplier return not found"));
  }

  res.status(200).json({
    success: true,
    message: "Supplier return retrieved successfully",
    data: {
      supplierReturn,
    },
  });
});

/**
 * @desc Settle Supplier Return with Cash/Bank Refund
 * @route POST /api/v1/supplier-returns/:id/settle-refund
 * @access Private (Owner, Manager)
 */
export const settleWithCashRefund = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { refundAmount, paymentMethod = "cash", receivedAt, notes } = req.body;

  const supplierReturn = await SupplierReturn.findOne({ _id: id, isDeleted: false });
  if (!supplierReturn) {
    return next(new CustomError(404, "Supplier return not found"));
  }

  if (supplierReturn.status === "completed") {
    return next(new CustomError(400, "This return has already been completed"));
  }
  if (supplierReturn.status === "cancelled") {
    return next(new CustomError(400, "Cannot settle a cancelled return"));
  }

  const finalRefundAmount = refundAmount !== undefined ? Number(refundAmount) : supplierReturn.totalReturnAmount;
  if (finalRefundAmount <= 0) {
    return next(new CustomError(400, "Refund amount must be greater than 0"));
  }

  supplierReturn.refundDetails = {
    refundAmount: finalRefundAmount,
    paymentMethod,
    receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    notes: notes || `Cash refund of ${finalRefundAmount} MMK processed`,
  };

  supplierReturn.settlementType = "cash_refund";
  supplierReturn.status = "completed";
  await supplierReturn.save();

  const populatedReturn = await SupplierReturn.findById(supplierReturn._id)
    .populate("supplierId", "supplierName contactNumber address township")
    .populate("handledBy", "name email role");

  res.status(200).json({
    success: true,
    message: "Supplier return settled with cash refund successfully",
    data: {
      supplierReturn: populatedReturn,
    },
  });
});

/**
 * @desc Settle Supplier Return with Product Exchange (Add replacement stock to warehouse)
 * @route POST /api/v1/supplier-returns/:id/settle-exchange
 * @access Private (Owner, Manager)
 */
export const settleWithProductExchange = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { exchangeItems, notes } = req.body;
  const adminId = req.user._id;

  const supplierReturn = await SupplierReturn.findOne({ _id: id, isDeleted: false });
  if (!supplierReturn) {
    return next(new CustomError(404, "Supplier return not found"));
  }

  if (supplierReturn.status === "completed") {
    return next(new CustomError(400, "This return has already been completed"));
  }
  if (supplierReturn.status === "cancelled") {
    return next(new CustomError(400, "Cannot settle a cancelled return"));
  }

  if (!exchangeItems || !Array.isArray(exchangeItems) || exchangeItems.length === 0) {
    return next(new CustomError(400, "At least one exchange item is required"));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const processedExchangeItems = [];

    for (const item of exchangeItems) {
      if (!item.inventoryId || !item.quantity || item.quantity <= 0 || !item.destinationWarehouseId) {
        throw new CustomError(
          400,
          "Each exchange item must have inventoryId, positive quantity, and destinationWarehouseId"
        );
      }

      const product = await Inventory.findById(item.inventoryId).session(session);
      if (!product) {
        throw new CustomError(404, `Product ${item.inventoryId} not found`);
      }

      const warehouse = await LocationProfile.findOne({
        _id: item.destinationWarehouseId,
        type: "warehouse",
        isDeleted: false,
      }).session(session);

      if (!warehouse) {
        throw new CustomError(404, `Warehouse ${item.destinationWarehouseId} not found`);
      }

      const batchNumber = item.batchNumber?.trim() || `EXC-${Date.now()}`;
      const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;

      // Find or create WarehouseStock record
      let stockRecord = await WarehouseStock.findOne({
        inventoryId: product._id,
        warehouseId: warehouse._id,
        batchNumber,
      }).session(session);

      const beforeQuantity = stockRecord ? stockRecord.quantity : 0;
      const afterQuantity = beforeQuantity + item.quantity;

      if (!stockRecord) {
        const newStock = await WarehouseStock.create(
          [
            {
              inventoryId: product._id,
              warehouseId: warehouse._id,
              batchNumber,
              expiryDate,
              quantity: item.quantity,
              lastUpdated: new Date(),
            },
          ],
          { session }
        );
        stockRecord = newStock[0];
      } else {
        stockRecord.quantity = afterQuantity;
        if (expiryDate) stockRecord.expiryDate = expiryDate;
        stockRecord.lastUpdated = new Date();
        await stockRecord.save({ session });
      }

      // Record stock audit log
      await createStockAuditLog({
        inventoryId: product._id,
        adminId,
        locationId: warehouse._id,
        locationType: "warehouse",
        stockRecordId: stockRecord._id,
        beforeQuantity,
        afterQuantity,
        quantityChange: item.quantity,
        action: "add",
        reason: `Supplier exchange replacement (${supplierReturn.returnNumber}): Batch ${batchNumber}`,
        relatedTransactionType: "supplier_exchange",
        session,
      });

      processedExchangeItems.push({
        inventoryId: product._id,
        productName: product.productName,
        productCode: product.productCode,
        quantity: item.quantity,
        batchNumber,
        expiryDate,
        destinationWarehouseId: warehouse._id,
        receivedDate: item.receivedDate ? new Date(item.receivedDate) : new Date(),
        notes: item.notes || null,
      });
    }

    supplierReturn.exchangeItems = processedExchangeItems;
    supplierReturn.settlementType = "exchange_product";
    supplierReturn.status = "completed";
    if (notes) supplierReturn.notes = notes;

    await supplierReturn.save({ session });
    await session.commitTransaction();

    const populatedReturn = await SupplierReturn.findById(supplierReturn._id)
      .populate("supplierId", "supplierName contactNumber address township")
      .populate("handledBy", "name email role")
      .populate("exchangeItems.inventoryId", "productName productCode unitOfMeasure")
      .populate("exchangeItems.destinationWarehouseId", "locationName locationCode locationAddress type");

    res.status(200).json({
      success: true,
      message: "Supplier return settled with replacement exchange products successfully",
      data: {
        supplierReturn: populatedReturn,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * @desc Cancel a pending Supplier Return (Revert deducted stock or GRN returnedQty)
 * @route POST /api/v1/supplier-returns/:id/cancel
 * @access Private (Owner, Manager)
 */
export const cancelSupplierReturn = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user._id;

  const supplierReturn = await SupplierReturn.findOne({ _id: id, isDeleted: false });
  if (!supplierReturn) {
    return next(new CustomError(404, "Supplier return not found"));
  }

  if (supplierReturn.status === "completed") {
    return next(new CustomError(400, "Cannot cancel an already completed return"));
  }
  if (supplierReturn.status === "cancelled") {
    return next(new CustomError(400, "Return is already cancelled"));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Revert inventory deductions if return was from warehouse or storefront
    if (supplierReturn.sourceType === "warehouse") {
      for (const item of supplierReturn.items) {
        const stockRecord = await WarehouseStock.findOne({
          inventoryId: item.inventoryId,
          warehouseId: supplierReturn.sourceLocationId,
          batchNumber: item.batchNumber || "__LEGACY__",
        }).session(session);

        if (stockRecord) {
          const beforeQuantity = stockRecord.quantity;
          const afterQuantity = beforeQuantity + item.quantity;
          stockRecord.quantity = afterQuantity;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });

          await createStockAuditLog({
            inventoryId: item.inventoryId,
            adminId,
            locationId: supplierReturn.sourceLocationId,
            locationType: "warehouse",
            stockRecordId: stockRecord._id,
            beforeQuantity,
            afterQuantity,
            quantityChange: item.quantity,
            action: "add",
            reason: `Cancelled supplier return (${supplierReturn.returnNumber}): Restored stock`,
            relatedTransactionType: "supplier_return",
            session,
          });
        }
      }
    } else if (supplierReturn.sourceType === "storefront") {
      for (const item of supplierReturn.items) {
        const stockRecord = await StorefrontInventory.findOne({
          inventoryId: item.inventoryId,
          storefrontId: supplierReturn.sourceLocationId,
          batchNumber: item.batchNumber || "__LEGACY__",
        }).session(session);

        if (stockRecord) {
          const beforeQuantity = stockRecord.quantity;
          const afterQuantity = beforeQuantity + item.quantity;
          stockRecord.quantity = afterQuantity;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });

          await createStockAuditLog({
            inventoryId: item.inventoryId,
            adminId,
            locationId: supplierReturn.sourceLocationId,
            locationType: "storefront",
            stockRecordId: stockRecord._id,
            beforeQuantity,
            afterQuantity,
            quantityChange: item.quantity,
            action: "add",
            reason: `Cancelled supplier return (${supplierReturn.returnNumber}): Restored stock`,
            relatedTransactionType: "supplier_return",
            session,
          });
        }
      }
    } else if (supplierReturn.sourceType === "grn" && supplierReturn.sourceGrnId) {
      // Revert returnedQuantity on GRN line items
      const grn = await GoodsRecievedNote.findById(supplierReturn.sourceGrnId).session(session);
      if (grn) {
        for (const item of supplierReturn.items) {
          const grnLineItem = item.grnLineItemId
            ? grn.lineItems.id(item.grnLineItemId)
            : grn.lineItems.find((li) => li.inventoryId.toString() === item.inventoryId.toString());

          if (grnLineItem) {
            grnLineItem.returnedQuantity = Math.max(
              0,
              (grnLineItem.returnedQuantity || 0) - item.quantity
            );
          }
        }
        await grn.save({ session });
      }
    }

    supplierReturn.status = "cancelled";
    if (reason) supplierReturn.notes = `Cancelled: ${reason}`;
    await supplierReturn.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Supplier return cancelled and stock reverted successfully",
      data: {
        supplierReturn,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});
