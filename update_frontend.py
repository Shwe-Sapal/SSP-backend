import re

file_path = "/Users/hlaingmyowin/Desktop/SSP-frontend/pages/EditOrder.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Replace imports
content = re.sub(
    r'import { addItemsToOrder, AddItemToOrderRequest } from "../services/Order/addItemsToOrder";\nimport { removeItemsFromOrder } from "../services/Order/removeItemsFromOrder";',
    'import { overwriteOrder, OverwriteOrderItemRequest } from "../services/Order/overwriteOrder";',
    content
)

# New handleSaveChanges
new_handle = """  // Save changes handler
  const handleSaveChanges = async () => {
    if (!order) return;

    // Check if anything actually changed (optional optimization)
    // Map current cart items to payload format
    const itemsToSave = cartItems.map((cartItem) => ({
      inventoryId: cartItem.inventoryId,
      quantity: cartItem.quantity,
    }));

    if (
      itemsToSave.length === Object.keys(originalItemsMap).length &&
      itemsToSave.every(item => originalItemsMap[item.inventoryId] === item.quantity) &&
      totals.tax === order.tax && 
      totals.discount === order.discount && 
      totals.finalAmount === order.finalAmount &&
      paidAmount === order.paidAmount
    ) {
      toast.info("No changes to save");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        items: itemsToSave,
        subTotal: totals.totalSubtotal,
        tax: totals.tax,
        discount: totals.discount,
        finalAmount: totals.finalAmount,
        extraChange: totals.extraChange,
        paidAmount: paidAmount,
      };

      const overwriteRes = await overwriteOrder(order._id, payload);
      if (!overwriteRes.success) {
        throw new Error(overwriteRes.message || "Failed to update order");
      }

      toast.success("Order updated successfully!");
      navigate(-1);
    } catch (error: any) {
      console.error("Error saving order changes:", error);
      toast.error(error.message || "Failed to update order");
    } finally {
      setSaving(false);
    }
  };"""

# Replace the method using regex
# Find the start of the method
start_str = "  // Save changes handler\n  const handleSaveChanges = async () => {"
end_str = "    } finally {\n      setSaving(false);\n    }\n  };"

pattern = re.compile(r'  // Save changes handler\n  const handleSaveChanges = async \(\) => \{.*?\} finally \{\n      setSaving\(false\);\n    \}\n  \};', re.DOTALL)
content = pattern.sub(new_handle, content)

with open(file_path, "w") as f:
    f.write(content)

print("Frontend EditOrder.tsx updated.")
