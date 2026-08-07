import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import WarehouseStock from "../src/models/warehouse.model.js";
import StorefrontInventory from "../src/models/storefrontInventory.model.js";

// Load environment variables from project root .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const migrateBatchNumber = async () => {
  console.log("==================================================");
  console.log("🚀 Starting Batch-Level Migration Script");
  console.log("==================================================\n");

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI environment variable is not defined in .env file.");
    process.exit(1);
  }

  try {
    // Step 1: Connect to Database
    console.log("📦 [1/4] Connecting to MongoDB...");
    mongoose.set("strictQuery", false);
    const conn = await mongoose.connect(mongoUri);
    console.log(`✓ Connected to Database: ${conn.connection.host} (${conn.connection.name})\n`);

    // Step 2: Backfill Legacy Data for WarehouseStock
    console.log("🔄 [2/4] Backfilling legacy stock records with batchNumber: '__LEGACY__'...");

    const legacyFilter = {
      $or: [
        { batchNumber: { $exists: false } },
        { batchNumber: null },
        { batchNumber: "" },
      ],
    };

    const warehouseUpdateResult = await WarehouseStock.updateMany(
      legacyFilter,
      { $set: { batchNumber: "__LEGACY__" } }
    );
    console.log(
      `  • WarehouseStock: Matched ${warehouseUpdateResult.matchedCount} records, Modified ${warehouseUpdateResult.modifiedCount} records.`
    );

    // Backfill Legacy Data for StorefrontInventory
    const storefrontUpdateResult = await StorefrontInventory.updateMany(
      legacyFilter,
      { $set: { batchNumber: "__LEGACY__" } }
    );
    console.log(
      `  • StorefrontInventory: Matched ${storefrontUpdateResult.matchedCount} records, Modified ${storefrontUpdateResult.modifiedCount} records.`
    );
    console.log("✓ Backfill completed successfully.\n");

    // Step 3: Drop Old Indexes
    console.log("🗑️  [3/4] Checking and dropping old unique indexes (without batchNumber)...");

    // 3a. Check WarehouseStock indexes
    try {
      const warehouseIndexes = await WarehouseStock.collection.indexes();
      const oldWarehouseIndex = warehouseIndexes.find(
        (idx) =>
          idx.key &&
          idx.key.inventoryId === 1 &&
          idx.key.warehouseId === 1 &&
          idx.key.batchNumber === undefined &&
          idx.unique === true
      );

      if (oldWarehouseIndex) {
        console.log(`  • Dropping old WarehouseStock index: '${oldWarehouseIndex.name}'...`);
        await WarehouseStock.collection.dropIndex(oldWarehouseIndex.name);
        console.log(`  ✓ Successfully dropped '${oldWarehouseIndex.name}' from WarehouseStock.`);
      } else {
        console.log("  • No obsolete unique index found on WarehouseStock.");
      }
    } catch (err) {
      if (err.code !== 27 && err.codeName !== "IndexNotFound") {
        console.warn(`  ⚠️  Warning while checking WarehouseStock indexes: ${err.message}`);
      }
    }

    // 3b. Check StorefrontInventory indexes
    try {
      const storefrontIndexes = await StorefrontInventory.collection.indexes();
      const oldStorefrontIndex = storefrontIndexes.find(
        (idx) =>
          idx.key &&
          idx.key.inventoryId === 1 &&
          idx.key.storefrontId === 1 &&
          idx.key.batchNumber === undefined &&
          idx.unique === true
      );

      if (oldStorefrontIndex) {
        console.log(`  • Dropping old StorefrontInventory index: '${oldStorefrontIndex.name}'...`);
        await StorefrontInventory.collection.dropIndex(oldStorefrontIndex.name);
        console.log(`  ✓ Successfully dropped '${oldStorefrontIndex.name}' from StorefrontInventory.`);
      } else {
        console.log("  • No obsolete unique index found on StorefrontInventory.");
      }
    } catch (err) {
      if (err.code !== 27 && err.codeName !== "IndexNotFound") {
        console.warn(`  ⚠️  Warning while checking StorefrontInventory indexes: ${err.message}`);
      }
    }

    // Step 4: Sync/Rebuild Indexes with Mongoose
    console.log("\n🔨 [4/4] Building new compound unique indexes (including batchNumber)...");

    console.log("  • Syncing indexes for WarehouseStock...");
    await WarehouseStock.syncIndexes();
    console.log("  ✓ WarehouseStock indexes synchronized.");

    console.log("  • Syncing indexes for StorefrontInventory...");
    await StorefrontInventory.syncIndexes();
    console.log("  ✓ StorefrontInventory indexes synchronized.");

    console.log("\n==================================================");
    console.log("🎉 Migration completed successfully!");
    console.log("==================================================");
  } catch (error) {
    console.error("\n❌ Migration failed with error:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database.\n");
    process.exit(0);
  }
};

migrateBatchNumber();
