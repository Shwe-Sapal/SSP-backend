const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/controllers/transfer.controller.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import convertToBaseUnit
if (!content.includes('convertToBaseUnit')) {
  content = content.replace(
    'import Inventory from "../models/inventory.model.js";',
    'import Inventory from "../models/inventory.model.js";\nimport { convertToBaseUnit } from "../utils/uom.utils.js";'
  );
}

// 2. Add transferUnit validation
const quantityValidationRegex = /if \(typeof userItem\.quantity !== "number" \|\| userItem\.quantity <= 0\) {[\s\S]*?}\n/g;
content = content.replace(quantityValidationRegex, (match) => {
  return match + `
    if (!userItem.transferUnit || typeof userItem.transferUnit !== "string" || userItem.transferUnit.trim() === "") {
      return next(
        new CustomError(400, "transferUnit is required for all line items")
      );
    }
`;
});

// 3. Add baseQuantity calculation after inventory check
const inventoryCheckRegex = /const inventoryIdValue = inventory\._id;/g;
content = content.replace(inventoryCheckRegex, (match) => {
  return match + `

    let baseQuantity;
    try {
      baseQuantity = convertToBaseUnit(inventory, userItem.transferUnit.trim(), userItem.quantity);
    } catch (error) {
      return next(new CustomError(400, error.message));
    }
`;
});

// 4. Update the sufficiency checks
// We have lines like: if (userItem.quantity > availableQuantity) {
// Replace with: if (baseQuantity > availableQuantity) {
content = content.replace(/if \(userItem\.quantity > availableQuantity\) {/g, 'if (baseQuantity > availableQuantity) {');

// Also need to update the error messages inside those if blocks
// `Transfer quantity (${userItem.quantity}) exceeds available quantity (${availableQuantity})
content = content.replace(/Transfer quantity \(\$\{userItem\.quantity\}\)/g, 'Transfer quantity (${baseQuantity} base units)');

// Also for Warehouse transfer error message:
// `Insufficient stock for product '${userItem.productCode}' (batch: ${batchNumber}). Requested: ${userItem.quantity}, Available: ${availableQuantity}`
content = content.replace(/Requested: \$\{userItem\.quantity\}/g, 'Requested: ${baseQuantity}');


// 5. Update validatedLineItems.push({
// Need to add transferUnit and baseQuantity to the push objects.
// Let's replace 'quantity: userItem.quantity,' with 'quantity: userItem.quantity,\n        transferUnit: userItem.transferUnit.trim(),\n        baseQuantity,'
content = content.replace(/quantity: userItem\.quantity,/g, 'quantity: userItem.quantity,\n        transferUnit: userItem.transferUnit.trim(),\n        baseQuantity,');


// 6. Update populate for getTransfers and getTransferById
// Let's find populate lineItems.inventoryId
const populateRegex = /await transfer\.populate\(\s*"lineItems\.inventoryId",\s*"productName productCode SKU"\s*\);/g;
content = content.replace(populateRegex, 'await transfer.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions");');

// In getTransfers, they might populate using string format or object format
const getTransfersPopulateRegex = /\.populate\("lineItems\.inventoryId", "productName productCode SKU"\)/g;
content = content.replace(getTransfersPopulateRegex, '.populate("lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions")');

// To catch variations, replace `"productName productCode SKU"` with `"productName productCode SKU unitOfMeasure uomConversions"` in the context of lineItems.inventoryId
const inventoryPopulateString = /"lineItems\.inventoryId",\s*"productName productCode SKU"/g;
content = content.replace(inventoryPopulateString, '"lineItems.inventoryId", "productName productCode SKU unitOfMeasure uomConversions"');

// Using string replace on the whole content for the populate arrays
// Some controllers use { path: "lineItems.inventoryId", select: "..." }
const inventoryPopulateObj = /path:\s*"lineItems\.inventoryId",\s*select:\s*"productName productCode SKU"/g;
content = content.replace(inventoryPopulateObj, 'path: "lineItems.inventoryId", select: "productName productCode SKU unitOfMeasure uomConversions"');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated transfer.controller.js");
