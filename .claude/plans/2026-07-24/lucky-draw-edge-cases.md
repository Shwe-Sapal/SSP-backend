# Plan: Lucky Draw Edge Cases & Fixes

**Date:** 2026-07-24
**Status:** Implemented

## Objective
Implement three edge case fixes identified in `lucky_draw_edge_cases.md` to harden the Lucky Draw redemption flow against storefront mismatch, invalid quantity input, and duplicate ticket code reuse.

## Files to Create / Modify
- `src/controllers/luckyDraw.controller.js` — Add three validation checks in `processRedemption`
- `src/models/luckyDrawRedemption.model.js` — Add compound index on `ticketCode` for query performance

## Implementation Steps

### 1. Storefront Mismatch Check (Edge Case #1)
Inside `processRedemption`, after loading the promotion (step 1), add:
```js
if (promotion.storefrontId && promotion.storefrontId.toString() !== storefrontId.toString()) {
  throw new CustomError(400, "This promotion is not valid for this storefront branch");
}
```

### 2. Quantity Validation (Edge Case #2)
Before the transaction begins in `processRedemption`, validate `quantity`:
```js
if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
  return next(new CustomError(400, "Quantity must be a positive integer"));
}
```

### 3. Duplicate Ticket Code Check (Edge Case #3)
Inside the transaction, after validating the promotion and before stock deduction, add:
```js
if (ticketCode) {
  const existingTicket = await LuckyDrawRedemption.findOne({ ticketCode, isDeleted: false }).session(session);
  if (existingTicket) {
    throw new CustomError(400, "This ticket code has already been redeemed");
  }
}
```

### 4. Pricing Logic (Edge Case #4)
This is a business policy question — no code change. The existing formula `totalAmount = redemptionPrice * productQuantity` is correct if `redemptionPrice` is per-unit. The document notes this requires business owner confirmation.

## Data Model Changes
- Add index on `{ ticketCode: 1, isDeleted: 1 }` in `luckyDrawRedemption.model.js` to optimize the duplicate ticket lookup.

## Edge Cases & Considerations
- Storefront check only applies when `promotion.storefrontId` is set (some promotions are global).
- Quantity validation uses `Number.isInteger()` to reject decimals and checks `> 0` to reject negatives/zero.
- Ticket code check runs inside the transaction to prevent race conditions.

## Test Plan
- Verify the server starts without errors after changes.
