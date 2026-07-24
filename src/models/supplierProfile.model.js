import mongoose from "mongoose";

const supplierProfileSchema = new mongoose.Schema(
  {
    supplierName: {
      type: String,
      required: true,
    },
    contactNumber: {
      type: String,
      required: true,
    },
    address: {
      street: { type: String, trim: true },
      township: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
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

// Indexes for query performance
supplierProfileSchema.index({ "address.township": 1 });

const SupplierProfile = mongoose.model(
  "SupplierProfile",
  supplierProfileSchema
);

export default SupplierProfile;
