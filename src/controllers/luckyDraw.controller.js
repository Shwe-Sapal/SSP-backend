import mongoose from "mongoose";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import LuckyDrawPromotion from "../models/luckyDrawPromotion.model.js";
import LuckyDrawRedemption from "../models/luckyDrawRedemption.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";

// ─── Promotion CRUD ───────────────────────────────────────────────

// CREATE Promotion
export const createPromotion = asyncErrorHandler(async (req, res, next) => {
  const { promotionName, ticketName, inventoryId, redemptionPrice, quantityPerRedeem, storefrontId } = req.body;

  if (!promotionName) return next(new CustomError(400, "Promotion name is required"));
  if (!ticketName) return next(new CustomError(400, "Ticket name is required"));
  if (!inventoryId) return next(new CustomError(400, "Product is required"));
  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid product ID format"));
  }
  if (redemptionPrice === undefined || redemptionPrice === null) {
    return next(new CustomError(400, "Redemption price is required"));
  }
  if (storefrontId && !mongoose.Types.ObjectId.isValid(storefrontId)) {
    return next(new CustomError(400, "Invalid storefront ID format"));
  }

  const promotion = await LuckyDrawPromotion.create({
    promotionName,
    ticketName,
    inventoryId,
    redemptionPrice,
    quantityPerRedeem: quantityPerRedeem || 1,
    storefrontId: storefrontId || null,
    createdBy: req.user?._id || req.user?.id || null,
  });

  res.status(201).json({
    success: true,
    message: "Lucky draw promotion created successfully",
    data: { promotion },
  });
});

// GET Promotions (list)
export const getPromotions = asyncErrorHandler(async (req, res, next) => {
  const { page = 1, limit = 20, isActive } = req.query;
  const skip = (page - 1) * limit;

  const filter = { isDeleted: false };

  // Optional isActive filter
  if (isActive !== undefined) {
    filter.isActive = isActive === "true";
  }

  const promotions = await LuckyDrawPromotion.find(filter)
    .populate("inventoryId", "productName productCode sellingPrice")
    .populate("storefrontId", "locationName locationCode")
    .populate("createdBy", "name")
    .skip(skip)
    .limit(Number(limit))
    .sort({ createdAt: -1 });

  const total = await LuckyDrawPromotion.countDocuments(filter);

  res.status(200).json({
    success: true,
    message: "Lucky draw promotions fetched successfully",
    data: { promotions },
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalItems: total,
      itemsPerPage: Number(limit),
    },
  });
});

// GET Promotion (single)
export const getPromotion = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid promotion ID format"));
  }

  const promotion = await LuckyDrawPromotion.findOne({ _id: id, isDeleted: false })
    .populate("inventoryId", "productName productCode sellingPrice buyingPrice")
    .populate("storefrontId", "locationName locationCode")
    .populate("createdBy", "name");

  if (!promotion) return next(new CustomError(404, "Promotion not found"));

  res.status(200).json({
    success: true,
    message: "Lucky draw promotion fetched successfully",
    data: { promotion },
  });
});

// UPDATE Promotion
export const updatePromotion = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid promotion ID format"));
  }

  // Verify promotion exists and is not deleted
  const existing = await LuckyDrawPromotion.findOne({ _id: id, isDeleted: false });
  if (!existing) return next(new CustomError(404, "Promotion not found"));

  const promotion = await LuckyDrawPromotion.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    message: "Lucky draw promotion updated successfully",
    data: { promotion },
  });
});

// DELETE Promotion (soft delete)
export const deletePromotion = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid promotion ID format"));
  }

  const promotion = await LuckyDrawPromotion.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true }
  );

  if (!promotion) return next(new CustomError(404, "Promotion not found"));

  res.status(200).json({
    success: true,
    message: "Lucky draw promotion deleted successfully",
    data: { promotion },
  });
});

// ─── Redemption ───────────────────────────────────────────────────

