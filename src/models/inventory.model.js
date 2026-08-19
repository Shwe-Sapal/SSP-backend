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
    // Array of sub-unit conversion definitions relative to the base unitOfMeasure.
    // Each entry describes how a derived unit relates back to another unit via `factor`
    // and optionally chains through `convertFrom`.
    uomConversions: [
      {
        unit: {
          type: String,
          required: [true, "Conversion unit name is required"],
          trim: true,
        },
        // Multiplier to convert FROM the `convertFrom` unit (or the base unit)
        // into this unit.  e.g. 1 box = 12 pieces → factor = 12.
        factor: {
          type: Number,
          required: [true, "Conversion factor is required"],
          min: [0.001, "Conversion factor must be at least 0.001"],
        },
        // When true this unit is pre-selected in the selling UI.
        isDefaultSellingUnit: {
          type: Boolean,
          default: false,
        },
        // The unit this conversion derives from.
        // null / omitted means it converts directly from the base `unitOfMeasure`.
        convertFrom: {
          type: String,
          default: null,
          trim: true,
        },
      },
    ],
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
    suppliers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SupplierProfile",
      },
    ],
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

// ---------------------------------------------------------------------------
// Pre-save hook – UOM conversion validations
// Uses synchronous throw instead of the callback `next` pattern.
// Modern Mongoose (5+) catches thrown errors and rejects the save promise.
// ---------------------------------------------------------------------------
inventorySchema.pre("save", function () {
  const conversions = this.uomConversions;

  // Nothing to validate when the array is empty or absent.
  if (!conversions || conversions.length === 0) return;

  const baseUnit = (this.unitOfMeasure || "").trim().toLowerCase();

  // ------------------------------------------------------------------
  // 1. Duplicate unit names check
  //    Collect every unit name (lowercased) and reject duplicates.
  // ------------------------------------------------------------------
  const seen = new Set();
  for (const conv of conversions) {
    const name = (conv.unit || "").trim().toLowerCase();
    if (!name) continue; // schema-level `required` will catch empty names
    if (seen.has(name)) {
      throw new Error(
        `Duplicate UOM conversion unit detected: "${conv.unit}". Each conversion unit must be unique.`,
      );
    }
    seen.add(name);
  }

  // ------------------------------------------------------------------
  // 2. No sub-unit may share the same name as the base unit
  // ------------------------------------------------------------------
  if (baseUnit) {
    for (const conv of conversions) {
      if ((conv.unit || "").trim().toLowerCase() === baseUnit) {
        throw new Error(
          `UOM conversion unit "${conv.unit}" cannot be the same as the base unit of measure "${this.unitOfMeasure}".`,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Circular convertFrom chain detection
  //    Build an adjacency map  unit → convertFrom  then walk each chain.
  //    If we revisit a node we have a cycle.
  // ------------------------------------------------------------------
  const parentMap = new Map(); // unit (lower) → convertFrom (lower)
  for (const conv of conversions) {
    const name = (conv.unit || "").trim().toLowerCase();
    // convertFrom of null / undefined / empty means "derives from base unit".
    const parent = conv.convertFrom
      ? conv.convertFrom.trim().toLowerCase()
      : null;
    parentMap.set(name, parent);
  }

  for (const [startUnit] of parentMap) {
    const visited = new Set();
    let current = startUnit;

    while (current !== null) {
      // If we've already visited this node in the current walk, it's a cycle.
      if (visited.has(current)) {
        throw new Error(
          `Circular UOM conversion chain detected involving unit "${current}". ` +
            "Conversion chains must not form loops.",
        );
      }
      visited.add(current);

      // Move to the parent. If `current` isn't in the map it either
      // points to the base unit or an external unit – both are terminal.
      if (!parentMap.has(current)) break;
      current = parentMap.get(current);
    }
  }
});

const Inventory = mongoose.model("Inventory", inventorySchema);
export default Inventory;
