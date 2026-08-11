# 🗂️ POS API - Stock Count Documentation

## 📋 Table of Contents
- [Stock Count Overview](#stock-count-overview)
- [Stock Count Model](#-stock-count-model)
- [Stock Count Controller](#-stock-count-controller)
- [Stock Count Routes](#-stock-count-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Stock Count Overview

Stock Count is a branch stock-take (physical inventory audit) with a three-step lifecycle: `in_progress → completed → reconciled`.

1. **`startStockCount()`** snapshots the system's current stock (`expectedQuantity`) for a chosen list of SKUs at a branch, and opens the count.
2. **`submitStockCount()`** records what was physically counted (`actualQuantity`) for every item and computes each line's `variance = actualQuantity - expectedQuantity`. No stock is touched yet.
3. **`reconcileStockCount()`** (manager/admin only) walks every non-zero-variance line and applies it as a **pre-approved** `StockAdjustment` (`reason: "count_correction"`) via `stockMovementService.recordStockMovement()` — this is the only step that actually changes `stockByBranch.currentStock`. The generated adjustments are pre-approved (`approvedBy`/`appliedAt` set immediately) since the reconciling manager is implicitly the approver; see `STOCKADJUSTMENT_DOCUMENTATION.md`.

This matches the target doc's note: *"on reconciled, each variance line generates a StockAdjustment + StockMovement so the ledger stays the single source of truth."*

---

## 👤 Stock Count Model

### Schema Definition
```typescript
export type StockCountStatus = "in_progress" | "completed" | "reconciled";

export interface IStockCountItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  expectedQuantity: number;
  actualQuantity: number;
  variance: number;
}

export interface IStockCount extends Document {
  branch: Types.ObjectId | IBranch;
  countNumber: string;
  items: IStockCountItem[];
  status: StockCountStatus;
  countedBy: Types.ObjectId | IUser;
  reviewedBy?: Types.ObjectId | IUser;
  createdAt: Date;
  completedAt?: Date;
}
```

### Model Implementation

**File: `src/models/StockCount.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IStockCount } from "../type";

const stockCountItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    sku: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    expectedQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    actualQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    variance: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const stockCountSchema = new Schema<IStockCount>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    countNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    items: {
      type: [stockCountItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "reconciled"],
      default: "in_progress",
    },
    countedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockCountSchema.index({ branch: 1 });
stockCountSchema.index({ status: 1 });

const StockCount = mongoose.model<IStockCount>("StockCount", stockCountSchema);
export default StockCount;
```

### Validation Rules
```typescript
branch:      { required: true, ObjectId ref: 'Branch' }
countNumber: { required: true, unique: true, trim: true, auto-generated }
items:       { default: [], each: { product: required ref Product, sku: required (no ref), expectedQuantity: required min 0, actualQuantity: default 0 min 0, variance: default 0 } }
status:      { default: 'in_progress', enum: ['in_progress','completed','reconciled'] }
countedBy:   { required: true, ObjectId ref: 'User' }
reviewedBy:  { optional, ObjectId ref: 'User' — set at reconciliation }
completedAt: { optional, Date — set on submit }
```

---

## 🎮 Stock Count Controller

**File:** `src/controllers/stockCountController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockCount from "../models/StockCount";
import StockAdjustment from "../models/StockAdjustment";
import Branch from "../models/Branch";
import Product from "../models/Product";
import { generateStockCountNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";
```

### Functions Overview

#### `startStockCount()`
**Purpose:** Begin a stock-take for a branch, snapshotting expected quantities for the listed SKUs
**Access:** Store Keeper, Manager, Admin
**Validation:** Branch and items required; each item's product/SKU must exist with initialized branch stock
**Process:** Snapshot `expectedQuantity` per item, generate count number, create stock count
**Response:** Created stock count

**Controller Implementation:**
```typescript
export const startStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, items } = req.body;

    // Guard — branch and items required
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Validate each item and snapshot expected quantity
    const preparedItems: any[] = [];

    for (const item of items) {
      const { product, sku } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }

      // Guard — product must exist
      const productDoc = await Product.findById(product);
      if (!productDoc) {
        return next(errorHandler(404, `Product not found: ${product}`));
      }

      // Guard — SKU must exist on the product
      const skuDoc = productDoc.skus.id(sku);
      if (!skuDoc) {
        return next(errorHandler(404, `SKU not found on product: ${sku}`));
      }

      // Guard — branch stock must already be initialized for this SKU
      const branchEntry = (skuDoc.stockByBranch as any[]).find(
        (entry: any) => entry.branch.toString() === branch.toString()
      );
      if (!branchEntry) {
        return next(errorHandler(400, `Stock not initialized for this branch/SKU: ${sku}`));
      }

      preparedItems.push({
        product,
        sku,
        expectedQuantity: branchEntry.currentStock,
        actualQuantity: 0,
        variance: 0 - branchEntry.currentStock,
      });
    }

    // Generate count number
    const countNumber = await generateStockCountNumber(branchDoc.code, String(branchDoc._id));

    // Create stock count
    const stockCount = await StockCount.create({
      branch,
      countNumber,
      items: preparedItems,
      status: "in_progress",
      countedBy: req.user?._id,
    });

    // Return created stock count
    res.status(201).json({
      success: true,
      message: "Stock count started successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `submitStockCount()`
**Purpose:** Record physically counted quantities for every item on an in-progress stock count
**Access:** Store Keeper, Manager, Admin
**Validation:** Stock count must exist and be in `'in_progress'` status; every item must be covered
**Process:** Apply `actualQuantity` per item, recompute `variance`, mark as completed
**Response:** Updated stock count

**Controller Implementation:**
```typescript
export const submitStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { items } = req.body;

    // Guard — items required
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one counted item is required"));
    }

    // Find stock count
    const stockCount = await StockCount.findById(req.params.stockCountId);

    // Guard — stock count must exist
    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    // Guard — must still be in progress
    if (stockCount.status !== "in_progress") {
      return next(errorHandler(409, "Stock count is not in progress"));
    }

    // Guard — every item on the count must be covered
    if (items.length !== stockCount.items.length) {
      return next(errorHandler(400, "All items must be counted before submitting"));
    }

    // Apply counted quantities
    for (const counted of items) {
      const { sku, actualQuantity } = counted;

      if (!sku) {
        return next(errorHandler(400, "SKU is required for each counted item"));
      }
      if (actualQuantity === undefined || actualQuantity < 0) {
        return next(errorHandler(400, "Actual quantity is required for each counted item"));
      }

      const existingItem = stockCount.items.find((i: any) => i.sku.toString() === sku.toString());
      if (!existingItem) {
        return next(errorHandler(400, `SKU was not part of this stock count: ${sku}`));
      }

      existingItem.actualQuantity = actualQuantity;
      existingItem.variance = actualQuantity - existingItem.expectedQuantity;
    }

    // Mark as completed
    stockCount.status = "completed";
    stockCount.completedAt = new Date();
    await stockCount.save();

    // Return updated stock count
    res.status(200).json({
      success: true,
      message: "Stock count submitted successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `reconcileStockCount()`
**Purpose:** Apply each variance line as a pre-approved stock adjustment, updating branch stock
**Access:** Manager, Admin
**Validation:** Stock count must exist and be in `'completed'` status
**Process:** For each non-zero variance, create a `StockAdjustment` and record a stock movement
**Response:** Updated stock count

**Controller Implementation:**
```typescript
export const reconcileStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find stock count
    const stockCount = await StockCount.findById(req.params.stockCountId);

    // Guard — stock count must exist
    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    // Guard — must be completed
    if (stockCount.status !== "completed") {
      return next(errorHandler(409, "Stock count must be completed before it can be reconciled"));
    }

    // Apply a pre-approved adjustment per variance line
    for (const item of stockCount.items) {
      if (item.variance === 0) {
        continue;
      }

      const adjustment = await StockAdjustment.create({
        branch: stockCount.branch,
        product: item.product,
        sku: item.sku,
        quantityChange: item.variance,
        reason: "count_correction",
        adjustedBy: stockCount.countedBy,
        approvedBy: req.user?._id,
        appliedAt: new Date(),
        stockCount: stockCount._id,
      });

      await recordStockMovement({
        branch: stockCount.branch as any,
        product: item.product as any,
        sku: item.sku,
        type: "adjusted",
        quantity: item.variance,
        reference: { refType: "StockAdjustment", refId: adjustment._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark as reconciled
    stockCount.status = "reconciled";
    stockCount.reviewedBy = req.user?._id as any;
    await stockCount.save();

    // Return updated stock count
    res.status(200).json({
      success: true,
      message: "Stock count reconciled successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllStockCounts()`
**Purpose:** List stock counts with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch/status, paginate, return results
**Response:** Stock count list and pagination

**Controller Implementation:**
```typescript
export const getAllStockCounts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page = 1, limit = 10, branch, status } = req.query;

    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    const stockCounts = await StockCount.find(query)
      .populate("branch", "name code")
      .populate("countedBy", "firstName lastName")
      .populate("reviewedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockCount.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    res.status(200).json({
      success: true,
      data: {
        stockCounts,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockCounts: total,
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

#### `getStockCountById()`
**Purpose:** Fetch a single stock count by ID
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Stock count must exist
**Process:** Find stock count by ID and return with populated refs
**Response:** Stock count details

**Controller Implementation:**
```typescript
export const getStockCountById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stockCount = await StockCount.findById(req.params.stockCountId)
      .populate("branch", "name code")
      .populate("countedBy", "firstName lastName")
      .populate("reviewedBy", "firstName lastName")
      .populate("items.product", "name");

    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    res.status(200).json({
      success: true,
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Stock Count Routes

### Base Path: `/api/stock-counts`

```typescript
GET   /                          // Get all stock counts (store_keeper, manager, admin, accountant)
GET   /:stockCountId             // Get single stock count (store_keeper, manager, admin, accountant)
POST  /                          // Start stock count (store_keeper, manager, admin)
PATCH /:stockCountId/submit      // Submit counted quantities (store_keeper, manager, admin)
PATCH /:stockCountId/reconcile   // Reconcile completed count (manager, admin)
```

### Router Implementation

**File: `src/routes/stockCountRoutes.ts`**

```typescript
import express from "express";
import {
  startStockCount,
  submitStockCount,
  reconcileStockCount,
  getAllStockCounts,
  getStockCountById,
} from "../controllers/stockCountController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getAllStockCounts);
router.get("/:stockCountId", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getStockCountById);
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), startStockCount);
router.patch("/:stockCountId/submit", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), submitStockCount);
router.patch("/:stockCountId/reconcile", authenticateToken, authorizeRoles(["manager", "admin"]), reconcileStockCount);

export default router;
```

### Route Details

#### `POST /api/stock-counts`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
  "items": [
    { "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6" }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Stock count started successfully",
  "data": {
    "stockCount": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f9",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "countNumber": "MAIN-SC-2026-0001",
      "items": [
        {
          "product": "64f1a2b3c4d5e6f7a8b9c0d5",
          "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
          "expectedQuantity": 72,
          "actualQuantity": 0,
          "variance": -72
        }
      ],
      "status": "in_progress",
      "countedBy": "64f1a2b3c4d5e6f7a8b9c0d7",
      "createdAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/stock-counts/:stockCountId/submit`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "items": [
    { "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "actualQuantity": 70 }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Stock count submitted successfully",
  "data": {
    "stockCount": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f9",
      "countNumber": "MAIN-SC-2026-0001",
      "items": [
        {
          "product": "64f1a2b3c4d5e6f7a8b9c0d5",
          "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
          "expectedQuantity": 72,
          "actualQuantity": 70,
          "variance": -2
        }
      ],
      "status": "completed",
      "completedAt": "2026-08-11T12:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/stock-counts/:stockCountId/reconcile`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Stock count reconciled successfully",
  "data": {
    "stockCount": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f9",
      "countNumber": "MAIN-SC-2026-0001",
      "status": "reconciled",
      "reviewedBy": "64f1a2b3c4d5e6f7a8b9c0d8"
    }
  }
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with roles

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.patch("/:stockCountId/reconcile", authenticateToken, authorizeRoles(["manager", "admin"]), reconcileStockCount);
```

---

## 📝 API Examples

### Start a Stock Count
```bash
curl -X POST http://localhost:3500/api/stock-counts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "items": [{ "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6" }]
  }'
```

### Submit Counted Quantities
```bash
curl -X PATCH http://localhost:3500/api/stock-counts/64f1a2b3c4d5e6f7a8b9c0f9/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "items": [{ "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "actualQuantity": 70 }] }'
```

### Reconcile a Completed Count
```bash
curl -X PATCH http://localhost:3500/api/stock-counts/64f1a2b3c4d5e6f7a8b9c0f9/reconcile \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Starting and submitting are limited to `store_keeper`, `manager`, `admin`. Reconciling — the step that actually changes stock — is restricted to `manager`, `admin` only, matching the doc's `reviewedBy: manager` intent. Reading is additionally open to `accountant`.
- **No direct stock mutation:** neither `startStockCount` nor `submitStockCount` touch `stockByBranch` — only `reconcileStockCount` does, and only through `stockMovementService.recordStockMovement()`.
- **Full coverage guard:** `submitStockCount` rejects a submission that doesn't cover every item on the count, preventing a partially-counted stock-take from being marked complete.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing required field; branch/SKU stock not initialized when starting; not all items counted when submitting |
| `400` | `recordStockMovement` — branch/SKU stock not initialized, or would go negative (during reconcile) |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. store keeper attempting to reconcile) |
| `404` | Branch, product, SKU, or stock count not found |
| `409` | Submitting a count that isn't `in_progress`; reconciling a count that isn't `completed` |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Stock count must be completed before it can be reconciled"
}
```

---

## 📊 Database Indexes

```typescript
stockCountSchema.index({ branch: 1 }); // scope counts to a branch
stockCountSchema.index({ status: 1 }); // filter by in_progress/completed/reconciled
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