// POST Process Redemption (ACID transaction with stock deduction)
export const processRedemption = asyncErrorHandler(async (req, res, next) => {
  const { promotionId, storefrontId, quantity, ticketCode, customerName, note } = req.body;

  if (!promotionId) return next(new CustomError(400, "Promotion ID is required"));
  if (!mongoose.Types.ObjectId.isValid(promotionId)) {
    return next(new CustomError(400, "Invalid promotion ID format"));
  }
  if (!storefrontId) return next(new CustomError(400, "Storefront ID is required"));
  if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
    return next(new CustomError(400, "Invalid storefront ID format"));
  }

  const redeemQuantity = quantity || 1;

  // Use ACID transaction for atomic stock deduction + record creation
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Validate promotion is active and not deleted
      const promotion = await LuckyDrawPromotion.findOne({
        _id: promotionId,
        isActive: true,
        isDeleted: false,
      }).session(session);

      if (!promotion) {
        throw new CustomError(400, "Promotion is not active or not found");
      }

      const productQuantity = promotion.quantityPerRedeem * redeemQuantity;

      // 2. Find StorefrontInventory and check stock atomically
      const stockRecord = await StorefrontInventory.findOne({
        inventoryId: promotion.inventoryId,
        storefrontId,
      }).session(session);

      if (!stockRecord) {
        throw new CustomError(400, "Product not found in this storefront");
      }

      // 3. Atomically deduct stock using findOneAndUpdate with quantity filter
      // This prevents negative stock even if validators don't run
      const beforeQuantity = stockRecord.quantity;
      const updatedStock = await StorefrontInventory.findOneAndUpdate(
        { _id: stockRecord._id, quantity: { $gte: productQuantity } },
        { $inc: { quantity: -productQuantity }, $set: { lastUpdated: new Date() } },
        { new: true, session }
      );

      if (!updatedStock) {
        throw new CustomError(400, "Insufficient stock");
      }

      // 4. Generate redemption number
      const redemptionNumber = await LuckyDrawRedemption.generateRedemptionNumber();

      // 5. Create redemption record
      const totalAmount = promotion.redemptionPrice * productQuantity;
      const redemptions = await LuckyDrawRedemption.create(
        [
          {
            redemptionNumber,
            promotionId: promotion._id,
            inventoryId: promotion.inventoryId,
            quantity: productQuantity,
            unitPrice: promotion.redemptionPrice,
            totalAmount,
            storefrontId,
            ticketCode: ticketCode || null,
            customerName: customerName || null,
            redeemedBy: req.user?._id || req.user?.id,
            note: note || null,
          },
        ],
        { session }
      );

      // 6. Create stock audit log entry
      await createStockAuditLog({
        inventoryId: promotion.inventoryId,
        adminId: req.user?._id || req.user?.id,
        locationId: storefrontId,
        locationType: "storefront",
        stockRecordId: updatedStock._id,
        beforeQuantity,
        afterQuantity: updatedStock.quantity,
        quantityChange: -productQuantity,
        action: "remove",
        reason: `Lucky draw redemption: ${promotion.promotionName} - ${promotion.ticketName}`,
        relatedTransactionId: redemptions[0]._id,
        relatedTransactionType: "lucky_draw_redemption",
        session,
      });

      res.status(201).json({
        success: true,
        message: "Lucky draw redemption processed successfully",
        data: { redemption: redemptions[0] },
      });
    });
  } catch (error) {
    // Transaction was aborted — forward the error
    return next(error);
  } finally {
    await session.endSession();
  }
});

// GET Redemptions (list with date filter)
export const getRedemptions = asyncErrorHandler(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  const filter = { isDeleted: false };

  // Apply date filter if startDate/endDate provided
  try {
    const dateFilter = createDateFilter(req.query, "createdAt");
    if (Object.keys(dateFilter).length > 0) {
      Object.assign(filter, dateFilter);
    }
  } catch (error) {
    return next(error);
  }

  const redemptions = await LuckyDrawRedemption.find(filter)
    .populate("promotionId", "promotionName ticketName redemptionPrice")
    .populate("inventoryId", "productName productCode")
    .populate("storefrontId", "locationName locationCode")
    .populate("redeemedBy", "name")
    .skip(skip)
    .limit(Number(limit))
    .sort({ createdAt: -1 });

  const total = await LuckyDrawRedemption.countDocuments(filter);

  res.status(200).json({
    success: true,
    message: "Lucky draw redemptions fetched successfully",
    data: { redemptions },
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalItems: total,
      itemsPerPage: Number(limit),
    },
  });
});
