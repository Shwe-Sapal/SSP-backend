import mongoose from "mongoose";

const supplierPaymentSchema = new mongoose.Schema(
  {
    purchasingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchasing",
      required: [true, "Purchasing ID is required"],
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierProfile",
    },
    paidAmount: {
      type: Number,
      required: [true, "Paid amount is required"],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      default: "cash",
    },
    notes: {
      type: String,
      trim: true,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Added by is required"],
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
  }
);

// Add necessary indexes
supplierPaymentSchema.index({ purchasingId: 1 });
supplierPaymentSchema.index({ supplierId: 1 });
supplierPaymentSchema.index({ paymentDate: -1 });
supplierPaymentSchema.index({ isDeleted: 1 });

const SupplierPayment = mongoose.model("SupplierPayment", supplierPaymentSchema);

export default SupplierPayment;
