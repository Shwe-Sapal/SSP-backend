import mongoose from "mongoose";
import Transfer from "../models/transfer.model.js";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import { convertToBaseUnit, getEffectiveBaseFactor } from "../utils/uom.utils.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";

// Helper to aggregate line items to prevent race conditions during validation and transfer
// when multiple line items for the same product are sent simultaneously.
const aggregateTransferLineItems = (transferLineItems) => {
  const aggregatedItemsMap = new Map();
  for (const item of transferLineItems) {
    if (!item.productCode || item.quantity === undefined || item.quantity === null) {
      // Missing required fields will be caught by the validation loop below
      aggregatedItemsMap.set(Math.random().toString(), item);
      continue;
    }
    const batch = item.batchNumber || "__LEGACY__";
    const unit = item.transferUnit ? item.transferUnit.trim().toLowerCase() : "piece";
    const grnLineItemId = item.grnLineItemId ? item.grnLineItemId.toString() : "";
    const key = `${item.productCode.toUpperCase()}_${batch}_${unit}_${grnLineItemId}`;
    
    if (aggregatedItemsMap.has(key)) {
      const existing = aggregatedItemsMap.get(key);
      existing.quantity = Number(existing.quantity) + Number(item.quantity);
      if (item.notes) {
        existing.notes = existing.notes ? `${existing.notes}; ${item.notes}` : item.notes;
      }
    } else {
      aggregatedItemsMap.set(key, { ...item, quantity: typeof item.quantity === 'number' ? item.quantity : Number(item.quantity) });
    }
  }
  return Array.from(aggregatedItemsMap.values());
};

