import express from "express";
import {
  getReturnableGrnBadItems,
  getReturnableExpiredItems,
  createSupplierReturn,
  getAllSupplierReturns,
  getSupplierReturnById,
  settleWithCashRefund,
  settleWithProductExchange,
  cancelSupplierReturn,
} from "../controllers/supplierReturn.controller.js";
import {
  protect,
  permissionGranted,
} from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.get(
  "/supplier-returns/returnable-grn-items",
  protect,
  permissionGranted("owner", "admin"),
  getReturnableGrnBadItems
);

router.get(
  "/supplier-returns/returnable-expired-items",
  protect,
  permissionGranted("owner", "admin"),
  getReturnableExpiredItems
);

router.post(
  "/supplier-returns",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierReturn
);

router.get(
  "/supplier-returns",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllSupplierReturns
);

router.get(
  "/supplier-returns/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getSupplierReturnById
);

router.post(
  "/supplier-returns/:id/settle-refund",
  protect,
  permissionGranted("owner", "admin"),
  settleWithCashRefund
);

router.post(
  "/supplier-returns/:id/settle-exchange",
  protect,
  permissionGranted("owner", "admin"),
  settleWithProductExchange
);

router.post(
  "/supplier-returns/:id/cancel",
  protect,
  permissionGranted("owner", "admin"),
  cancelSupplierReturn
);

export default router;
