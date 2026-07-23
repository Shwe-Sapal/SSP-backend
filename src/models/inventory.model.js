import mongoose from "mongoose";
// import validator from "validator"; // Reserved for future use

const inventorySchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
    },
    productCode: {
      type: String,
      required: [true, "Product code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    saleCode: {
      type: String,
      unique: true,
      sparse: true, // Optional field - allows multiple nulls, enforces uniqueness when provided
      trim: true,
      uppercase: true,
    },
    SKU: {
      type: String,
      sparse: true, // Optional field - allows multiple nulls, enforces uniqueness when provided
      unique: true,
      trim: true,
      uppercase: true,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values but enforces uniqueness for non-null
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
      default: "Unknown",
    },
    subCategory: {
      type: String,
      trim: true,
      default: "Unknown",
    },
    brand: {
      type: String,
      trim: true,
      default: "Unknown",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "No description available",
    },
    buyingPrice: {
      type: Number,
      required: [true, "Buying price is required"],
      min: [0, "Buying price cannot be negative"],
    },
    sellingPrice: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0, "Selling price cannot be negative"],
      validate: {
        validator: function (value) {
          // Selling price should typically be >= buying price
          return value >= this.buyingPrice;
        },
        message:
          "Selling price should be greater than or equal to buying price",
      },
    },
    wholesalePrices: [{
      quantity: {
        type: Number,
        required: [true, "Wholesale quantity is required"],
        min: [2, "Wholesale quantity must be at least 2"],
      },
      price: {
        type: Number,
        required: [true, "Wholesale price is required"],
        min: [0, "Wholesale price cannot be negative"],
      },
    }],
    unitOfMeasure: {
      type: String,
      required: [true, "Unit of measure is required"],
      trim: true,
      default: "piece",
    },
    reorderPoint: {
      type: Number,
      min: [0, "Reorder point cannot be negative"],
      default: 0,
    },
    reorderQuantity: {
      type: Number,
      min: [0, "Reorder quantity cannot be negative"],
      default: 0,
    },
    taxRate: {
      type: Number,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
      default: 0,
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive", "discontinued"],
        message: "Status must be active, inactive, or discontinued",
      },
      default: "active",
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    note: {
      type: String,
      trim: true,
      maxlength: [1000, "Note cannot exceed 1000 characters"],
      default: "",
    },
    // createdBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    // },
    // updatedBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    // },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
// Note: productCode, SKU, saleCode, and barcode already have indexes from unique: true
// Only add indexes for fields that don't have unique: true
inventorySchema.index({ category: 1 });
inventorySchema.index({ category: 1, subCategory: 1 });
inventorySchema.index({ status: 1 });
inventorySchema.index({ productName: "text", description: "text" }); // Text search index

// Virtual for profit margin
inventorySchema.virtual("profitMargin").get(function () {
  if (this.buyingPrice === 0) return 0;
  return ((this.sellingPrice - this.buyingPrice) / this.buyingPrice) * 100;
});

// Virtual for profit amount
inventorySchema.virtual("profitAmount").get(function () {
  return this.sellingPrice - this.buyingPrice;
});

// Pre-save middleware to ensure only one primary image
// TODO: Uncomment when images field is added
// inventorySchema.pre("save", function (next) {
//   if (this.images && this.images.length > 0) {
//     const primaryImages = this.images.filter((img) => img.isPrimary);
//     if (primaryImages.length > 1) {
//       // Keep only the first one as primary
//       this.images.forEach((img, index) => {
//         if (index > 0) img.isPrimary = false;
//       });
//     }
//     if (primaryImages.length === 0) {
//       // Set first image as primary if none is set
//       this.images[0].isPrimary = true;
//     }
//   }
//   next();
// });

const Inventory = mongoose.model("Inventory", inventorySchema);
export default Inventory;
