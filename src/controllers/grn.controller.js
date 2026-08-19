import mongoose from "mongoose";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import Purchasing from "../models/purchasing.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { convertToBaseUnit } from "../utils/uom.utils.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

// Helper function to generate unique batch number in format BAT-YYYYMMDD-XXXX
const generateBatchNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomStr = "";
  for (let i = 0; i < 4; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BAT-${year}${month}${day}-${randomStr}`;
};

// Create new GRN (Supports Partial GRN - Can receive one or more items from PO)
export const createGRN = asyncErrorHandler(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { purchasingId, grnDate, lineItems, notes, warehouseId, locationId, locationType } = req.body;

    // Validate purchasingId
    if (!purchasingId) {
      throw new CustomError(400, "Purchase order ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(purchasingId)) {
      throw new CustomError(400, "Invalid purchase order ID format");
    }

    // Fetch PO with products
    const purchaseOrder = await Purchasing.findById(purchasingId).lean(); // Use lean() to get plain JS object
    if (!purchaseOrder) {
      throw new CustomError(404, "Purchase order not found");
    }

    // Validate PO status - only "arrived" status allows GRN creation
    if (purchaseOrder.status !== "arrived") {
      throw new CustomError(
        400,
        `Cannot create GRN for purchase order with status '${purchaseOrder.status}'. Only purchase orders with status 'arrived' can have GRN created.`
      );
    }

    // Check if PO has products
    if (!purchaseOrder.products || purchaseOrder.products.length === 0) {
      throw new CustomError(400, "Purchase order has no products");
    }

    if (!lineItems || !Array.isArray(lineItems)) {
      throw new CustomError(
        400,
        "Line items are required as an array. Provide goodQuantity and badQuantity for each product from the purchase order."
      );
    }

    if (lineItems.length === 0) {
      throw new CustomError(
        400,
        "At least one line item is required. Provide goodQuantity and badQuantity for products from the purchase order."
      );
    }

    // Create a map of user-provided line items by productCode for easy lookup
    const userLineItemsMap = new Map();
    lineItems.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        throw new CustomError(400, `Line item at index ${index} must be an object`);
      }
      if (!item.productCode) {
        throw new CustomError(
          400,
          `Line item at index ${index} is missing 'productCode'. Each line item must have a productCode to match products from the purchase order.`
        );
      }
      const productCodeUpper = item.productCode.toUpperCase();
      if (userLineItemsMap.has(productCodeUpper)) {
        throw new CustomError(
          400,
          `Duplicate productCode '${item.productCode}' found in line items. Each product can only appear once per GRN.`
        );
      }
      userLineItemsMap.set(productCodeUpper, item);
    });

    // Create a map of PO products by productCode for efficient lookup
    const poProductsByCode = new Map();
    purchaseOrder.products.forEach((poProduct) => {
      const code = poProduct.productCode.toUpperCase();
      poProductsByCode.set(code, poProduct);
    });

    // Batch fetch all inventory items for the PO products
    const poProductCodes = purchaseOrder.products.map((p) => p.productCode.toUpperCase());
    const inventoryItems = await Inventory.find({ productCode: { $in: poProductCodes } }).lean();
    const inventoryMapByCode = new Map(
      inventoryItems.map((item) => [item.productCode.toUpperCase(), item])
    );

    // Build GRN line items from user-provided line items (partial GRN support)
    const grnLineItems = [];
    let calculatedTotalAmount = 0;

    // Process only the products that user wants to receive (partial GRN)
    for (const [productCodeUpper, userItem] of userLineItemsMap) {
      // Find the corresponding PO product
      const poProduct = poProductsByCode.get(productCodeUpper);
      if (!poProduct) {
        throw new CustomError(
          400,
          `Product with productCode '${userItem.productCode}' not found in purchase order.`
        );
      }

      const inventoryItem = inventoryMapByCode.get(productCodeUpper);
      if (!inventoryItem) {
        throw new CustomError(
          404,
          `Inventory item with productCode '${poProduct.productCode}' not found.`
        );
      }
      const inventoryIdValue = inventoryItem._id;

      // Validate quantities (user only provides goodQuantity and badQuantity)
      if (
        userItem.goodQuantity === undefined ||
        userItem.badQuantity === undefined
      ) {
        throw new CustomError(
          400,
          `goodQuantity and badQuantity are required for product '${poProduct.productCode}'`
        );
      }

      if (userItem.goodQuantity < 0 || userItem.badQuantity < 0) {
        throw new CustomError(400, "Quantities cannot be negative");
      }

      // Calculate receivedQuantity from goodQuantity + badQuantity
      const calculatedReceivedQuantity = userItem.goodQuantity + userItem.badQuantity;

      // Check if receivedQuantity is provided in the request (optional)
      const providedReceivedQuantity = userItem.receivedQuantity;

      // Validate that goodQuantity + badQuantity equals receivedQuantity
      let receivedQuantity;
      if (providedReceivedQuantity !== undefined) {
        if (
          typeof providedReceivedQuantity !== "number" ||
          providedReceivedQuantity < 0
        ) {
          throw new CustomError(
            400,
            `For product '${poProduct.productCode}': receivedQuantity must be a non-negative number.`
          );
        }

        if (providedReceivedQuantity !== calculatedReceivedQuantity) {
          throw new CustomError(
            400,
            `For product '${poProduct.productCode}': goodQuantity (${userItem.goodQuantity}) + badQuantity (${userItem.badQuantity}) = ${calculatedReceivedQuantity}, but receivedQuantity is ${providedReceivedQuantity}.`
          );
        }
        receivedQuantity = providedReceivedQuantity;
      } else {
        receivedQuantity = calculatedReceivedQuantity;
      }

      const poPurchaseQuantity = poProduct.purchaseQuantity || 0;
      const poReceivedQuantity = poProduct.receivedQuantity || 0;
      const remainingQuantity = poPurchaseQuantity - poReceivedQuantity;

      if (receivedQuantity > remainingQuantity) {
        throw new CustomError(
          400,
          `Received quantity (${receivedQuantity}) for product '${poProduct.productCode}' exceeds remaining purchase order quantity.`
        );
      }

      if (receivedQuantity <= 0) {
        throw new CustomError(
          400,
          `Received quantity must be greater than 0 for product '${poProduct.productCode}'.`
        );
      }

      const unitPrice =
        userItem.unitPrice !== undefined
          ? userItem.unitPrice
          : poProduct.buyingPrice;
      if (unitPrice < 0) {
        throw new CustomError(400, "Unit price cannot be negative");
      }

      const totalPrice = receivedQuantity * unitPrice;

      // UOM Conversion
      const receivedUnit = userItem.receivedUnit || poProduct.purchaseUnit || inventoryItem.unitOfMeasure || inventoryItem.uom;
      let baseQuantity;
      try {
        baseQuantity = convertToBaseUnit(inventoryItem, receivedUnit, receivedQuantity);
      } catch (err) {
        throw new CustomError(400, `For product '${poProduct.productCode}': ${err.message}`);
      }

      // Handle batch number
      const userBatchNumber =
        userItem.batchNumber && String(userItem.batchNumber).trim() !== ""
          ? String(userItem.batchNumber).trim()
          : null;

      if (userBatchNumber && userBatchNumber !== "__LEGACY__") {
        const existingBatch = await GoodsRecievedNote.findOne({
          lineItems: {
            $elemMatch: {
              batchNumber: userBatchNumber,
              inventoryId: inventoryIdValue,
            },
          },
        });

        if (existingBatch) {
          throw new CustomError(
            400,
            `Batch number '${userBatchNumber}' already exists for product '${poProduct.productCode}'. Please use a unique batch number.`
          );
        }
      }

      const batchNumber = userBatchNumber || generateBatchNumber();
      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : null;

      // Build line item
      grnLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        receivedQuantity,
        receivedUnit,
        baseQuantity,
        goodQuantity: userItem.goodQuantity,
        badQuantity: userItem.badQuantity,
        unitPrice,
        totalPrice,
        notes: userItem.notes || null,
      });

      calculatedTotalAmount += totalPrice;
    }

    const grnNumber = await GoodsRecievedNote.generateGRNNumber();

    const grnData = {
      grnNumber,
      purchasingId,
      grnDate: grnDate || new Date(),
      lineItems: grnLineItems,
      notes: notes || null,
      totalAmount: calculatedTotalAmount,
      status: "pending",
    };

    const newGRN = await GoodsRecievedNote.create([grnData], { session });
    const savedGRN = newGRN[0];

    // Update PO quantities
    for (const grnLineItem of grnLineItems) {
      await Purchasing.updateOne(
        {
          _id: purchasingId,
          "products.inventoryId": grnLineItem.inventoryId,
        },
        {
          $inc: {
            "products.$.receivedQuantity": grnLineItem.receivedQuantity,
          },
        },
        { session }
      );
    }

    const updatedPO = await Purchasing.findById(purchasingId).session(session).lean();

    for (const product of updatedPO.products) {
      const purchaseQty = product.purchaseQuantity || 0;
      const receivedQty = product.receivedQuantity || 0;
      const currentStatus = product.productStatus;

      if (purchaseQty === receivedQty && currentStatus !== "seperated") {
        await Purchasing.updateOne(
          {
            _id: purchasingId,
            "products.inventoryId": product.inventoryId,
          },
          {
            $set: {
              "products.$.productStatus": "seperated",
            },
          },
          { session }
        );
      } else if (purchaseQty !== receivedQty && currentStatus !== "pending") {
        await Purchasing.updateOne(
          {
            _id: purchasingId,
            "products.inventoryId": product.inventoryId,
          },
          {
            $set: {
              "products.$.productStatus": "pending",
            },
          },
          { session }
        );
      }
    }

    // Handle optional stock update using baseQuantity
    const locId = warehouseId || locationId;
    const locType = locationType || 'warehouse';

    if (locId) {
      for (const item of grnLineItems) {
        if (locType === 'warehouse') {
          const stockRecord = await WarehouseStock.findOneAndUpdate(
            {
              inventoryId: item.inventoryId,
              warehouseId: locId,
              batchNumber: item.batchNumber
            },
            {
              $inc: { quantity: item.baseQuantity },
              $set: { lastUpdated: new Date() },
              $setOnInsert: {
                expiryDate: item.expiryDate,
                manufacturingDate: item.manufacturingDate
              }
            },
            { upsert: true, new: true, session }
          );

          await createStockAuditLog({
            inventoryId: item.inventoryId,
            adminId: req.user._id,
            locationId: locId,
            locationType: 'warehouse',
            stockRecordId: stockRecord._id,
            beforeQuantity: (stockRecord.quantity - item.baseQuantity),
            afterQuantity: stockRecord.quantity,
            quantityChange: item.baseQuantity,
            action: 'add',
            reason: `GRN Received: ${purchaseOrder.poNumber}`,
            relatedTransactionId: savedGRN._id,
            relatedTransactionType: 'grn',
            session
          });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Populate references for response
    await savedGRN.populate("purchasingId", "status totalAmount");
    await savedGRN.populate(
      "lineItems.inventoryId",
      "productName productCode SKU sellingPrice"
    );

    res.status(201).json({
      success: true,
      message: "GRN created successfully",
      data: savedGRN,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});

// Get all GRNs
export const getAllGRN = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    purchasingId,
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    includeDeleted = false,
  } = req.query;

  // Build query
  const query = {};

  if (!includeDeleted || includeDeleted === "false") {
    query.isDeleted = false;
  }

  if (purchasingId) {
    if (!mongoose.Types.ObjectId.isValid(purchasingId)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }
    query.purchasingId = purchasingId;
  }

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { grnNumber: { $regex: search, $options: "i" } },
      { notes: { $regex: search, $options: "i" } },
    ];
  }

  // Add date range filter using dateFilter utility
  // Filter by the 'grnDate' field (when the GRN was created/received)
  try {
    const dateFilter = createDateFilter(req.query, "grnDate", false);
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

  // Execute query with population (include sellingPrice for profit calculations)
  const grns = await GoodsRecievedNote.find(query)
    .populate({
      path: "purchasingId",
      select: "status totalAmount supplierId poNumber",
      populate: {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
    })
    .populate(
      "lineItems.inventoryId",
      "productName productCode SKU buyingPrice sellingPrice"
    )
    .sort(sort)
    .skip(skip)
    .limit(limitNum);

  // Get total count for pagination
  const total = await GoodsRecievedNote.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "GRNs retrieved successfully",
    data: grns,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

// Get GRN by ID
export const getGRNById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid GRN ID format"));
  }

  const grn = await GoodsRecievedNote.findOne({
    _id: id,
    isDeleted: false,
  })
    .populate({
      path: "purchasingId",
      select: "status totalAmount products supplierId poNumber",
      populate: {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
    })
    .populate(
      "lineItems.inventoryId",
      "productName productCode SKU category buyingPrice sellingPrice"
    );

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  res.status(200).json({
    success: true,
    message: "GRN retrieved successfully",
    data: grn,
  });
});

export const updateGRNStatus = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  const grn = await GoodsRecievedNote.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  res.status(200).json({
    success: true,
    message: "GRN status updated successfully",
    data: grn,
  });
});

// Update GRN lineItems (goodQuantity and badQuantity)
export const updateGRNLineItems = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { lineItems } = req.body;

  // Validate GRN ID format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid GRN ID format"));
  }

  // Validate lineItems
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
    return next(
      new CustomError(
        400,
        "Line items are required as an array with at least one item."
      )
    );
  }

  // Find the GRN
  const grn = await GoodsRecievedNote.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  // Validate and update each line item
  for (const updateItem of lineItems) {
    // Validate required fields
    if (!updateItem.lineItemId) {
      return next(
        new CustomError(
          400,
          "lineItemId is required for each line item update."
        )
      );
    }

    if (
      updateItem.goodQuantity === undefined ||
      updateItem.badQuantity === undefined
    ) {
      return next(
        new CustomError(
          400,
          "goodQuantity and badQuantity are required for each line item update."
        )
      );
    }

    // Validate quantities are non-negative
    if (updateItem.goodQuantity < 0 || updateItem.badQuantity < 0) {
      return next(
        new CustomError(400, "goodQuantity and badQuantity cannot be negative.")
      );
    }

    // Find the line item in the GRN
    const lineItem = grn.lineItems.id(updateItem.lineItemId);
    if (!lineItem) {
      return next(
        new CustomError(
          400,
          `Line item with ID ${updateItem.lineItemId} not found in GRN.`
        )
      );
    }

    // Validate that goodQuantity + badQuantity equals receivedQuantity
    const sumOfGoodAndBad = updateItem.goodQuantity + updateItem.badQuantity;
    if (sumOfGoodAndBad !== lineItem.receivedQuantity) {
      return next(
        new CustomError(
          400,
          `For line item ${updateItem.lineItemId}: goodQuantity (${updateItem.goodQuantity}) + badQuantity (${updateItem.badQuantity}) = ${sumOfGoodAndBad}, but receivedQuantity is ${lineItem.receivedQuantity}. These values must be equal. Please ensure: goodQuantity + badQuantity = receivedQuantity.`
        )
      );
    }

    // Validate that transferredQuantity doesn't exceed new goodQuantity
    if (updateItem.goodQuantity < lineItem.transferredQuantity) {
      return next(
        new CustomError(
          400,
          `For line item ${updateItem.lineItemId}: Cannot set goodQuantity (${updateItem.goodQuantity}) less than transferredQuantity (${lineItem.transferredQuantity}). Some quantity has already been transferred.`
        )
      );
    }

    // Update the line item
    lineItem.goodQuantity = updateItem.goodQuantity;
    lineItem.badQuantity = updateItem.badQuantity;

    // Update notes if provided
    if (updateItem.notes !== undefined) {
      lineItem.notes = updateItem.notes || null;
    }

    // Update batchNumber (supports both batchNumber and batchNo from frontend)
    const batch =
      updateItem.batchNumber !== undefined
        ? updateItem.batchNumber
        : updateItem.batchNo;
    if (batch !== undefined) {
      // Check uniqueness of batchNumber if it's being actively set to a real batch
      if (batch !== "__LEGACY__" && batch.trim() !== "") {
        const existingBatch = await GoodsRecievedNote.findOne({
          lineItems: {
            $elemMatch: {
              batchNumber: batch,
              inventoryId: lineItem.inventoryId,
              _id: { $ne: updateItem.lineItemId },
            },
          },
        });

        if (existingBatch) {
          return next(
            new CustomError(
              400,
              "Batch number already exists. Please enter a unique batch number."
            )
          );
        }
      }
      lineItem.batchNumber = batch;
    }

    // Update and validate expiryDate
    if (updateItem.expiryDate !== undefined) {
      if (updateItem.expiryDate) {
        const parsedDate = new Date(updateItem.expiryDate);
        if (isNaN(parsedDate.getTime())) {
          return next(
            new CustomError(
              400,
              `Invalid expiryDate format for line item ${updateItem.lineItemId}.`
            )
          );
        }
        lineItem.expiryDate = parsedDate;
      } else {
        lineItem.expiryDate = null;
      }
    }
  }

  // Recalculate totalAmount based on updated line items
  const newTotalAmount = grn.lineItems.reduce(
    (total, item) => total + item.totalPrice,
    0
  );
  grn.totalAmount = newTotalAmount;

  // Save the updated GRN
  await grn.save();

  // Populate references for response
  await grn.populate({
    path: "purchasingId",
    select: "status totalAmount supplierId poNumber",
    populate: {
      path: "supplierId",
      select: "supplierName supplierCode",
    },
  });
  await grn.populate(
    "lineItems.inventoryId",
    "productName productCode SKU category buyingPrice sellingPrice"
  );

  res.status(200).json({
    success: true,
    message: "GRN line items updated successfully",
    data: grn,
  });
});
