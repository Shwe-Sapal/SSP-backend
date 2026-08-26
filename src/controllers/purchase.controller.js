import mongoose from "mongoose";
import Purchasing from "../models/purchasing.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import Inventory from "../models/inventory.model.js";
import Supplier from "../models/supplierProfile.model.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const createPurchase = asyncErrorHandler(async (req, res, next) => {
  const { supplierId, products, note, paymentType, paidAmount, dueDate } = req.body;
  const purchasedBy = req.user._id;

  if (!supplierId || !products || products.length === 0) {
    return next(new CustomError(400, "Supplier ID and products are required"));
  }

  // Extract all inventory IDs for batch fetching
  const inventoryIds = products.map((item) => {
    if (!item.inventoryId || !item.purchaseQuantity) {
      throw new CustomError(
        400,
        `Product must have inventoryId and purchaseQuantity`
      );
    }
    return item.inventoryId;
  });

  // Batch fetch all inventory items
  const inventoryItems = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const inventoryMap = new Map(
    inventoryItems.map((item) => [item._id.toString(), item])
  );

  let calculatedTotalAmount = 0;

  // Process and validate products
  const productsWithDetails = products.map((item) => {
    const inventoryItem = inventoryMap.get(item.inventoryId.toString());

    if (!inventoryItem) {
      throw new CustomError(
        404,
        `Product with ID ${item.inventoryId} not found`
      );
    }

    // UOM Validation
    if (!item.purchaseUnit) {
      throw new CustomError(400, `purchaseUnit is required for product '${inventoryItem.productName}'`);
    }
    const purchaseUnit = item.purchaseUnit;
    const baseUnit = (inventoryItem.unitOfMeasure || inventoryItem.uom || "").trim().toLowerCase();

    // Build set of valid units (base unit + conversion units)
    const validUnits = new Set([baseUnit]);
    if (inventoryItem.uomConversions && Array.isArray(inventoryItem.uomConversions)) {
      inventoryItem.uomConversions.forEach((conv) => {
        if (conv.unit) validUnits.add(conv.unit.trim().toLowerCase());
      });
    }

    const providedUnitLower = purchaseUnit.trim().toLowerCase();
    if (!validUnits.has(providedUnitLower)) {
      throw new CustomError(
        400,
        `Invalid purchase unit '${purchaseUnit}' provided for product '${inventoryItem.productName}'. Valid units are: ${Array.from(validUnits).join(", ")}`
      );
    }

    if (item.purchaseUnitPrice === undefined || item.purchaseUnitPrice === null) {
      throw new CustomError(400, `purchaseUnitPrice is required for product '${inventoryItem.productName}'`);
    }
    const purchaseUnitPrice = item.purchaseUnitPrice;

    if (purchaseUnitPrice < 0) {
      throw new CustomError(400, `Purchase unit price cannot be negative for product '${inventoryItem.productName}'`);
    }

    // Calculate item total
    const itemTotal = item.purchaseQuantity * purchaseUnitPrice;
    calculatedTotalAmount += itemTotal;

    return {
      inventoryId: inventoryItem._id,
      productName: inventoryItem.productName,
      productCode: inventoryItem.productCode,
      buyingPrice: inventoryItem.buyingPrice,
      purchaseQuantity: item.purchaseQuantity,
      purchaseUnit,
      purchaseUnitPrice,
    };
  });

  // Handle payment logic
  let finalPaidAmount = 0;
  if (paymentType === "credit") {
    finalPaidAmount = paidAmount || 0;
  } else {
    finalPaidAmount = calculatedTotalAmount;
  }

  // Generate PO number
  const poNumber = await Purchasing.generatePONumber();

  const purchase = await Purchasing.create({
    poNumber,
    supplierId,
    products: productsWithDetails,
    note: note || "No note available",
    totalAmount: calculatedTotalAmount,
    paymentType: paymentType || "paid",
    paidAmount: finalPaidAmount,
    dueDate: paymentType === "credit" ? dueDate : null,
    status: "pending",
    purchasedBy,
  });

  res.status(201).json({
    success: true,
    message: "Purchase created successfully",
    data: purchase,
  });
});

