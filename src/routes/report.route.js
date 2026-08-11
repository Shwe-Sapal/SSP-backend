import express from "express";
import {
  getPurchaseOverallReport,
  getPurchaseProductReport,
  getLowStockReport,
} from "../controllers/report.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// ─── Purchase Reports ────────────────────────────────────────────────────────
// Overall purchase summary (total value, average, status breakdown, top suppliers)
// Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get(
  "/reports/purchases/overall",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseOverallReport,
);

// Product-level purchase breakdown (quantity purchased, total cost per product)
// Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=10
router.get(
  "/reports/purchases/products",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseProductReport,
);

// ─── Inventory Reports ──────────────────────────────────────────────────────
// Low-stock report across all warehouses & storefronts
// Query: ?threshold=50&page=1&limit=20
router.get(
  "/reports/inventory/low-stock",
  protect,
  permissionGranted("owner", "admin"),
  getLowStockReport,
);

export default router;
