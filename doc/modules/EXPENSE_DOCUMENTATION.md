# 🧾 POS API - Expense Management Documentation

## 📋 Table of Contents
- [Expense Management Overview](#expense-management-overview)
- [Expense Model](#-expense-model)
- [Expense Controller](#-expense-controller)
- [Expense Routes](#-expense-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Expense Management Overview

Expense records every operational outgoing cost a branch incurs — rent, electricity, DJ, security, cleaning, fuel, repairs, marketing, and a catch-all `other` category. It is a standalone financial record, not linked to Tabs or Payments (those track incoming sales revenue; Expense tracks outgoing cost). Expenses feed directly into Profit Reports: `Net Profit = Revenue − Cost of Goods − Expenses`.

**Scope notes for this pass:**
- **`status` was added beyond the documented spec.** The original model interface had no lifecycle field, but a dedicated `approveExpense()` action only means something against an explicit `pending`/`approved` state — every other lifecycle-bearing model in this codebase (Tab, Payment, Purchase) has one, so `IExpense.status` was added for consistency. `approvedBy`/`approvedAt` are only ever set once, by `approveExpense()`.
- **Approved expenses are immutable.** `updateExpense()` and `deleteExpense()` both reject once `status === "approved"` (`409`) — once a figure has fed into a profit report, it shouldn't move silently, same reasoning as Payment's reversal boundary.
- **`receiptPublicId` was added alongside the documented `receiptUrl`.** Per this codebase's Cloudinary convention, every model with a Cloudinary asset stores both the `url` and the `public_id` (needed to delete/replace the asset later).
- **No auto-generated number field.** Unlike Payment/Purchase/Receipt, the documented spec has no `expenseNumber`, so none was added.
- **No `AuditLog` write anywhere in this module.** No `AuditLog` model exists in this codebase yet.
- **`createExpense()` notifies managers/admins.** An `expense_pending_approval` notification (via `notificationService.createNotification`) goes out the moment an expense is recorded, so approval isn't gated on someone thinking to check. See `doc/modules/NOTIFICATION_DOCUMENTATION.md`.

---

## 💸 Expense Model

### Schema Definition
```typescript
export type ExpenseCategory =
  | "rent"
  | "electricity"
  | "water"
  | "dj"
  | "security"
  | "cleaning"
  | "fuel"
  | "repairs"
  | "marketing"
  | "other";
export type ExpensePaymentMethod = "cash" | "mpesa" | "bank";
export type ExpenseStatus = "pending" | "approved";

export interface IExpense extends Document {
  branch: Types.ObjectId | IBranch;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  receiptUrl?: string;
  receiptPublicId?: string;
  status: ExpenseStatus;
  approvedBy?: Types.ObjectId | IUser;
  approvedAt?: Date;
  recordedBy: Types.ObjectId | IUser;
  expenseDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Expense.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IExpense } from "../type";

const expenseSchema = new Schema<IExpense>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    category: {
      type: String,
      enum: ["rent", "electricity", "water", "dj", "security", "cleaning", "fuel", "repairs", "marketing", "other"],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "mpesa", "bank"],
      required: true,
    },
    receiptUrl: {
      type: String,
    },
    receiptPublicId: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "pending",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expenseDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ branch: 1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: 1 });

const Expense = mongoose.model<IExpense>("Expense", expenseSchema);
export default Expense;
```

### Validation Rules
```typescript
branch:           { required: true, ObjectId ref: 'Branch' }
category:         { required: true, enum: ['rent', 'electricity', 'water', 'dj', 'security', 'cleaning', 'fuel', 'repairs', 'marketing', 'other'] }
description:      { required: true, trim: true }
amount:           { required: true, min: 0 }
paymentMethod:    { required: true, enum: ['cash', 'mpesa', 'bank'] — descriptive only, not linked to the Payment collection }
receiptUrl:       { optional, Cloudinary secure_url — scanned receipt or invoice }
receiptPublicId:  { optional, Cloudinary public_id — required before any delete/replace }
status:           { default: 'pending', enum: ['pending', 'approved'] }
approvedBy:       { optional, ObjectId ref: 'User' — set only by approveExpense() }
approvedAt:       { optional, Date — set only by approveExpense() }
recordedBy:       { required: true, ObjectId ref: 'User' — whoever created the record }
expenseDate:      { required: true, Date — when the cost was actually incurred, distinct from createdAt }
```

---

## 🎮 Expense Controller

**File:** `src/controllers/expenseController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary";
import Expense from "../models/Expense";
import { createNotification } from "../services/internal/notificationService";
```

### Functions Overview

#### `createExpense()`
**Purpose:** Record a new operational expense against a branch
**Access:** Store Keeper, Manager, Admin
**Validation:** `branch`, `category`, `description`, `amount`, `paymentMethod`, `expenseDate` are required
**Process:** Upload receipt to Cloudinary if a file is provided, create the expense as `pending`, notify the branch's managers/admins that it needs approval
**Response:** Created expense

**Controller Implementation:**
```typescript
export const createExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, category, description, amount, paymentMethod, expenseDate } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "branch is required"));
    }
    if (!category) {
      return next(errorHandler(400, "category is required"));
    }
    if (!description) {
      return next(errorHandler(400, "description is required"));
    }
    if (!amount) {
      return next(errorHandler(400, "amount is required"));
    }
    if (!paymentMethod) {
      return next(errorHandler(400, "paymentMethod is required"));
    }
    if (!expenseDate) {
      return next(errorHandler(400, "expenseDate is required"));
    }

    // Upload receipt to Cloudinary if provided
    let receiptUrl: string | undefined;
    let receiptPublicId: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/expense-receipts");
      receiptUrl = uploadResult.url;
      receiptPublicId = uploadResult.public_id;
    }

    // Create expense
    const expense = await Expense.create({
      branch,
      category,
      description,
      amount,
      paymentMethod,
      expenseDate,
      receiptUrl,
      receiptPublicId,
      status: "pending",
      recordedBy: req.user?._id,
    });

    // Notify managers/admins that an expense is awaiting approval
    await createNotification({
      branch,
      recipientRole: ["manager", "admin"],
      type: "expense_pending_approval",
      title: "Expense awaiting approval",
      message: `A ${category} expense of KES ${amount} ("${description}") needs approval.`,
      metadata: { expenseId: expense._id, category, amount },
    });

    // Return created expense
    res.status(201).json({
      success: true,
      message: "Expense recorded successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllExpenses()`
**Purpose:** List all expenses with filtering and pagination
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** None
**Process:** Filter by `branch`/`category`/`status`/`paymentMethod`/`search`, paginate, return results sorted by `expenseDate` (newest first)
**Response:** Expense list and pagination

**Controller Implementation:**
```typescript
export const getAllExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, category, status, paymentMethod, search } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (category) {
      query.category = category;
    }
    if (status) {
      query.status = status;
    }
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }
    if (search) {
      query.description = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // Fetch expenses and total count
    const expenses = await Expense.find(query)
      .populate("branch", "name code")
      .populate("recordedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName")
      .sort({ expenseDate: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Expense.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        expenses,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalExpenses: total,
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

#### `getExpense()`
**Purpose:** Fetch a single expense record
**Access:** Store Keeper, Manager, Admin, Accountant
**Validation:** Expense must exist
**Process:** Find expense by ID and return with populated refs
**Response:** Expense details

**Controller Implementation:**
```typescript
export const getExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense by ID
    const expense = await Expense.findById(req.params.expenseId)
      .populate("branch", "name code")
      .populate("recordedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName");

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Return expense
    res.status(200).json({
      success: true,
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateExpense()`
**Purpose:** Update an expense record by ID
**Access:** Store Keeper, Manager, Admin
**Validation:** Expense must exist; approved expenses cannot be updated
**Process:** Apply field updates, replace the receipt if a new file is provided (deletes the old Cloudinary asset first)
**Response:** Updated expense

**Controller Implementation:**
```typescript
export const updateExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { category, description, amount, paymentMethod, expenseDate } = req.body;

    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — approved expenses are immutable
    if (expense.status === "approved") {
      return next(errorHandler(409, "An approved expense cannot be updated"));
    }

    // Apply updates
    if (category) {
      expense.category = category;
    }
    if (description) {
      expense.description = description;
    }
    if (amount) {
      expense.amount = amount;
    }
    if (paymentMethod) {
      expense.paymentMethod = paymentMethod;
    }
    if (expenseDate) {
      expense.expenseDate = expenseDate;
    }

    // Handle receipt replacement
    if (req.file) {
      if (expense.receiptPublicId) {
        try {
          await deleteFromCloudinary(expense.receiptPublicId);
        } catch (deleteError) {
          console.error("Failed to delete previous expense receipt:", deleteError);
        }
      }
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/expense-receipts");
      expense.receiptUrl = uploadResult.url;
      expense.receiptPublicId = uploadResult.public_id;
    }

    // Save and return
    await expense.save();
    res.status(200).json({
      success: true,
      message: "Expense updated successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `deleteExpense()`
**Purpose:** Delete an expense record by ID
**Access:** Admin
**Validation:** Expense must exist; approved expenses cannot be deleted
**Process:** Delete the receipt from Cloudinary if present, delete the record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — approved expenses cannot be deleted
    if (expense.status === "approved") {
      return next(errorHandler(409, "An approved expense cannot be deleted"));
    }

    // Delete receipt from Cloudinary if present
    if (expense.receiptPublicId) {
      try {
        await deleteFromCloudinary(expense.receiptPublicId);
      } catch (deleteError) {
        console.error("Failed to delete expense receipt from Cloudinary:", deleteError);
      }
    }

    // Delete expense record
    await expense.deleteOne();

    // Return success
    res.status(200).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `approveExpense()`
**Purpose:** Approve a pending expense
**Access:** Manager, Admin
**Validation:** Expense must exist and be `pending`
**Process:** Mark the expense `approved`, stamp `approvedBy`/`approvedAt`
**Response:** Approved expense

**Controller Implementation:**
```typescript
export const approveExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — only a pending expense can be approved
    if (expense.status !== "pending") {
      return next(errorHandler(409, "Only a pending expense can be approved"));
    }

    // Mark approved
    expense.status = "approved";
    expense.approvedBy = req.user?._id as any;
    expense.approvedAt = new Date();
    await expense.save();

    // Return approved expense
    res.status(200).json({
      success: true,
      message: "Expense approved successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Expense Routes

### Base Path: `/api/expenses`

```typescript
POST   /                    // Record expense (store_keeper, manager, admin)
GET    /                    // List expenses (store_keeper, manager, admin, accountant)
GET    /:expenseId          // Get single expense (store_keeper, manager, admin, accountant)
PUT    /:expenseId          // Update expense (store_keeper, manager, admin)
DELETE /:expenseId          // Delete expense (admin)
PATCH  /:expenseId/approve  // Approve expense (manager, admin)
```

### Router Implementation

**File: `src/routes/expenseRoutes.ts`**

```typescript
import express from "express";
import {
  createExpense,
  getAllExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  approveExpense,
} from "../controllers/expenseController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { uploadExpenseReceipt } from "../config/cloudinary";
import { UserRole } from "../type";

const router = express.Router();

const CREATE_ROLES: UserRole[] = ["store_keeper", "manager", "admin"];
const READ_ROLES: UserRole[] = ["store_keeper", "manager", "admin", "accountant"];
const APPROVE_ROLES: UserRole[] = ["manager", "admin"];

router.post("/", authenticateToken, authorizeRoles(CREATE_ROLES), uploadExpenseReceipt.single("receipt"), createExpense);
router.get("/", authenticateToken, authorizeRoles(READ_ROLES), getAllExpenses);
router.get("/:expenseId", authenticateToken, authorizeRoles(READ_ROLES), getExpense);
router.put("/:expenseId", authenticateToken, authorizeRoles(CREATE_ROLES), uploadExpenseReceipt.single("receipt"), updateExpense);
router.delete("/:expenseId", authenticateToken, authorizeRoles(["admin"]), deleteExpense);
router.patch("/:expenseId/approve", authenticateToken, authorizeRoles(APPROVE_ROLES), approveExpense);

export default router;
```

### Route Details

#### `POST /api/expenses`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
**Body:**
```
branch: 64f1a2b3c4d5e6f7a8b9c0d3
category: dj
description: Weekend DJ booking — DJ Kaymu
amount: 15000
paymentMethod: cash
expenseDate: 2026-08-14
receipt: <file, optional>
```
**Response:**
```json
{
  "success": true,
  "message": "Expense recorded successfully",
  "data": {
    "expense": {
      "_id": "64f1a2b3c4d5e6f7a8b9c4a1",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "category": "dj",
      "description": "Weekend DJ booking — DJ Kaymu",
      "amount": 15000,
      "paymentMethod": "cash",
      "receiptUrl": "https://res.cloudinary.com/pos-api/image/upload/v1723630000/pos-api/expense-receipts/dj-booking.jpg",
      "receiptPublicId": "pos-api/expense-receipts/dj-booking",
      "status": "pending",
      "recordedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "expenseDate": "2026-08-14T00:00:00.000Z",
      "createdAt": "2026-08-14T09:00:00.000Z",
      "updatedAt": "2026-08-14T09:00:00.000Z"
    }
  }
}
```

#### `GET /api/expenses`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `branch=<branchId>`, `category=dj`, `status=pending`, `paymentMethod=cash`, `search=<text>`
**Response:**
```json
{
  "success": true,
  "data": {
    "expenses": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c4a1",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "category": "dj",
        "description": "Weekend DJ booking — DJ Kaymu",
        "amount": 15000,
        "paymentMethod": "cash",
        "status": "pending",
        "recordedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "expenseDate": "2026-08-14T00:00:00.000Z",
        "createdAt": "2026-08-14T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalExpenses": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/expenses/:expenseId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "expense": {
      "_id": "64f1a2b3c4d5e6f7a8b9c4a1",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "category": "dj",
      "description": "Weekend DJ booking — DJ Kaymu",
      "amount": 15000,
      "paymentMethod": "cash",
      "receiptUrl": "https://res.cloudinary.com/pos-api/image/upload/v1723630000/pos-api/expense-receipts/dj-booking.jpg",
      "receiptPublicId": "pos-api/expense-receipts/dj-booking",
      "status": "pending",
      "recordedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
        "firstName": "Grace",
        "lastName": "Njeri"
      },
      "expenseDate": "2026-08-14T00:00:00.000Z",
      "createdAt": "2026-08-14T09:00:00.000Z",
      "updatedAt": "2026-08-14T09:00:00.000Z"
    }
  }
}
```

#### `PUT /api/expenses/:expenseId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
**Body:**
```
amount: 16000
receipt: <file, optional>
```
**Response:**
```json
{
  "success": true,
  "message": "Expense updated successfully",
  "data": {
    "expense": {
      "_id": "64f1a2b3c4d5e6f7a8b9c4a1",
      "amount": 16000,
      "status": "pending",
      "updatedAt": "2026-08-14T10:00:00.000Z"
    }
  }
}
```

#### `DELETE /api/expenses/:expenseId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Expense deleted successfully"
}
```

#### `PATCH /api/expenses/:expenseId/approve`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Expense approved successfully",
  "data": {
    "expense": {
      "_id": "64f1a2b3c4d5e6f7a8b9c4a1",
      "status": "approved",
      "approvedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "approvedAt": "2026-08-14T11:00:00.000Z",
      "updatedAt": "2026-08-14T11:00:00.000Z"
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
router.get("/:expenseId", authenticateToken, getExpense);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["store_keeper", "manager", "admin"]), createExpense);
```

### Upload Middleware

#### `uploadExpenseReceipt`
**Purpose:** Multer + Cloudinary storage for the optional scanned receipt/invoice — 5MB limit, images + PDF
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(CREATE_ROLES), uploadExpenseReceipt.single("receipt"), createExpense);
```
Defined in `src/config/cloudinary.ts`, folder `pos-api/expense-receipts`. Applied to `createExpense` and `updateExpense` only.

---

## 📝 API Examples

### Record an Expense
```bash
curl -X POST http://localhost:3500/api/expenses \
  -H "Authorization: Bearer <token>" \
  -F "branch=64f1a2b3c4d5e6f7a8b9c0d3" \
  -F "category=dj" \
  -F "description=Weekend DJ booking — DJ Kaymu" \
  -F "amount=15000" \
  -F "paymentMethod=cash" \
  -F "expenseDate=2026-08-14" \
  -F "receipt=@/path/to/receipt.jpg"
```

### List Pending Expenses for a Branch
```bash
curl -X GET "http://localhost:3500/api/expenses?branch=64f1a2b3c4d5e6f7a8b9c0d3&status=pending" \
  -H "Authorization: Bearer <token>"
```

### Approve an Expense
```bash
curl -X PATCH http://localhost:3500/api/expenses/64f1a2b3c4d5e6f7a8b9c4a1/approve \
  -H "Authorization: Bearer <token>"
```

### Delete an Expense
```bash
curl -X DELETE http://localhost:3500/api/expenses/64f1a2b3c4d5e6f7a8b9c4a1 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** Recording/updating expenses is limited to `store_keeper`, `manager`, `admin` — the operational tier that already handles purchase orders. Deletion is `admin` only (least privilege — destructive action). Approval is limited to `manager`/`admin`. Reading is additionally open to `accountant`.
- **Approved records are immutable:** `updateExpense`/`deleteExpense` both reject with `409` once `status === "approved"`, protecting figures already rolled into a profit report.
- **Cloudinary cleanup on delete/replace:** the receipt asset is deleted from Cloudinary before a new one is uploaded (update) or when the record itself is removed (delete) — deletion failures are caught and logged, never block the main flow.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing `branch`/`category`/`description`/`amount`/`paymentMethod`/`expenseDate` on create |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role |
| `404` | Expense not found |
| `409` | Update/delete attempted on an `approved` expense; approve attempted on a non-`pending` expense |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "An approved expense cannot be updated"
}
```

---

## 📊 Database Indexes

```typescript
expenseSchema.index({ branch: 1 });      // scope expenses to a branch
expenseSchema.index({ category: 1 });    // filter by expense category
expenseSchema.index({ status: 1 });      // filter pending/approved
expenseSchema.index({ expenseDate: 1 }); // date-range reporting (profit reports)
```

---

**Last Updated:** 2026-08-14
**Version:** 1.0.0
**Maintainer:** POS API Development Team
