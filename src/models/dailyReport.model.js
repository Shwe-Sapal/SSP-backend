import mongoose from "mongoose";

const dailyReportSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, "Date is required"],
      unique: true,
      trim: true,
    },
    period: {
      type: String,
      enum: ["daily", "monthly"],
      default: "daily",
    },
    // Financial summary
    finalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    subTotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalCardAmount: { type: Number, default: 0 },
    totalCashAmount: { type: Number, default: 0 },
    // Counts
    orderCount: { type: Number, default: 0 },
    creditOrderCount: { type: Number, default: 0 },
    paidOrderCount: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    // The formatted Myanmar report text
    reportText: { type: String, default: "" },
    // When the report was generated
    generatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    id: false,
  }
);

// Index for sorting by date
dailyReportSchema.index({ date: -1 });
dailyReportSchema.index({ generatedAt: -1 });

const DailyReport = mongoose.model("DailyReport", dailyReportSchema);
export default DailyReport;
