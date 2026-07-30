import mongoose from "mongoose";
import SupplierPayment from "../models/supplierPayment.model.js";
import Purchasing from "../models/purchasing.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";

// 1. createSupplierPayment
export const createSupplierPayment = asyncErrorHandler(async (req, res, next) => {
  const { id: purchasingId } = req.params;
  const { paidAmount, paymentMethod, notes, paymentDate } = req.body;
  const addedBy = req.user._id;

  if (!paidAmount || paidAmount <= 0) {
    return next(new CustomError(400, "Valid paid amount is required"));
  }

  // Start a transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const purchase = await Purchasing.findById(purchasingId).session(session);
    
    if (!purchase) {
      throw new CustomError(404, "Purchase order not found");
    }

    if (purchase.paymentType !== "credit") {
      throw new CustomError(400, "Payments can only be added to credit purchases");
    }

    const remainingBalance = Math.max(0, purchase.totalAmount - purchase.paidAmount);

    if (paidAmount > remainingBalance) {
      throw new CustomError(400, `Paid amount cannot exceed remaining balance of ${remainingBalance}`);
    }

    // Create the payment record
    const payment = await SupplierPayment.create([{
      purchasingId,
      supplierId: purchase.supplierId,
      paidAmount,
      paymentMethod: paymentMethod || "cash",
      paymentDate: paymentDate || Date.now(),
      notes,
      addedBy,
    }], { session });

    // Update PO's paidAmount
    purchase.paidAmount += paidAmount;
    
    // Save purchase to trigger pre-save hook for status if applicable
    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Payment added successfully",
      data: payment[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

// 2. getPaymentsByPurchaseId
export const getPaymentsByPurchaseId = asyncErrorHandler(async (req, res, next) => {
  const { id: purchasingId } = req.params;

  const payments = await SupplierPayment.find({ purchasingId, isDeleted: false })
    .sort({ paymentDate: -1 })
    .populate("addedBy", "name role");

  res.status(200).json({
    success: true,
    message: "Payments retrieved successfully",
    data: payments,
  });
});

// 3. getPaymentsBySupplierId
export const getPaymentsBySupplierId = asyncErrorHandler(async (req, res, next) => {
  const { supplierId } = req.params;

  const payments = await SupplierPayment.find({ supplierId, isDeleted: false })
    .sort({ paymentDate: -1 })
    .populate("purchasingId", "poNumber totalAmount status");

  res.status(200).json({
    success: true,
    message: "Supplier payments retrieved successfully",
    data: payments,
  });
});

// 4. hardDeleteSupplierPayment
export const hardDeleteSupplierPayment = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await SupplierPayment.findById(id).session(session);

    if (!payment) {
      throw new CustomError(404, "Payment record not found");
    }

    const purchase = await Purchasing.findById(payment.purchasingId).session(session);

    if (purchase) {
      // Revert the PO's paidAmount
      purchase.paidAmount -= payment.paidAmount;
      
      // If the status was updated to completed due to full payment, revert it
      if (purchase.status === "completed" && purchase.paidAmount < purchase.totalAmount) {
        // We revert to pending. (or whatever makes sense in your workflow)
        purchase.status = "pending";
      }

      await purchase.save({ session });
    }

    // Hard delete the payment
    await SupplierPayment.findByIdAndDelete(id, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Payment deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});
