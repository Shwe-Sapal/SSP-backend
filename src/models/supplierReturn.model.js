import mongoose from "mongoose";

const returnItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    productCode: {
      type: String,
      required: [true, "Product code is required"],
      trim: true,
      uppercase: true,
    },
    batchNumber: {
      type: String,
      trim: true,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    unitOfMeasure: {
      type: String,
      trim: true,
      default: "piece",
    },
    quantity: {
      type: Number,
      required: [true, "Return quantity is required"],
      min: [1, "Return quantity must be at least 1"],
    },
    unitCost: {
      type: Number,
      required: [true, "Unit cost is required"],
      min: [0, "Unit cost cannot be negative"],
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
    },
    reason: {
      type: String,
      enum: {
        values: ["grn_bad", "expired", "damaged", "other"],
        message: "Reason must be grn_bad, expired, damaged, or other",
      },
      required: [true, "Return reason is required"],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: null,
    },
    grnLineItemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    stockRecordId: {
      type: mongoose.Schema.Types.ObjectId,
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

const exchangeItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    productCode: {
      type: String,
      required: [true, "Product code is required"],
      trim: true,
      uppercase: true,
    },
    quantity: {
      type: Number,
      required: [true, "Exchange quantity is required"],
      min: [1, "Exchange quantity must be at least 1"],
    },
    batchNumber: {
      type: String,
      required: [true, "Batch number is required"],
      trim: true,
      default: "__DEFAULT__",
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    destinationWarehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      required: [true, "Destination warehouse is required"],
    },
    receivedDate: {
      type: Date,
      default: Date.now,
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

const supplierReturnSchema = new mongoose.Schema(
  {
    returnNumber: {
      type: String,
      required: [true, "Return number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierProfile",
      required: [true, "Supplier is required"],
    },
    sourceType: {
      type: String,
      enum: {
        values: ["grn", "warehouse", "storefront"],
        message: "Source type must be grn, warehouse, or storefront",
      },
      required: [true, "Source type is required"],
    },
    sourceGrnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodsRecievedNote",
      default: null,
    },
    sourceLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
    },
    items: {
      type: [returnItemSchema],
      required: [true, "Return items are required"],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "At least one item is required for return",
      },
    },
    totalReturnAmount: {
      type: Number,
      required: [true, "Total return amount is required"],
      min: [0, "Total return amount cannot be negative"],
    },
    settlementType: {
      type: String,
      enum: {
        values: ["pending", "cash_refund", "exchange_product", "debt_deduction", "mixed"],
        message: "Settlement type must be pending, cash_refund, exchange_product, debt_deduction, or mixed",
      },
      default: "pending",
    },
    refundDetails: {
      refundAmount: {
        type: Number,
        default: 0,
        min: [0, "Refund amount cannot be negative"],
      },
      paymentMethod: {
        type: String,
        enum: ["cash", "kpay", "wave", "ayapay", "bank_transfer", "other"],
        default: "cash",
      },
      receivedAt: {
        type: Date,
        default: null,
      },
      notes: {
        type: String,
        trim: true,
        default: null,
      },
    },
    exchangeItems: {
      type: [exchangeItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "approved", "completed", "cancelled"],
        message: "Status must be pending, approved, completed, or cancelled",
      },
      default: "pending",
    },
    handledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Handled by admin is required"],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
      default: "No notes provided",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for total items count
supplierReturnSchema.virtual("totalItemsCount").get(function () {
  return this.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
});

// Static helper to generate return number: RET-YYYY-MM-DD-NNNNNN
supplierReturnSchema.statics.generateReturnNumber = async function () {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `RET-${year}-${month}-${day}-`;

  const latestReturn = await this.findOne({
    returnNumber: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  })
    .sort({ createdAt: -1 })
    .select("returnNumber");

  let sequence = 1;
  if (latestReturn && latestReturn.returnNumber) {
    const parts = latestReturn.returnNumber.split("-");
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  return `${prefix}${String(sequence).padStart(6, "0")}`;
};

// Indexes
supplierReturnSchema.index({ returnNumber: 1 });
supplierReturnSchema.index({ supplierId: 1 });
supplierReturnSchema.index({ status: 1 });
supplierReturnSchema.index({ sourceType: 1 });
supplierReturnSchema.index({ createdAt: -1 });
supplierReturnSchema.index({ isDeleted: 1 });

// High-performance compound indexes for returns reports
supplierReturnSchema.index({ supplierId: 1, isDeleted: 1, createdAt: -1 });
supplierReturnSchema.index({ isDeleted: 1, createdAt: -1 });

const SupplierReturn = mongoose.model("SupplierReturn", supplierReturnSchema);

export default SupplierReturn;