export const getAllPurchases = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    isDeleted,
    status,
    paymentType,
    paymentStatus,
  } = req.query;

  // Build query
  const query = {};

  // Filter by isDeleted status if provided
  // Supports: ?isDeleted=true, ?isDeleted=false, or omit to default to false
  if (isDeleted !== undefined) {
    // Convert string "true"/"false" to boolean
    if (isDeleted === "true" || isDeleted === true) {
      query.isDeleted = true;
    } else if (isDeleted === "false" || isDeleted === false) {
      query.isDeleted = false;
    } else {
      return next(
        new CustomError(
          400,
          "Invalid isDeleted value. Must be 'true' or 'false'."
        )
      );
    }
  } else {
    // Default: exclude deleted purchases if isDeleted is not specified
    query.isDeleted = false;
  }

  // Filter by status if provided
  if (status !== undefined) {
    const validStatuses = [
      "pending",
      "confirmed", "arrived",
      "cancelled",
      "completed",
    ];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }
    query.status = status;
  }

  // Filter by paymentType if provided
  if (paymentType !== undefined) {
    const validPaymentTypes = ["credit", "paid"];
    if (!validPaymentTypes.includes(paymentType)) {
      return next(
        new CustomError(
          400,
          `Invalid paymentType. Allowed values: ${validPaymentTypes.join(", ")}`
        )
      );
    }
    query.paymentType = paymentType;
  }

  // Filter by paymentStatus custom logic
  if (paymentStatus !== undefined) {
    if (paymentStatus === "paid") {
      query.$expr = { $gte: ["$paidAmount", "$totalAmount"] };
    } else if (paymentStatus === "partial") {
      query.$expr = {
        $and: [{ $gt: ["$paidAmount", 0] }, { $lt: ["$paidAmount", "$totalAmount"] }],
      };
    } else if (paymentStatus === "unpaid") {
      query.$expr = { $lte: ["$paidAmount", 0] };
    } else {
      return next(
        new CustomError(400, "Invalid paymentStatus. Allowed values: paid, partial, unpaid")
      );
    }
  }

  // Add date range filter using dateFilter utility
  // Filter by the 'createdAt' field (when the purchase was created)
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(query, dateFilter);
  } catch (error) {
    // If it's a CustomError, pass it to error handler
    if (error instanceof CustomError) {
      return next(error);
    }
    // For other errors, wrap and pass
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // Pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Sort
  const sort = {};
  sort[sortBy] = sortOrder === "asc" ? 1 : -1;

  // Execute query with population
  const purchases = await Purchasing.find(query)
    .populate("purchasedBy", "name role")
    .populate("supplierId", "supplierName supplierCode")
    .sort(sort)
    .skip(skip)
    .limit(limitNum);

  // Calculate totalRemainingQuantity for each purchase
  // Convert to plain objects and add totalRemainingQuantity field
  const purchasesWithTotalRemaining = purchases.map((purchase) => {
    const purchaseObj = purchase.toObject({ virtuals: true });

    // Calculate totalRemainingQuantity by summing all products' remainingQuantity
    // Use virtual field if available, otherwise calculate manually
    const totalRemainingQuantity = purchase.products.reduce(
      (total, product) => {
        // Try to use virtual field first, fallback to manual calculation
        const remainingQty =
          product.remainingQuantity !== undefined
            ? product.remainingQuantity
            : (product.purchaseQuantity || 0) - (product.receivedQuantity || 0);
        return total + Math.max(0, remainingQty); // Ensure non-negative
      },
      0
    );

    // Add totalRemainingQuantity after products section
    return {
      ...purchaseObj,
      totalRemainingQuantity,
    };
  });

  // Get total count for pagination
  const total = await Purchasing.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "All purchases retrieved successfully",
    data: purchasesWithTotalRemaining,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getPurchaseById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Exclude deleted purchases by default
  const includeDeleted = req.query.includeDeleted === "true";
  const query = includeDeleted ? { _id: id } : { _id: id, isDeleted: false };

  const purchase = await Purchasing.findOne(query).populate(
    "purchasedBy",
    "name role"
  );

  if (!purchase) {
    return next(new CustomError(404, "Purchase not found"));
  }

  res.status(200).json({
    success: true,
    message: "Purchase retrieved successfully",
    data: purchase,
  });
});

export const updatePurchaseStatus = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { status, dueDate } = req.body;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }

    if (!status) {
      return next(new CustomError(400, "Status is required"));
    }

    const validStatuses = ["pending", "confirmed", "arrived", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }

    // First, check if the purchase exists and if it's soft-deleted
    const existingPurchase = await Purchasing.findById(id);

    if (!existingPurchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    // Validate that the purchase is not soft-deleted
    if (existingPurchase.isDeleted === true) {
      return next(
        new CustomError(
          400,
          "Cannot update status of a soft-deleted purchase order. Please restore the purchase order first."
        )
      );
    }

    // Update the status and optionally dueDate
    const updateData = { status };
    if (dueDate !== undefined) {
      updateData.dueDate = dueDate;
    }

    const purchase = await Purchasing.findOneAndUpdate(
      { _id: id, isDeleted: false },
      updateData,
      { new: true, runValidators: true }
    );

    if (!purchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    res.status(200).json({
      success: true,
      message: "Purchase status updated successfully",
      data: purchase,
    });
  }
);

