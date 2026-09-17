import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

export const Db = async () => {
  try {
    mongoose.set("strictQuery", false);
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`Database Connected: ${conn.connection.host}`);

    // One-time migrations to drop obsolete unique indexes that conflict with multi-batch / partial receiving
    try {
      // 1. GoodsRecievedNote - drop unique purchasingId index
      const grnCollection = mongoose.connection.db.collection("goodsrecievednotes");
      const grnIndexes = await grnCollection.indexes();
      const grnUniqueIndex = grnIndexes.find(
        (index) => index.key && index.key.purchasingId === 1 && index.unique === true
      );
      if (grnUniqueIndex) {
        await grnCollection.dropIndex(grnUniqueIndex.name);
        console.log(`✓ Dropped unique index on purchasingId: ${grnUniqueIndex.name}`);
      }
    } catch (e) {
      // Ignore if collection or index doesn't exist
    }

    try {
      // 2. WarehouseStock - drop old 2-field unique index without batchNumber (inventoryId + warehouseId)
      const whCollection = mongoose.connection.db.collection("warehousestocks");
      const whIndexes = await whCollection.indexes();
      for (const idx of whIndexes) {
        if (idx.unique && idx.key && idx.key.inventoryId && idx.key.warehouseId && !idx.key.batchNumber) {
          await whCollection.dropIndex(idx.name);
          console.log(`✓ Dropped obsolete unique index on warehousestocks: ${idx.name}`);
        }
      }
    } catch (e) {
      // Ignore if collection or index doesn't exist
    }

    try {
      // 3. StorefrontInventory - drop old 2-field unique index without batchNumber (inventoryId + storefrontId)
      const sfCollection = mongoose.connection.db.collection("storefrontinventories");
      const sfIndexes = await sfCollection.indexes();
      for (const idx of sfIndexes) {
        if (idx.unique && idx.key && idx.key.inventoryId && idx.key.storefrontId && !idx.key.batchNumber) {
          await sfCollection.dropIndex(idx.name);
          console.log(`✓ Dropped obsolete unique index on storefrontinventories: ${idx.name}`);
        }
      }
    } catch (e) {
      // Ignore if collection or index doesn't exist
    }
  } catch (error) {
    console.log("Database connection failed:", error.message);
    process.exit(1);
  }
};

export default Db;
