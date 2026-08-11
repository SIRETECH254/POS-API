# 🗂️ POS API - Stock Movement Documentation

## 📋 Table of Contents
- [Stock Movement Overview](#stock-movement-overview)
- [Stock Movement Model](#-stock-movement-model)
- [Stock Movement Service](#-stock-movement-service)
- [Stock Movement Controller](#-stock-movement-controller)
- [Stock Movement Routes](#-stock-movement-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Stock Movement Overview

Stock Movement is the immutable ledger behind branch stock levels. Every unit change — a purchase received, a sale, a breakage, a stock-take correction, a branch transfer — is meant to write exactly one `StockMovement` record, scoped to a branch. It is the audit trail behind `Product.skus[].stockByBranch[].currentStock` and behind future Inventory Reports. Records are never edited or deleted.

**Important architectural note:** in this codebase SKU is not a standalone collection — it is an embedded subdocument on `Product` (`Product.skus: [skuSchema]`, each with its own `_id`). `StockMovement` therefore stores both `product` (a real `ref: "Product"`) and `sku` (the embedded subdocument's ObjectId, with no formal Mongoose `ref` since there is no top-level SKU collection to point to). Lookups resolve the SKU the same way `skuController.ts` already does — `Product.findById(product)` then `product.skus.id(sku)`.

**Current scope — read-only ledger:** the modules that are documented as the *triggers* for stock movements (`Purchase` received, `Tab` completed, `StockAdjustment` approved, `Transfer` dispatched/received) do not exist yet in this codebase. This module therefore ships two read endpoints (`getAllStockMovements`, `getStockMovementById`) for viewing the ledger. The write path — `stockMovementService.recordStockMovement()` — is fully implemented as the single entry point for all branch-scoped stock changes (it writes the ledger entry *and* atomically updates the SKU's `stockByBranch.currentStock`), but it is not yet wired to any public route. Future Purchase/Tab/StockAdjustment/Transfer controllers will import and call this service directly rather than mutating `stockByBranch` themselves.

---

## 👤 Stock Movement Model

### Schema Definition
```typescript
export type StockMovementType =
  | "purchased"
  | "sold"
  | "adjusted"
  | "returned"
  | "damaged"
  | "transferred_out"
  | "transferred_in";

export type StockMovementRefType = "Purchase" | "Tab" | "StockAdjustment" | "Transfer";

export interface IStockMovementReference {
  refType?: StockMovementRefType;
  refId?: Types.ObjectId;
}

export interface IStockMovement extends Document {
  branch: Types.ObjectId | IBranch;
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  reference?: IStockMovementReference;
  reason?: string;
  performedBy: Types.ObjectId | IUser;
  createdAt: Date;
}
```

### Model Implementation

**File: `src/models/StockMovement.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IStockMovement } from "../type";

const stockMovementSchema = new Schema<IStockMovement>(
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
    type: {
      type: String,
      enum: ["purchased", "sold", "adjusted", "returned", "damaged", "transferred_out", "transferred_in"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      refType: {
        type: String,
        enum: ["Purchase", "Tab", "StockAdjustment", "Transfer"],
      },
      refId: {
        type: Schema.Types.ObjectId,
      },
    },
    reason: {
      type: String,
      trim: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockMovementSchema.index({ branch: 1, sku: 1 });
stockMovementSchema.index({ branch: 1, createdAt: -1 });
stockMovementSchema.index({ type: 1 });
stockMovementSchema.index({ "reference.refType": 1, "reference.refId": 1 });

const StockMovement = mongoose.model<IStockMovement>("StockMovement", stockMovementSchema);
export default StockMovement;
```

### Validation Rules
```typescript
branch:       { required: true, ObjectId ref: 'Branch' }
product:      { required: true, ObjectId ref: 'Product' }
sku:          { required: true, ObjectId — subdocument id on Product.skus, no ref }
type:         { required: true, enum: ['purchased','sold','adjusted','returned','damaged','transferred_out','transferred_in'] }
quantity:     { required: true, signed — positive increases stock, negative decreases it }
balanceAfter: { required: true, min: 0 }
reference:    { optional — { refType: enum, refId: ObjectId } }
reason:       { optional, trim: true }
performedBy:  { required: true, ObjectId ref: 'User' }
createdAt:    { auto, immutable — no updatedAt }
```

---

## ⚙️ Stock Movement Service

**File:** `src/services/internal/stockMovementService.ts`

The single entry point for all branch-scoped stock changes. Any future controller that needs to change `stockByBranch.currentStock` calls this function instead of mutating the Product document directly, guaranteeing every stock change has a matching ledger entry.

### `recordStockMovement()`
**Purpose:** Write a StockMovement ledger entry and atomically apply the resulting balance to `Product.skus.stockByBranch.currentStock`
**Process:**
1. Load the `Product`, resolve the SKU subdocument via `product.skus.id(sku)`
2. Locate the `stockByBranch` entry for the given branch — the entry must already be initialized via `setBranchStockLevel`, it is never silently created here
3. Compute the signed delta from `type`: `purchased`/`returned`/`transferred_in` apply `+Math.abs(quantity)`; `sold`/`damaged`/`transferred_out` apply `-Math.abs(quantity)`; `adjusted` applies `quantity` exactly as given (positive or negative correction)
4. Guard — the resulting balance must not go negative
5. Persist the new `currentStock` on the Product, then create the immutable `StockMovement` record with `balanceAfter` set to the new balance

**Implementation:**
```typescript
import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Product from "../../models/Product";
import StockMovement from "../../models/StockMovement";
import { IStockMovement, StockMovementRefType, StockMovementType } from "../../type";

const INCREASING_TYPES: StockMovementType[] = ["purchased", "returned", "transferred_in"];
const DECREASING_TYPES: StockMovementType[] = ["sold", "damaged", "transferred_out"];

interface RecordStockMovementParams {
  branch: string | Types.ObjectId;
  product: string | Types.ObjectId;
  sku: string | Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  reason?: string;
  reference?: { refType: StockMovementRefType; refId: Types.ObjectId | string };
  performedBy: string | Types.ObjectId;
}

export const recordStockMovement = async (
  params: RecordStockMovementParams
): Promise<IStockMovement> => {
  const { branch, product: productId, sku, type, quantity, reason, reference, performedBy } = params;

  const product = await Product.findById(productId);
  if (!product) {
    throw errorHandler(404, "Product not found");
  }

  const skuDoc = product.skus.id(sku as any);
  if (!skuDoc) {
    throw errorHandler(404, "SKU not found");
  }

  const branchEntry = (skuDoc.stockByBranch as any[]).find(
    (entry: any) => entry.branch.toString() === branch.toString()
  );
  if (!branchEntry) {
    throw errorHandler(400, "Stock not initialized for this branch/SKU — use setBranchStockLevel first");
  }

  let signedQuantity: number;
  if (INCREASING_TYPES.includes(type)) {
    signedQuantity = Math.abs(quantity);
  } else if (DECREASING_TYPES.includes(type)) {
    signedQuantity = -Math.abs(quantity);
  } else {
    signedQuantity = quantity;
  }

  const newBalance = branchEntry.currentStock + signedQuantity;

  if (newBalance < 0) {
    throw errorHandler(400, "Insufficient stock for this movement");
  }

  branchEntry.currentStock = newBalance;
  await product.save();

  const movement = await StockMovement.create({
    branch,
    product: productId,
    sku,
    type,
    quantity: signedQuantity,
    balanceAfter: newBalance,
    reference,
    reason,
    performedBy,
  });

  return movement;
};
```

> **Note:** `recordStockMovement` throws (via `errorHandler`, the same `Error`-with-`.statusCode` utility used across controllers) rather than calling `next()`, since services run outside the Express request cycle. Callers in future controllers should `try/catch` and pass the caught error to `next(error)`.

---

## 🎮 Stock Movement Controller

**File:** `src/controllers/stockMovementController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockMovement from "../models/StockMovement";
```

### Functions Overview

#### `getAllStockMovements()`
**Purpose:** List the stock movement ledger with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch/product/sku/type/date range, populate branch/product/performedBy, paginate, return results
**Response:** Stock movement list and pagination

**Controller Implementation:**
```typescript
export const getAllStockMovements = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, product, sku, type, dateFrom, dateTo } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (product) {
      query.product = product;
    }
    if (sku) {
      query.sku = sku;
    }
    if (type) {
      query.type = type;
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = new Date(dateFrom as string);
      }
      if (dateTo) {
        query.createdAt.$lte = new Date(dateTo as string);
      }
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch stock movements and total count
    const stockMovements = await StockMovement.find(query)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("performedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockMovement.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        stockMovements,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockMovements: total,
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

#### `getStockMovementById()`
**Purpose:** Fetch a single stock movement ledger entry
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Stock movement must exist
**Process:** Find stock movement by ID with populated branch/product/performedBy, return
**Response:** Stock movement details

**Controller Implementation:**
```typescript
export const getStockMovementById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find stock movement by ID
    const stockMovement = await StockMovement.findById(req.params.stockMovementId)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("performedBy", "firstName lastName");

    // Guard — stock movement must exist
    if (!stockMovement) {
      return next(errorHandler(404, "Stock movement not found"));
    }

    // Return stock movement
    res.status(200).json({
      success: true,
      data: { stockMovement },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Stock Movement Routes

### Base Path: `/api/stock-movements`

```typescript
GET    /                        // Get all stock movements (store_keeper, manager, admin, accountant)
GET    /:stockMovementId        // Get single stock movement (store_keeper, manager, admin, accountant)
```

### Router Implementation

**File: `src/routes/stockMovementRoutes.ts`**

```typescript
import express from "express";
import { getAllStockMovements, getStockMovementById } from "../controllers/stockMovementController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllStockMovements
);
router.get(
  "/:stockMovementId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getStockMovementById
);

export default router;
```

### Route Details

#### `GET /api/stock-movements`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `branch=<branchId>`, `product=<productId>`, `sku=<skuId>`, `type=purchased|sold|adjusted|returned|damaged|transferred_out|transferred_in`, `dateFrom=2026-08-01`, `dateTo=2026-08-11`
**Response:**
```json
{
  "success": true,
  "data": {
    "stockMovements": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
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
        "type": "purchased",
        "quantity": 24,
        "balanceAfter": 74,
        "reference": {
          "refType": "Purchase",
          "refId": "64f1a2b3c4d5e6f7a8b9c0e2"
        },
        "reason": "Weekly restock from Kenya Breweries Ltd",
        "performedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
          "firstName": "James",
          "lastName": "Otieno"
        },
        "createdAt": "2026-08-11T09:15:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalStockMovements": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/stock-movements/:stockMovementId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "stockMovement": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
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
      "type": "sold",
      "quantity": -2,
      "balanceAfter": 72,
      "reference": {
        "refType": "Tab",
        "refId": "64f1a2b3c4d5e6f7a8b9c0e3"
      },
      "reason": "",
      "performedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
        "firstName": "Mercy",
        "lastName": "Wanjiru"
      },
      "createdAt": "2026-08-11T20:42:00.000Z"
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
router.get("/", authenticateToken, getAllStockMovements);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getAllStockMovements);
```

> This codebase does not yet implement `requireBranchAccess` or `requirePermission` (referenced as target middleware in `CLAUDE.md`) — only `authenticateToken` and `authorizeRoles` exist and are wired up here.

---

## 📝 API Examples

### Get All Stock Movements
```bash
curl -X GET "http://localhost:3500/api/stock-movements?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

### Filter Stock Movements by Branch and Type
```bash
curl -X GET "http://localhost:3500/api/stock-movements?branch=64f1a2b3c4d5e6f7a8b9c0d3&type=sold" \
  -H "Authorization: Bearer <token>"
```

### Filter Stock Movements by SKU and Date Range
```bash
curl -X GET "http://localhost:3500/api/stock-movements?sku=64f1a2b3c4d5e6f7a8b9c0d6&dateFrom=2026-08-01&dateTo=2026-08-11" \
  -H "Authorization: Bearer <token>"
```

### Get Stock Movement by ID
```bash
curl -X GET http://localhost:3500/api/stock-movements/64f1a2b3c4d5e6f7a8b9c0e1 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Reading the ledger is limited to `store_keeper`, `manager`, `admin`, and `accountant` — roles with a legitimate need to see inventory movement history.
- **Immutability:** No update or delete endpoint exists for this module, matching the ledger's audit requirement — a movement, once written, is permanent.
- **Single write path:** `stockMovementService.recordStockMovement()` is the only code path meant to change `stockByBranch.currentStock`, so every stock change is guaranteed to leave a matching ledger entry once Purchase/Tab/StockAdjustment/Transfer are wired to call it.
- **Non-negative balance guard:** the service rejects any movement that would drive `currentStock` below zero.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | `recordStockMovement` called for a branch/SKU with no initialized `stockByBranch` entry |
| `400` | `recordStockMovement` would drive `currentStock` below zero |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. bartender reading the ledger) |
| `404` | Stock movement not found by ID (`getStockMovementById`) |
| `404` | Product or SKU not found (`recordStockMovement`) |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Stock movement not found"
}
```

---

## 📊 Database Indexes

```typescript
stockMovementSchema.index({ branch: 1, sku: 1 });                            // ledger lookups per SKU per branch
stockMovementSchema.index({ branch: 1, createdAt: -1 });                     // branch-scoped ledger, newest first
stockMovementSchema.index({ type: 1 });                                      // filter by movement type
stockMovementSchema.index({ "reference.refType": 1, "reference.refId": 1 }); // trace movements back to their trigger document
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
