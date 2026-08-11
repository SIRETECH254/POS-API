# 🗂️ POS API - Purchase Management Documentation

## 📋 Table of Contents
- [Purchase Management Overview](#purchase-management-overview)
- [Purchase Model](#-purchase-model)
- [Purchase Controller](#-purchase-controller)
- [Purchase Routes](#-purchase-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Purchase Management Overview

Purchase Management records goods received from suppliers into a branch. A purchase order is created against a `Supplier` for a `Branch`, listing line items (`product` + `sku` + `quantity` + `purchasePrice`). Once the goods physically arrive, `receiveGoods()` transitions the order to `received` and writes one immutable `StockMovement` (`type: "purchased"`) per line item via the shared `stockMovementService.recordStockMovement()` — this is the only place `Product.skus.stockByBranch.currentStock` is incremented from a purchase.

**Scope note:** this module intentionally does **not** track the supplier's actual invoice document or record payments against it. The original target design had a bare `invoiceRef` string field and a `recordSupplierPayment()` function; both were dropped for this pass — a real invoice (amount owed, due date, payment state, attached scan) deserves its own module and will be designed separately later. `Purchase.amountPaid` / `paymentStatus` remain on the schema for forward compatibility but nothing currently writes to them beyond their defaults (`0` / `"unpaid"`).

**Operational precondition:** `receiveGoods()` calls `stockMovementService.recordStockMovement()`, which requires the branch's `stockByBranch` entry for each SKU to already exist (even at `currentStock: 0`, set via `SKU.setBranchStockLevel`) — it deliberately refuses to silently initialize one. Receiving goods for a branch/SKU pairing that was never initialized returns a `400`.

---

## 👤 Purchase Model

### Schema Definition
```typescript
export type PurchaseStatus = "ordered" | "received" | "cancelled";
export type PurchasePaymentStatus = "unpaid" | "partial" | "paid";

export interface IPurchaseItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantity: number;
  purchasePrice: number;
  subtotal: number;
}

export interface IPurchase extends Document {
  purchaseNumber: string;
  branch: Types.ObjectId | IBranch;
  supplier: Types.ObjectId | ISupplier;
  items: IPurchaseItem[];
  totalAmount: number;
  amountPaid: number;
  paymentStatus: PurchasePaymentStatus;
  status: PurchaseStatus;
  createdBy: Types.ObjectId | IUser;
  receivedBy?: Types.ObjectId | IUser;
  receivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Purchase.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IPurchase } from "../type";

const purchaseItemSchema = new Schema(
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
    purchasePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const purchaseSchema = new Schema<IPurchase>(
  {
    purchaseNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    items: {
      type: [purchaseItemSchema],
      default: [],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
    },
    status: {
      type: String,
      enum: ["ordered", "received", "cancelled"],
      default: "ordered",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

purchaseSchema.index({ branch: 1 });
purchaseSchema.index({ supplier: 1 });
purchaseSchema.index({ status: 1 });

const Purchase = mongoose.model<IPurchase>("Purchase", purchaseSchema);
export default Purchase;
```

### Validation Rules
```typescript
purchaseNumber: { required: true, unique: true, trim: true, auto-generated }
branch:         { required: true, ObjectId ref: 'Branch' }
supplier:       { required: true, ObjectId ref: 'Supplier' }
items:          { default: [], each: { product: required ref Product, sku: required (no ref, embedded subdoc), quantity: required min 1, purchasePrice: required min 0, subtotal: required min 0 } }
totalAmount:    { required: true, min: 0, default: 0 — sum of item subtotals }
amountPaid:     { default: 0, min: 0 — not yet written to by any endpoint }
paymentStatus:  { default: 'unpaid' — not yet written to by any endpoint }
status:         { default: 'ordered', enum: ['ordered','received','cancelled'] }
createdBy:      { required: true, ObjectId ref: 'User' }
receivedBy:     { optional, ObjectId ref: 'User' — set on receiveGoods }
receivedAt:     { optional, Date — set on receiveGoods }
```

---

## 🎮 Purchase Controller

**File:** `src/controllers/purchaseController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Purchase from "../models/Purchase";
import Branch from "../models/Branch";
import Supplier from "../models/Supplier";
import Product from "../models/Product";
import { generatePurchaseNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";
```

### Functions Overview

#### `createPurchaseOrder()`
**Purpose:** Create a new purchase order for goods to be received from a supplier
**Access:** Store Keeper, Manager, Admin
**Validation:** Branch, supplier, and items required; each item's product and SKU must exist
**Process:** Validate items, compute subtotals/total, generate purchase number, create purchase
**Response:** Created purchase order

**Controller Implementation:**
```typescript
export const createPurchaseOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, supplier, items } = req.body;

    // Guard — branch required
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!supplier) {
      return next(errorHandler(400, "Supplier is required"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — supplier must exist
    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Validate each item and compute subtotals
    const preparedItems: any[] = [];
    let totalAmount = 0;

    for (const item of items) {
      const { product, sku, quantity, purchasePrice } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }
      if (!quantity || quantity < 1) {
        return next(errorHandler(400, "Quantity must be at least 1 for each item"));
      }
      if (purchasePrice === undefined || purchasePrice < 0) {
        return next(errorHandler(400, "Purchase price is required for each item"));
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

      const subtotal = quantity * purchasePrice;
      totalAmount += subtotal;

      preparedItems.push({ product, sku, quantity, purchasePrice, subtotal });
    }

    // Generate purchase number
    const purchaseNumber = await generatePurchaseNumber(branchDoc.code, String(branchDoc._id));

    // Create purchase order
    const purchase = await Purchase.create({
      purchaseNumber,
      branch,
      supplier,
      items: preparedItems,
      totalAmount,
      status: "ordered",
      createdBy: req.user?._id,
    });

    // Return created purchase order
    res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `receiveGoods()`
**Purpose:** Mark a purchase order as received and increment branch stock for each item
**Access:** Store Keeper, Manager, Admin
**Validation:** Purchase must exist and be in `'ordered'` status
**Process:** Record a stock movement per item via `stockMovementService`, mark purchase as received
**Response:** Updated purchase order

**Controller Implementation:**
```typescript
export const receiveGoods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find purchase order
    const purchase = await Purchase.findById(req.params.purchaseId);

    // Guard — purchase must exist
    if (!purchase) {
      return next(errorHandler(404, "Purchase order not found"));
    }

    // Guard — purchase must still be ordered
    if (purchase.status !== "ordered") {
      return next(errorHandler(409, "Purchase order has already been received or cancelled"));
    }

    // Record a stock movement per item
    for (const item of purchase.items) {
      await recordStockMovement({
        branch: purchase.branch as any,
        product: item.product as any,
        sku: item.sku,
        type: "purchased",
        quantity: item.quantity,
        reference: { refType: "Purchase", refId: purchase._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark purchase as received
    purchase.status = "received";
    purchase.receivedBy = req.user?._id as any;
    purchase.receivedAt = new Date();
    await purchase.save();

    // Return updated purchase order
    res.status(200).json({
      success: true,
      message: "Goods received successfully",
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};
```

> **Note:** If any item's branch/SKU `stockByBranch` entry hasn't been initialized (via `SKU.setBranchStockLevel`), `recordStockMovement` throws a `400` mid-loop — items already processed before the failure will have already incremented stock and written their ledger entries. Initialize stock levels for every SKU/branch pairing before creating purchase orders against them.

---

#### `getAllPurchases()`
**Purpose:** List all purchase orders with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch/supplier/status/search, paginate, return results
**Response:** Purchase list and pagination

**Controller Implementation:**
```typescript
export const getAllPurchases = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, supplier, status, search } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (supplier) {
      query.supplier = supplier;
    }
    if (status) {
      query.status = status;
    }
    if (search) {
      query.purchaseNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch purchases and total count
    const purchases = await Purchase.find(query)
      .populate("branch", "name code")
      .populate("supplier", "companyName")
      .populate("receivedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Purchase.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        purchases,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalPurchases: total,
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

#### `getPurchaseById()`
**Purpose:** Fetch a single purchase order by ID
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Purchase must exist
**Process:** Find purchase by ID and return with populated refs
**Response:** Purchase order details

**Controller Implementation:**
```typescript
export const getPurchaseById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find purchase by ID
    const purchase = await Purchase.findById(req.params.purchaseId)
      .populate("branch", "name code")
      .populate("supplier", "companyName")
      .populate("receivedBy", "firstName lastName")
      .populate("createdBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — purchase must exist
    if (!purchase) {
      return next(errorHandler(404, "Purchase order not found"));
    }

    // Return purchase
    res.status(200).json({
      success: true,
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Purchase Routes

### Base Path: `/api/purchases`

```typescript
GET    /                        // Get all purchases (store_keeper, manager, admin, accountant)
GET    /:purchaseId             // Get single purchase (store_keeper, manager, admin, accountant)
POST   /                        // Create purchase order (store_keeper, manager, admin)
PATCH  /:purchaseId/receive     // Receive goods (store_keeper, manager, admin)
```

### Router Implementation

**File: `src/routes/purchaseRoutes.ts`**

```typescript
import express from "express";
import {
  createPurchaseOrder,
  receiveGoods,
  getAllPurchases,
  getPurchaseById,
} from "../controllers/purchaseController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getAllPurchases);
router.get("/:purchaseId", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin", "accountant"]), getPurchaseById);
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), createPurchaseOrder);
router.patch("/:purchaseId/receive", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), receiveGoods);

export default router;
```

### Route Details

#### `GET /api/purchases`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `branch=<branchId>`, `supplier=<supplierId>`, `status=ordered|received|cancelled`, `search=<purchaseNumber>`
**Response:**
```json
{
  "success": true,
  "data": {
    "purchases": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
        "purchaseNumber": "MAIN-PO-2026-0001",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "supplier": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
          "companyName": "Kenya Breweries Ltd"
        },
        "totalAmount": 4800,
        "amountPaid": 0,
        "paymentStatus": "unpaid",
        "status": "ordered",
        "receivedBy": null,
        "createdAt": "2026-08-11T09:00:00.000Z",
        "updatedAt": "2026-08-11T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalPurchases": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/purchases/:purchaseId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "purchase": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
      "purchaseNumber": "MAIN-PO-2026-0001",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "supplier": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "companyName": "Kenya Breweries Ltd"
      },
      "items": [
        {
          "product": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
            "name": "Tusker Lager"
          },
          "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
          "quantity": 24,
          "purchasePrice": 200,
          "subtotal": 4800
        }
      ],
      "totalAmount": 4800,
      "amountPaid": 0,
      "paymentStatus": "unpaid",
      "status": "ordered",
      "createdBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
        "firstName": "James",
        "lastName": "Otieno"
      },
      "receivedBy": null,
      "receivedAt": null,
      "createdAt": "2026-08-11T09:00:00.000Z",
      "updatedAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `POST /api/purchases`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
  "supplier": "64f1a2b3c4d5e6f7a8b9c0d1",
  "items": [
    {
      "product": "64f1a2b3c4d5e6f7a8b9c0d5",
      "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
      "quantity": 24,
      "purchasePrice": 200
    }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Purchase order created successfully",
  "data": {
    "purchase": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
      "purchaseNumber": "MAIN-PO-2026-0001",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "supplier": "64f1a2b3c4d5e6f7a8b9c0d1",
      "items": [
        {
          "product": "64f1a2b3c4d5e6f7a8b9c0d5",
          "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
          "quantity": 24,
          "purchasePrice": 200,
          "subtotal": 4800
        }
      ],
      "totalAmount": 4800,
      "amountPaid": 0,
      "paymentStatus": "unpaid",
      "status": "ordered",
      "createdAt": "2026-08-11T09:00:00.000Z",
      "updatedAt": "2026-08-11T09:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/purchases/:purchaseId/receive`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Goods received successfully",
  "data": {
    "purchase": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
      "purchaseNumber": "MAIN-PO-2026-0001",
      "status": "received",
      "receivedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "receivedAt": "2026-08-11T14:30:00.000Z",
      "updatedAt": "2026-08-11T14:30:00.000Z"
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
router.get("/", authenticateToken, getAllPurchases);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), createPurchaseOrder);
```

---

## 📝 API Examples

### Get All Purchases
```bash
curl -X GET "http://localhost:3500/api/purchases?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

### Filter Purchases by Branch and Status
```bash
curl -X GET "http://localhost:3500/api/purchases?branch=64f1a2b3c4d5e6f7a8b9c0d3&status=ordered" \
  -H "Authorization: Bearer <token>"
```

### Get Purchase by ID
```bash
curl -X GET http://localhost:3500/api/purchases/64f1a2b3c4d5e6f7a8b9c0f1 \
  -H "Authorization: Bearer <token>"
```

### Create Purchase Order
```bash
curl -X POST http://localhost:3500/api/purchases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "supplier": "64f1a2b3c4d5e6f7a8b9c0d1",
    "items": [
      { "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "quantity": 24, "purchasePrice": 200 }
    ]
  }'
```

### Receive Goods
```bash
curl -X PATCH http://localhost:3500/api/purchases/64f1a2b3c4d5e6f7a8b9c0f1/receive \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Creating and receiving are limited to `store_keeper`, `manager`, `admin`. Reading is additionally open to `accountant`.
- **Item-level existence checks:** `createPurchaseOrder` validates every line item's `product` and embedded `sku` exist before creating the order — a bad item fails the whole request rather than silently dropping it.
- **Single write path for stock:** `receiveGoods()` never mutates `stockByBranch` directly — it always goes through `stockMovementService.recordStockMovement()`, guaranteeing a matching immutable `StockMovement` ledger entry for every unit received.
- **State guard:** `receiveGoods()` refuses to run on a purchase that isn't `'ordered'`, preventing double-receiving (double-counting stock) or receiving a cancelled order.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing `branch`, `supplier`, or `items`; an item missing `product`/`sku`/`quantity`/`purchasePrice` |
| `400` | `recordStockMovement` — branch/SKU stock not initialized, or would go negative |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. bartender attempting to create a purchase order) |
| `404` | Branch, supplier, product, SKU, or purchase order not found |
| `409` | `receiveGoods` called on a purchase that isn't `'ordered'` |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Purchase order has already been received or cancelled"
}
```

---

## 📊 Database Indexes

```typescript
purchaseSchema.index({ branch: 1 });    // scope purchases to a branch
purchaseSchema.index({ supplier: 1 });  // supplier purchase history lookups
purchaseSchema.index({ status: 1 });    // filter by ordered/received/cancelled
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