// Create new Transfer (supports both GRN → Warehouse and Warehouse → Storefront)
export const createTransfer = asyncErrorHandler(async (req, res, next) => {
  if (!req.user || !req.user._id) {
    return next(
      new CustomError(
        401,
        "Authentication required. Admin account ID is missing."
      )
    );
  }
  const transferredBy = req.user._id;
  // Support both camelCase and lowercase for lineItems
  const {
    sourceType, // "GRN" or "Warehouse"
    grnId, // For GRN → Warehouse transfers
    sourceWarehouseId, // For Warehouse → Storefront transfers
    destinationWarehouseId, // For GRN → Warehouse transfers
    destinationStorefrontId, // For Warehouse → Storefront transfers
    lineItems,
    lineitems,
    transferDate,
    notes,
  } = req.body;

  // Use lineItems (camelCase) or fallback to lineitems (lowercase)
  const transferLineItems = lineItems || lineitems;

  // Determine sourceType if not provided (backward compatibility: default to GRN)
  const transferSourceType = sourceType || (grnId ? "GRN" : null);

  if (
    !transferSourceType ||
    !["GRN", "Warehouse"].includes(transferSourceType)
  ) {
    return next(
      new CustomError(
        400,
        "sourceType is required and must be 'GRN' or 'Warehouse'"
      )
    );
  }

  let sourceId;
  let destinationId;
  let destinationType;

  // Handle GRN transfer (supports both GRN → Warehouse and GRN → Storefront)
  if (transferSourceType === "GRN") {
    if (!grnId) {
      return next(new CustomError(400, "grnId is required for GRN transfers"));
    }
    if (!mongoose.Types.ObjectId.isValid(grnId)) {
      return next(new CustomError(400, "Invalid GRN ID format"));
    }
    if (!destinationWarehouseId && !destinationStorefrontId) {
      return next(
        new CustomError(
          400,
          "Either destinationWarehouseId or destinationStorefrontId is required for GRN transfers"
        )
      );
    }
    if (destinationWarehouseId && destinationStorefrontId) {
      return next(
        new CustomError(
          400,
          "Cannot specify both destinationWarehouseId and destinationStorefrontId"
        )
      );
    }

    if (destinationWarehouseId) {
      if (!mongoose.Types.ObjectId.isValid(destinationWarehouseId)) {
        return next(
          new CustomError(400, "Invalid destination warehouse ID format")
        );
      }
      sourceId = grnId;
      destinationId = destinationWarehouseId;
      destinationType = "warehouse";
    } else {
      if (!mongoose.Types.ObjectId.isValid(destinationStorefrontId)) {
        return next(
          new CustomError(400, "Invalid destination storefront ID format")
        );
      }
      sourceId = grnId;
      destinationId = destinationStorefrontId;
      destinationType = "storefront";
    }
  }
  // Handle Warehouse → Storefront transfer
  else if (transferSourceType === "Warehouse") {
    if (!sourceWarehouseId) {
      return next(
        new CustomError(
          400,
          "sourceWarehouseId is required for Warehouse → Storefront transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(sourceWarehouseId)) {
      return next(new CustomError(400, "Invalid source warehouse ID format"));
    }
    if (!destinationStorefrontId) {
      return next(
        new CustomError(
          400,
          "destinationStorefrontId is required for Warehouse → Storefront transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(destinationStorefrontId)) {
      return next(
        new CustomError(400, "Invalid destination storefront ID format")
      );
    }
    sourceId = sourceWarehouseId;
    destinationId = destinationStorefrontId;
    destinationType = "storefront";
  }

  // Validate lineItems (support both camelCase and lowercase)
  if (
    !transferLineItems ||
    !Array.isArray(transferLineItems) ||
    transferLineItems.length === 0
  ) {
    return next(
      new CustomError(
        400,
        "Line items are required and must be a non-empty array"
      )
    );
  }

  // Validate source and destination based on transfer type
  if (transferSourceType === "GRN") {
    // Fetch GRN with line items
    const grn = await GoodsRecievedNote.findById(sourceId).lean();
    if (!grn) {
      return next(new CustomError(404, "GRN not found"));
    }
    if (grn.isDeleted) {
      return next(
        new CustomError(400, "Cannot create transfer from deleted GRN")
      );
    }
    if (grn.status !== "partial" && grn.status !== "verified") {
      return next(
        new CustomError(
          400,
          `Cannot create transfer from GRN with status '${grn.status}'. Only GRNs with status 'partial' or 'verified' can have transfers created.`
        )
      );
    }
    if (!grn.lineItems || grn.lineItems.length === 0) {
      return next(new CustomError(400, "GRN has no line items"));
    }

    if (destinationType === "warehouse") {
      // Validate destination warehouse exists
      const warehouse = await LocationProfile.findOne({
        _id: destinationId,
        type: "warehouse",
      });
      if (!warehouse) {
        return next(new CustomError(404, "Destination warehouse not found"));
      }
      if (warehouse.isDeleted) {
        return next(
          new CustomError(400, "Cannot transfer to deleted warehouse")
        );
      }
    } else if (destinationType === "storefront") {
      // Validate destination storefront exists
      const storefront = await LocationProfile.findOne({
        _id: destinationId,
        type: "storefront",
      });
      if (!storefront) {
        return next(new CustomError(404, "Destination storefront not found"));
      }
      if (storefront.isDeleted) {
        return next(
          new CustomError(400, "Cannot transfer to deleted storefront")
        );
      }
    }
  } else if (transferSourceType === "Warehouse") {
    // Validate source warehouse exists
    const sourceWarehouse = await LocationProfile.findOne({
      _id: sourceId,
      type: "warehouse",
    });
    if (!sourceWarehouse) {
      return next(new CustomError(404, "Source warehouse not found"));
    }
    if (sourceWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot create transfer from deleted warehouse")
      );
    }

    // Validate destination storefront exists
    const storefront = await LocationProfile.findOne({
      _id: destinationId,
      type: "storefront",
    });
    if (!storefront) {
      return next(new CustomError(404, "Destination storefront not found"));
    }
    if (storefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to deleted storefront")
      );
    }
  }

  // Validate and process line items
  const validatedLineItems = [];

  for (const userItem of aggregateTransferLineItems(transferLineItems)) {
    // Validate required fields
    if (!userItem.productCode) {
      return next(new CustomError(400, "Each line item must have productCode"));
    }

    if (userItem.quantity === undefined || userItem.quantity === null) {
      return next(
        new CustomError(400, "Transfer quantity is required for all line items")
      );
    }

    if (typeof userItem.quantity !== "number" || userItem.quantity <= 0) {
      return next(
        new CustomError(
          400,
          "Transfer quantity must be a positive number greater than 0"
        )
      );
    }

    if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
      return next(
        new CustomError(400, "transferUnit is required for all line items")
      );
    }

    // Lookup inventory by productCode
    const inventory = await Inventory.findOne({
      productCode: userItem.productCode.toUpperCase(),
    }).lean();

    if (!inventory) {
      return next(
        new CustomError(
          404,
          `Product with code '${userItem.productCode}' not found`
        )
      );
    }

    const inventoryIdValue = inventory._id;

    let baseQuantity;
    try {
      baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), userItem.quantity);
    } catch (error) {
      return next(new CustomError(400, error.message));
    }


    // Validate based on transfer type
    if (transferSourceType === "GRN") {
      // Fetch GRN again for line item validation
      const grn = await GoodsRecievedNote.findById(sourceId).lean();

      // Find corresponding GRN line item by grnLineItemId or inventoryId
      let grnLineItem = null;
      if (userItem.grnLineItemId) {
        grnLineItem = grn.lineItems.find(
          (item) => item._id.toString() === userItem.grnLineItemId.toString()
        );
      } else if (userItem.batchNumber) {
        grnLineItem = grn.lineItems.find(
          (item) =>
            item.inventoryId.toString() === inventoryIdValue.toString() &&
            item.batchNumber === userItem.batchNumber
        );
      }

      if (!grnLineItem) {
        grnLineItem = grn.lineItems.find(
          (item) => item.inventoryId.toString() === inventoryIdValue.toString()
        );
      }

      if (!grnLineItem) {
        return next(
          new CustomError(
            400,
            `GRN does not contain product with code '${userItem.productCode}'. Please ensure the product exists in the GRN line items.`
          )
        );
      }

      // Calculate available quantity from GRN line item
      const goodQuantity = grnLineItem.goodQuantity || 0;
      const transferredQuantity = grnLineItem.transferredQuantity || 0;
      const availableQuantity = goodQuantity - transferredQuantity;

      // Validate transfer quantity doesn't exceed available quantity
      if (baseQuantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Transfer quantity (${baseQuantity} base units) exceeds available quantity (${availableQuantity}) for product '${userItem.productCode}'. Available quantity = goodQuantity (${goodQuantity}) - transferredQuantity (${transferredQuantity})`
          )
        );
      }

      const batchNumber =
        userItem.batchNumber || grnLineItem.batchNumber || "__LEGACY__";
      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : grnLineItem.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : grnLineItem.manufacturingDate || null;

      // Build validated line item for GRN transfer
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: userItem.quantity,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        grnLineItemId: grnLineItem._id, // Link to GRN line item for tracking
        notes: userItem.notes || null,
      });
    } else if (transferSourceType === "Warehouse") {
      const batchNumber = userItem.batchNumber || "__LEGACY__";

      // Validate warehouse has sufficient stock
      const warehouseStock = await WarehouseStock.findOne({
        inventoryId: inventoryIdValue,
        warehouseId: sourceId,
        batchNumber,
      }).lean();

      if (!warehouseStock) {
        return next(
          new CustomError(
            404,
            `Warehouse stock not found for product '${userItem.productCode}' (batch: ${batchNumber}) in source warehouse`
          )
        );
      }

      const availableQuantity = warehouseStock.quantity || 0;
      if (baseQuantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Transfer quantity (${baseQuantity} base units) exceeds available warehouse stock (${availableQuantity}) for product '${userItem.productCode}' (batch: ${batchNumber})`
          )
        );
      }

      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : warehouseStock.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : warehouseStock.manufacturingDate || null;

      // Build validated line item for Warehouse transfer
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: userItem.quantity,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        notes: userItem.notes || null,
        // No grnLineItemId for Warehouse → Storefront transfers
      });
    }
  }

  // Validate and ensure inventory items exist in destination
  // This ensures we can catch errors early and provide clear error messages
  try {
    if (destinationType === "warehouse") {
      // Ensure inventory items exist in destination warehouse
      for (const lineItem of validatedLineItems) {
        const existingWarehouseStock = await WarehouseStock.findOne({
          inventoryId: lineItem.inventoryId,
          warehouseId: destinationId,
          batchNumber: lineItem.batchNumber || "__LEGACY__",
        });

        if (!existingWarehouseStock) {
          // Create warehouse stock record with quantity 0 if it doesn't exist
          try {
            await WarehouseStock.create({
              inventoryId: lineItem.inventoryId,
              warehouseId: destinationId,
              batchNumber: lineItem.batchNumber || "__LEGACY__",
              expiryDate: lineItem.expiryDate || null,
              manufacturingDate: lineItem.manufacturingDate || null,
              quantity: 0,
            });
          } catch (error) {
            // If duplicate key error (concurrency), ignore, otherwise throw
            if (error.code !== 11000) {
              const inventory = await Inventory.findById(lineItem.inventoryId);
              const productCode = inventory?.productCode || lineItem.inventoryId;
              return next(
                new CustomError(
                  400,
                  `Failed to create inventory record for product '${productCode}' in destination warehouse. ${error.message}`
                )
              );
            }
          }
        }
      }
    } else if (destinationType === "storefront") {
      // Ensure inventory items exist in destination storefront
      for (const lineItem of validatedLineItems) {
        const existingStorefrontInventory = await StorefrontInventory.findOne({
          inventoryId: lineItem.inventoryId,
          storefrontId: destinationId,
          batchNumber: lineItem.batchNumber || "__LEGACY__",
        });

        if (!existingStorefrontInventory) {
          // Create storefront inventory record with quantity 0 if it doesn't exist
          try {
            await StorefrontInventory.create({
              inventoryId: lineItem.inventoryId,
              storefrontId: destinationId,
              batchNumber: lineItem.batchNumber || "__LEGACY__",
              expiryDate: lineItem.expiryDate || null,
              manufacturingDate: lineItem.manufacturingDate || null,
              quantity: 0,
            });
          } catch (error) {
            if (error.code !== 11000) {
              const inventory = await Inventory.findById(lineItem.inventoryId);
              const productCode = inventory?.productCode || lineItem.inventoryId;
              return next(
                new CustomError(
                  400,
                  `Failed to create inventory record for product '${productCode}' in destination storefront. ${error.message}`
                )
              );
            }
          }
        }
      }
    }
  } catch (error) {
    // Catch any unexpected errors during validation
    return next(
      new CustomError(
        500,
        `Error validating destination inventory: ${error.message}`
      )
    );
  }

  // Auto-generate transfer number
  const transferNumber = await Transfer.generateTransferNumber();

  // Use MongoDB transaction to ensure ACID properties
  // Transfer stock immediately when creating transfer document
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create transfer document
    const transferData = {
      transferNumber,
      sourceType: transferSourceType,
      sourceId,
      lineItems: validatedLineItems,
      transferDate: transferDate || new Date(),
      notes: notes || null,
      status: "completed", // Set to completed immediately since we transfer stock now
      transferredBy,
    };

    // Add destination based on destinationType
    if (destinationType === "warehouse") {
      transferData.destinationWarehouseId = destinationId;
    } else if (destinationType === "storefront") {
      transferData.destinationStorefrontId = destinationId;
    }

    // Create transfer document within transaction
    // Note: Transfer.create() with session requires array syntax for transactions
    const newTransferArray = await Transfer.create([transferData], { session });
    const transfer = newTransferArray[0];

    // Immediately transfer stock atomically (handles GRN → Warehouse, GRN → Storefront, and Warehouse → Storefront)
    await transfer.updateStock(session);

    // Set receivedDate since transfer is completed
    transfer.receivedDate = new Date();
    await transfer.save({ session });

    // Commit transaction - all operations succeed or all fail
    await session.commitTransaction();
    await session.endSession();

    // Populate references for response
    if (transferSourceType === "GRN") {
      await transfer.populate("sourceId", "grnNumber status");
      if (transfer.destinationWarehouseId) {
        await transfer.populate(
          "destinationWarehouseId",
          "locationName locationCode"
        );
      }
      if (transfer.destinationStorefrontId) {
        await transfer.populate(
          "destinationStorefrontId",
          "locationName locationCode"
        );
      }
    } else if (transferSourceType === "Warehouse") {
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
    }
    await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");
    await transfer.populate("transferredBy", "name role");

    res.status(201).json({
      success: true,
      message: "Transfer created and stock transferred successfully",
      data: transfer,
    });
  } catch (error) {
    // Rollback transaction on any error
    await session.abortTransaction();
    await session.endSession();
    return next(
      new CustomError(500, `Failed to create transfer: ${error.message}`)
    );
  }
});

