import express from "express";
import {
  createTransfer,
  transferWarehouseToWarehouse,
  transferStorefrontToWarehouse,
  getTransfers,
  getTransferById,
  updateTransferStatus,
} from "../controllers/transfer.controller.js";

import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

router.post(
  "/transfer",
  protect,
  permissionGranted("owner", "admin"),
  createTransfer
);
router.get(
  "/transfer",
  protect,
  permissionGranted("owner", "admin"),
  getTransfers
);
router.post(
  "/transfer/warehouse-to-warehouse",
  protect,
  permissionGranted("owner", "admin"),
  transferWarehouseToWarehouse
);
router.post(
  "/transfer/storefront-to-warehouse",
  protect,
  permissionGranted("owner", "admin"),
  transferStorefrontToWarehouse
);
router.get(
  "/transfer/:id",
  protect,
  permissionGranted("owner", "admin"),
  getTransferById
);
router.patch(
  "/transfer/:id",
  protect,
  permissionGranted("owner"),
  updateTransferStatus
);
export default router;
