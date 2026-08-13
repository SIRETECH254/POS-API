# 🕵️ POS API - Audit Management Documentation

## 📋 Table of Contents
- [Audit Management Overview](#audit-management-overview)
- [Audit Model](#-audit-model)
- [Audit Service](#-audit-service)
- [Audit Controller](#-audit-controller)
- [Audit Routes](#-audit-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Audit Management Overview

AuditLog is the immutable trail of who changed what, and from what to what, for the four operations this codebase treats as sensitive: **price edits**, **tab cancellation**, **payment reversal**, and **role assignment**. Nothing calls this module from a "create X" route the way Expense or Purchase would — instead, `auditService.logAudit()` is called explicitly from inside the four operations themselves, right after each one's state change already committed.

**Scope notes for this pass:**
- **No `auditLogger` middleware — explicit service calls instead.** The originally documented `auditLogger(entityType, action)` middleware can't actually work as a generic Express middleware in this codebase: it would only see `req`/`res`, not the before/after database state, and none of the four target handlers use a `res.locals`-style convention a middleware could read a diff from (confirmed: no such convention exists anywhere in this codebase). All four already follow `findById` → mutate in-memory → `.save()`, so the "before" snapshot only exists transiently inside the handler/service, right before the mutating assignment — the same reasoning that led the Notification module to use explicit `createNotification()` calls instead of a generic broadcast mechanism.
- **`branch` is optional on `IAuditLog`**, unlike the originally documented (non-optional) field. `Tab`/`Payment`/`User` all have a clear branch to attribute an entry to, but a `SKU` doesn't — pricing lives on `Product.skus`, which isn't branch-scoped (only `stockByBranch` is). `PRICE_CHANGE` entries fall back to the acting user's own `branch`.
- **`action`/`entityType` are typed unions**, not the originally documented loose `string` — `AuditAction` (`PRICE_CHANGE` | `TAB_CANCELLED` | `PAYMENT_REVERSED` | `ROLE_CHANGED`) and `AuditEntityType` (`SKU` | `Tab` | `Payment` | `User`), matching this codebase's consistent preference for typed enums (`ExpenseStatus`, `PaymentMethod`, etc.) over free-form strings, scoped to the four operations wired this pass.
- **No update or delete routes exist at all.** Per the original spec — "Never editable or deletable, even by administrators" — immutability is enforced by omission rather than a guard: there is no `updateAuditLog`/`deleteAuditLog` function anywhere to call.
- **`logAudit()` never throws.** A failed audit write must never roll back the price change/cancellation/reversal/role change it's recording — same principle as `notificationService.createNotification`.

---

## 📄 Audit Model

### Schema Definition
```typescript
export type AuditAction = "PRICE_CHANGE" | "TAB_CANCELLED" | "PAYMENT_REVERSED" | "ROLE_CHANGED";
export type AuditEntityType = "SKU" | "Tab" | "Payment" | "User";

export interface IAuditLog extends Document {
  branch?: Types.ObjectId | IBranch;
  user: Types.ObjectId | IUser;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: Types.ObjectId;
  before?: Record<string, any>;
  after?: Record<string, any>;
  ipAddress?: string;
  createdAt: Date;
}
```

### Model Implementation

**File: `src/models/AuditLog.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IAuditLog } from "../type";

const auditLogSchema = new Schema<IAuditLog>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: ["PRICE_CHANGE", "TAB_CANCELLED", "PAYMENT_REVERSED", "ROLE_CHANGED"],
      required: true,
    },
    entityType: {
      type: String,
      enum: ["SKU", "Tab", "Payment", "User"],
      required: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    before: {
      type: Schema.Types.Mixed,
    },
    after: {
      type: Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ branch: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
export default AuditLog;
```

### Validation Rules
```typescript
branch:      { optional, ObjectId ref: 'Branch' — absent for entities with no inherent branch (SKU) }
user:        { required: true, ObjectId ref: 'User' — who performed the action }
action:      { required: true, enum: AuditAction }
entityType:  { required: true, enum: AuditEntityType }
entityId:    { required: true, ObjectId — the affected document's _id }
before:      { optional, Mixed — relevant pre-change fields only, not a full document dump }
after:       { optional, Mixed — relevant post-change fields only }
ipAddress:   { optional, trim — from req.ip where the trigger is a controller; absent where it's a service with no req }
```

---

## ⚙️ Audit Service

**File:** `src/services/internal/auditService.ts`

```typescript
import { Types } from "mongoose";
import AuditLog from "../../models/AuditLog";
import { AuditAction, AuditEntityType } from "../../type";

interface LogAuditInput {
  branch?: string | Types.ObjectId;
  user: string | Types.ObjectId;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | Types.ObjectId;
  before?: Record<string, any>;
  after?: Record<string, any>;
  ipAddress?: string | undefined;
}

export const logAudit = async (input: LogAuditInput): Promise<void> => {
  try {
    await AuditLog.create({
      branch: input.branch,
      user: input.user,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ipAddress: input.ipAddress,
    });
  } catch (error: any) {
    console.error(`Failed to write audit log (${input.action} on ${input.entityType} ${input.entityId}):`, error);
  }
};
```

### Trigger Wiring

Four call sites, each snapshotting the relevant *before* fields into local variables immediately before the existing mutation line, and calling `logAudit` immediately after the existing `.save()`:

| File / Function | Action | Entity | Snapshot |
|---|---|---|---|
| `skuController.updateSku` | `PRICE_CHANGE` | `SKU` | `{ buyingPrice, sellingPrice }` — only when the update actually touches price |
| `tabController.cancelTab` | `TAB_CANCELLED` | `Tab` | `{ status }` → `{ status: "cancelled", cancelReason }` |
| `paymentService.reversePayment` | `PAYMENT_REVERSED` | `Payment` | `{ status }` → `{ status: "reversed", reversedReason }` |
| `userController.updateStaff` | `ROLE_CHANGED` | `User` | `{ role }` → `{ role: roleId }` — only when `roleId` was actually provided |

Example — `skuController.updateSku` (the trickiest one, since `product.updateSKU()` mutates the SKU subdocument in place):
```typescript
// Snapshot pre-update price fields — product.updateSKU mutates the
// subdocument in place, so this must happen before that call
const skuBeforeUpdate = product.skus.id(req.params.skuId as string);
const priceBefore = { buyingPrice: skuBeforeUpdate?.buyingPrice, sellingPrice: skuBeforeUpdate?.sellingPrice };

// Apply update via instance method
await product.updateSKU(req.params.skuId as string, updateData);

// Audit price changes only — skip barcode/status-only edits.
// SKUs aren't branch-scoped (only stockByBranch is), so this is
// attributed to the acting user's own branch.
if (buyingPrice !== undefined || sellingPrice !== undefined) {
  await logAudit({
    branch: req.user?.branch as any,
    user: req.user?._id as any,
    action: "PRICE_CHANGE",
    entityType: "SKU",
    entityId: req.params.skuId as string,
    before: priceBefore,
    after: { buyingPrice, sellingPrice },
    ipAddress: req.ip,
  });
}
```

`paymentService.reversePayment` runs outside any controller, so it has no `req` — it takes an added optional `ipAddress` parameter, threaded from `paymentController.reversePayment`'s `req.ip` the same way `performedBy` is already threaded through this codebase's service layer:
```typescript
export const reversePayment = async (
  paymentId: string | Types.ObjectId,
  reversedBy: string | Types.ObjectId,
  reversedReason: string,
  ipAddress?: string
): Promise<IPayment> => {
  // ...
  const statusBefore = payment.status;

  payment.status = "reversed";
  payment.reversedBy = reversedBy as any;
  payment.reversedReason = reversedReason;
  await payment.save();

  await logAudit({
    branch: payment.branch as any,
    user: reversedBy,
    action: "PAYMENT_REVERSED",
    entityType: "Payment",
    entityId: payment._id as any,
    before: { status: statusBefore },
    after: { status: "reversed", reversedReason },
    ipAddress,
  });
  // ...
};
```

---

## 🎮 Audit Controller

**File:** `src/controllers/auditController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import AuditLog from "../models/AuditLog";
```

### Functions Overview

#### `getAuditLogs()`
**Purpose:** List audit log entries with filtering and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by `branch`/`user`/`entityType`/`action`/date range, paginate, return results newest first
**Response:** Audit log list and pagination

**Controller Implementation:**
```typescript
export const getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, user, entityType, action, from, to } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (user) {
      query.user = user;
    }
    if (entityType) {
      query.entityType = entityType;
    }
    if (action) {
      query.action = action;
    }
    if (from || to) {
      query.createdAt = {};
      if (from) {
        query.createdAt.$gte = new Date(from as string);
      }
      if (to) {
        query.createdAt.$lte = new Date(to as string);
      }
    }

    // Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // Fetch audit logs and total count
    const auditLogs = await AuditLog.find(query)
      .populate("branch", "name code")
      .populate("user", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await AuditLog.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        auditLogs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalAuditLogs: total,
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

#### `getEntityHistory()`
**Purpose:** List every audit log entry recorded against a single entity
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by `entityType`/`entityId` from the path, paginate, return oldest first — a history read top to bottom
**Response:** Audit log list and pagination

**Controller Implementation:**
```typescript
export const getEntityHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract path and query parameters
    const { entityType, entityId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // Fetch audit logs and total count, oldest first
    const query = { entityType, entityId };
    const auditLogs = await AuditLog.find(query)
      .populate("branch", "name code")
      .populate("user", "firstName lastName")
      .sort({ createdAt: "asc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await AuditLog.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        auditLogs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalAuditLogs: total,
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

## 🛣️ Audit Routes

### Base Path: `/api/audit-logs`

```typescript
GET /                              // All audit logs, filterable/paginated (manager, admin)
GET /entity/:entityType/:entityId  // One entity's history (manager, admin)
```

No `POST`/`PUT`/`DELETE` routes exist — immutability enforced by omission.

### Router Implementation

**File: `src/routes/auditRoutes.ts`**

```typescript
import express from "express";
import { getAuditLogs, getEntityHistory } from "../controllers/auditController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const AUDIT_ROLES: UserRole[] = ["manager", "admin"];

router.get("/", authenticateToken, authorizeRoles(AUDIT_ROLES), getAuditLogs);
router.get("/entity/:entityType/:entityId", authenticateToken, authorizeRoles(AUDIT_ROLES), getEntityHistory);

export default router;
```

### Route Details

#### `GET /api/audit-logs`
**Headers:** `Authorization: Bearer <token>`
**Query:** `entityType=Tab`, `action=TAB_CANCELLED`, `from=2026-08-01`, `to=2026-08-13`
**Response:**
```json
{
  "success": true,
  "data": {
    "auditLogs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c9a1",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "user": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "action": "TAB_CANCELLED",
        "entityType": "Tab",
        "entityId": "64f1a2b3c4d5e6f7a8b9c1a1",
        "before": {
          "status": "open"
        },
        "after": {
          "status": "cancelled",
          "cancelReason": "Customer walked out"
        },
        "ipAddress": "41.90.12.7",
        "createdAt": "2026-08-13T19:20:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAuditLogs": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/audit-logs/entity/:entityType/:entityId`
**Headers:** `Authorization: Bearer <token>`
**Example:** `GET /api/audit-logs/entity/SKU/64f1a2b3c4d5e6f7a8b9c5a2`
**Response:**
```json
{
  "success": true,
  "data": {
    "auditLogs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c9a2",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "user": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d9",
          "firstName": "Daniel",
          "lastName": "Kimani"
        },
        "action": "PRICE_CHANGE",
        "entityType": "SKU",
        "entityId": "64f1a2b3c4d5e6f7a8b9c5a2",
        "before": {
          "buyingPrice": 150,
          "sellingPrice": 250
        },
        "after": {
          "buyingPrice": 160,
          "sellingPrice": 260
        },
        "ipAddress": "41.90.12.9",
        "createdAt": "2026-08-13T08:05:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAuditLogs": 1,
      "hasNextPage": false,
      "hasPrevPage": false
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
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAuditLogs);
```
Both routes use the same `AUDIT_ROLES` set — bartender/cashier/store_keeper/accountant have no access to the audit trail.

---

## 📝 API Examples

### List Audit Logs Filtered by Action
```bash
curl -X GET "http://localhost:3500/api/audit-logs?action=PAYMENT_REVERSED&from=2026-08-01" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "auditLogs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c9a3",
        "action": "PAYMENT_REVERSED",
        "entityType": "Payment",
        "entityId": "64f1a2b3c4d5e6f7a8b9c2a1",
        "before": {
          "status": "completed"
        },
        "after": {
          "status": "reversed",
          "reversedReason": "Cashier entered the wrong tab, payment applied in error"
        },
        "createdAt": "2026-08-11T18:50:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAuditLogs": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Entity History
```bash
curl -X GET "http://localhost:3500/api/audit-logs/entity/User/64f1a2b3c4d5e6f7a8b9c0d8" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "auditLogs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c9a4",
        "action": "ROLE_CHANGED",
        "entityType": "User",
        "entityId": "64f1a2b3c4d5e6f7a8b9c0d8",
        "before": {
          "role": "64f1a2b3c4d5e6f7a8b9c0a1"
        },
        "after": {
          "role": "64f1a2b3c4d5e6f7a8b9c0a2"
        },
        "createdAt": "2026-07-20T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAuditLogs": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

## 🛡️ Security Features

- **RBAC:** Both routes are `manager`/`admin` only — no other role can read the audit trail.
- **Truly immutable:** there is no update or delete path anywhere in this module — not gated behind a role check, simply absent. Even a compromised admin token can't erase history through this API.
- **Failures are silent by design, on purpose:** `logAudit()` never throws, so an audit-write failure (e.g. a Mongo blip) can never roll back the price change/cancellation/reversal/role change it was recording — the business operation always wins.
- **`before`/`after` are scoped snapshots, not full document dumps** — only the fields relevant to each action (e.g. `buyingPrice`/`sellingPrice` for `PRICE_CHANGE`), so entries stay small and reviewable rather than becoming an opaque full-document diff.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role |
| `500` | Unexpected server error (e.g. invalid `from`/`to` date, invalid `branch`/`user` ObjectId string) |

**Error response shape:**
```json
{
  "success": false,
  "message": "Cast to ObjectId failed for value \"not-an-id\" (type string) at path \"user\""
}
```

---

## 📊 Database Indexes

```typescript
auditLogSchema.index({ branch: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 }); // getEntityHistory — the primary lookup
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });
```

---

**Last Updated:** 2026-08-13
**Version:** 1.0.0
**Maintainer:** POS API Development Team
