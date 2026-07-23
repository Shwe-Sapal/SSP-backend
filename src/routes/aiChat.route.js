import express from "express";
import { askSaleReportAI, getAiChatHistory } from "../controllers/aiChat.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
import aiChatRateLimiter from "../middlewares/aiChatRateLimiter.middleware.js";

const router = express.Router();

router.post(
  "/sale-report/ai-chat",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  aiChatRateLimiter,
  askSaleReportAI
);

router.get(
  "/sale-report/ai-chat/history",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAiChatHistory
);

export default router;

