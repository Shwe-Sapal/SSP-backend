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

export function getEffectiveBaseFactor(targetUnit, conversions, baseUnit) {
  const normalizedTarget = targetUnit ? String(targetUnit).toLowerCase().trim() : "";
  const normalizedBase = baseUnit ? String(baseUnit).toLowerCase().trim() : "";

  if (!normalizedTarget || normalizedTarget === normalizedBase) return 1;

  const conversion = conversions.find(
    (conv) => conv.unit && String(conv.unit).toLowerCase().trim() === normalizedTarget
  );

  if (!conversion) return 1;

  const normalizedConvertFrom = conversion.convertFrom ? String(conversion.convertFrom).toLowerCase().trim() : "";

  if (!normalizedConvertFrom || normalizedConvertFrom === normalizedBase) {
    return conversion.factor;
  }

  return conversion.factor * getEffectiveBaseFactor(conversion.convertFrom, conversions, baseUnit);
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

  const factor = getEffectiveBaseFactor(selectedUnit, conversions, baseUnit);

  return quantity * factor;
}
