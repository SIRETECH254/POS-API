# 🗂️ POS API - Transfer Documentation

## 📋 Table of Contents
- [Transfer Overview](#transfer-overview)
- [Transfer Model](#-transfer-model)
- [Transfer Controller](#-transfer-controller)
- [Transfer Routes](#-transfer-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Transfer Overview

Transfer moves stock between two branches through a three-step lifecycle: `pending → in_transit → received`.

1. **`createTransfer()`** records intent — which SKUs, how much, from which branch to which branch. No stock moves yet.
2. **`dispatchTransfer()`** is called at the source branch: it writes a `transferred_out` `StockMovement` per item via `stockMovementService.recordStockMovement()`, decrementing `fromBranch` stock (and naturally rejecting the request if there isn't enough stock to send).
3. **`receiveTransfer()`** is called at the destination branch once the goods physically arrive: it writes a `transferred_in` `StockMovement` per item, incrementing `toBranch` stock.

Both branches' `stockByBranch` entries for every item must already be initialized (via `SKU.setBranchStockLevel`) before dispatch/receive — the same precondition every other module that writes through `recordStockMovement` relies on.

**Schema note beyond the original target design:** a `createdBy` field was added. The documented interface only has `sentBy`/`receivedBy`, but a transfer exists in `pending` status before anyone has sent it — `createdBy` records who initiated the request, matching the convention every other creatable entity in this codebase follows.

**Not built in this pass:** there's no `cancelTransfer()` endpoint, so the `'cancelled'` status value isn't currently reachable through the API — same scope restraint applied to Purchase's missing cancel path.

---

## 👤 Transfer Model

### Schema Definition
```typescript
export type TransferStatus = "pending" | "in_transit" | "received" | "cancelled";

export interface ITransferItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantity: number;
}

export interface ITransfer extends Document {
  transferNumber: string;
  fromBranch: Types.ObjectId | IBranch;
  toBranch: Types.ObjectId | IBranch;
  items: ITransferItem[];
  status: TransferStatus;
  createdBy: Types.ObjectId | IUser;
  sentBy?: Types.ObjectId | IUser;
  receivedBy?: Types.ObjectId | IUser;
  createdAt: Date;
  receivedAt?: Date;
}
```

### Model Implementation

**File: `src/models/Transfer.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { ITransfer } from "../type";

const transferItemSchema = new Schema(
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
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const transferSchema = new Schema<ITransfer>(
  {
    transferNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    fromBranch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    toBranch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    items: {
      type: [transferItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "in_transit", "received", "cancelled"],
      default: "pending",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sentBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

transferSchema.index({ fromBranch: 1 });
transferSchema.index({ toBranch: 1 });
transferSchema.index({ status: 1 });

const Transfer = mongoose.model<ITransfer>("Transfer", transferSchema);
export default Transfer;
```

### Validation Rules
```typescript
transferNumber: { required: true, unique: true, trim: true, auto-generated }
fromBranch:     { required: true, ObjectId ref: 'Branch' }
toBranch:       { required: true, ObjectId ref: 'Branch' — must differ from fromBranch }
items:          { default: [], each: { product: required ref Product, sku: required (no ref), quantity: required min 1 } }
status:         { default: 'pending', enum: ['pending','in_transit','received','cancelled'] }
createdBy:      { required: true, ObjectId ref: 'User' }
sentBy:         { optional, ObjectId ref: 'User' — set on dispatch }
receivedBy:     { optional, ObjectId ref: 'User' — set on receive }
receivedAt:     { optional, Date — set on receive }
```

---

## 🎮 Transfer Controller

**File:** `src/controllers/transferController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Transfer from "../models/Transfer";
import Branch from "../models/Branch";
import Product from "../models/Product";
import { generateTransferNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";
import { createNotification } from "../services/internal/notificationService";
```

### Functions Overview

#### `createTransfer()`
**Purpose:** Create a new branch-to-branch stock transfer request
**Access:** Store Keeper, Manager, Admin
**Validation:** `fromBranch`/`toBranch` required and must differ; items required; each item's product and SKU must exist
**Process:** Validate branches and items, generate transfer number, create transfer
**Response:** Created transfer

**Controller Implementation:**
```typescript
export const createTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fromBranch, toBranch, items } = req.body;

    if (!fromBranch) {
      return next(errorHandler(400, "fromBranch is required"));
    }
    if (!toBranch) {
      return next(errorHandler(400, "toBranch is required"));
    }
    if (fromBranch === toBranch) {
      return next(errorHandler(400, "fromBranch and toBranch must be different"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    const fromBranchDoc = await Branch.findById(fromBranch);
    if (!fromBranchDoc) {
      return next(errorHandler(404, "fromBranch not found"));
    }
    const toBranchDoc = await Branch.findById(toBranch);
    if (!toBranchDoc) {
      return next(errorHandler(404, "toBranch not found"));
    }

    const preparedItems: any[] = [];

    for (const item of items) {
      const { product, sku, quantity } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }
      if (!quantity || quantity < 1) {
        return next(errorHandler(400, "Quantity must be at least 1 for each item"));
      }

      const productDoc = await Product.findById(product);
      if (!productDoc) {
        return next(errorHandler(404, `Product not found: ${product}`));
      }

      const skuDoc = productDoc.skus.id(sku);
      if (!skuDoc) {
        return next(errorHandler(404, `SKU not found on product: ${sku}`));
      }

      preparedItems.push({ product, sku, quantity });
    }

    const transferNumber = await generateTransferNumber(fromBranchDoc.code, String(fromBranchDoc._id));

    const transfer = await Transfer.create({
      transferNumber,
      fromBranch,
      toBranch,
      items: preparedItems,
      status: "pending",
      createdBy: req.user?._id,
    });

    res.status(201).json({
      success: true,
      message: "Transfer created successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `dispatchTransfer()`
**Purpose:** Send a pending transfer, decrementing stock at the source branch
**Access:** Store Keeper, Manager, Admin
**Validation:** Transfer must exist and be in `'pending'` status
**Process:** Record a `transferred_out` stock movement per item, mark as `in_transit`
**Response:** Updated transfer

**Controller Implementation:**
```typescript
export const dispatchTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transfer = await Transfer.findById(req.params.transferId);

    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }
    if (transfer.status !== "pending") {
      return next(errorHandler(409, "Transfer is not pending"));
    }

    for (const item of transfer.items) {
      await recordStockMovement({
        branch: transfer.fromBranch as any,
        product: item.product as any,
        sku: item.sku,
        type: "transferred_out",
        quantity: item.quantity,
        reference: { refType: "Transfer", refId: transfer._id as any },
        performedBy: req.user?._id as any,
      });
    }

    transfer.status = "in_transit";
    transfer.sentBy = req.user?._id as any;
    await transfer.save();

    res.status(200).json({
      success: true,
      message: "Transfer dispatched successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `receiveTransfer()`
**Purpose:** Receive an in-transit transfer, incrementing stock at the destination branch
**Access:** Store Keeper, Manager, Admin
**Validation:** Transfer must exist and be in `'in_transit'` status
**Process:** Record a `transferred_in` stock movement per item, mark as `received`, notify the receiving branch's managers
**Response:** Updated transfer

**Controller Implementation:**
```typescript
export const receiveTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transfer = await Transfer.findById(req.params.transferId);

    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }
    if (transfer.status !== "in_transit") {
      return next(errorHandler(409, "Transfer is not in transit"));
    }

    for (const item of transfer.items) {
      await recordStockMovement({
        branch: transfer.toBranch as any,
        product: item.product as any,
        sku: item.sku,
        type: "transferred_in",
        quantity: item.quantity,
        reference: { refType: "Transfer", refId: transfer._id as any },
        performedBy: req.user?._id as any,
      });
    }

    transfer.status = "received";
    transfer.receivedBy = req.user?._id as any;
    transfer.receivedAt = new Date();
    await transfer.save();

    // Notify managers at the receiving branch
    await createNotification({
      branch: transfer.toBranch as any,
      recipientRole: "manager",
      type: "transfer_received",
      title: "Stock transfer received",
      message: `Transfer ${transfer.transferNumber} has arrived and been added to stock.`,
      metadata: { transferId: transfer._id, fromBranch: transfer.fromBranch },
    });

    res.status(200).json({
      success: true,
      message: "Transfer received successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllTransfers()`
**Purpose:** List transfers with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by `fromBranch`/`toBranch`/`status`, paginate, return results
**Response:** Transfer list and pagination

**Controller Implementation:**
```typescript
export const getAllTransfers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page = 1, limit = 10, fromBranch, toBranch, status } = req.query;

    const query: any = {};
    if (fromBranch) {
      query.fromBranch = fromBranch;
    }
    if (toBranch) {
      query.toBranch = toBranch;
    }
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    const transfers = await Transfer.find(query)
      .populate("fromBranch", "name code")
      .populate("toBranch", "name code")
      .populate("createdBy", "firstName lastName")
      .populate("sentBy", "firstName lastName")
      .populate("receivedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Transfer.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    res.status(200).json({
      success: true,
      data: {
        transfers,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalTransfers: total,
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

#### `getTransferById()`
**Purpose:** Fetch a single transfer by ID
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Transfer must exist
**Process:** Find transfer by ID and return with populated refs
**Response:** Transfer details

**Controller Implementation:**
```typescript
export const getTransferById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transfer = await Transfer.findById(req.params.transferId)
      .populate("fromBranch", "name code")
      .populate("toBranch", "name code")
      .populate("createdBy", "firstName lastName")
      .populate("sentBy", "firstName lastName")
      .populate("receivedBy", "firstName lastName")
      .populate("items.product", "name");

    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }

    res.status(200).json({
      success: true,
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Transfer Routes

### Base Path: `/api/transfers`

```typescript
GET   /                       // Get all transfers (store_keeper, manager, admin, accountant)
GET   /:transferId            // Get single transfer (store_keeper, manager, admin, accountant)
POST  /                       // Create transfer (store_keeper, manager, admin)
PATCH /:transferId/dispatch   // Dispatch transfer (store_keeper, manager, admin)
PATCH /:transferId/receive    // Receive transfer (store_keeper, manager, admin)
```

### Router Implementation

**File: `src/routes/transferRoutes.ts`**

```typescript
import express from "express";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  getAllTransfers,
  getTransferById,
} from "../controllers/transferController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getAllTransfers);
router.get("/:transferId", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getTransferById);
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), createTransfer);
router.patch("/:transferId/dispatch", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), dispatchTransfer);
router.patch("/:transferId/receive", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), receiveTransfer);

export default router;
```

### Route Details

#### `POST /api/transfers`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "fromBranch": "64f1a2b3c4d5e6f7a8b9c0d3",
  "toBranch": "64f1a2b3c4d5e6f7a8b9c0e0",
  "items": [
    { "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "quantity": 12 }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Transfer created successfully",
  "data": {
    "transfer": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "transferNumber": "MAIN-TRF-2026-0001",
      "fromBranch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "toBranch": "64f1a2b3c4d5e6f7a8b9c0e0",
      "items": [
        { "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "quantity": 12 }
      ],
      "status": "pending",
      "createdBy": "64f1a2b3c4d5e6f7a8b9c0d7",
      "createdAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/transfers/:transferId/dispatch`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Transfer dispatched successfully",
  "data": {
    "transfer": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "transferNumber": "MAIN-TRF-2026-0001",
      "status": "in_transit",
      "sentBy": "64f1a2b3c4d5e6f7a8b9c0d7"
    }
  }
}
```

#### `PATCH /api/transfers/:transferId/receive`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Transfer received successfully",
  "data": {
    "transfer": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "transferNumber": "MAIN-TRF-2026-0001",
      "status": "received",
      "receivedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "receivedAt": "2026-08-11T15:00:00.000Z"
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
router.patch("/:transferId/dispatch", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), dispatchTransfer);
```

---

## 📝 API Examples

### Create a Transfer
```bash
curl -X POST http://localhost:3500/api/transfers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "fromBranch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "toBranch": "64f1a2b3c4d5e6f7a8b9c0e0",
    "items": [{ "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "quantity": 12 }]
  }'
```

### Dispatch a Transfer
```bash
curl -X PATCH http://localhost:3500/api/transfers/64f1a2b3c4d5e6f7a8b9c1a1/dispatch \
  -H "Authorization: Bearer <token>"
```

### Receive a Transfer
```bash
curl -X PATCH http://localhost:3500/api/transfers/64f1a2b3c4d5e6f7a8b9c1a1/receive \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Create/dispatch/receive are limited to `store_keeper`, `manager`, `admin`. Reading is additionally open to `accountant`.
- **State guards:** `dispatchTransfer` only runs on `'pending'` transfers; `receiveTransfer` only runs on `'in_transit'` ones — prevents double-dispatch (double-decrementing source stock) or receiving a transfer that was never sent.
- **Single write path for stock:** both legs of the transfer go through `stockMovementService.recordStockMovement()`, guaranteeing a matching immutable `StockMovement` ledger entry (`transferred_out` then `transferred_in`) for every unit moved.
- **Insufficient-stock protection:** dispatching a transfer that would drive the source branch's stock negative is rejected by the shared service's existing guard.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing required field; `fromBranch` equals `toBranch` |
| `400` | `recordStockMovement` — branch/SKU stock not initialized, or would go negative |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role |
| `404` | Branch, product, SKU, or transfer not found |
| `409` | Dispatching a non-pending transfer, or receiving a non-in-transit transfer |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Transfer is not pending"
}
```

---

## 📊 Database Indexes

```typescript
transferSchema.index({ fromBranch: 1 }); // outbound transfers per branch
transferSchema.index({ toBranch: 1 });   // inbound transfers per branch
transferSchema.index({ status: 1 });     // filter by pending/in_transit/received/cancelled
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