// Warehouse → Warehouse Transfer with Batch Tracking
export const transferWarehouseToWarehouse = asyncErrorHandler(
  async (req, res, next) => {
    // Authentication check
    if (!req.user || !req.user._id) {
      return next(
        new CustomError(
          401,
          "Authentication required. Admin account ID is missing."
        )
      );
    }
    const transferredBy = req.user._id;

    const {
      fromLocationId,
      toLocationId,
      lineItems,
      lineitems,
      transferDate,
      notes,
    } = req.body;

    // Support both camelCase and lowercase for lineItems
    const transferLineItems = lineItems || lineitems;

    // Validate required fields
    if (!fromLocationId) {
      return next(new CustomError(400, "fromLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(fromLocationId)) {
      return next(new CustomError(400, "Invalid fromLocationId format"));
    }
    if (!toLocationId) {
      return next(new CustomError(400, "toLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(toLocationId)) {
      return next(new CustomError(400, "Invalid toLocationId format"));
    }
    if (fromLocationId === toLocationId) {
      return next(
        new CustomError(
          400,
          "Source and destination warehouses must be different"
        )
      );
    }

    // Validate lineItems array
    if (
      !transferLineItems ||
      !Array.isArray(transferLineItems) ||
      transferLineItems.length === 0
    ) {
      return next(
        new CustomError(
          400,
          "Line items are required and must be a non-empty array"
        )
      );
    }

    // Requirement 1: batchNumber is strictly required for every item
    for (let i = 0; i < transferLineItems.length; i++) {
      if (
        !transferLineItems[i].batchNumber ||
        typeof transferLineItems[i].batchNumber !== "string" ||
        transferLineItems[i].batchNumber.trim() === ""
      ) {
        return next(
          new CustomError(
            400,
            `batchNumber is required for every line item. Missing or empty batchNumber at item index ${i}.`
          )
        );
      }
    }

    // Validate source warehouse exists
    const sourceWarehouse = await LocationProfile.findOne({
      _id: fromLocationId,
      type: "warehouse",
    });
    if (!sourceWarehouse) {
      return next(new CustomError(404, "Source warehouse not found"));
    }
    if (sourceWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer from a deleted warehouse")
      );
    }

    // Validate destination warehouse exists
    const destinationWarehouse = await LocationProfile.findOne({
      _id: toLocationId,
      type: "warehouse",
    });
    if (!destinationWarehouse) {
      return next(new CustomError(404, "Destination warehouse not found"));
    }
    if (destinationWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to a deleted warehouse")
      );
    }

    // Validate and process line items
    const validatedLineItems = [];

    for (const userItem of aggregateTransferLineItems(transferLineItems)) {
      // Validate required fields
      if (!userItem.productCode) {
        return next(
          new CustomError(400, "Each line item must have productCode")
        );
      }

      if (userItem.quantity === undefined || userItem.quantity === null) {
        return next(
          new CustomError(
            400,
            "Transfer quantity is required for all line items"
          )
        );
      }

      if (typeof userItem.quantity !== "number" || userItem.quantity <= 0) {
        return next(
          new CustomError(
            400,
            "Transfer quantity must be a positive number greater than 0"
          )
        );
      }

    if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
      return next(
        new CustomError(400, "transferUnit is required for all line items")
      );
    }

      // Lookup inventory by productCode
      const inventory = await Inventory.findOne({
        productCode: userItem.productCode.toUpperCase(),
      }).lean();

      if (!inventory) {
        return next(
          new CustomError(
            404,
            `Product with code '${userItem.productCode}' not found`
          )
        );
      }

      const inventoryIdValue = inventory._id;

    let baseQuantity;
    try {
      baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), userItem.quantity);
    } catch (error) {
      return next(new CustomError(400, error.message));
    }

      const batchNumber = userItem.batchNumber.trim();

      // Requirement 2: Validate source warehouse has sufficient stock for this batch
      const warehouseStock = await WarehouseStock.findOne({
        inventoryId: inventoryIdValue,
        warehouseId: fromLocationId,
        batchNumber,
      }).lean();

      if (!warehouseStock) {
        return next(
          new CustomError(
            400,
            `Insufficient stock: No stock record found for product '${userItem.productCode}' with batch '${batchNumber}' in source warehouse`
          )
        );
      }

      const availableQuantity = warehouseStock.quantity || 0;
      if (baseQuantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Insufficient stock for product '${userItem.productCode}' (batch: ${batchNumber}). Requested: ${baseQuantity}, Available: ${availableQuantity}`
          )
        );
      }

      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : warehouseStock.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : warehouseStock.manufacturingDate || null;

      // Build validated line item
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: userItem.quantity,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        notes: userItem.notes || null,
      });
    }

    // Auto-generate transfer number
    const transferNumber = await Transfer.generateTransferNumber();

    // Use MongoDB transaction to ensure ACID properties
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create transfer document
      const transferData = {
        transferNumber,
        sourceType: "Warehouse",
        sourceId: fromLocationId,
        destinationWarehouseId: toLocationId,
        lineItems: validatedLineItems,
        transferDate: transferDate || new Date(),
        notes: notes || null,
        status: "completed",
        transferredBy,
      };

      // Create transfer document within transaction
      const newTransferArray = await Transfer.create([transferData], {
        session,
      });
      const transfer = newTransferArray[0];

      // Requirement 3 & 4: Deduct from source, add to destination (handled by model method)
      await transfer.updateStock(session);

      // Set receivedDate since transfer is completed
      transfer.receivedDate = new Date();
      await transfer.save({ session });

      // Commit transaction - all operations succeed or all fail
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationWarehouseId",
        "locationName locationCode"
      );
      await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");
      await transfer.populate("transferredBy", "name role");

      res.status(201).json({
        success: true,
        message:
          "Warehouse-to-warehouse transfer created and stock transferred successfully",
        data: transfer,
      });
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to create warehouse-to-warehouse transfer: ${error.message}`
        )
      );
    }
  }
);

