import mongoose from "mongoose";

const aiChatHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "userId is required"],
    },
    storefrontId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
    },
    message: {
      type: String,
      required: [true, "message is required"],
      trim: true,
    },
    response: {
      type: String,
      required: [true, "response is required"],
    },
    toolCalls: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const AiChatHistory = mongoose.model("AiChatHistory", aiChatHistorySchema);

export default AiChatHistory;
