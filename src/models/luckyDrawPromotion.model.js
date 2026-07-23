import mongoose from "mongoose";

const luckyDrawPromotionSchema = new mongoose.Schema(
  {
    promotionName: {
      type: String,
      required: [true, "Promotion name is required"],
      trim: true,
      maxlength: [200, "Promotion name cannot exceed 200 characters"],
    },
    ticketName: {
      type: String,
      required: [true, "Ticket name is required"],
      trim: true,
      maxlength: [200, "Ticket name cannot exceed 200 characters"],
    },
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    redemptionPrice: {
      type: Number,
      required: [true, "Redemption price is required"],
      min: [0, "Redemption price cannot be negative"],
    },
    quantityPerRedeem: {
      type: Number,
      default: 1,
      min: [1, "Quantity per redeem must be at least 1"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    storefrontId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
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
luckyDrawPromotionSchema.index({ isActive: 1, isDeleted: 1 });
luckyDrawPromotionSchema.index({ storefrontId: 1 });
luckyDrawPromotionSchema.index({ createdBy: 1 });

const LuckyDrawPromotion = mongoose.model(
  "LuckyDrawPromotion",
  luckyDrawPromotionSchema
);

export default LuckyDrawPromotion;