// Storefront → Warehouse Transfer with Batch Tracking
export const transferStorefrontToWarehouse = asyncErrorHandler(
  async (req, res, next) => {
    // Authentication check
    if (!req.user || !req.user._id) {
      return next(
        new CustomError(
          401,
          "Authentication required. Admin account ID is missing."
        )
      );
    }
    const transferredBy = req.user._id;

    const {
      fromLocationId,
      toLocationId,
      lineItems,
      lineitems,
      transferDate,
      notes,
    } = req.body;

    // Support both camelCase and lowercase for lineItems
    const transferLineItems = lineItems || lineitems;

    // Validate required fields
    if (!fromLocationId) {
      return next(new CustomError(400, "fromLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(fromLocationId)) {
      return next(new CustomError(400, "Invalid fromLocationId format"));
    }
    if (!toLocationId) {
      return next(new CustomError(400, "toLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(toLocationId)) {
      return next(new CustomError(400, "Invalid toLocationId format"));
    }

    // Validate lineItems array
    if (
      !transferLineItems ||
      !Array.isArray(transferLineItems) ||
      transferLineItems.length === 0
    ) {
      return next(
        new CustomError(
          400,
          "Line items are required and must be a non-empty array"
        )
      );
    }

    // batchNumber is strictly required for every item
    for (let i = 0; i < transferLineItems.length; i++) {
      if (
        !transferLineItems[i].batchNumber ||
        typeof transferLineItems[i].batchNumber !== "string" ||
        transferLineItems[i].batchNumber.trim() === ""
      ) {
        return next(
          new CustomError(
            400,
            `batchNumber is required for every line item. Missing or empty batchNumber at item index ${i}.`
          )
        );
      }
    }

    // Validate source storefront exists
    const sourceStorefront = await LocationProfile.findOne({
      _id: fromLocationId,
      type: "storefront",
    });
    if (!sourceStorefront) {
      return next(new CustomError(404, "Source storefront not found"));
    }
    if (sourceStorefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer from a deleted storefront")
      );
    }

    // Validate destination warehouse exists
    const destinationWarehouse = await LocationProfile.findOne({
      _id: toLocationId,
      type: "warehouse",
    });
    if (!destinationWarehouse) {
      return next(new CustomError(404, "Destination warehouse not found"));
    }
    if (destinationWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to a deleted warehouse")
      );
    }

    // Validate and process line items
    const validatedLineItems = [];

    for (const userItem of aggregateTransferLineItems(transferLineItems)) {
      // Validate required fields
      if (!userItem.productCode) {
        return next(
          new CustomError(400, "Each line item must have productCode")
        );
      }

      // Support both 'quantity' and 'transferQuantity' field names
      const qty =
        userItem.transferQuantity !== undefined
          ? userItem.transferQuantity
          : userItem.quantity;

      if (qty === undefined || qty === null) {
        return next(
          new CustomError(
            400,
            "Transfer quantity (quantity or transferQuantity) is required for all line items"
          )
        );
      }

      if (typeof qty !== "number" || qty <= 0) {
        return next(
          new CustomError(
            400,
            "Transfer quantity must be a positive number greater than 0"
          )
        );
      }

      if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
        return next(
          new CustomError(400, "transferUnit is required for all line items")
        );
      }

      // Lookup inventory by productCode
      const inventory = await Inventory.findOne({
        productCode: userItem.productCode.toUpperCase(),
      }).lean();

      if (!inventory) {
        return next(
          new CustomError(
            404,
            `Product with code '${userItem.productCode}' not found`
          )
        );
      }

      const inventoryIdValue = userItem.inventoryId || inventory._id;

      let baseQuantity;
      try {
        baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), qty);
      } catch (error) {
        return next(new CustomError(400, error.message));
      }

      const batchNumber = userItem.batchNumber.trim();

      // Validate source storefront has sufficient stock for this batch
      const storefrontStock = await StorefrontInventory.findOne({
        inventoryId: inventoryIdValue,
        storefrontId: fromLocationId,
        batchNumber,
      }).lean();

      if (!storefrontStock) {
        return next(
          new CustomError(
            400,
            `Insufficient stock: No stock record found for product '${userItem.productCode}' with batch '${batchNumber}' in source storefront`
          )
        );
      }

      const availableQuantity = storefrontStock.quantity || 0;
      if (baseQuantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Insufficient stock for product '${userItem.productCode}' (batch: ${batchNumber}). Requested: ${baseQuantity}, Available: ${availableQuantity}`
          )
        );
      }

      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : storefrontStock.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : storefrontStock.manufacturingDate || null;

      // Build validated line item
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: qty,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        notes: userItem.notes || null,
      });
    }

    // Auto-generate transfer number
    const transferNumber = await Transfer.generateTransferNumber();

    // Use MongoDB transaction to ensure ACID properties
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create transfer document
      const transferData = {
        transferNumber,
        sourceType: "Storefront",
        sourceId: fromLocationId,
        destinationWarehouseId: toLocationId,
        lineItems: validatedLineItems,
        transferDate: transferDate || new Date(),
        notes: notes || null,
        status: "completed",
        transferredBy,
      };

      // Create transfer document within transaction
      const newTransferArray = await Transfer.create([transferData], {
        session,
      });
      const transfer = newTransferArray[0];

      // Deduct from source storefront, add to destination warehouse (handled by model method)
      await transfer.updateStock(session);

      // Set receivedDate since transfer is completed
      transfer.receivedDate = new Date();
      await transfer.save({ session });

      // Commit transaction - all operations succeed or all fail
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationWarehouseId",
        "locationName locationCode"
      );
      await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");
      await transfer.populate("transferredBy", "name role");

      res.status(201).json({
        success: true,
        message:
          "Storefront-to-warehouse transfer created and stock transferred successfully",
        data: transfer,
      });
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to create storefront-to-warehouse transfer: ${error.message}`
        )
      );
    }
  }
);

