import mongoose from "mongoose";

const luckyDrawRedemptionSchema = new mongoose.Schema(
  {
    redemptionNumber: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },
    promotionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LuckyDrawPromotion",
      required: [true, "Promotion is required"],
    },
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    quantity: {
      type: Number,
      default: 1,
      min: [1, "Quantity must be at least 1"],
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price is required"],
      min: [0, "Unit price cannot be negative"],
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
    },
    storefrontId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      required: [true, "Storefront is required"],
    },
    ticketCode: {
      type: String,
      trim: true,
      default: null,
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
    },
    redeemedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Redeemed by is required"],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, "Note cannot exceed 500 characters"],
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
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for query performance
luckyDrawRedemptionSchema.index({ promotionId: 1 });
luckyDrawRedemptionSchema.index({ inventoryId: 1 });
luckyDrawRedemptionSchema.index({ storefrontId: 1 });
luckyDrawRedemptionSchema.index({ redeemedBy: 1 });
luckyDrawRedemptionSchema.index({ createdAt: -1 });
luckyDrawRedemptionSchema.index({ isDeleted: 1 });
luckyDrawRedemptionSchema.index({ ticketCode: 1, isDeleted: 1 }, { sparse: true });

// Static method to generate redemption number
// Format: LDR-YYYYMMDD-NNNNNN (e.g., LDR-20260723-000001)
luckyDrawRedemptionSchema.statics.generateRedemptionNumber = async function () {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `LDR-${y}${m}${d}-`;

  // Find the latest redemption for today (excluding deleted)
  const latest = await this.findOne({
    redemptionNumber: new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    ),
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select("redemptionNumber");

  let sequence = 1;
  if (latest && latest.redemptionNumber) {
    // Extract sequence number from format: LDR-YYYYMMDD-NNNNNN
    const parts = latest.redemptionNumber.split("-");
    if (parts.length === 3) {
      // Format: ["LDR", "YYYYMMDD", "NNNNNN"]
      const latestSequence = parseInt(parts[2], 10);
      if (!isNaN(latestSequence)) {
        sequence = latestSequence + 1;
      }
    }
  }

  // Format: LDR-YYYYMMDD-NNNNNN (e.g., LDR-20260723-000001)
  return `${prefix}${sequence.toString().padStart(6, "0")}`;
};

const LuckyDrawRedemption = mongoose.model(
  "LuckyDrawRedemption",
  luckyDrawRedemptionSchema
);

export default LuckyDrawRedemption;
