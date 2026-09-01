import mongoose from "mongoose";
import { getEffectiveBaseFactor } from "../utils/uom.utils.js";

// Transfer Line Item Schema
const transferLineItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    batchNumber: {
      type: String,
      trim: true,
      default: "__LEGACY__",
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    manufacturingDate: {
      type: Date,
      default: null,
    },
    quantity: {
      type: Number,
      required: [true, "Transfer quantity is required"],
      min: [0, "Transfer quantity cannot be negative"],
    },
    transferUnit: {
      type: String,
      required: [true, "Transfer unit is required"],
    },
    baseQuantity: {
      type: Number,
      required: [true, "Base quantity is required"],
      min: [0.000001, "Base quantity must be strictly greater than 0"],
    },
    // Optional reference to GRN line item if source is GRN
    grnLineItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodsRecievedNote.lineItems",
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: null,
    },
  },
  {
    _id: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Main Transfer Schema
const transferSchema = new mongoose.Schema(
  {
    transferNumber: {
      type: String,
      required: [true, "Transfer number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    sourceType: {
      type: String,
      enum: {
        values: ["GRN", "Warehouse", "Storefront"],
        message: "Source type must be GRN, Warehouse, or Storefront",
      },
      required: [true, "Source type is required"],
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Source ID is required"],
      // Dynamic reference based on sourceType
      // If sourceType is "GRN", this references GoodsRecievedNote
      // If sourceType is "Warehouse", this references LocationProfile (type: "warehouse")
      // If sourceType is "Storefront", this references LocationProfile (type: "storefront")
    },
    destinationWarehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
      // Required when sourceType is "GRN" and destination is Warehouse
      // Optional otherwise
    },
    destinationStorefrontId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
      // Required when sourceType is "Warehouse" OR when sourceType is "GRN" and destination is Storefront
      // Optional otherwise
    },
    lineItems: {
      type: [transferLineItemSchema],
      required: [true, "Line items are required"],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "At least one line item is required",
      },
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "in-transit", "completed", "cancelled"],
        message: "Status must be pending, in-transit, completed, or cancelled",
      },
      default: "pending",
    },
    transferDate: {
      type: Date,
      required: [true, "Transfer date is required"],
      default: Date.now,
    },
    receivedDate: {
      type: Date,
      default: null,
      // Set when status changes to "completed"
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    transferredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Transferred by is required"],
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Pre-save validation: Ensure correct destination based on sourceType
transferSchema.pre("save", async function () {
  if (this.sourceType === "GRN") {
    if (!this.destinationWarehouseId && !this.destinationStorefrontId) {
      throw new Error(
        "Either destinationWarehouseId or destinationStorefrontId is required when sourceType is 'GRN'"
      );
    }
    if (this.destinationWarehouseId && this.destinationStorefrontId) {
      throw new Error(
        "Cannot specify both destinationWarehouseId and destinationStorefrontId"
      );
    }
  } else if (this.sourceType === "Warehouse") {
    if (!this.destinationStorefrontId && !this.destinationWarehouseId) {
      throw new Error(
        "Either destinationStorefrontId or destinationWarehouseId is required when sourceType is 'Warehouse'"
      );
    }
    if (this.destinationStorefrontId && this.destinationWarehouseId) {
      throw new Error(
        "Cannot specify both destinationStorefrontId and destinationWarehouseId for Warehouse transfers"
      );
    }
  } else if (this.sourceType === "Storefront") {
    if (!this.destinationWarehouseId && !this.destinationStorefrontId) {
      throw new Error(
        "Either destinationWarehouseId or destinationStorefrontId is required when sourceType is 'Storefront'"
      );
    }
    if (this.destinationWarehouseId && this.destinationStorefrontId) {
      throw new Error(
        "Cannot specify both destinationWarehouseId and destinationStorefrontId for Storefront transfers"
      );
    }
  }
});

// Indexes for better query performance
// Note: transferNumber already has an index from unique: true
transferSchema.index({ sourceType: 1, sourceId: 1 });
transferSchema.index({ destinationWarehouseId: 1 });
transferSchema.index({ destinationStorefrontId: 1 });
transferSchema.index({ status: 1 });
transferSchema.index({ transferDate: 1 });
transferSchema.index({ isDeleted: 1 });
transferSchema.index({ status: 1, isDeleted: 1 }); // Compound index
transferSchema.index({ sourceType: 1, sourceId: 1, status: 1 }); // Compound index for GRN/Warehouse queries
transferSchema.index({ sourceType: 1, destinationStorefrontId: 1 }); // For Warehouse → Storefront queries
transferSchema.index({ transferredBy: 1 }); // Index for admin who created the transfer

// Virtual for total transfer quantity
transferSchema.virtual("totalQuantity").get(function () {
  return this.lineItems.reduce((sum, item) => sum + item.baseQuantity, 0);
});

// Static method to generate transfer number
transferSchema.statics.generateTransferNumber = async function () {
  const year = new Date().getFullYear();
  const prefix = `TRF-${year}-`;

  // Find the latest transfer for this year (excluding deleted)
  const latestTransfer = await this.findOne({
    transferNumber: new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    ),
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select("transferNumber");

  let sequence = 1;
  if (latestTransfer && latestTransfer.transferNumber) {
    // Extract sequence number from format: TRF-YYYY-NNNN
    const parts = latestTransfer.transferNumber.split("-");
    if (parts.length === 3) {
      const latestSequence = parseInt(parts[2], 10);
      if (!isNaN(latestSequence)) {
        sequence = latestSequence + 1;
      }
    }
  }

  // Format: TRF-YYYY-NNNN (e.g., TRF-2024-0001)
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

// Instance method to update stock atomically (call when transfer is completed)
// Uses MongoDB transactions to ensure ACID properties for consistent tracking:
// For GRN → Warehouse: Updates GRN transferredQuantity + WarehouseStock
// For GRN → Storefront: Updates GRN transferredQuantity + StorefrontInventory
// For Warehouse → Storefront: Updates WarehouseStock + StorefrontInventory
// All operations succeed or all fail (ACID guarantee)
transferSchema.methods.updateStock = async function (session = null) {
  if (this.status !== "completed") {
    throw new Error("Transfer must be completed before updating stock");
  }

  // Validate destination based on sourceType
  if (this.sourceType === "GRN") {
    if (!this.destinationWarehouseId && !this.destinationStorefrontId) {
      throw new Error(
        "GRN transfers require destinationWarehouseId or destinationStorefrontId"
      );
    }
  }

  if (
    this.sourceType === "Warehouse" &&
    !this.destinationStorefrontId &&
    !this.destinationWarehouseId
  ) {
    throw new Error(
      "Warehouse transfers require destinationStorefrontId or destinationWarehouseId"
    );
  }

  // Handle GRN transfers (to Warehouse or Storefront)
  if (this.sourceType === "GRN") {
    if (this.destinationWarehouseId) {
      await this._updateGRNToWarehouseStock(session);
    } else if (this.destinationStorefrontId) {
      await this._updateGRNToStorefrontStock(session);
    }
  }
  // Handle Warehouse transfers (to Storefront or Warehouse)
  else if (this.sourceType === "Warehouse") {
    if (this.destinationWarehouseId) {
      await this._updateWarehouseToWarehouseStock(session);
    } else if (this.destinationStorefrontId) {
      await this._updateWarehouseToStorefrontStock(session);
    }
  }
  // Handle Storefront transfers (to Warehouse or Storefront)
  else if (this.sourceType === "Storefront") {
    if (this.destinationWarehouseId) {
      await this._updateStorefrontToWarehouseStock(session);
    } else if (this.destinationStorefrontId) {
      await this._updateStorefrontToStorefrontStock(session);
    } else {
      throw new Error(
        "Storefront transfers require destinationWarehouseId or destinationStorefrontId"
      );
    }
  }
};

// Private method: Handle GRN → Warehouse stock updates
transferSchema.methods._updateGRNToWarehouseStock = async function (
  session = null
) {
  const WarehouseStock = mongoose.model("WarehouseStock");
  const GoodsRecievedNote = mongoose.model("GoodsRecievedNote");
  const Inventory = mongoose.model("Inventory");

  const grn = await GoodsRecievedNote.findById(this.sourceId).session(session || null);
  if (!grn) throw new Error(`GRN with ID ${this.sourceId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedDestOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    let grnLineItem = null;
    let grnLineItemIndex = -1;
    if (transferItem.grnLineItemId) {
      grnLineItem = grn.lineItems.id(transferItem.grnLineItemId);
      if (grnLineItem) {
        grnLineItemIndex = grn.lineItems.findIndex(
          (item) => item._id.toString() === transferItem.grnLineItemId.toString()
        );
      }
    } else {
      grnLineItemIndex = grn.lineItems.findIndex(
        (item) => item.inventoryId.toString() === transferItem.inventoryId.toString()
      );
      if (grnLineItemIndex !== -1) {
        grnLineItem = grn.lineItems[grnLineItemIndex];
      }
    }

    if (!grnLineItem || grnLineItemIndex === -1) {
      throw new Error(`GRN line item not found for inventory ${transferItem.inventoryId}`);
    }

    const availableQty = grnLineItem.goodQuantity - (grnLineItem.transferredQuantity || 0);
    if (trueBaseQty > availableQty) {
      throw new Error(`Transfer quantity (${trueBaseQty}) exceeds available quantity (${availableQty}) for inventory ${transferItem.inventoryId}`);
    }

    const grnUpdateResult = await GoodsRecievedNote.findOneAndUpdate(
      { _id: this.sourceId, "lineItems._id": grnLineItem._id },
      { $inc: { [`lineItems.$.transferredQuantity`]: trueBaseQty } },
      { new: true, session }
    );

    if (!grnUpdateResult) {
      throw new Error(`GRN line item with ID ${grnLineItem._id} not found.`);
    }

    const destKey = transferItem.inventoryId.toString();
    if (aggregatedDestOps.has(destKey)) {
      aggregatedDestOps.get(destKey).trueBaseQty += trueBaseQty;
    } else {
      aggregatedDestOps.set(destKey, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || grnLineItem?.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || grnLineItem?.manufacturingDate || null
      });
    }
  }

  const destOps = Array.from(aggregatedDestOps.values()).map(item => ({
    updateOne: {
      filter: { 
        inventoryId: item.inventoryId,
        warehouseId: this.destinationWarehouseId
      },
      update: {
        $inc: { quantity: item.trueBaseQty },
        $set: { lastUpdated: new Date() },
        $setOnInsert: {
          inventoryId: item.inventoryId,
          warehouseId: this.destinationWarehouseId,
          batchNumber: "__LEGACY__",
          expiryDate: item.expiryDate,
          manufacturingDate: item.manufacturingDate
        }
      },
      upsert: true
    }
  }));

  if (destOps.length > 0) {
    await WarehouseStock.bulkWrite(destOps, { session });
  }
};

// Private method: Handle GRN → Storefront stock updates
transferSchema.methods._updateGRNToStorefrontStock = async function (
  session = null
) {
  const StorefrontInventory = mongoose.model("StorefrontInventory");
  const GoodsRecievedNote = mongoose.model("GoodsRecievedNote");
  const Inventory = mongoose.model("Inventory");

  const grn = await GoodsRecievedNote.findById(this.sourceId).session(session || null);
  if (!grn) throw new Error(`GRN with ID ${this.sourceId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedDestOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    let grnLineItem = null;
    let grnLineItemIndex = -1;
    if (transferItem.grnLineItemId) {
      grnLineItem = grn.lineItems.id(transferItem.grnLineItemId);
      if (grnLineItem) {
        grnLineItemIndex = grn.lineItems.findIndex(
          (item) => item._id.toString() === transferItem.grnLineItemId.toString()
        );
      }
    } else {
      grnLineItemIndex = grn.lineItems.findIndex(
        (item) => item.inventoryId.toString() === transferItem.inventoryId.toString()
      );
      if (grnLineItemIndex !== -1) {
        grnLineItem = grn.lineItems[grnLineItemIndex];
      }
    }

    if (!grnLineItem || grnLineItemIndex === -1) {
      throw new Error(`GRN line item not found for inventory ${transferItem.inventoryId}`);
    }

    const availableQty = grnLineItem.goodQuantity - (grnLineItem.transferredQuantity || 0);
    if (trueBaseQty > availableQty) {
      throw new Error(`Transfer quantity (${trueBaseQty}) exceeds available quantity (${availableQty}) for inventory ${transferItem.inventoryId}`);
    }

    const grnUpdateResult = await GoodsRecievedNote.findOneAndUpdate(
      { _id: this.sourceId, "lineItems._id": grnLineItem._id },
      { $inc: { [`lineItems.$.transferredQuantity`]: trueBaseQty } },
      { new: true, session }
    );

    if (!grnUpdateResult) {
      throw new Error(`GRN line item with ID ${grnLineItem._id} not found.`);
    }

    const destKey = transferItem.inventoryId.toString();
    if (aggregatedDestOps.has(destKey)) {
      aggregatedDestOps.get(destKey).trueBaseQty += trueBaseQty;
    } else {
      aggregatedDestOps.set(destKey, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || grnLineItem?.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || grnLineItem?.manufacturingDate || null
      });
    }
  }

  const destOps = Array.from(aggregatedDestOps.values()).map(item => ({
    updateOne: {
      filter: { 
        inventoryId: item.inventoryId,
        storefrontId: this.destinationStorefrontId
      },
      update: {
        $inc: { quantity: item.trueBaseQty },
        $set: { lastUpdated: new Date() },
        $setOnInsert: {
          inventoryId: item.inventoryId,
          storefrontId: this.destinationStorefrontId,
          batchNumber: "__LEGACY__",
          expiryDate: item.expiryDate,
          manufacturingDate: item.manufacturingDate
        }
      },
      upsert: true
    }
  }));

  if (destOps.length > 0) {
    await StorefrontInventory.bulkWrite(destOps, { session });
  }
};

// Private method: Handle Warehouse → Storefront stock updates
transferSchema.methods._updateWarehouseToStorefrontStock = async function (
  session = null
) {
  const WarehouseStock = mongoose.model("WarehouseStock");
  const StorefrontInventory = mongoose.model("StorefrontInventory");
  const LocationProfile = mongoose.model("LocationProfile");
  const Inventory = mongoose.model("Inventory");

  const sourceLocation = await LocationProfile.findOne({ _id: this.sourceId, type: "warehouse" }).session(session || null);
  if (!sourceLocation) throw new Error(`Source location with ID ${this.sourceId} not found`);

  const destLocation = await LocationProfile.findOne({ _id: this.destinationStorefrontId, type: "storefront" }).session(session || null);
  if (!destLocation) throw new Error(`Destination location with ID ${this.destinationStorefrontId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    const key = transferItem.inventoryId.toString();
    if (aggregatedOps.has(key)) {
      aggregatedOps.get(key).trueBaseQty += trueBaseQty;
    } else {
      aggregatedOps.set(key, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || null
      });
    }
  }

  const itemsToTransfer = Array.from(aggregatedOps.values());
  const srcOps = [];
  const destOps = [];

  for (const item of itemsToTransfer) {
    // Since we ignore batchNumber, we just find the FIRST stock record to deduct from.
    // If they want exactly ONE total sum per product, we decrement the legacy batch.
    const sourceStock = await WarehouseStock.findOne({
      inventoryId: item.inventoryId,
      warehouseId: this.sourceId
    }).session(session || null);

    if (!sourceStock) {
      throw new Error(`Source stock not found for inventory ${item.inventoryId}`);
    }

    if (item.trueBaseQty > (sourceStock.quantity || 0)) {
      throw new Error(`Transfer quantity (${item.trueBaseQty}) exceeds available stock (${sourceStock.quantity}) for inventory ${item.inventoryId}`);
    }

    srcOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, warehouseId: this.sourceId, batchNumber: sourceStock.batchNumber },
        update: { $inc: { quantity: -item.trueBaseQty }, $set: { lastUpdated: new Date() } }
      }
    });

    destOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, storefrontId: this.destinationStorefrontId },
        update: {
          $inc: { quantity: item.trueBaseQty },
          $set: { lastUpdated: new Date() },
          $setOnInsert: {
            inventoryId: item.inventoryId,
            storefrontId: this.destinationStorefrontId,
            batchNumber: "__LEGACY__",
            expiryDate: item.expiryDate || sourceStock.expiryDate || null,
            manufacturingDate: item.manufacturingDate || sourceStock.manufacturingDate || null
          }
        },
        upsert: true
      }
    });
  }

  if (srcOps.length > 0) {
    await WarehouseStock.bulkWrite(srcOps, { session });
  }
  if (destOps.length > 0) {
    await StorefrontInventory.bulkWrite(destOps, { session });
  }
};

// Private method: Handle Warehouse → Warehouse stock updates
transferSchema.methods._updateWarehouseToWarehouseStock = async function (
  session = null
) {
  const WarehouseStock = mongoose.model("WarehouseStock");
  const LocationProfile = mongoose.model("LocationProfile");
  const Inventory = mongoose.model("Inventory");

  const sourceLocation = await LocationProfile.findOne({ _id: this.sourceId, type: "warehouse" }).session(session || null);
  if (!sourceLocation) throw new Error(`Source location with ID ${this.sourceId} not found`);

  const destLocation = await LocationProfile.findOne({ _id: this.destinationWarehouseId, type: "warehouse" }).session(session || null);
  if (!destLocation) throw new Error(`Destination location with ID ${this.destinationWarehouseId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    const key = transferItem.inventoryId.toString();
    if (aggregatedOps.has(key)) {
      aggregatedOps.get(key).trueBaseQty += trueBaseQty;
    } else {
      aggregatedOps.set(key, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || null
      });
    }
  }

  const itemsToTransfer = Array.from(aggregatedOps.values());
  const srcOps = [];
  const destOps = [];

  for (const item of itemsToTransfer) {
    // Since we ignore batchNumber, we just find the FIRST stock record to deduct from.
    // If they want exactly ONE total sum per product, we decrement the legacy batch.
    const sourceStock = await WarehouseStock.findOne({
      inventoryId: item.inventoryId,
      warehouseId: this.sourceId
    }).session(session || null);

    if (!sourceStock) {
      throw new Error(`Source stock not found for inventory ${item.inventoryId}`);
    }

    if (item.trueBaseQty > (sourceStock.quantity || 0)) {
      throw new Error(`Transfer quantity (${item.trueBaseQty}) exceeds available stock (${sourceStock.quantity}) for inventory ${item.inventoryId}`);
    }

    srcOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, warehouseId: this.sourceId, batchNumber: sourceStock.batchNumber },
        update: { $inc: { quantity: -item.trueBaseQty }, $set: { lastUpdated: new Date() } }
      }
    });

    destOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, warehouseId: this.destinationWarehouseId },
        update: {
          $inc: { quantity: item.trueBaseQty },
          $set: { lastUpdated: new Date() },
          $setOnInsert: {
            inventoryId: item.inventoryId,
            warehouseId: this.destinationWarehouseId,
            batchNumber: "__LEGACY__",
            expiryDate: item.expiryDate || sourceStock.expiryDate || null,
            manufacturingDate: item.manufacturingDate || sourceStock.manufacturingDate || null
          }
        },
        upsert: true
      }
    });
  }

  if (srcOps.length > 0) {
    await WarehouseStock.bulkWrite(srcOps, { session });
  }
  if (destOps.length > 0) {
    await WarehouseStock.bulkWrite(destOps, { session });
  }
};