// Warehouse → Storefront Transfer with Batch Tracking
export const transferWarehouseToStorefront = asyncErrorHandler(
  async (req, res, next) => {
    // Authentication check
    if (!req.user || !req.user._id) {
      return next(
        new CustomError(
          401,
          "Authentication required. Admin account ID is missing."
        )
      );
    }
    const transferredBy = req.user._id;

    const {
      fromLocationId,
      toLocationId,
      lineItems,
      lineitems,
      transferDate,
      notes,
    } = req.body;

    // Support both camelCase and lowercase for lineItems
    const transferLineItems = lineItems || lineitems;

    // Validate required fields
    if (!fromLocationId) {
      return next(new CustomError(400, "fromLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(fromLocationId)) {
      return next(new CustomError(400, "Invalid fromLocationId format"));
    }
    if (!toLocationId) {
      return next(new CustomError(400, "toLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(toLocationId)) {
      return next(new CustomError(400, "Invalid toLocationId format"));
    }

    // Validate lineItems array
    if (
      !transferLineItems ||
      !Array.isArray(transferLineItems) ||
      transferLineItems.length === 0
    ) {
      return next(
        new CustomError(
          400,
          "Line items are required and must be a non-empty array"
        )
      );
    }

    // batchNumber is strictly required for every item
    for (let i = 0; i < transferLineItems.length; i++) {
      if (
        !transferLineItems[i].batchNumber ||
        typeof transferLineItems[i].batchNumber !== "string" ||
        transferLineItems[i].batchNumber.trim() === ""
      ) {
        return next(
          new CustomError(
            400,
            `batchNumber is required for every line item. Missing or empty batchNumber at item index ${i}.`
          )
        );
      }
    }

    // Validate source warehouse exists
    const sourceWarehouse = await LocationProfile.findOne({
      _id: fromLocationId,
      type: "warehouse",
    });
    if (!sourceWarehouse) {
      return next(new CustomError(404, "Source warehouse not found"));
    }
    if (sourceWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer from a deleted warehouse")
      );
    }

    // Validate destination storefront exists
    const destinationStorefront = await LocationProfile.findOne({
      _id: toLocationId,
      type: "storefront",
    });
    if (!destinationStorefront) {
      return next(new CustomError(404, "Destination storefront not found"));
    }
    if (destinationStorefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to a deleted storefront")
      );
    }

    // Validate and process line items
    const validatedLineItems = [];

    for (const userItem of aggregateTransferLineItems(transferLineItems)) {
      // Validate required fields
      if (!userItem.productCode) {
        return next(
          new CustomError(400, "Each line item must have productCode")
        );
      }

      // Support both 'quantity' and 'transferQuantity' field names
      const qty =
        userItem.transferQuantity !== undefined
          ? userItem.transferQuantity
          : userItem.quantity;

      if (qty === undefined || qty === null) {
        return next(
          new CustomError(
            400,
            "Transfer quantity (quantity or transferQuantity) is required for all line items"
          )
        );
      }

      if (typeof qty !== "number" || qty <= 0) {
        return next(
          new CustomError(
            400,
            "Transfer quantity must be a positive number greater than 0"
          )
        );
      }

      if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
        return next(
          new CustomError(400, "transferUnit is required for all line items")
        );
      }

      // Lookup inventory by productCode
      const inventory = await Inventory.findOne({
        productCode: userItem.productCode.toUpperCase(),
      }).lean();

      if (!inventory) {
        return next(
          new CustomError(
            404,
            `Product with code '${userItem.productCode}' not found`
          )
        );
      }

      const inventoryIdValue = userItem.inventoryId || inventory._id;

      let baseQuantity;
      try {
        baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), qty);
      } catch (error) {
        return next(new CustomError(400, error.message));
      }

      const batchNumber = userItem.batchNumber.trim();

      // Validate source warehouse has sufficient stock for this batch
      const warehouseStock = await WarehouseStock.findOne({
        inventoryId: inventoryIdValue,
        warehouseId: fromLocationId,
        batchNumber,
      }).lean();

      if (!warehouseStock) {
        return next(
          new CustomError(
            400,
            `Insufficient stock: No stock record found for product '${userItem.productCode}' with batch '${batchNumber}' in source warehouse`
          )
        );
      }

      const availableQuantity = warehouseStock.quantity || 0;
      if (baseQuantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Insufficient stock for product '${userItem.productCode}' (batch: ${batchNumber}). Requested: ${baseQuantity}, Available: ${availableQuantity}`
          )
        );
      }

      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : warehouseStock.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : warehouseStock.manufacturingDate || null;

      // Build validated line item
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: qty,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        notes: userItem.notes || null,
      });
    }

    // Auto-generate transfer number
    const transferNumber = await Transfer.generateTransferNumber();

    // Use MongoDB transaction to ensure ACID properties
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create transfer document
      const transferData = {
        transferNumber,
        sourceType: "Warehouse",
        sourceId: fromLocationId,
        destinationStorefrontId: toLocationId,
        lineItems: validatedLineItems,
        transferDate: transferDate || new Date(),
        notes: notes || null,
        status: "completed",
        transferredBy,
      };

      // Create transfer document within transaction
      const newTransferArray = await Transfer.create([transferData], {
        session,
      });
      const transfer = newTransferArray[0];

      // Deduct from source warehouse, add to destination storefront (handled by model method)
      await transfer.updateStock(session);

      // Set receivedDate since transfer is completed
      transfer.receivedDate = new Date();
      await transfer.save({ session });

      // Commit transaction - all operations succeed or all fail
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
      await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");
      await transfer.populate("transferredBy", "name role");

      res.status(201).json({
        success: true,
        message:
          "Warehouse-to-storefront transfer created and stock transferred successfully",
        data: transfer,
      });
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to create warehouse-to-storefront transfer: ${error.message}`
        )
      );
    }
  }
);

