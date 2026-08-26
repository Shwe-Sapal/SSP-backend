/**
 * UOM (Unit of Measure) Conversion Utilities
 *
 * Provides helpers to convert a quantity expressed in an arbitrary selling
 * unit back to the product's base unit by looking up the conversion factor
 * stored on the product document.
 */

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Resolve the effective conversion factor for a given unit.
 *
 * @param {Array<{ unit: string, factor: number }>} conversions
 *   The product's `uomConversions` array.
 * @param {string} baseUnit
 *   The product's base unit of measure (e.g. "piece").
 * @param {string} selectedUnit
 *   The unit the caller wants to convert FROM.
 * @returns {number} The multiplication factor to apply to the quantity.
 * @throws {Error} If no matching conversion entry is found.
 */
function getEffectiveFactor(conversions, baseUnit, selectedUnit) {
  const normalizedSelectedUnit = selectedUnit ? String(selectedUnit).toLowerCase().trim() : "";
  const normalizedBaseUnit = baseUnit ? String(baseUnit).toLowerCase().trim() : "";

  // When the selected unit already IS the base unit, no conversion is needed.
  if (normalizedSelectedUnit === normalizedBaseUnit) return 1;

  // Attempt to locate a matching conversion entry (case-insensitive match).
  const entry = conversions.find(
    (conv) => conv.unit && String(conv.unit).toLowerCase().trim() === normalizedSelectedUnit
  );

  if (entry) return entry.factor;

  // No match — surface a clear, actionable error.
  throw new Error(`Conversion not found for unit: ${selectedUnit}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a quantity from a selected selling unit to the product's base unit.
 *
 * @param {Object|null} product
 *   The product (inventory) document. Expected to carry:
 *     - `unitOfMeasure` (or legacy `uom`) — the base unit string.
 *     - `uomConversions` — array of `{ unit, factor, … }` objects.
 * @param {string} selectedUnit
 *   The unit in which `quantity` is expressed (e.g. "box", "pack").
 * @param {number} quantity
 *   The numerical quantity to convert.
 * @returns {number}
 *   The equivalent quantity expressed in the base unit.
 *
 * @example
 *   // product.unitOfMeasure = "piece"
 *   // product.uomConversions = [{ unit: "box", factor: 12 }]
 *   convertToBaseUnit(product, "box", 3); // → 36  (3 boxes × 12 pieces)
 *
 * @example
 *   // No product provided — returns the original quantity unchanged.
 *   convertToBaseUnit(null, "box", 5); // → 5
 */
export function convertToBaseUnit(product, selectedUnit, quantity) {
  // Guard: if no product is provided, return the raw quantity as-is.
  if (!product) return quantity;

  // Prefer the canonical field name; fall back to the shorthand alias.
  const baseUnit = product.unitOfMeasure || product.uom || "";

  // Default to an empty array so downstream code never has to null-check.
  const conversions = product.uomConversions || [];

  const factor = getEffectiveFactor(conversions, baseUnit, selectedUnit);

  return quantity * factor;
}
