# 🔔 POS API - Notification Management Documentation

## 📋 Table of Contents
- [Notification Management Overview](#notification-management-overview)
- [Notification Model](#-notification-model)
- [Notification Service](#-notification-service)
- [Notification Controller](#-notification-controller)
- [Notification Routes](#-notification-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Notification Management Overview

Notification is the in-app inbox every staff member reads from — low stock alerts, a shift closing with a cash variance, a failed or confirmed M-Pesa payment, an expense awaiting approval, a purchase order or stock transfer arriving, a cancelled tab, and the daily branch summary. Nothing calls this module directly from a route the way a "create X" endpoint would; instead, `notificationService.createNotification()` is called from **eight trigger points spread across six other modules**, and delivered to the recipient's device in real time over the Socket.io connection already wired up (but previously unused) in `src/index.ts`.

**Scope notes for this pass:**
- **`recipient` is always a concrete user, never null.** The originally documented interface allowed `recipient: null` for a role/branch broadcast, but `isRead`/`readAt` are scalar fields that only mean something for a single owner. A "broadcast" (e.g. low stock → every manager and store keeper in a branch) fans out into one `Notification` document per matching user at creation time — `recipientRole` is kept on each document purely as an audit trail of *why* that user received it, not as a targeting mechanism at read time.
- **Four `type` values were added beyond the original six** (`expense_pending_approval`, `purchase_received`, `transfer_received`, `tab_cancelled`) to cover the trigger points below. `shift_started` stays in the enum for schema completeness but isn't actively wired this pass — starting a shift isn't actionable/urgent the way closing one with a variance is (same "documented but deferred" treatment as Receipt's `emailReceipt`).
- **The doc's original "Real-time Events" section was stale and has been corrected.** It described `branch:<branchId>`/role Socket rooms and a `src/config/socket.ts` file that never existed. The actual, working Socket.io setup in `src/index.ts` only tracks **per-user** rooms (`socket.join(`user_${userId}`)` on the client's `authenticate` event). This module is the first to actually emit anything over it (`notification:new`) — every controller and service before it left `io`/`socketConnections` completely unused.
- **No `updatedAt`** — matches the original documented interface, and mirrors `StockMovement`'s existing `{ timestamps: { createdAt: true, updatedAt: false } }` precedent.
- **`sendDailySummary()` is cron-scheduled**, per explicit choice: `node-cron` was added as a new dependency, registered once in `src/index.ts` via `notificationService.scheduleDailySummaryCron()`, firing daily at 01:00 server time for every active branch.

---

## 🔔 Notification Model

### Schema Definition
```typescript
export type NotificationType =
  | "low_stock"
  | "shift_started"
  | "shift_closed"
  | "mpesa_failed"
  | "payment_success"
  | "daily_summary"
  | "expense_pending_approval"
  | "purchase_received"
  | "transfer_received"
  | "tab_cancelled";

export interface INotification extends Document {
  branch: Types.ObjectId | IBranch;
  recipient: Types.ObjectId | IUser;
  recipientRole?: UserRole;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
}
```

### Model Implementation

**File: `src/models/Notification.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { INotification } from "../type";

const notificationSchema = new Schema<INotification>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientRole: {
      type: String,
      enum: ["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"],
    },
    type: {
      type: String,
      enum: [
        "low_stock",
        "shift_started",
        "shift_closed",
        "mpesa_failed",
        "payment_success",
        "daily_summary",
        "expense_pending_approval",
        "purchase_received",
        "transfer_received",
        "tab_cancelled",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ branch: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.model<INotification>("Notification", notificationSchema);
export default Notification;
```

### Validation Rules
```typescript
branch:         { required: true, ObjectId ref: 'Branch' }
recipient:      { required: true, ObjectId ref: 'User' — always concrete, never null }
recipientRole:  { optional, enum: UserRole — set only when the notification was created via a role fan-out, records which role matched }
type:           { required: true, enum: NotificationType (10 values, 4 beyond the original spec) }
title:          { required: true, trim: true }
message:        { required: true, trim: true }
metadata:       { optional, Mixed — free-form context (ids, amounts) for the frontend to deep-link with }
isRead:         { default: false }
readAt:         { optional, Date — set only by markAsRead/markAllAsRead }
```

---

## ⚙️ Notification Service

**File:** `src/services/internal/notificationService.ts`

Unlike every other module this pass, Notification's real surface area is a service, not a controller — the controller only covers reading/acknowledging an inbox that other modules fill.

```typescript
import { Types } from "mongoose";
import cron from "node-cron";
import Notification from "../../models/Notification";
import Role from "../../models/Role";
import User from "../../models/User";
import Tab from "../../models/Tab";
import Branch from "../../models/Branch";
import { getIo } from "../../config/socket";
import { getRevenueBreakdown, getCostOfGoodsSold, getApprovedExpenseTotal } from "./reportingService";
import { INotification, NotificationType, UserRole } from "../../type";
```

#### `createNotification(input)`
**Purpose:** The core primitive every trigger site calls
**Process:** Resolves recipients (a single explicit `recipient`, or every active user in `branch` holding one of `recipientRole`), creates one `Notification` document per recipient, and emits `notification:new` to that user's `user_<id>` Socket.io room. **Never throws** — every DB/socket step is caught and logged internally, so a notification failure can never abort the business transaction that triggered it (same "must not block the main flow" principle already used for Cloudinary delete failures elsewhere in this codebase).

**Implementation:**
```typescript
interface CreateNotificationInput {
  branch: string | Types.ObjectId;
  recipient?: string | Types.ObjectId;
  recipientRole?: UserRole | UserRole[];
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

interface NotificationTarget {
  recipient: Types.ObjectId;
  recipientRole?: UserRole;
}

const resolveTargets = async (input: CreateNotificationInput): Promise<NotificationTarget[]> => {
  if (input.recipient) {
    return [{ recipient: new Types.ObjectId(input.recipient) }];
  }

  if (!input.recipientRole) {
    return [];
  }

  const roleNames = Array.isArray(input.recipientRole) ? input.recipientRole : [input.recipientRole];
  const targets: NotificationTarget[] = [];

  for (const roleName of roleNames) {
    const roleDoc = await Role.findOne({ name: roleName });
    if (!roleDoc) {
      continue;
    }

    const users = await User.find({ branch: input.branch, role: roleDoc._id, status: true });
    for (const user of users) {
      targets.push({ recipient: user._id as Types.ObjectId, recipientRole: roleName });
    }
  }

  return targets;
};

export const createNotification = async (input: CreateNotificationInput): Promise<INotification[]> => {
  const created: INotification[] = [];

  try {
    const targets = await resolveTargets(input);
    const io = getIo();

    for (const target of targets) {
      try {
        const notification = await Notification.create({
          branch: input.branch,
          recipient: target.recipient,
          recipientRole: target.recipientRole,
          type: input.type,
          title: input.title,
          message: input.message,
          metadata: input.metadata,
        });
        created.push(notification);

        if (io) {
          io.to(`user_${target.recipient.toString()}`).emit("notification:new", notification);
        }
      } catch (error: any) {
        console.error(`Failed to create/emit notification for user ${target.recipient}:`, error);
      }
    }
  } catch (error: any) {
    console.error("Failed to resolve notification recipients:", error);
  }

  return created;
};
```

---

#### `sendLowStockAlert(input)`
**Purpose:** Wraps `createNotification` for the low-stock case
**Called from:** `stockMovementService.recordStockMovement`, the instant a *decreasing* movement pushes a SKU at or below its branch `minimumStock`
**Recipients:** `manager`, `store_keeper` (branch)

```typescript
export const sendLowStockAlert = async (input: {
  branch: string | Types.ObjectId;
  productName: string;
  skuCode: string;
  currentStock: number;
  minimumStock: number;
}): Promise<void> => {
  await createNotification({
    branch: input.branch,
    recipientRole: ["manager", "store_keeper"],
    type: "low_stock",
    title: "Low stock alert",
    message: `${input.productName} (${input.skuCode}) is at ${input.currentStock} units — at or below the minimum of ${input.minimumStock}.`,
    metadata: {
      skuCode: input.skuCode,
      currentStock: input.currentStock,
      minimumStock: input.minimumStock,
    },
  });
};
```

---

#### `sendDailySummary(branch)`
**Purpose:** Summarizes the previous calendar day's revenue/COGS/expenses/profit for a branch
**Called from:** the daily cron job (`scheduleDailySummaryCron`, below), and callable directly for a manual/on-demand summary
**Recipients:** `manager` (branch)
**Reuses:** `reportingService.getRevenueBreakdown` / `getCostOfGoodsSold` / `getApprovedExpenseTotal` — the exact same helpers `reportController.getProfitReport` and `analyticsController.getProfitTrend` are built on.

```typescript
export const sendDailySummary = async (branch: string | Types.ObjectId): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  const revenue = await getRevenueBreakdown({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const cogs = await getCostOfGoodsSold({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const expenses = await getApprovedExpenseTotal({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const tabCount = await Tab.countDocuments({
    branch,
    status: "completed",
    closedAt: { $gte: startOfYesterday, $lte: startOfToday },
  });
  const netProfit = revenue.totalRevenue - cogs - expenses;

  await createNotification({
    branch,
    recipientRole: "manager",
    type: "daily_summary",
    title: "Yesterday's summary",
    message: `Revenue: ${revenue.totalRevenue}, Tabs completed: ${tabCount}, Net profit: ${netProfit}.`,
    metadata: {
      revenue: revenue.totalRevenue,
      cogs,
      expenses,
      netProfit,
      tabCount,
    },
  });
};
```

---

#### `scheduleDailySummaryCron()`
**Purpose:** Registers the once-daily cron job
**Called from:** `src/index.ts`, once at startup

```typescript
export const scheduleDailySummaryCron = (): void => {
  cron.schedule("0 1 * * *", async () => {
    const branches = await Branch.find({ isActive: true });

    for (const branch of branches) {
      try {
        await sendDailySummary(branch._id as Types.ObjectId);
      } catch (error: any) {
        console.error(`Failed to send daily summary for branch ${branch._id}:`, error);
      }
    }
  });
};
```

---

### Trigger Wiring

Eight call sites across six other files call into this service, each right after the state change they're reporting on has already been persisted (a notification must never fire for a change that then fails to save):

| # | File / Function | Type | Recipient(s) |
|---|---|---|---|
| 1 | `stockMovementService.recordStockMovement` | `low_stock` | manager, store_keeper (branch) |
| 2 | `shiftController.endShift` | `shift_closed` | manager (branch) — message includes expected/actual/variance |
| 3 | `paymentService.failMpesaPayment` | `mpesa_failed` | `payment.processedBy` |
| 4 | `paymentService.completeMpesaPayment` | `payment_success` | `payment.processedBy` — mpesa only; cash is synchronous, nothing to confirm |
| 5 | `expenseController.createExpense` | `expense_pending_approval` | manager, admin (branch) |
| 6 | `purchaseController.receiveGoods` | `purchase_received` | manager, store_keeper (branch) |
| 7 | `transferController.receiveTransfer` | `transfer_received` | manager (`transfer.toBranch`) |
| 8 | `tabController.cancelTab` | `tab_cancelled` | manager (branch) |

Example — `stockMovementService.recordStockMovement` (the low-stock trigger):
```typescript
// Alert once a decreasing movement pushes stock at/below the branch minimum
if (DECREASING_TYPES.includes(type) && newBalance <= branchEntry.minimumStock) {
  await sendLowStockAlert({
    branch,
    productName: product.name,
    skuCode: skuDoc.skuCode,
    currentStock: newBalance,
    minimumStock: branchEntry.minimumStock,
  });
}
```

---

## 🎮 Notification Controller

**File:** `src/controllers/notificationController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Notification from "../models/Notification";
```

### Functions Overview

#### `getMyNotifications()`
**Purpose:** List the authenticated user's notifications, filterable and paginated
**Access:** Any authenticated user
**Validation:** None required
**Process:** Filter by recipient (always the caller) and optional `isRead`, paginate, return results
**Response:** Notification list and pagination

**Controller Implementation:**
```typescript
export const getMyNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, isRead } = req.query;

    // Build filter query — always scoped to the caller
    const query: any = { recipient: req.user?._id };
    if (isRead !== undefined) {
      query.isRead = isRead === "true";
    }

    // Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // Fetch notifications and total count
    const notifications = await Notification.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Notification.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalNotifications: total,
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

#### `getUnreadCount()`
**Purpose:** Count the authenticated user's unread notifications, for a bell badge
**Access:** Any authenticated user
**Validation:** None required
**Process:** Count notifications scoped to the caller with `isRead: false`
**Response:** Unread count

**Controller Implementation:**
```typescript
export const getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Count unread notifications for the caller
    const count = await Notification.countDocuments({ recipient: req.user?._id, isRead: false });

    // Return count
    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `markAsRead()`
**Purpose:** Mark a single notification read
**Access:** Any authenticated user
**Validation:** Notification must exist and belong to the caller
**Process:** Find by ID scoped to the caller, set `isRead`/`readAt`
**Response:** Updated notification

**Controller Implementation:**
```typescript
export const markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find notification scoped to the caller
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      recipient: req.user?._id,
    });

    // Guard — notification must exist and belong to the caller
    if (!notification) {
      return next(errorHandler(404, "Notification not found"));
    }

    // Mark read
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    // Return updated notification
    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: { notification },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `markAllAsRead()`
**Purpose:** Mark every one of the caller's unread notifications read in one call
**Access:** Any authenticated user
**Validation:** None required
**Process:** Bulk update scoped to the caller
**Response:** Number of notifications marked read

**Controller Implementation:**
```typescript
export const markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Bulk mark read, scoped to the caller
    const result = await Notification.updateMany(
      { recipient: req.user?._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    // Return count
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Notification Routes

### Base Path: `/api/notifications`

```typescript
GET    /                    // My notifications, paginated (any authenticated user)
GET    /unread-count        // My unread count (any authenticated user)
PATCH  /:notificationId/read // Mark one read (any authenticated user, own only)
PATCH  /read-all            // Mark all read (any authenticated user, own only)
```

No `authorizeRoles` on any route — every authenticated user reads and manages only their own inbox, scoped by `req.user._id` inside the controller, not gated by role.

### Router Implementation

**File: `src/routes/notificationRoutes.ts`**

```typescript
import express from "express";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, getMyNotifications);
router.get("/unread-count", authenticateToken, getUnreadCount);
router.patch("/:notificationId/read", authenticateToken, markAsRead);
router.patch("/read-all", authenticateToken, markAllAsRead);

export default router;
```

### Route Details

#### `GET /api/notifications`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `isRead=false`
**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c7a1",
        "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
        "recipient": "64f1a2b3c4d5e6f7a8b9c0d9",
        "recipientRole": "manager",
        "type": "low_stock",
        "title": "Low stock alert",
        "message": "Tusker Lager (TUSKER-LAGER-DEFAULT) is at 6 units — at or below the minimum of 12.",
        "metadata": {
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "currentStock": 6,
          "minimumStock": 12
        },
        "isRead": false,
        "createdAt": "2026-08-13T21:10:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalNotifications": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/notifications/unread-count`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "count": 4
  }
}
```

#### `PATCH /api/notifications/:notificationId/read`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read",
  "data": {
    "notification": {
      "_id": "64f1a2b3c4d5e6f7a8b9c7a1",
      "isRead": true,
      "readAt": "2026-08-13T21:15:00.000Z"
    }
  }
}
```

#### `PATCH /api/notifications/read-all`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "All notifications marked as read",
  "data": {
    "modifiedCount": 4
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
router.get("/", authenticateToken, getMyNotifications);
```
No `authorizeRoles` anywhere in this module — see Security Features below.

### Socket Delivery Accessor

#### `getIo()` / `setIo()`
**File:** `src/config/socket.ts`
**Purpose:** Lets deep service functions that never receive `req` (e.g. `stockMovementService.recordStockMovement`, called from `tabService`, `purchaseController`, `transferController`, `stockAdjustmentController`...) emit Socket.io events without threading `io` through every call signature.
```typescript
import type { Server } from "socket.io";

let ioInstance: Server | null = null;

export const setIo = (io: Server): void => {
  ioInstance = io;
};

export const getIo = (): Server | null => {
  return ioInstance;
};
```
`src/index.ts` calls `setIo(io)` right after constructing the Socket.io server — additive to the existing `app.set("io", io)` line, not a replacement.

---

## 📝 API Examples

### List My Notifications
```bash
curl -X GET "http://localhost:3500/api/notifications?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c7a2",
        "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
        "recipient": "64f1a2b3c4d5e6f7a8b9c0d9",
        "recipientRole": "manager",
        "type": "shift_closed",
        "title": "Shift closed",
        "message": "Shift MAIN-SHIFT-2026-0042 closed. Expected KES 18500, actual KES 18350, variance KES -150.",
        "metadata": {
          "shiftId": "64f1a2b3c4d5e6f7a8b9c8a1",
          "expected": 18500,
          "actual": 18350,
          "variance": -150
        },
        "isRead": false,
        "createdAt": "2026-08-13T20:05:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalNotifications": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Only Unread
```bash
curl -X GET "http://localhost:3500/api/notifications?isRead=false" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [],
    "pagination": {
      "currentPage": 1,
      "totalPages": 0,
      "totalNotifications": 0,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Unread Count for a Bell Badge
```bash
curl -X GET http://localhost:3500/api/notifications/unread-count \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "count": 2
  }
}
```

### Mark One Read
```bash
curl -X PATCH http://localhost:3500/api/notifications/64f1a2b3c4d5e6f7a8b9c7a1/read \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read",
  "data": {
    "notification": {
      "_id": "64f1a2b3c4d5e6f7a8b9c7a1",
      "isRead": true,
      "readAt": "2026-08-13T21:15:00.000Z"
    }
  }
}
```

### Mark All Read
```bash
curl -X PATCH http://localhost:3500/api/notifications/read-all \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "message": "All notifications marked as read",
  "data": {
    "modifiedCount": 2
  }
}
```

---

## 🛡️ Security Features

- **No role gating — ownership gating instead.** Every route only requires `authenticateToken`; every query and update inside the controller is scoped to `req.user._id`. There is no "read anyone's notifications" capability at any role, including admin — a notification is private to its recipient.
- **`markAsRead` cannot target another user's notification.** The lookup is `{ _id, recipient: req.user._id }` together, not a plain `findById` — a mismatched id returns `404`, not `403`, so it doesn't even confirm the notification exists.
- **Fan-out never leaks membership.** Resolving `recipientRole` happens entirely server-side inside `createNotification`; no endpoint lets a client ask "who are the managers of branch X."
- **Delivery failures are silent by design.** `createNotification` never throws, so a Socket.io outage or a bad `metadata` payload can never roll back the stock movement, payment, shift close, etc. that triggered it.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `401` | Missing or invalid JWT token |
| `404` | `markAsRead` target doesn't exist or doesn't belong to the caller |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Notification not found"
}
```

---

## 📊 Database Indexes

```typescript
notificationSchema.index({ recipient: 1, isRead: 1 }); // the "my unread" query — the hot path
notificationSchema.index({ branch: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ createdAt: -1 });
```

---

**Last Updated:** 2026-08-13
**Version:** 1.0.0
**Maintainer:** POS API Development Team
