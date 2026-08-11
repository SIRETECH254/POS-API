# 🗂️ POS API - Stock Adjustment Documentation

## 📋 Table of Contents
- [Stock Adjustment Overview](#stock-adjustment-overview)
- [Stock Adjustment Model](#-stock-adjustment-model)
- [Stock Adjustment Controller](#-stock-adjustment-controller)
- [Stock Adjustment Routes](#-stock-adjustment-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Stock Adjustment Overview

Stock Adjustment records manual corrections to branch stock — breakage, theft, expiry, a stock-count correction, or anything else that isn't a purchase, sale, or transfer. Every adjustment writes through the shared `stockMovementService.recordStockMovement()` (`type: "adjusted"`), so it always leaves a matching immutable `StockMovement` ledger entry.

**Approval flow:** a **positive** `quantityChange` (a correction adding stock back) applies immediately on creation. A **negative** `quantityChange` (breakage/theft/loss) is created as a **pending** record — no stock movement is written yet — and requires a separate `approveStockAdjustment()` call by a manager or admin before it actually decrements stock. This matches the intent behind the model's `approvedBy` field ("manager approval for negative adjustments").

**Schema note beyond the original target design:** an `appliedAt?: Date` field was added. Without it there'd be no way to distinguish "an auto-applied positive adjustment" from "a still-pending negative adjustment" — both would otherwise show `approvedBy: undefined`. `appliedAt` is set at creation time for positive adjustments and at approval time for negative ones; `approveStockAdjustment()` also uses its presence to reject double-approval.

`StockCount` reconciliation (see `STOCKCOUNT_DOCUMENTATION.md`) creates `StockAdjustment` records too — those are created pre-approved (`approvedBy`/`appliedAt` set immediately), since the manager reconciling the count is implicitly the approver.

---

## 👤 Stock Adjustment Model

### Schema Definition
```typescript
export type StockAdjustmentReason = "breakage" | "theft" | "expired" | "count_correction" | "other";

export interface IStockAdjustment extends Document {
  branch: Types.ObjectId | IBranch;
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantityChange: number;
  reason: StockAdjustmentReason;
  notes?: string;
  adjustedBy: Types.ObjectId | IUser;
  approvedBy?: Types.ObjectId | IUser;
  appliedAt?: Date;
  stockCount?: Types.ObjectId | IStockCount;
  createdAt: Date;
}
```

### Model Implementation

**File: `src/models/StockAdjustment.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IStockAdjustment } from "../type";

const stockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    sku: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    quantityChange: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      enum: ["breakage", "theft", "expired", "count_correction", "other"],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    adjustedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    appliedAt: {
      type: Date,
    },
    stockCount: {
      type: Schema.Types.ObjectId,
      ref: "StockCount",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockAdjustmentSchema.index({ branch: 1, sku: 1 });
stockAdjustmentSchema.index({ reason: 1 });
stockAdjustmentSchema.index({ appliedAt: 1 });

const StockAdjustment = mongoose.model<IStockAdjustment>("StockAdjustment", stockAdjustmentSchema);
export default StockAdjustment;
```

### Validation Rules
```typescript
branch:         { required: true, ObjectId ref: 'Branch' }
product:        { required: true, ObjectId ref: 'Product' }
sku:            { required: true, ObjectId — subdocument id on Product.skus, no ref }
quantityChange: { required: true, signed — negative for loss, positive for correction, cannot be 0 }
reason:         { required: true, enum: ['breakage','theft','expired','count_correction','other'] }
notes:          { optional, trim — required by controller when reason is 'other' }
adjustedBy:     { required: true, ObjectId ref: 'User' }
approvedBy:     { optional, ObjectId ref: 'User' — set only for negative adjustments, at approval time }
appliedAt:      { optional, Date — set when the stock movement is actually written }
stockCount:     { optional, ObjectId ref: 'StockCount' — set when auto-generated during reconciliation }
createdAt:      { auto, immutable — no updatedAt }
```

---

## 🎮 Stock Adjustment Controller

**File:** `src/controllers/stockAdjustmentController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockAdjustment from "../models/StockAdjustment";
import Product from "../models/Product";
import { recordStockMovement } from "../services/internal/stockMovementService";
```

### Functions Overview

#### `createStockAdjustment()`
**Purpose:** Record a manual correction to branch stock
**Access:** Store Keeper, Manager, Admin
**Validation:** Branch, product, sku, quantityChange, reason required; quantityChange cannot be 0; notes required when reason is `'other'`; product/SKU must exist
**Process:** Create the adjustment record; positive changes apply immediately, negative changes stay pending approval
**Response:** Created stock adjustment

**Controller Implementation:**
```typescript
export const createStockAdjustment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, product, sku, quantityChange, reason, notes } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!product) {
      return next(errorHandler(400, "Product is required"));
    }
    if (!sku) {
      return next(errorHandler(400, "SKU is required"));
    }
    if (quantityChange === undefined || quantityChange === null) {
      return next(errorHandler(400, "Quantity change is required"));
    }
    if (quantityChange === 0) {
      return next(errorHandler(400, "Quantity change cannot be zero"));
    }
    if (!reason) {
      return next(errorHandler(400, "Reason is required"));
    }
    if (reason === "other" && !notes) {
      return next(errorHandler(400, "Notes are required when reason is 'other'"));
    }

    // Guard — product must exist
    const productDoc = await Product.findById(product);
    if (!productDoc) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — SKU must exist on the product
    const skuDoc = productDoc.skus.id(sku);
    if (!skuDoc) {
      return next(errorHandler(404, "SKU not found on product"));
    }

    // Create the adjustment record
    const adjustment = await StockAdjustment.create({
      branch,
      product,
      sku,
      quantityChange,
      reason,
      notes,
      adjustedBy: req.user?._id,
    });

    // Positive adjustments apply immediately; negative ones stay pending manager approval
    if (quantityChange > 0) {
      await recordStockMovement({
        branch,
        product,
        sku,
        type: "adjusted",
        quantity: quantityChange,
        reference: { refType: "StockAdjustment", refId: adjustment._id as any },
        performedBy: req.user?._id as any,
      });

      adjustment.appliedAt = new Date();
      await adjustment.save();
    }

    // Return created adjustment
    res.status(201).json({
      success: true,
      message: quantityChange > 0 ? "Stock adjustment applied successfully" : "Stock adjustment created and pending approval",
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `approveStockAdjustment()`
**Purpose:** Approve a pending negative stock adjustment and apply it to branch stock
**Access:** Manager, Admin
**Validation:** Adjustment must exist, must be negative, must not already be applied
**Process:** Record the stock movement, mark the adjustment as approved and applied
**Response:** Updated stock adjustment

**Controller Implementation:**
```typescript
export const approveStockAdjustment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find adjustment
    const adjustment = await StockAdjustment.findById(req.params.stockAdjustmentId);

    // Guard — adjustment must exist
    if (!adjustment) {
      return next(errorHandler(404, "Stock adjustment not found"));
    }

    // Guard — only negative adjustments require approval
    if (adjustment.quantityChange >= 0) {
      return next(errorHandler(409, "This adjustment does not require approval"));
    }

    // Guard — must not already be applied
    if (adjustment.appliedAt) {
      return next(errorHandler(409, "Adjustment already applied"));
    }

    // Record the stock movement
    await recordStockMovement({
      branch: adjustment.branch as any,
      product: adjustment.product as any,
      sku: adjustment.sku,
      type: "adjusted",
      quantity: adjustment.quantityChange,
      reference: { refType: "StockAdjustment", refId: adjustment._id as any },
      performedBy: req.user?._id as any,
    });

    // Mark as approved and applied
    adjustment.approvedBy = req.user?._id as any;
    adjustment.appliedAt = new Date();
    await adjustment.save();

    // Return updated adjustment
    res.status(200).json({
      success: true,
      message: "Stock adjustment approved and applied successfully",
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllStockAdjustments()`
**Purpose:** List stock adjustments with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch/sku/reason/pending, paginate, return results
**Response:** Stock adjustment list and pagination

**Controller Implementation:**
```typescript
export const getAllStockAdjustments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, sku, reason, pending } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (sku) {
      query.sku = sku;
    }
    if (reason) {
      query.reason = reason;
    }
    if (pending === "true") {
      query.appliedAt = { $exists: false };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch adjustments and total count
    const stockAdjustments = await StockAdjustment.find(query)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("adjustedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockAdjustment.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        stockAdjustments,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockAdjustments: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getStockAdjustmentById()`
**Purpose:** Fetch a single stock adjustment by ID
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Stock adjustment must exist
**Process:** Find adjustment by ID and return with populated refs
**Response:** Stock adjustment details

**Controller Implementation:**
```typescript
export const getStockAdjustmentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find adjustment by ID
    const adjustment = await StockAdjustment.findById(req.params.stockAdjustmentId)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("adjustedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName");

    // Guard — adjustment must exist
    if (!adjustment) {
      return next(errorHandler(404, "Stock adjustment not found"));
    }

    // Return adjustment
    res.status(200).json({
      success: true,
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Stock Adjustment Routes

### Base Path: `/api/stock-adjustments`

```typescript
GET   /                              // Get all stock adjustments (store_keeper, manager, admin, accountant)
GET   /:stockAdjustmentId            // Get single stock adjustment (store_keeper, manager, admin, accountant)
POST  /                              // Create stock adjustment (store_keeper, manager, admin)
PATCH /:stockAdjustmentId/approve    // Approve pending negative adjustment (manager, admin)
```

### Router Implementation

**File: `src/routes/stockAdjustmentRoutes.ts`**

```typescript
import express from "express";
import {
  createStockAdjustment,
  approveStockAdjustment,
  getAllStockAdjustments,
  getStockAdjustmentById,
} from "../controllers/stockAdjustmentController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getAllStockAdjustments);
router.get("/:stockAdjustmentId", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getStockAdjustmentById);
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), createStockAdjustment);
router.patch("/:stockAdjustmentId/approve", authenticateToken, authorizeRoles(["manager", "admin"]), approveStockAdjustment);

export default router;
```

### Route Details

#### `GET /api/stock-adjustments`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `branch=<branchId>`, `sku=<skuId>`, `reason=breakage|theft|expired|count_correction|other`, `pending=true`
**Response:**
```json
{
  "success": true,
  "data": {
    "stockAdjustments": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0f5",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "product": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
          "name": "Tusker Lager"
        },
        "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
        "quantityChange": -3,
        "reason": "breakage",
        "notes": "Three bottles broken during restock",
        "adjustedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
          "firstName": "James",
          "lastName": "Otieno"
        },
        "approvedBy": null,
        "appliedAt": null,
        "createdAt": "2026-08-11T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalStockAdjustments": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/stock-adjustments/:stockAdjustmentId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "adjustment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f5",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "product": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
        "name": "Tusker Lager"
      },
      "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
      "quantityChange": -3,
      "reason": "breakage",
      "notes": "Three bottles broken during restock",
      "adjustedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
        "firstName": "James",
        "lastName": "Otieno"
      },
      "approvedBy": null,
      "appliedAt": null,
      "createdAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `POST /api/stock-adjustments`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body (negative — will require approval):**
```json
{
  "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
  "product": "64f1a2b3c4d5e6f7a8b9c0d5",
  "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
  "quantityChange": -3,
  "reason": "breakage",
  "notes": "Three bottles broken during restock"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Stock adjustment created and pending approval",
  "data": {
    "adjustment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f5",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "product": "64f1a2b3c4d5e6f7a8b9c0d5",
      "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
      "quantityChange": -3,
      "reason": "breakage",
      "notes": "Three bottles broken during restock",
      "adjustedBy": "64f1a2b3c4d5e6f7a8b9c0d7",
      "createdAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/stock-adjustments/:stockAdjustmentId/approve`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Stock adjustment approved and applied successfully",
  "data": {
    "adjustment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f5",
      "quantityChange": -3,
      "approvedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "appliedAt": "2026-08-11T14:30:00.000Z"
    }
  }
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with roles
**Usage:**
```typescript
router.get("/", authenticateToken, getAllStockAdjustments);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.patch("/:stockAdjustmentId/approve", authenticateToken, authorizeRoles(["manager", "admin"]), approveStockAdjustment);
```

---

## 📝 API Examples

### Create a Positive Adjustment (applies immediately)
```bash
curl -X POST http://localhost:3500/api/stock-adjustments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "product": "64f1a2b3c4d5e6f7a8b9c0d5",
    "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
    "quantityChange": 2,
    "reason": "count_correction",
    "notes": "Found 2 extra bottles during shelf check"
  }'
```

### Create a Negative Adjustment (pending approval)
```bash
curl -X POST http://localhost:3500/api/stock-adjustments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "product": "64f1a2b3c4d5e6f7a8b9c0d5",
    "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
    "quantityChange": -3,
    "reason": "breakage",
    "notes": "Three bottles broken during restock"
  }'
```

### Approve a Pending Adjustment
```bash
curl -X PATCH http://localhost:3500/api/stock-adjustments/64f1a2b3c4d5e6f7a8b9c0f5/approve \
  -H "Authorization: Bearer <token>"
```

### List Pending Adjustments
```bash
curl -X GET "http://localhost:3500/api/stock-adjustments?pending=true" \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Creating is limited to `store_keeper`, `manager`, `admin`. Approving is restricted to `manager`, `admin` only — matches the doc's "manager approval" requirement. Reading is additionally open to `accountant`.
- **Approval gate for losses:** any negative `quantityChange` never touches stock until a manager/admin explicitly approves it — a store keeper cannot silently write off inventory.
- **Single write path for stock:** stock is only ever changed via `stockMovementService.recordStockMovement()`, guaranteeing a matching immutable `StockMovement` ledger entry for every applied adjustment.
- **Double-approval guard:** `appliedAt` presence prevents the same negative adjustment from being approved and applied twice.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing required field; `quantityChange` is 0; `notes` missing when `reason` is `'other'` |
| `400` | `recordStockMovement` — branch/SKU stock not initialized, or would go negative |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. store keeper attempting to approve) |
| `404` | Product, SKU, or stock adjustment not found |
| `409` | Approving a positive adjustment, or an already-applied adjustment |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "This adjustment does not require approval"
}
```

---

## 📊 Database Indexes

```typescript
stockAdjustmentSchema.index({ branch: 1, sku: 1 }); // ledger lookups per SKU per branch
stockAdjustmentSchema.index({ reason: 1 });          // filter by adjustment reason
stockAdjustmentSchema.index({ appliedAt: 1 });       // find pending vs applied adjustments
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
