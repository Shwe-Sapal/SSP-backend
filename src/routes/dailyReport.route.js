import express from "express";
import {
  getDailyReports,
  getLatestDailyReport,
} from "../controllers/dailyReport.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Get paginated daily reports
router.get(
  "/daily-reports",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getDailyReports
);

// Get the latest daily report
router.get(
  "/daily-reports/latest",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getLatestDailyReport
);

export default router;
