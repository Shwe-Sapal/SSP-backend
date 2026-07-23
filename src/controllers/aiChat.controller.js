import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import { processAiChat } from "../services/aiChat.service.js";
import AiChatHistory from "../models/aiChatHistory.model.js";

export const askSaleReportAI = asyncErrorHandler(async (req, res, next) => {
  const { message, conversationHistory, storefrontId } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Message is required and must be a non-empty string.",
    });
  }

  const history = Array.isArray(conversationHistory) ? conversationHistory : [];

  const defaults = {};
  if (storefrontId) defaults.storefrontId = storefrontId;

  const result = await processAiChat(message.trim(), history, defaults);

  // Save the chat interaction to database
  await AiChatHistory.create({
    userId: req.user._id,
    storefrontId: storefrontId || null,
    message: message.trim(),
    response: result.response,
    toolCalls: result.toolCalls || [],
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getAiChatHistory = asyncErrorHandler(async (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const history = await AiChatHistory.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("storefrontId", "locationName");

  res.status(200).json({
    success: true,
    data: history,
  });
});

