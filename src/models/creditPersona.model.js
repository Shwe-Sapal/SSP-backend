import mongoose from "mongoose";

const creditPersonSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
    },
    phone: {
      type: String,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    blacklist: {
      type: Boolean,
      default: false,
    },
    blacklistReason: {
      type: String,
      default: null,
    },
    blacklistDate: {
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

const CreditPerson = mongoose.model("CreditPerson", creditPersonSchema);

export default CreditPerson;
