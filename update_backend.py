import re

controller_path = "src/controllers/order.controller.js"
with open(controller_path, "r") as f:
    content = f.read()

# We need to add overwriteOrder. We will base it on the combination of removeOrderItems and createOrder logic.
# I'll just write the full function and append it.

overwrite_code = """
// Overwrite entire order items
export const overwriteOrder = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const {
    items,
    subTotal,
    tax,
    discount,
    finalAmount,
    extraChange,
    paidAmount,
  } = req.body;

  // Validate orderId
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  // Validate required fields - items array
  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(
      new CustomError(400, "Items array is required and must not be empty"),
    );
  }

  // Validate each item in the array
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.inventoryId) {
      return next(new CustomError(400, `Item at index ${i}: Inventory ID is required`));
    }
    if (!mongoose.Types.ObjectId.isValid(item.inventoryId)) {
      return next(new CustomError(400, `Item at index ${i}: Invalid inventory ID format`));
    }
    if (!item.quantity || item.quantity < 1) {
      return next(new CustomError(400, `Item at index ${i}: Quantity must be at least 1`));
    }
  }

  // Validate numeric fields if provided
  if (tax !== undefined && tax < 0) return next(new CustomError(400, "Tax cannot be negative"));
  if (discount !== undefined && discount < 0) return next(new CustomError(400, "Discount cannot be negative"));
  if (finalAmount !== undefined && finalAmount < 0) return next(new CustomError(400, "Final amount cannot be negative"));
  if (paidAmount !== undefined && paidAmount < 0) return next(new CustomError(400, "Paid amount cannot be negative"));
  if (extraChange !== undefined && extraChange < 0) return next(new CustomError(400, "Extra change cannot be negative"));

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // 1. Validate order exists
      const order = await Order.findById(orderId).session(session);

      if (!order) throw new CustomError(404, "Order not found");
      if (order.isDeleted) throw new CustomError(400, "Cannot modify deleted order");
      if (order.orderStatus !== "completed") throw new CustomError(400, `Cannot overwrite order with status '${order.orderStatus}'`);

      const storefrontId = order.storefrontId;

      // 2. Revert Old Stock completely
      for (const oldItem of order.ordersProducts) {
        const baseQtyToRestore = oldItem.quantity * (oldItem.conversionFactor || 1);
        
        // Find existing stock record (we can just add to any existing batch for this product, or find the most recently updated one)
        const stockRecord = await StorefrontInventory.findOne(
          { inventoryId: oldItem.inventoryId, storefrontId },
          null,
          { session }
        );

        if (!stockRecord) {
          await StorefrontInventory.create([{
            inventoryId: oldItem.inventoryId,
            storefrontId,
            quantity: baseQtyToRestore,
            lastUpdated: new Date(),
          }], { session });
        } else {
          stockRecord.quantity += baseQtyToRestore;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });
        }
      }

      // 3. Prepare New Stock
      const uniqueInventoryIds = [...new Set(items.map((p) => p.inventoryId.toString()))].map((id) => new mongoose.Types.ObjectId(id));
      const inventoryItems = await Inventory.find({ _id: { $in: uniqueInventoryIds } }).session(session);

      if (inventoryItems.length !== uniqueInventoryIds.length) {
        const foundIds = inventoryItems.map((item) => item._id.toString());
        const missingIds = uniqueInventoryIds.filter((id) => !foundIds.includes(id.toString()));
        throw new CustomError(404, `Inventory items not found: ${missingIds.join(", ")}`);
      }

      const inventoryMap = new Map();
      inventoryItems.forEach((item) => inventoryMap.set(item._id.toString(), item));

      const validatedProducts = [];
      const aggregatedQuantities = new Map();

      for (const item of items) {
        const inventoryId = new mongoose.Types.ObjectId(item.inventoryId);
        const inventoryItem = inventoryMap.get(inventoryId.toString());

        if (!inventoryItem) throw new CustomError(404, `Inventory item not found: ${item.inventoryId}`);
        if (inventoryItem.sellingPrice === undefined || inventoryItem.sellingPrice === null) {
          throw new CustomError(400, `Product does not have a selling price set`);
        }
        if (inventoryItem.sellingPrice < 0) {
          throw new CustomError(400, `Product has an invalid selling price`);
        }

        let unitPrice = inventoryItem.sellingPrice;
        if (inventoryItem.wholesalePrices?.length > 0) {
          const sorted = [...inventoryItem.wholesalePrices].sort((a, b) => b.quantity - a.quantity);
          const tier = sorted.find((wp) => item.quantity >= wp.quantity);
          if (tier) unitPrice = tier.price;
        }

        const computedFactor = getEffectiveBaseFactor(
          item.saleUnit || "piece",
          inventoryItem.uomConversions || [],
          inventoryItem.unitOfMeasure || inventoryItem.uom || ""
        );

        validatedProducts.push({
          inventoryId,
          quantity: item.quantity,
          saleUnit: item.saleUnit || "piece",
          conversionFactor: computedFactor,
          unitPrice, // Snapshot
          buyingPrice: inventoryItem.buyingPrice || 0,
        });

        const idStr = inventoryId.toString();
        const baseQty = item.quantity * computedFactor;
        if (aggregatedQuantities.has(idStr)) {
          aggregatedQuantities.set(idStr, aggregatedQuantities.get(idStr) + baseQty);
        } else {
          aggregatedQuantities.set(idStr, baseQty);
        }
      }

      // 4. Validate and Deduct New Stock (Using batch logic)
      for (const [inventoryIdStr, totalBaseQty] of aggregatedQuantities.entries()) {
        const stockAgg = await StorefrontInventory.aggregate([
          { $match: { inventoryId: new mongoose.Types.ObjectId(inventoryIdStr), storefrontId } },
          { $group: { _id: null, totalQty: { $sum: "$quantity" } } }
        ]).session(session);

        const totalAvailable = stockAgg.length > 0 ? (stockAgg[0].totalQty || 0) : 0;

        if (totalAvailable < totalBaseQty) {
          const inventoryItem = inventoryMap.get(inventoryIdStr);
          throw new CustomError(400, `Insufficient stock for product. Available: ${totalAvailable}, Requested: ${totalBaseQty}`);
        }

        const batchRecords = await StorefrontInventory.find(
          { inventoryId: new mongoose.Types.ObjectId(inventoryIdStr), storefrontId, quantity: { $gt: 0 } },
          null,
          { session, sort: { createdAt: 1 } }
        );

        let remaining = totalBaseQty;
        for (const batch of batchRecords) {
          if (remaining <= 0) break;
          const deduct = Math.min(batch.quantity, remaining);
          batch.quantity -= deduct;
          batch.lastUpdated = new Date();
          await batch.save({ session });
          remaining -= deduct;
        }

        if (remaining > 0) {
          throw new CustomError(400, `Failed to deduct full stock. Shortage: ${remaining}`);
        }
      }

      // 5. Overwrite items
      order.ordersProducts = validatedProducts;

      // 6. Update financials
      if (subTotal !== undefined) order.subTotal = subTotal;
      if (tax !== undefined) order.tax = tax;
      if (discount !== undefined) order.discount = discount;
      if (finalAmount !== undefined) order.finalAmount = finalAmount;
      if (paidAmount !== undefined) order.paidAmount = paidAmount;

      await order.save({ session });
    });

    res.status(200).json({
      success: true,
      message: "Order overwritten successfully"
    });

  } catch (error) {
    if (error instanceof CustomError) return next(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map(val => val.message);
      return next(new CustomError(400, `Validation error: ${errors.join(". ")}`));
    }
    console.error("Overwrite order error:", error);
    return next(new CustomError(500, `Failed to overwrite order: ${error.message}`));
  } finally {
    await session.endSession();
  }
});
"""

with open(controller_path, "a") as f:
    f.write("\n" + overwrite_code)


route_path = "src/routes/order.route.js"
with open(route_path, "r") as f:
    route_content = f.read()

# Add overwriteOrder to imports
route_content = route_content.replace("removeOrderItems,", "removeOrderItems,\n  overwriteOrder,")

# Add route
route_to_add = """
// Overwrite order entirely
router.patch(
  "/order/:orderId/overwrite",
  protect,
  permissionGranted("owner"),
  overwriteOrder
);
"""

# Insert before `// Hard delete order`
route_content = route_content.replace("// Hard delete order", route_to_add + "\n// Hard delete order")

with open(route_path, "w") as f:
    f.write(route_content)

print("Backend files updated.")