// Soft delete purchase order
export const softDeletePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find the purchase order
  const purchase = await Purchasing.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Soft delete: set isDeleted to true and deletedAt to current date
  purchase.isDeleted = true;
  purchase.deletedAt = new Date();
  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Purchase order soft deleted successfully",
    data: purchase,
  });
});

export const restorePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find the purchase order
  const purchase = await Purchasing.findOne({
    _id: id,
    isDeleted: true,
  });

  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Restore: set isDeleted to false and deletedAt to null
  purchase.isDeleted = false;
  purchase.deletedAt = null;
  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Purchase order restored successfully",
    data: purchase,
  });
});

export const hardDeletePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find the purchase order
  const purchase = await Purchasing.findById(id);

  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Delete the document permanently
  await purchase.deleteOne();

  res.status(200).json({
    success: true,
    message: "Purchase order permanently deleted successfully",
    data: null,
  });
});

// Update a specific product's purchaseQuantity within a PO
export const updatePurchaseItemQuantity = asyncErrorHandler(
  async (req, res, next) => {
    const { id: poId, itemId } = req.params;
    const { purchaseQuantity } = req.body;

    // Validate MongoDB ObjectId formats
    if (!mongoose.Types.ObjectId.isValid(poId)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return next(new CustomError(400, "Invalid item ID format"));
    }

    // Validate purchaseQuantity
    if (purchaseQuantity === undefined || purchaseQuantity === null) {
      return next(new CustomError(400, "purchaseQuantity is required"));
    }
    if (typeof purchaseQuantity !== "number" || purchaseQuantity <= 0) {
      return next(
        new CustomError(400, "purchaseQuantity must be a positive number")
      );
    }

    // Find the PO (non-deleted only)
    const purchase = await Purchasing.findOne({
      _id: poId,
      isDeleted: false,
    });

    if (!purchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    // Only allow edits on POs that haven't been fully received/completed
    const editableStatuses = ["pending", "confirmed"];
    if (!editableStatuses.includes(purchase.status)) {
      return next(
        new CustomError(
          400,
          `Cannot edit quantities for a purchase order with status '${purchase.status}'. Only 'pending' or 'confirmed' POs can be edited.`
        )
      );
    }

    // Find the specific product subdocument
    const product = purchase.products.id(itemId);
    if (!product) {
      return next(
        new CustomError(404, "Product item not found in this purchase order")
      );
    }

    // Prevent reducing below already-received quantity
    const alreadyReceived = product.receivedQuantity || 0;
    if (purchaseQuantity < alreadyReceived) {
      return next(
        new CustomError(
          400,
          `Cannot set purchaseQuantity (${purchaseQuantity}) below already received quantity (${alreadyReceived}).`
        )
      );
    }

    // Update the product's purchaseQuantity
    const oldQuantity = product.purchaseQuantity;
    product.purchaseQuantity = purchaseQuantity;

    // Recalculate PO totalAmount from all products
    let newTotalAmount = 0;
    for (const p of purchase.products) {
      const qty = p.purchaseQuantity || 0;
      const price = p.purchaseUnitPrice || 0;
      newTotalAmount += qty * price;
    }
    purchase.totalAmount = newTotalAmount;

    await purchase.save();

    res.status(200).json({
      success: true,
      message: `Product quantity updated from ${oldQuantity} to ${purchaseQuantity}`,
      data: purchase,
    });
  }
);

// Add a new item to an existing pending purchase order
export const addPurchaseItem = asyncErrorHandler(async (req, res, next) => {
  const { id: poId } = req.params;
  const { inventoryId, purchaseQuantity, purchaseUnit, purchaseUnitPrice } = req.body;

  if (!mongoose.Types.ObjectId.isValid(poId)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  if (!inventoryId || !purchaseQuantity || !purchaseUnit || purchaseUnitPrice === undefined) {
    return next(new CustomError(400, "inventoryId, purchaseQuantity, purchaseUnit, and purchaseUnitPrice are required"));
  }

  const purchase = await Purchasing.findOne({ _id: poId, isDeleted: false });
  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  if (purchase.status !== "pending") {
    return next(new CustomError(400, `Cannot add items to a purchase order with status '${purchase.status}'. Only 'pending' POs can be edited.`));
  }

  const existingItemIndex = purchase.products.findIndex(
    (item) => item.inventoryId.toString() === inventoryId.toString()
  );

  if (existingItemIndex > -1) {
    return next(new CustomError(400, "Product already exists in this purchase order. Please update its quantity instead."));
  }

  const inventoryItem = await Inventory.findById(inventoryId).lean();
  if (!inventoryItem) {
    return next(new CustomError(404, `Product with ID ${inventoryId} not found in inventory`));
  }

  const baseUnit = (inventoryItem.unitOfMeasure || inventoryItem.uom || "").trim().toLowerCase();
  const validUnits = new Set([baseUnit]);
  if (inventoryItem.uomConversions && Array.isArray(inventoryItem.uomConversions)) {
    inventoryItem.uomConversions.forEach((conv) => {
      if (conv.unit) validUnits.add(conv.unit.trim().toLowerCase());
    });
  }

  const providedUnitLower = purchaseUnit.trim().toLowerCase();
  if (!validUnits.has(providedUnitLower)) {
    return next(new CustomError(
      400,
      `Invalid purchase unit '${purchaseUnit}' provided. Valid units are: ${Array.from(validUnits).join(", ")}`
    ));
  }

  if (purchaseUnitPrice < 0) {
    return next(new CustomError(400, "Purchase unit price cannot be negative"));
  }
  if (purchaseQuantity <= 0) {
    return next(new CustomError(400, "Purchase quantity must be greater than zero"));
  }

  const newItem = {
    inventoryId: inventoryItem._id,
    productName: inventoryItem.productName,
    productCode: inventoryItem.productCode,
    buyingPrice: inventoryItem.buyingPrice,
    purchaseQuantity,
    purchaseUnit,
    purchaseUnitPrice,
  };

  purchase.products.push(newItem);

  let newTotalAmount = 0;
  for (const p of purchase.products) {
    const qty = p.purchaseQuantity || 0;
    const price = p.purchaseUnitPrice || 0;
    newTotalAmount += qty * price;
  }
  purchase.totalAmount = newTotalAmount;

  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Item added to purchase order successfully",
    data: purchase,
  });
});

