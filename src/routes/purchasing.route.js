import express from "express";
import {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchaseStatus,
  updatePurchaseItemQuantity,
  softDeletePurchase,
  restorePurchase,
  hardDeletePurchase,
  addPurchaseItem,
  removePurchaseItem,
} from "../controllers/purchase.controller.js";
import {
  createSupplierPayment,
  getPaymentsByPurchaseId,
  getPaymentsBySupplierId,
  hardDeleteSupplierPayment,
} from "../controllers/supplierPayment.controller.js";
import {
  protect,
  permissionGranted,
} from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.post(
  "/purchase",
  protect,
  permissionGranted("owner", "admin"),
  createPurchase
);
router.get(
  "/purchase",
  protect,
  permissionGranted("owner", "admin"),
  getAllPurchases
);
router.get(
  "/purchase/:id",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseById
);
router.patch(
  "/purchase/:id/status",
  protect,
  permissionGranted("owner", "admin"),
  updatePurchaseStatus
);
router.patch(
  "/purchase/:id/items/:itemId",
  protect,
  permissionGranted("owner", "admin"),
  updatePurchaseItemQuantity
);
router.post(
  "/purchase/:id/items",
  protect,
  permissionGranted("owner", "admin"),
  addPurchaseItem
);
router.delete(
  "/purchase/:id/items/:itemId",
  protect,
  permissionGranted("owner", "admin"),
  removePurchaseItem
);
router.patch(
  "/purchase/:id/soft-delete",
  protect,
  permissionGranted("owner"),
  softDeletePurchase
);
router.patch(
  "/purchase/:id/restore",
  protect,
  permissionGranted("owner"),
  restorePurchase
);
router.delete(
  "/purchase/:id",
  protect,
  permissionGranted("owner"),
  hardDeletePurchase
);

// Supplier Payment Routes
router.post(
  "/purchase/:id/payment",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierPayment
);

router.get(
  "/purchase/:id/payments",
  protect,
  permissionGranted("owner", "admin"),
  getPaymentsByPurchaseId
);

router.get(
  "/supplier/:supplierId/payments",
  protect,
  permissionGranted("owner", "admin"),
  getPaymentsBySupplierId
);

router.delete(
  "/supplier-payment/:id",
  protect,
  permissionGranted("owner", "admin"),
  hardDeleteSupplierPayment
);

export default router;