// Storefront → Storefront Transfer with Batch Tracking
export const transferStorefrontToStorefront = asyncErrorHandler(
  async (req, res, next) => {
    // Authentication check
    if (!req.user || !req.user._id) {
      return next(
        new CustomError(
          401,
          "Authentication required. Admin account ID is missing."
        )
      );
    }
    const transferredBy = req.user._id;

    const {
      fromLocationId,
      toLocationId,
      lineItems,
      lineitems,
      transferDate,
      notes,
    } = req.body;

    // Support both camelCase and lowercase for lineItems
    const transferLineItems = lineItems || lineitems;

    // Validate required fields
    if (!fromLocationId) {
      return next(new CustomError(400, "fromLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(fromLocationId)) {
      return next(new CustomError(400, "Invalid fromLocationId format"));
    }
    if (!toLocationId) {
      return next(new CustomError(400, "toLocationId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(toLocationId)) {
      return next(new CustomError(400, "Invalid toLocationId format"));
    }
    if (fromLocationId === toLocationId) {
      return next(
        new CustomError(
          400,
          "Source and destination storefronts must be different"
        )
      );
    }

    // Validate lineItems array
    if (
      !transferLineItems ||
      !Array.isArray(transferLineItems) ||
      transferLineItems.length === 0
    ) {
      return next(
        new CustomError(
          400,
          "Line items are required and must be a non-empty array"
        )
      );
    }

    // batchNumber is strictly required for every item
    for (let i = 0; i < transferLineItems.length; i++) {
      if (
        !transferLineItems[i].batchNumber ||
        typeof transferLineItems[i].batchNumber !== "string" ||
        transferLineItems[i].batchNumber.trim() === ""
      ) {
        return next(
          new CustomError(
            400,
            `batchNumber is required for every line item. Missing or empty batchNumber at item index ${i}.`
          )
        );
      }
    }

    // Validate source storefront exists
    const sourceStorefront = await LocationProfile.findOne({
      _id: fromLocationId,
      type: "storefront",
    });
    if (!sourceStorefront) {
      return next(new CustomError(404, "Source storefront not found"));
    }
    if (sourceStorefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer from a deleted storefront")
      );
    }

    // Validate destination storefront exists
    const destinationStorefront = await LocationProfile.findOne({
      _id: toLocationId,
      type: "storefront",
    });
    if (!destinationStorefront) {
      return next(new CustomError(404, "Destination storefront not found"));
    }
    if (destinationStorefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to a deleted storefront")
      );
    }

    // Validate and process line items
    const validatedLineItems = [];

    for (const userItem of aggregateTransferLineItems(transferLineItems)) {
      // Validate required fields
      if (!userItem.productCode) {
        return next(
          new CustomError(400, "Each line item must have productCode")
        );
      }

      // Support both 'quantity' and 'transferQuantity' field names
      const qty =
        userItem.transferQuantity !== undefined
          ? userItem.transferQuantity
          : userItem.quantity;

      if (qty === undefined || qty === null) {
        return next(
          new CustomError(
            400,
            "Transfer quantity (quantity or transferQuantity) is required for all line items"
          )
        );
      }

      if (typeof qty !== "number" || qty <= 0) {
        return next(
          new CustomError(
            400,
            "Transfer quantity must be a positive number greater than 0"
          )
        );
      }

      if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
        return next(
          new CustomError(400, "transferUnit is required for all line items")
        );
      }

      // Lookup inventory by productCode
      const inventory = await Inventory.findOne({
        productCode: userItem.productCode.toUpperCase(),
      }).lean();

      if (!inventory) {
        return next(
          new CustomError(
            404,
            `Product with code '${userItem.productCode}' not found`
          )
        );
      }

      const inventoryIdValue = userItem.inventoryId || inventory._id;

      let baseQuantity;
      try {
        baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), qty);
      } catch (error) {
        return next(new CustomError(400, error.message));
      }

      const batchNumber = userItem.batchNumber.trim();

      // Validate source storefront has sufficient stock for this batch
      const storefrontStock = await StorefrontInventory.findOne({
        inventoryId: inventoryIdValue,
        storefrontId: fromLocationId,
        batchNumber,
      }).lean();

      if (!storefrontStock) {
        return next(
          new CustomError(
            400,
            `Insufficient stock: No stock record found for product '${userItem.productCode}' with batch '${batchNumber}' in source storefront`
          )
        );
      }

      // The storefrontStock.quantity may be stored in the product's base unit OR in a
      // raw purchase unit (e.g. Dozens). We must convert it to true base units before
      // comparing against baseQuantity (which is already expressed in base units).
      //
      // We use the product's base UOM and uomConversions to derive the factor for the
      // stock record. If the stock is stored in base units the factor resolves to 1 and
      // the comparison is unchanged; if stored in a higher-order unit (e.g. Dozen=12)
      // it correctly scales up the available quantity.
      const stockBaseUnit = inventory.unitOfMeasure || inventory.uom || "";
      const stockConversions = inventory.uomConversions || [];
      // Determine which unit the storefront stock was recorded in.
      // Storefront stock is stored in whatever unit was used when stock was added.
      // We default to the product's own base unit (factor=1) unless we can detect otherwise.
      // Since StorefrontInventory does not persist the storage unit, we use the product's
      // effective base factor relative to its own base unit — which equals 1 for base-unit
      // storage but allows the admin to configure a default selling/storage unit via
      // uomConversions if needed. To be safe and match the described bug scenario, we
      // apply getEffectiveBaseFactor with the product's unitOfMeasure as both the target
      // and base (giving factor=1), unless a storageUnit is explicitly stored.
      // Per QA bug report: storefrontStock.quantity stores raw unconverted amounts;
      // multiply by the product's base factor to get trueAvailableBaseQuantity.
      const rawAvailableQuantity = storefrontStock.quantity || 0;
      // Compute the factor that converts the raw DB quantity into base units.
      // When stock was stored in the same base unit, this factor is 1.
      // When stock was stored in a higher-order unit (e.g. Dozen), factor = 12.
      // We look for the "default selling unit" or derive from the stockBaseUnit itself.
      // Since no storage-unit metadata is persisted on StorefrontInventory, we infer
      // by checking the product's uomConversions for any conversion that has factor > 1
      // and isDefaultSellingUnit=true, which represents how the stock was originally entered.
      const defaultStorageConversion = stockConversions.find(
        (conv) => conv.isDefaultSellingUnit === true
      );
      const storageUnitName = defaultStorageConversion
        ? defaultStorageConversion.unit
        : stockBaseUnit;
      const storageToBaseFactor = getEffectiveBaseFactor(
        storageUnitName,
        stockConversions,
        stockBaseUnit
      );
      const trueAvailableBaseQuantity = rawAvailableQuantity * storageToBaseFactor;

      if (baseQuantity > trueAvailableBaseQuantity) {
        return next(
          new CustomError(
            400,
            `Insufficient stock for product '${userItem.productCode}' (batch: ${batchNumber}). ` +
            `Requested: ${baseQuantity} ${stockBaseUnit}, Available: ${trueAvailableBaseQuantity} ${stockBaseUnit} ` +
            `(raw DB quantity: ${rawAvailableQuantity}${defaultStorageConversion ? ` ${storageUnitName}` : ""})`
          )
        );
      }

      const expiryDate = userItem.expiryDate
        ? new Date(userItem.expiryDate)
        : storefrontStock.expiryDate || null;
      const manufacturingDate = userItem.manufacturingDate
        ? new Date(userItem.manufacturingDate)
        : storefrontStock.manufacturingDate || null;

      // Build validated line item
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        batchNumber,
        expiryDate,
        manufacturingDate,
        quantity: qty,
        transferUnit: userItem.transferUnit.trim(),
        baseQuantity,
        notes: userItem.notes || null,
      });
    }

    // Auto-generate transfer number
    const transferNumber = await Transfer.generateTransferNumber();

    // Use MongoDB transaction to ensure ACID properties
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create transfer document
      const transferData = {
        transferNumber,
        sourceType: "Storefront",
        sourceId: fromLocationId,
        destinationStorefrontId: toLocationId,
        lineItems: validatedLineItems,
        transferDate: transferDate || new Date(),
        notes: notes || null,
        status: "completed",
        transferredBy,
      };

      // Create transfer document within transaction
      const newTransferArray = await Transfer.create([transferData], {
        session,
      });
      const transfer = newTransferArray[0];

      // Deduct from source storefront, add to destination storefront (handled by model method)
      await transfer.updateStock(session);

      // Set receivedDate since transfer is completed
      transfer.receivedDate = new Date();
      await transfer.save({ session });

      // Commit transaction - all operations succeed or all fail
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
      await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");
      await transfer.populate("transferredBy", "name role");

      res.status(201).json({
        success: true,
        message:
          "Storefront-to-storefront transfer created and stock transferred successfully",
        data: transfer,
      });
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to create storefront-to-storefront transfer: ${error.message}`
        )
      );
    }
  }
);

export const getTransfers = asyncErrorHandler(async (req, res, next) => {
  const transfers = await Transfer.find()
    .populate("transferredBy", "name role")
    .populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions")
    .populate("destinationWarehouseId", "locationName locationCode")
    .populate("destinationStorefrontId", "locationName locationCode")
    .lean();
  if (!transfers) {
    return next(new CustomError(404, "Transfers not found"));
  }
  res.status(200).json({
    success: true,
    message: "Transfers fetched successfully",
    data: transfers,
  });
});

export const getTransferById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const transfer = await Transfer.findById(id)
    .populate("transferredBy", "name role")
    .populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");

  if (!transfer) {
    return next(new CustomError(404, "Transfer not found"));
  }

  // Populate source and destination based on transfer type
  if (transfer.sourceType === "GRN") {
    await transfer.populate("sourceId", "grnNumber status");
    if (transfer.destinationWarehouseId) {
      await transfer.populate(
        "destinationWarehouseId",
        "locationName locationCode"
      );
    }
    if (transfer.destinationStorefrontId) {
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
    }
  } else if (transfer.sourceType === "Warehouse") {
    await transfer.populate("sourceId", "locationName locationCode");
    await transfer.populate(
      "destinationStorefrontId",
      "locationName locationCode"
    );
  }

  res.status(200).json({
    success: true,
    message: "Transfer fetched successfully",
    data: transfer,
  });
});

export const updateTransferStatus = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return next(new CustomError(400, "Status is required"));
    }
    const validStatuses = ["pending", "in-transit", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }

    // Use MongoDB transaction to ensure ACID properties when completing transfer
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatedTransfer = await Transfer.findByIdAndUpdate(
        id,
        { status },
        { new: true, session }
      );

      if (!updatedTransfer) {
        await session.abortTransaction();
        await session.endSession();
        return next(new CustomError(404, "Transfer not found"));
      }

      // When status is "completed", update stock atomically (handles GRN → Warehouse, GRN → Storefront, and Warehouse → Storefront)
      if (status === "completed") {
        await updatedTransfer.updateStock(session);
      }

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response based on transfer type
      if (updatedTransfer.sourceType === "GRN") {
        await updatedTransfer.populate("sourceId", "grnNumber status");
        if (updatedTransfer.destinationWarehouseId) {
          await updatedTransfer.populate(
            "destinationWarehouseId",
            "locationName locationCode"
          );
        }
        if (updatedTransfer.destinationStorefrontId) {
          await updatedTransfer.populate(
            "destinationStorefrontId",
            "locationName locationCode"
          );
        }
      } else if (updatedTransfer.sourceType === "Warehouse") {
        await updatedTransfer.populate("sourceId", "locationName locationCode");
        await updatedTransfer.populate(
          "destinationStorefrontId",
          "locationName locationCode"
        );
      }
      await updatedTransfer.populate(
        "lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions"
      );
      await updatedTransfer.populate("transferredBy", "name role");

      res.status(200).json({
        success: true,
        message: "Transfer status updated successfully",
        data: updatedTransfer,
      });
    } catch (error) {
      // Rollback transaction on error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to update transfer status: ${error.message}`
        )
      );
    }
  }
);
