const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/models/transfer.model.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add transferUnit and baseQuantity
content = content.replace(
  /quantity: {\s*type: Number,\s*required: \[true, "Transfer quantity is required"\],\s*min: \[0, "Transfer quantity cannot be negative"\],\s*},/g,
  `quantity: {
      type: Number,
      required: [true, "Transfer quantity is required"],
      min: [0, "Transfer quantity cannot be negative"],
    },
    transferUnit: {
      type: String,
      required: [true, "Transfer unit is required"],
    },
    baseQuantity: {
      type: Number,
      required: [true, "Base quantity is required"],
      min: [0.000001, "Base quantity must be strictly greater than 0"],
    },`
);

// 2. Replace transferItem.quantity with transferItem.baseQuantity in stock update methods
// The methods are _updateGRNToWarehouseStock, _updateGRNToStorefrontStock, _updateWarehouseToStorefrontStock,
// _updateWarehouseToWarehouseStock, _updateStorefrontToWarehouseStock, _updateStorefrontToStorefrontStock
// The easiest way is to just replace 'transferItem.quantity' with 'transferItem.baseQuantity' 
// everywhere AFTER 'transferSchema.methods.updateStock = async function'
const splitKeyword = 'transferSchema.methods.updateStock = async function';
const parts = content.split(splitKeyword);
if (parts.length === 2) {
  parts[1] = parts[1].replace(/transferItem\.quantity/g, 'transferItem.baseQuantity');
  content = parts[0] + splitKeyword + parts[1];
}

// 3. Update virtual totalQuantity
content = content.replace(
  /sum \+ item\.quantity/g,
  'sum + item.baseQuantity'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated transfer.model.js");
