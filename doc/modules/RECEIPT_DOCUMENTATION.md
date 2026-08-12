# 🧾 POS API - Receipt Management Documentation

## 📋 Table of Contents
- [Receipt Management Overview](#receipt-management-overview)
- [Receipt Model](#-receipt-model)
- [Receipt Controller](#-receipt-controller)
- [Receipt Routes](#-receipt-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Receipt Management Overview

Receipt is the audit trail of everything printed for a **Tab**. A `sale` receipt is generated automatically — `paymentService.applySuccessfulPayment()` calls `receiptService.generateReceipt()` right after `tabService.completeTab()`, the moment a tab's balance hits zero. From there, staff can mark it printed, issue a `reprint` when a copy is needed later, or a manager can issue a `refund` receipt against the tab. Every receipt (sale, reprint, refund) is its own permanent `Receipt` document — nothing is mutated in place except the `printedAt`/`printedBy` bookkeeping on the original `print` action.

**Scope notes for this pass:**
- **Real PDFs, uploaded to Cloudinary.** Each receipt renders an actual PDF via `pdfkit` (`src/utils/generateReceiptPDF.ts`) and uploads it as a raw asset (`resource_type: "raw"`) through `uploadToCloudinary()`, storing both `pdfUrl` and `pdfPublicId`.
- **No `emailReceipt()`.** Digital/email receipts are out of scope for this pass — there is no `POST /tab/:tabId/email` route, despite `@sendgrid/mail` already being a project dependency.
- **Refunds are manual only.** `generateRefundReceipt()` is **not** wired into `paymentService.reversePayment()` — a refund receipt is only ever created by an explicit `POST /tab/:tabId/refund` call.
- **Reprints reuse the original PDF.** `reprintReceipt()` does not re-render — the sale receipt's content doesn't change after the fact, so a reprint copies the source's `pdfUrl`/`pdfPublicId`/`amount` into a new record and just stamps a fresh `receiptNumber`/`printedAt`/`printedBy`.
- **No thermal-printer integration.** `printReceipt()` is bookkeeping only — it records that a receipt was printed (by whom, when) for a frontend/POS terminal that owns the actual print job; the backend does not drive a physical printer.

---

## 🧾 Receipt Model

### Schema Definition
```typescript
export type ReceiptType = "sale" | "refund" | "reprint";

export interface IReceipt extends Document {
  receiptNumber: string;
  branch: Types.ObjectId | IBranch;
  tab: Types.ObjectId | ITab;
  payment?: Types.ObjectId | IPayment;
  type: ReceiptType;
  amount: number;
  pdfUrl: string;
  pdfPublicId: string;
  generatedBy: Types.ObjectId | IUser;
  printedAt?: Date;
  printedBy?: Types.ObjectId | IUser;
  refundReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Receipt.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IReceipt } from "../type";

const receiptSchema = new Schema<IReceipt>(
  {
    receiptNumber: {
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
    tab: {
      type: Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    payment: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    type: {
      type: String,
      enum: ["sale", "refund", "reprint"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    pdfUrl: {
      type: String,
      required: true,
    },
    pdfPublicId: {
      type: String,
      required: true,
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    printedAt: {
      type: Date,
    },
    printedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    refundReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

receiptSchema.index({ branch: 1 });
receiptSchema.index({ tab: 1 });
receiptSchema.index({ type: 1 });

const Receipt = mongoose.model<IReceipt>("Receipt", receiptSchema);
export default Receipt;
```

### Validation Rules
```typescript
receiptNumber:  { required: true, unique: true, trim: true, auto-generated e.g. MAIN-RCT-2026-0001 }
branch:         { required: true, ObjectId ref: 'Branch' — derived from tab.branch, never from the request }
tab:            { required: true, ObjectId ref: 'Tab' }
payment:        { optional, ObjectId ref: 'Payment' — set on the auto-generated sale receipt, absent on manual refund receipts }
type:           { required: true, enum: ['sale', 'refund', 'reprint'] }
amount:         { required: true, min: 0 — tab.grandTotal for 'sale', requested refund amount for 'refund', copied from source for 'reprint' }
pdfUrl:         { required: true, Cloudinary secure_url, resource_type 'raw' }
pdfPublicId:    { required: true, Cloudinary public_id — required before any future delete/replace flow }
generatedBy:    { required: true, ObjectId ref: 'User' — the payment's processedBy for auto sale receipts, the requesting user for manual actions }
printedAt:      { optional, Date — set the first time the sale receipt is printed, and always set on a reprint }
printedBy:      { optional, ObjectId ref: 'User' }
refundReason:   { optional, trim — required in the request body to generate a refund receipt }
```

---

## 🎮 Receipt Controller

**File:** `src/controllers/receiptController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Receipt from "../models/Receipt";
import Tab from "../models/Tab";
import {
  printReceipt as printReceiptService,
  reprintReceipt as reprintReceiptService,
  generateRefundReceipt as generateRefundReceiptService,
} from "../services/internal/receiptService";
```

### Functions Overview

#### `getTabReceipts()`
**Purpose:** List every receipt (sale, refund, reprint) issued for a tab, filtered and paginated
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** Tab must exist
**Process:** Find receipts by tab directly (no service indirection — same pattern as `paymentController.getTabPayments`), optionally filtered by `type`/`search`, paginated, sorted oldest first
**Response:** Receipt list and pagination

**Controller Implementation:**
```typescript
export const getTabReceipts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);

    // Guard — tab must exist
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Extract query parameters
    const { page = 1, limit = 10, type, search } = req.query;

    // Build filter query
    const query: any = { tab: tab._id };
    if (type) {
      query.type = type;
    }
    if (search) {
      query.receiptNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // Fetch receipts and total count
    const receipts = await Receipt.find(query)
      .populate("generatedBy", "firstName lastName")
      .populate("printedBy", "firstName lastName")
      .sort({ createdAt: 1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Receipt.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        receipts,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalReceipts: total,
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

#### `getReceipt()`
**Purpose:** Fetch a single receipt with full details
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** Receipt must exist
**Process:** Find receipt by ID directly and return with populated refs — same pattern as `paymentController.getPayment`
**Response:** Receipt details

**Controller Implementation:**
```typescript
export const getReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find receipt by ID
    const receipt = await Receipt.findById(req.params.receiptId)
      .populate("tab", "tabNumber status")
      .populate("branch", "name code")
      .populate("payment", "paymentNumber method")
      .populate("generatedBy", "firstName lastName")
      .populate("printedBy", "firstName lastName");

    // Guard — receipt must exist
    if (!receipt) {
      return next(errorHandler(404, "Receipt not found"));
    }

    // Return receipt
    res.status(200).json({
      success: true,
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `printReceipt()`
**Purpose:** Mark a tab's sale receipt as printed
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** A `sale` receipt must already exist for the tab (i.e. the tab has completed a sale)
**Process:** Delegates to `receiptService.printReceipt` — idempotent, refreshes `printedAt`/`printedBy` on every call
**Response:** Updated receipt

**Controller Implementation:**
```typescript
export const printReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Mark receipt printed
    const receipt = await printReceiptService(req.params.tabId as string, req.user?._id as any);

    // Return receipt
    res.status(200).json({
      success: true,
      message: "Receipt marked as printed",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `reprintReceipt()`
**Purpose:** Issue a new receipt record for a tab that already has a sale receipt
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** A `sale` receipt must already exist for the tab
**Process:** Delegates to `receiptService.reprintReceipt` — creates a new `type: 'reprint'` record reusing the original PDF
**Response:** New reprint receipt record

**Controller Implementation:**
```typescript
export const reprintReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Create reprint record
    const receipt = await reprintReceiptService(req.params.tabId as string, req.user?._id as any);

    // Return receipt
    res.status(201).json({
      success: true,
      message: "Receipt reprinted",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `generateRefundReceipt()`
**Purpose:** Issue a refund receipt for a tab
**Access:** Manager, Admin
**Validation:** `amount` and `reason` are required in the body; the service further enforces `0 < amount <= tab.amountPaid`
**Process:** Delegates to `receiptService.generateRefundReceipt` — renders and uploads a fresh PDF, creates a `type: 'refund'` record
**Response:** New refund receipt record

**Controller Implementation:**
```typescript
export const generateRefundReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { amount, reason } = req.body;

    // Guard — amount and reason required
    if (!amount) {
      return next(errorHandler(400, "amount is required"));
    }
    if (!reason) {
      return next(errorHandler(400, "reason is required"));
    }

    // Create refund receipt via service
    const receipt = await generateRefundReceiptService(req.params.tabId as string, req.user?._id as any, {
      amount,
      reason,
    });

    // Return receipt
    res.status(201).json({
      success: true,
      message: "Refund receipt generated",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Receipt Routes

### Base Path: `/api/receipts`

```typescript
GET    /tab/:tabId          // List receipts for a tab, paginated (bartender, cashier, manager, admin, accountant)
POST   /tab/:tabId/print    // Mark the tab's sale receipt printed (bartender, cashier, manager, admin)
POST   /tab/:tabId/reprint  // Issue a reprint (bartender, cashier, manager, admin)
POST   /tab/:tabId/refund   // Generate a refund receipt (manager, admin)
GET    /:receiptId          // Get a single receipt (bartender, cashier, manager, admin, accountant)
```

### Router Implementation

**File: `src/routes/receiptRoutes.ts`**

```typescript
import express from "express";
import {
  getTabReceipts,
  getReceipt,
  printReceipt,
  reprintReceipt,
  generateRefundReceipt,
} from "../controllers/receiptController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];
const REFUND_ROLES: UserRole[] = ["manager", "admin"];

router.get("/tab/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTabReceipts);
router.post("/tab/:tabId/print", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, printReceipt);
router.post("/tab/:tabId/reprint", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, reprintReceipt);
router.post("/tab/:tabId/refund", authenticateToken, authorizeRoles(REFUND_ROLES), requireActiveShift, generateRefundReceipt);
router.get("/:receiptId", authenticateToken, authorizeRoles(READ_ROLES), getReceipt);

export default router;
```

### Route Details

#### `GET /api/receipts/tab/:tabId`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `type=sale|refund|reprint`, `search=<receiptNumber>`
**Response:**
```json
{
  "success": true,
  "data": {
    "receipts": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c3a1",
        "receiptNumber": "MAIN-RCT-2026-0001",
        "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
        "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
        "payment": "64f1a2b3c4d5e6f7a8b9c2a1",
        "type": "sale",
        "amount": 1200,
        "pdfUrl": "https://res.cloudinary.com/pos-api/raw/upload/v1723400000/pos-api/receipts/main-rct-2026-0001.pdf",
        "pdfPublicId": "pos-api/receipts/main-rct-2026-0001",
        "generatedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "printedAt": "2026-08-11T18:41:00.000Z",
        "printedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "createdAt": "2026-08-11T18:40:05.000Z",
        "updatedAt": "2026-08-11T18:41:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalReceipts": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `POST /api/receipts/tab/:tabId/print`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Receipt marked as printed",
  "data": {
    "receipt": {
      "_id": "64f1a2b3c4d5e6f7a8b9c3a1",
      "receiptNumber": "MAIN-RCT-2026-0001",
      "type": "sale",
      "amount": 1200,
      "printedAt": "2026-08-11T18:41:00.000Z",
      "printedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "updatedAt": "2026-08-11T18:41:00.000Z"
    }
  }
}
```

#### `POST /api/receipts/tab/:tabId/reprint`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Receipt reprinted",
  "data": {
    "receipt": {
      "_id": "64f1a2b3c4d5e6f7a8b9c3a2",
      "receiptNumber": "MAIN-RCT-2026-0002",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
      "payment": "64f1a2b3c4d5e6f7a8b9c2a1",
      "type": "reprint",
      "amount": 1200,
      "pdfUrl": "https://res.cloudinary.com/pos-api/raw/upload/v1723400000/pos-api/receipts/main-rct-2026-0001.pdf",
      "pdfPublicId": "pos-api/receipts/main-rct-2026-0001",
      "generatedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "printedAt": "2026-08-12T09:05:00.000Z",
      "printedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "createdAt": "2026-08-12T09:05:00.000Z",
      "updatedAt": "2026-08-12T09:05:00.000Z"
    }
  }
}
```

#### `POST /api/receipts/tab/:tabId/refund`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "amount": 300,
  "reason": "Customer sent back a spoiled order"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Refund receipt generated",
  "data": {
    "receipt": {
      "_id": "64f1a2b3c4d5e6f7a8b9c3a3",
      "receiptNumber": "MAIN-RCT-2026-0003",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
      "type": "refund",
      "amount": 300,
      "pdfUrl": "https://res.cloudinary.com/pos-api/raw/upload/v1723486400/pos-api/receipts/main-rct-2026-0003.pdf",
      "pdfPublicId": "pos-api/receipts/main-rct-2026-0003",
      "generatedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "refundReason": "Customer sent back a spoiled order",
      "createdAt": "2026-08-12T09:10:00.000Z",
      "updatedAt": "2026-08-12T09:10:00.000Z"
    }
  }
}
```

#### `GET /api/receipts/:receiptId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "receipt": {
      "_id": "64f1a2b3c4d5e6f7a8b9c3a1",
      "receiptNumber": "MAIN-RCT-2026-0001",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "tab": {
        "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
        "tabNumber": "MAIN-TAB-000001",
        "status": "completed"
      },
      "payment": {
        "_id": "64f1a2b3c4d5e6f7a8b9c2a1",
        "paymentNumber": "MAIN-PAY-2026-0001",
        "method": "cash"
      },
      "type": "sale",
      "amount": 1200,
      "pdfUrl": "https://res.cloudinary.com/pos-api/raw/upload/v1723400000/pos-api/receipts/main-rct-2026-0001.pdf",
      "pdfPublicId": "pos-api/receipts/main-rct-2026-0001",
      "generatedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
        "firstName": "Grace",
        "lastName": "Njeri"
      },
      "printedAt": "2026-08-11T18:41:00.000Z",
      "printedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
        "firstName": "Grace",
        "lastName": "Njeri"
      },
      "createdAt": "2026-08-11T18:40:05.000Z",
      "updatedAt": "2026-08-11T18:41:00.000Z"
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
router.get("/:receiptId", authenticateToken, getReceipt);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.post("/tab/:tabId/refund", authenticateToken, authorizeRoles(["manager", "admin"]), generateRefundReceipt);
```

#### `requireActiveShift`
**Purpose:** Block receipt-mutating routes when the requesting user has no `open` Shift
**Usage:**
```typescript
router.post("/tab/:tabId/print", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, printReceipt);
```
Applied to `printReceipt`, `reprintReceipt`, and `generateRefundReceipt`. Not applied to the two read routes.

---

## 📝 API Examples

### List Receipts for a Tab
```bash
curl -X GET http://localhost:3500/api/receipts/tab/64f1a2b3c4d5e6f7a8b9c1a1 \
  -H "Authorization: Bearer <token>"
```

### Mark a Receipt Printed
```bash
curl -X POST http://localhost:3500/api/receipts/tab/64f1a2b3c4d5e6f7a8b9c1a1/print \
  -H "Authorization: Bearer <token>"
```

### Reprint a Receipt
```bash
curl -X POST http://localhost:3500/api/receipts/tab/64f1a2b3c4d5e6f7a8b9c1a1/reprint \
  -H "Authorization: Bearer <token>"
```

### Generate a Refund Receipt
```bash
curl -X POST http://localhost:3500/api/receipts/tab/64f1a2b3c4d5e6f7a8b9c1a1/refund \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "amount": 300, "reason": "Customer sent back a spoiled order" }'
```

### Get a Receipt by ID
```bash
curl -X GET http://localhost:3500/api/receipts/64f1a2b3c4d5e6f7a8b9c3a1 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Print/reprint are limited to `bartender`, `cashier`, `manager`, `admin`. Refunds are limited to `manager`/`admin` only — the same financial-risk boundary used for `paymentService.reversePayment`. Reading is additionally open to `accountant`.
- **Shift gating:** `requireActiveShift` blocks every mutating route when the requesting user has no `open` Shift.
- **Branch derived from the Tab:** `branch` on every Receipt is copied from the Tab, never accepted from the request body.
- **Refund ceiling enforced server-side:** `generateRefundReceipt` rejects any `amount` that is `<= 0` or exceeds `tab.amountPaid` — a caller cannot manufacture a refund receipt larger than what was actually collected.
- **Raw asset storage:** receipt PDFs are uploaded with `resource_type: "raw"` (not the image pipeline used for avatars/product photos), so Cloudinary serves the exact rendered file rather than an image-transformed derivative.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing `amount`/`reason` on refund; refund `amount` is `<= 0` or exceeds `tab.amountPaid` |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role; no active shift (`requireActiveShift`) |
| `404` | Tab or receipt not found; no `sale` receipt exists yet for the tab (print/reprint) |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "No receipt found for this tab"
}
```

---

## 📊 Database Indexes

```typescript
receiptSchema.index({ branch: 1 }); // scope receipts to a branch
receiptSchema.index({ tab: 1 });    // fetch all receipts for a tab (getTabReceipts, print/reprint lookup)
receiptSchema.index({ type: 1 });   // filter sale/refund/reprint
// receiptNumber already has a unique index from { unique: true } in the schema definition
```

---

**Last Updated:** 2026-08-12
**Version:** 1.0.0
**Maintainer:** POS API Development Team
