import mongoose from "mongoose";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import LuckyDrawPromotion from "../models/luckyDrawPromotion.model.js";
import LuckyDrawRedemption from "../models/luckyDrawRedemption.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";
import { getEffectiveBaseFactor } from "../utils/uom.utils.js";

// ─── Promotion CRUD ───────────────────────────────────────────────

// CREATE Promotion
export const createPromotion = asyncErrorHandler(async (req, res, next) => {
  const { promotionName, ticketName, inventoryId, redemptionPrice, quantityPerRedeem, prizeUnit, storefrontId } = req.body;

  if (!promotionName) return next(new CustomError(400, "Promotion name is required"));
  if (!ticketName) return next(new CustomError(400, "Ticket name is required"));
  if (!inventoryId) return next(new CustomError(400, "Product is required"));
  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid product ID format"));
  }
  if (!prizeUnit) return next(new CustomError(400, "Prize unit is required"));
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
    prizeUnit,
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

  // Validate quantity is a positive integer (prevents stock manipulation via negative/decimal values)
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    return next(new CustomError(400, "Quantity must be a positive integer"));
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
      }).populate("inventoryId").session(session);

      if (!promotion) {
        throw new CustomError(400, "Promotion is not active or not found");
      }

      const product = promotion.inventoryId;
      if (!product) {
        throw new CustomError(400, "Promotional product not found");
      }
      const inventoryIdValue = product._id;

      // Validate storefront matches the promotion's target storefront
      if (promotion.storefrontId && promotion.storefrontId.toString() !== storefrontId.toString()) {
        throw new CustomError(400, "This promotion is not valid for this storefront branch");
      }

      // Prevent reuse of already-redeemed ticket codes
      if (ticketCode) {
        const existingTicket = await LuckyDrawRedemption.findOne({ ticketCode, isDeleted: false }).session(session);
        if (existingTicket) {
          throw new CustomError(400, "This ticket code has already been redeemed");
        }
      }

      const baseUnit = product.unitOfMeasure || product.uom || "";
      const conversions = product.uomConversions || [];
      const effectiveFactor = getEffectiveBaseFactor(promotion.prizeUnit, conversions, baseUnit);
      
      const trueBaseQuantity = promotion.quantityPerRedeem * redeemQuantity * effectiveFactor;

      // 2. Find ALL StorefrontInventory batch documents for this product in this storefront
      const stockRecords = await StorefrontInventory.find({
        inventoryId: inventoryIdValue,
        storefrontId,
        quantity: { $gt: 0 },
      }).sort({ createdAt: 1 }).session(session);

      if (!stockRecords || stockRecords.length === 0) {
        throw new CustomError(400, "Product not found in this storefront");
      }

      // 3. Aggregate total available stock across ALL batch documents
      const totalAvailable = stockRecords.reduce((sum, r) => sum + (r.quantity || 0), 0);

      if (totalAvailable < trueBaseQuantity) {
        throw new CustomError(
          400,
          `Insufficient stock for prize. Available: ${totalAvailable}, Requested: ${trueBaseQuantity} (Base Quantity)`
        );
      }

      // 4. Deduct stock atomically across batch documents (FIFO: oldest batches first)
      let remainingToDeduct = trueBaseQuantity;
      const deductionDetails = []; // track per-batch deductions for audit

      for (const record of stockRecords) {
        if (remainingToDeduct <= 0) break;

        const deductFromThis = Math.min(record.quantity, remainingToDeduct);

        const updatedRecord = await StorefrontInventory.findOneAndUpdate(
          { _id: record._id, quantity: { $gte: deductFromThis } },
          {
            $inc: { quantity: -deductFromThis },
            $set: { lastUpdated: new Date() },
          },
          { new: true, session }
        );

        if (!updatedRecord) {
          // Concurrent modification — abort (transaction will rollback)
          throw new CustomError(400, "Stock was modified concurrently. Please try again.");
        }

        deductionDetails.push({
          stockRecordId: updatedRecord._id,
          beforeQuantity: record.quantity,
          afterQuantity: updatedRecord.quantity,
          deducted: deductFromThis,
        });

        remainingToDeduct -= deductFromThis;
      }

      if (remainingToDeduct > 0) {
        throw new CustomError(400, "Could not fully deduct stock. Please try again.");
      }

      // 5. Generate redemption number
      const redemptionNumber = await LuckyDrawRedemption.generateRedemptionNumber();

      // 6. Create redemption record
      const totalAmount = promotion.redemptionPrice * (promotion.quantityPerRedeem * redeemQuantity);
      const redemptions = await LuckyDrawRedemption.create(
        [
          {
            redemptionNumber,
            promotionId: promotion._id,
            inventoryId: inventoryIdValue,
            quantity: trueBaseQuantity,
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

      // 7. Create stock audit log entries (one per batch touched)
      for (const detail of deductionDetails) {
        await createStockAuditLog({
          inventoryId: inventoryIdValue,
          adminId: req.user?._id || req.user?.id,
          locationId: storefrontId,
          locationType: "storefront",
          stockRecordId: detail.stockRecordId,
          beforeQuantity: detail.beforeQuantity,
          afterQuantity: detail.afterQuantity,
          quantityChange: -detail.deducted,
          action: "remove",
          reason: `Lucky draw redemption: ${promotion.promotionName} - ${promotion.ticketName}`,
          relatedTransactionId: redemptions[0]._id,
          relatedTransactionType: "lucky_draw_redemption",
          session,
        });
      }

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
  const { page = 1, limit = 10, search, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = { isDeleted: false };

  // Search logic
  if (search) {
    filter.$or = [
      { redemptionNumber: { $regex: search, $options: "i" } },
      { customerName: { $regex: search, $options: "i" } },
      { ticketCode: { $regex: search, $options: "i" } },
    ];
  }

  // Date Logic
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const [totalItems, redemptions] = await Promise.all([
    LuckyDrawRedemption.countDocuments(filter),
    LuckyDrawRedemption.find(filter)
      .populate("promotionId", "promotionName ticketName redemptionPrice")
      .populate("inventoryId", "productName productCode")
      .populate("storefrontId", "locationName locationCode")
      .populate("redeemedBy", "name")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 }),
  ]);

  res.status(200).json({
    success: true,
    message: "Lucky draw redemptions fetched successfully",
    data: { redemptions },
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(totalItems / Number(limit)),
      totalItems,
      itemsPerPage: Number(limit),
    },
  });
});