// Remove an item from a pending purchase order
export const removePurchaseItem = asyncErrorHandler(async (req, res, next) => {
  const { id: poId, itemId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(poId)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return next(new CustomError(400, "Invalid item ID format"));
  }

  const purchase = await Purchasing.findOne({ _id: poId, isDeleted: false });
  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  if (purchase.status !== "pending") {
    return next(new CustomError(400, `Cannot remove items from a purchase order with status '${purchase.status}'. Only 'pending' POs can be edited.`));
  }

  const product = purchase.products.id(itemId);
  if (!product) {
    return next(new CustomError(404, "Product item not found in this purchase order"));
  }

  purchase.products.pull(itemId);

  let newTotalAmount = 0;
  for (const p of purchase.products) {
    const qty = p.purchaseQuantity || 0;
    const price = p.purchaseUnitPrice || 0;
    newTotalAmount += qty * price;
  }
  purchase.totalAmount = newTotalAmount;

  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Item removed from purchase order successfully",
    data: purchase,
  });
});

// Update the entire purchase order (PATCH)
export const updateWholePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { supplierId, note, paymentType, paidAmount, dueDate, products } = req.body;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find existing PO
  const purchase = await Purchasing.findOne({ _id: id, isDeleted: false });
  if (!purchase) {
    return next(new CustomError(400, "Purchase order not found"));
  }

  // Check if status is pending
  if (purchase.status !== "pending") {
    return next(
      new CustomError(
        400,
        `Cannot edit a purchase order with status '${purchase.status}'. Only 'pending' POs can be edited.`
      )
    );
  }

  // Validate Supplier if provided
  if (supplierId) {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return next(new CustomError(400, "Supplier not found"));
    }
    purchase.supplierId = supplierId;
  }

  // Update simple fields
  if (note !== undefined) purchase.note = note;

  // Process and validate products if provided
  if (products && Array.isArray(products)) {
    // Collect incoming products map for quick lookup
    const incomingProductsMap = new Map();
    products.forEach((p) => {
      if (p.inventoryId) incomingProductsMap.set(p.inventoryId.toString(), p);
    });

    // Check STRICT RULE: existing products
    for (const existingItem of purchase.products) {
      const received = existingItem.receivedQuantity || 0;
      if (received > 0) {
        const incomingItem = incomingProductsMap.get(existingItem.inventoryId.toString());
        // 1. Cannot completely remove it
        if (!incomingItem) {
          return next(
            new CustomError(
              400,
              `Cannot remove product '${existingItem.productName}' as it has already been partially received (${received} received).`
            )
          );
        }
        // 2. New purchaseQuantity MUST NOT be less than receivedQuantity
        if (incomingItem.purchaseQuantity < received) {
          return next(
            new CustomError(
              400,
              `Cannot set purchase quantity for product '${existingItem.productName}' (${incomingItem.purchaseQuantity}) below already received quantity (${received}).`
            )
          );
        }
      }
    }

    // Extract all inventory IDs for batch fetching
    const inventoryIds = products.map((item) => {
      if (!item.inventoryId || item.purchaseQuantity === undefined) {
        throw new CustomError(
          400,
          `Product must have inventoryId and purchaseQuantity`
        );
      }
      return item.inventoryId;
    });

    // Batch fetch all inventory items
    const inventoryItems = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
    const inventoryMap = new Map(
      inventoryItems.map((item) => [item._id.toString(), item])
    );

    let calculatedTotalAmount = 0;

    // Build the new products array
    const productsWithDetails = products.map((item) => {
      const inventoryItem = inventoryMap.get(item.inventoryId.toString());
      if (!inventoryItem) {
        throw new CustomError(
          404,
          `Product with ID ${item.inventoryId} not found in inventory`
        );
      }

      // UOM Validation
      if (!item.purchaseUnit) {
        throw new CustomError(
          400,
          `purchaseUnit is required for product '${inventoryItem.productName}'`
        );
      }
      const purchaseUnit = item.purchaseUnit;
      const baseUnit = (inventoryItem.unitOfMeasure || inventoryItem.uom || "").trim().toLowerCase();

      // Build set of valid units
      const validUnits = new Set([baseUnit]);
      if (inventoryItem.uomConversions && Array.isArray(inventoryItem.uomConversions)) {
        inventoryItem.uomConversions.forEach((conv) => {
          if (conv.unit) validUnits.add(conv.unit.trim().toLowerCase());
        });
      }

      const providedUnitLower = purchaseUnit.trim().toLowerCase();
      if (!validUnits.has(providedUnitLower)) {
        throw new CustomError(
          400,
          `Invalid purchase unit '${purchaseUnit}' provided for product '${inventoryItem.productName}'. Valid units are: ${Array.from(validUnits).join(", ")}`
        );
      }

      if (item.purchaseUnitPrice === undefined || item.purchaseUnitPrice === null) {
        throw new CustomError(
          400,
          `purchaseUnitPrice is required for product '${inventoryItem.productName}'`
        );
      }
      const purchaseUnitPrice = item.purchaseUnitPrice;
      if (purchaseUnitPrice < 0) {
        throw new CustomError(
          400,
          `Purchase unit price cannot be negative for product '${inventoryItem.productName}'`
        );
      }

      if (item.purchaseQuantity <= 0) {
         throw new CustomError(
           400,
           `Purchase quantity must be greater than zero for product '${inventoryItem.productName}'`
         );
      }

      // Calculate item total
      const itemTotal = item.purchaseQuantity * purchaseUnitPrice;
      calculatedTotalAmount += itemTotal;

      // Find if this product was already in the PO to retain receivedQuantity and _id if possible
      const existingProduct = purchase.products.find(
        (p) => p.inventoryId.toString() === item.inventoryId.toString()
      );

      return {
        _id: existingProduct ? existingProduct._id : undefined, // retain subdocument ID if it exists
        inventoryId: inventoryItem._id,
        productName: inventoryItem.productName,
        productCode: inventoryItem.productCode,
        buyingPrice: inventoryItem.buyingPrice,
        purchaseQuantity: item.purchaseQuantity,
        purchaseUnit,
        purchaseUnitPrice,
        receivedQuantity: existingProduct ? existingProduct.receivedQuantity || 0 : 0,
      };
    });

    purchase.products = productsWithDetails;
    purchase.totalAmount = calculatedTotalAmount;
  }

  // Handle payment logic
  if (paymentType !== undefined) {
    purchase.paymentType = paymentType;
  }
  
  if (purchase.paymentType === "paid") {
    purchase.paidAmount = purchase.totalAmount;
    purchase.dueDate = null;
  } else if (purchase.paymentType === "credit") {
    if (paidAmount !== undefined) purchase.paidAmount = paidAmount;
    if (dueDate !== undefined) purchase.dueDate = dueDate;
  }

  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Purchase order updated successfully",
    data: purchase,
  });
});
