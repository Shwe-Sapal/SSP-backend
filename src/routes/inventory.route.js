import express from "express";
import multer from "multer";
import {
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  importInventoryFromExcel,
  getAllCategories,
  bulkLinkSuppliers,
  bulkUnlinkSuppliers,
} from "../controllers/inventory.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls") ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls, .csv) are allowed"), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// Bulk import inventory from Excel
router.post(
  "/inventory/import-excel",
  protect,
  permissionGranted("owner", "admin"),
  upload.single("file"),
  importInventoryFromExcel,
);

// Bulk link products to suppliers
router.post(
  "/inventory/bulk-link-suppliers",
  protect,
  permissionGranted("owner", "admin"),
  bulkLinkSuppliers,
);

// Bulk unlink products from suppliers
router.post(
  "/inventory/bulk-unlink-suppliers",
  protect,
  permissionGranted("owner", "admin"),
  bulkUnlinkSuppliers,
);

// Get all unique categories
router.get(
  "/inventory/categories",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllCategories,
);

// Create new inventory item
router.post(
  "/inventory",
  protect,
  permissionGranted("owner", "admin"),
  createInventory,
);

// Get all inventory items
router.get(
  "/inventory",
  protect,
  permissionGranted("owner", "admin"),
  getAllInventory,
);

// Get inventory item by ID
router.get(
  "/inventory/:id",
  protect,
  permissionGranted("owner", "admin"),
  getInventoryById,
);

// Update inventory metadata
router.patch(
  "/inventory/:id",
  protect,
  permissionGranted("owner"),
  updateInventory,
);

export default router;