// Private method: Handle Storefront → Warehouse stock updates
transferSchema.methods._updateStorefrontToWarehouseStock = async function (
  session = null
) {
  const StorefrontInventory = mongoose.model("StorefrontInventory");
  const WarehouseStock = mongoose.model("WarehouseStock");
  const LocationProfile = mongoose.model("LocationProfile");
  const Inventory = mongoose.model("Inventory");

  const sourceLocation = await LocationProfile.findOne({ _id: this.sourceId, type: "storefront" }).session(session || null);
  if (!sourceLocation) throw new Error(`Source location with ID ${this.sourceId} not found`);

  const destLocation = await LocationProfile.findOne({ _id: this.destinationWarehouseId, type: "warehouse" }).session(session || null);
  if (!destLocation) throw new Error(`Destination location with ID ${this.destinationWarehouseId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    const key = transferItem.inventoryId.toString();
    if (aggregatedOps.has(key)) {
      aggregatedOps.get(key).trueBaseQty += trueBaseQty;
    } else {
      aggregatedOps.set(key, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || null
      });
    }
  }

  const itemsToTransfer = Array.from(aggregatedOps.values());
  const srcOps = [];
  const destOps = [];

  for (const item of itemsToTransfer) {
    // Since we ignore batchNumber, we just find the FIRST stock record to deduct from.
    // If they want exactly ONE total sum per product, we decrement the legacy batch.
    const sourceStock = await StorefrontInventory.findOne({
      inventoryId: item.inventoryId,
      storefrontId: this.sourceId
    }).session(session || null);

    if (!sourceStock) {
      throw new Error(`Source stock not found for inventory ${item.inventoryId}`);
    }

    if (item.trueBaseQty > (sourceStock.quantity || 0)) {
      throw new Error(`Transfer quantity (${item.trueBaseQty}) exceeds available stock (${sourceStock.quantity}) for inventory ${item.inventoryId}`);
    }

    srcOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, storefrontId: this.sourceId, batchNumber: sourceStock.batchNumber },
        update: { $inc: { quantity: -item.trueBaseQty }, $set: { lastUpdated: new Date() } }
      }
    });

    destOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, warehouseId: this.destinationWarehouseId },
        update: {
          $inc: { quantity: item.trueBaseQty },
          $set: { lastUpdated: new Date() },
          $setOnInsert: {
            inventoryId: item.inventoryId,
            warehouseId: this.destinationWarehouseId,
            batchNumber: "__LEGACY__",
            expiryDate: item.expiryDate || sourceStock.expiryDate || null,
            manufacturingDate: item.manufacturingDate || sourceStock.manufacturingDate || null
          }
        },
        upsert: true
      }
    });
  }

  if (srcOps.length > 0) {
    await StorefrontInventory.bulkWrite(srcOps, { session });
  }
  if (destOps.length > 0) {
    await WarehouseStock.bulkWrite(destOps, { session });
  }
};

// Private method: Handle Storefront → Storefront stock updates
transferSchema.methods._updateStorefrontToStorefrontStock = async function (
  session = null
) {
  const StorefrontInventory = mongoose.model("StorefrontInventory");
  const LocationProfile = mongoose.model("LocationProfile");
  const Inventory = mongoose.model("Inventory");

  const sourceLocation = await LocationProfile.findOne({ _id: this.sourceId, type: "storefront" }).session(session || null);
  if (!sourceLocation) throw new Error(`Source location with ID ${this.sourceId} not found`);

  const destLocation = await LocationProfile.findOne({ _id: this.destinationStorefrontId, type: "storefront" }).session(session || null);
  if (!destLocation) throw new Error(`Destination location with ID ${this.destinationStorefrontId} not found`);

  const inventoryIds = [...new Set(this.lineItems.map(item => item.inventoryId.toString()))];
  const products = await Inventory.find({ _id: { $in: inventoryIds } }).lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const aggregatedOps = new Map();

  for (const transferItem of this.lineItems) {
    if (transferItem.quantity <= 0) continue;

    const product = productMap.get(transferItem.inventoryId.toString());
    const baseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const conversions = product ? (product.uomConversions || []) : [];
    const effectiveFactor = getEffectiveBaseFactor(transferItem.transferUnit, conversions, baseUnit);
    
    const trueBaseQty = transferItem.quantity * effectiveFactor;
    if (trueBaseQty <= 0) continue;

    const key = transferItem.inventoryId.toString();
    if (aggregatedOps.has(key)) {
      aggregatedOps.get(key).trueBaseQty += trueBaseQty;
    } else {
      aggregatedOps.set(key, {
        inventoryId: transferItem.inventoryId,
        trueBaseQty: trueBaseQty,
        expiryDate: transferItem.expiryDate || null,
        manufacturingDate: transferItem.manufacturingDate || null
      });
    }
  }

  const itemsToTransfer = Array.from(aggregatedOps.values());
  const srcOps = [];
  const destOps = [];

  for (const item of itemsToTransfer) {
    // Since we ignore batchNumber, we just find the FIRST stock record to deduct from.
    // If they want exactly ONE total sum per product, we decrement the legacy batch.
    const sourceStock = await StorefrontInventory.findOne({
      inventoryId: item.inventoryId,
      storefrontId: this.sourceId
    }).session(session || null);

    if (!sourceStock) {
      throw new Error(`Source stock not found for inventory ${item.inventoryId}`);
    }

    // -------------------------------------------------------------------------
    // UOM-aware stock validation
    // -------------------------------------------------------------------------
    // `item.trueBaseQty` is already expressed in the product's base unit.
    // `sourceStock.quantity` may be stored as a raw amount in a higher-order unit
    // (e.g. 11 Dozens instead of 132 pieces). We must convert it to true base
    // units before comparing to avoid false "insufficient stock" errors.
    //
    // We derive the storageToBaseFactor by inspecting the product's UOM conversions:
    //   • If the product has a default selling/storage unit (isDefaultSellingUnit=true),
    //     we use that unit's factor as the raw-to-base multiplier.
    //   • Otherwise we assume the DB stores base units (factor = 1).
    const product = productMap.get(item.inventoryId.toString());
    const productBaseUnit = product ? (product.unitOfMeasure || product.uom || "") : "";
    const productConversions = product ? (product.uomConversions || []) : [];

    const defaultStorageConversion = productConversions.find(
      (conv) => conv.isDefaultSellingUnit === true
    );
    const storageUnitName = defaultStorageConversion
      ? defaultStorageConversion.unit
      : productBaseUnit;
    const storageToBaseFactor = getEffectiveBaseFactor(
      storageUnitName,
      productConversions,
      productBaseUnit
    );

    const rawAvailableQty = sourceStock.quantity || 0;
    const trueAvailableBaseQty = rawAvailableQty * storageToBaseFactor;

    if (item.trueBaseQty > trueAvailableBaseQty) {
      throw new Error(
        `Transfer quantity (${item.trueBaseQty} ${productBaseUnit}) exceeds available stock ` +
        `(${trueAvailableBaseQty} ${productBaseUnit}, raw DB: ${rawAvailableQty}${defaultStorageConversion ? ` ${storageUnitName}` : ""}) ` +
        `for inventory ${item.inventoryId}`
      );
    }

    // Compute how many raw storage units to deduct from the source record.
    // If stored in base units (factor=1), rawDeduction === trueBaseQty.
    // If stored in dozens (factor=12), rawDeduction = trueBaseQty / 12.
    const rawDeduction = storageToBaseFactor > 1
      ? item.trueBaseQty / storageToBaseFactor
      : item.trueBaseQty;

    srcOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, storefrontId: this.sourceId, batchNumber: sourceStock.batchNumber },
        update: { $inc: { quantity: -rawDeduction }, $set: { lastUpdated: new Date() } }
      }
    });

    // The destination receives `trueBaseQty` expressed in the SAME storage unit
    // as the destination's existing records. Convert back to raw storage units.
    const rawAddition = storageToBaseFactor > 1
      ? item.trueBaseQty / storageToBaseFactor
      : item.trueBaseQty;

    destOps.push({
      updateOne: {
        filter: { inventoryId: item.inventoryId, storefrontId: this.destinationStorefrontId },
        update: {
          $inc: { quantity: rawAddition },
          $set: { lastUpdated: new Date() },
          $setOnInsert: {
            inventoryId: item.inventoryId,
            storefrontId: this.destinationStorefrontId,
            batchNumber: "__LEGACY__",
            expiryDate: item.expiryDate || sourceStock.expiryDate || null,
            manufacturingDate: item.manufacturingDate || sourceStock.manufacturingDate || null
          }
        },
        upsert: true
      }
    });
  }

  if (srcOps.length > 0) {
    await StorefrontInventory.bulkWrite(srcOps, { session });
  }
  if (destOps.length > 0) {
    await StorefrontInventory.bulkWrite(destOps, { session });
  }
};

// Backward compatibility: Keep old method name that calls new method
transferSchema.methods.updateWarehouseStock = async function (session = null) {
  return this.updateStock(session);
};

const Transfer = mongoose.model("Transfer", transferSchema);

export default Transfer;
