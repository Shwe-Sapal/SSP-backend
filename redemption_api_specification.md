# Backend Implementation: Redemption List API

## Overview
This document outlines the implementation plan and API specification for the Redemption List endpoint, incorporating search, date filtering, and pagination functionalities using Mongoose.

## API Specification

**Endpoint:** `GET /api/redemptions` (or equivalent route)

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `search` | String | No | Keyword to filter by ticket name, customer info, etc. |
| `startDate` | Date String | No | Start date for filtering redemption history (ISO 8601). |
| `endDate` | Date String | No | End date for filtering redemption history (ISO 8601). |
| `page` | Integer | No | The page number to retrieve. Default is `1`. |
| `limit` | Integer | No | Number of items per page. Default is `10`. |

### Database Query Logic (Mongoose)

#### 1. Dynamic Query Object
The query will dynamically build the `filter` object based on the provided query parameters:
*   **Search Filter:** If `search` exists, utilize an `$or` array with `$regex` (case-insensitive) across relevant fields like `customerName`, `customerPhone`, or `ticketName`.
*   **Date Filter:** If `startDate` or `endDate` are provided, apply `$gte` and `$lte` constraints to the `createdAt` timestamp.

#### 2. Pagination Logic
*   **Skip:** `(page - 1) * limit`
*   **Limit:** `limit`

#### 3. Data Fetching
Utilize `Promise.all` to fetch the data and total count concurrently for optimal performance:
```javascript
// Example Logic
const [totalItems, redemptions] = await Promise.all([
  RedemptionModel.countDocuments(query),
  RedemptionModel.find(query)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
]);

Acceptance Criteria
[ ] API returns correct filtered results for keyword search.

[ ] API returns correct filtered results within startDate and endDate.

[ ] Combined queries (search keyword + date range) work as expected.

[ ] Pagination (page, limit) works seamlessly alongside filters.