# 💳 POS API - Payment Management Documentation

## 📋 Table of Contents
- [Payment Management Overview](#payment-management-overview)
- [Payment Model](#-payment-model)
- [Payment Controller](#-payment-controller)
- [Payment Routes](#-payment-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Payment Management Overview

Payment is where a **Tab**'s `awaiting_payment` state resolves. A Tab can carry multiple Payment records (Mixed Payment) — a cashier might take a partial cash tender and finish the remainder via M-Pesa, both against the same tab. Once a tab's `amountPaid >= grandTotal`, the Payment module hands off to the existing `tabService.completeTab()`, which deducts stock, marks the tab `completed`, and rolls the sale into `Shift.salesSummary.totalSales`.

**Scope notes for this pass:**
- **Cash and M-Pesa only.** Card/Paystack support is deferred — `IPayment.method` is `'cash' | 'mpesa'`, there is no `card` sub-object, and there is no `payCard()`/`recordMixedPayment()` endpoint. Mixed payment already works without a dedicated `/mixed` route: call `POST /cash` then `POST /mpesa/initiate` (or vice versa) against the same `tabId` for the remainder.
- **`reversePayment()` is the only `AuditLog` write in this module.** A `PAYMENT_REVERSED` entry is written via `auditService.logAudit()` (see `doc/modules/AUDIT_DOCUMENTATION.md`). `retryMpesaPayment()` still isn't audited — it creates a **new** Payment document instead of mutating the failed one, and the Payment collection itself remains the only durable record of what was attempted there.
- **Payment reversal is narrower than it looks.** `reversePayment()` is blocked once the tab it belongs to has reached `completed` (stock already deducted, no refund path exists) and once the tab's shift has `closed` (its cash reconciliation already ran against `salesSummary`). Because a single full payment finishes the tab in the same request that completes it, `reversePayment()` is realistically only usable in the partial/mixed-payment window — e.g. undoing a wrong cash tender before an M-Pesa top-up finishes the sale.
- **Notifications on mpesa outcomes.** `completeMpesaPayment()` and `failMpesaPayment()` (the private handlers `mpesaCallback`/`getMpesaPaymentStatus` funnel through) each call `notificationService.createNotification()` — `payment_success` / `mpesa_failed` — addressed to `payment.processedBy`, the cashier who took the payment. Cash payments don't get one; they're synchronous, so there's nothing async to confirm. This is also this module's first real-time Socket.io traffic: notifications push to the recipient's `user_{userId}` room. See `doc/modules/NOTIFICATION_DOCUMENTATION.md`.
- **Branch/shift are derived from the Tab, not the requesting user.** A cashier's own `currentShift` isn't necessarily the shift that opened the tab (a tab opened by a bartender may be closed out by a different cashier later in the same shift, or after a shift handover), so every payment inherits `tab.branch`/`tab.shift` directly.

---

## 👤 Payment Model

### Schema Definition
```typescript
export type PaymentMethod = "cash" | "mpesa";
export type PaymentStatus = "pending" | "completed" | "failed" | "reversed";

export interface IPaymentMpesaDetails {
  phone?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  mpesaReceiptNumber?: string;
  resultCode?: number;
  resultDesc?: string;
}

export interface IPayment extends Document {
  paymentNumber: string;
  tab: Types.ObjectId | ITab;
  branch: Types.ObjectId | IBranch;
  shift: Types.ObjectId | IShift;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  cashReceived?: number;
  cashChange?: number;
  mpesa?: IPaymentMpesaDetails;
  reversedBy?: Types.ObjectId | IUser;
  reversedReason?: string;
  processedBy: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Payment.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IPayment } from "../type";

const paymentSchema = new Schema<IPayment>(
  {
    paymentNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    tab: {
      type: Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    method: {
      type: String,
      enum: ["cash", "mpesa"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "pending",
    },
    cashReceived: {
      type: Number,
      min: 0,
    },
    cashChange: {
      type: Number,
      min: 0,
    },
    mpesa: {
      phone: { type: String, trim: true },
      checkoutRequestId: { type: String, trim: true },
      merchantRequestId: { type: String, trim: true },
      mpesaReceiptNumber: { type: String, trim: true },
      resultCode: { type: Number },
      resultDesc: { type: String, trim: true },
    },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reversedReason: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ branch: 1 });
paymentSchema.index({ shift: 1 });
paymentSchema.index({ tab: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ "mpesa.checkoutRequestId": 1 }, { sparse: true, unique: true });

const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
export default Payment;
```

### Validation Rules
```typescript
paymentNumber:   { required: true, unique: true, trim: true, auto-generated e.g. MAIN-PAY-2026-0001 }
tab:             { required: true, ObjectId ref: 'Tab' }
branch:          { required: true, ObjectId ref: 'Branch' — derived from tab.branch, never from the request }
shift:           { required: true, ObjectId ref: 'Shift' — derived from tab.shift, never from req.user.currentShift }
method:          { required: true, enum: ['cash', 'mpesa'] }
amount:          { required: true, min: 0 — must be > 0 and <= tab.balanceDue at creation time }
status:          { default: 'pending', enum: ['pending', 'completed', 'failed', 'reversed'] }
cashReceived:    { optional, min: 0 — cash method only }
cashChange:      { optional, min: 0 — cash method only, cashReceived - amount }
mpesa:           { optional plain object, absent entirely on cash payments — phone, checkoutRequestId, merchantRequestId set on initiation; mpesaReceiptNumber/resultCode/resultDesc set on callback/reconciliation }
reversedBy:      { optional, ObjectId ref: 'User' — set only when status becomes 'reversed' }
reversedReason:  { optional, trim — required in the request body to reverse a payment }
processedBy:     { required: true, ObjectId ref: 'User' — the cashier/bartender who took the payment }
```

---

## 🎮 Payment Controller

**File:** `src/controllers/paymentController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Payment from "../models/Payment";
import Tab from "../models/Tab";
import {
  payCash as payCashService,
  initiateMpesaPayment as initiateMpesaPaymentService,
  handleMpesaCallback,
  retryMpesaPayment as retryMpesaPaymentService,
  reconcileMpesaPayment,
  reversePayment as reversePaymentService,
} from "../services/internal/paymentService";
```

### Functions Overview

#### `payCash()`
**Purpose:** Record a cash payment against a tab that is awaiting payment
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** `tabId` and `cashReceived` are required; the service further enforces the tab is `awaiting_payment`, `0 < amount <= balanceDue`, and `cashReceived >= amount`
**Process:** Delegates to `paymentService.payCash` — completes immediately (no pending state), applies the payment to the tab's `amountPaid`/`balanceDue` and the shift's `salesSummary.cashSales`, and completes the tab if the balance hits zero
**Response:** Created payment

**Controller Implementation:**
```typescript
export const payCash = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabId, amount, cashReceived } = req.body;

    // Guard — tabId required
    if (!tabId) {
      return next(errorHandler(400, "tabId is required"));
    }
    if (!cashReceived) {
      return next(errorHandler(400, "cashReceived is required"));
    }

    // Record cash payment via service
    const payment = await payCashService({
      tabId,
      amount,
      cashReceived,
      processedBy: req.user?._id as any,
    });

    // Return created payment
    res.status(201).json({
      success: true,
      message: "Cash payment recorded",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `initiateMpesaPayment()`
**Purpose:** Trigger an M-Pesa STK push for a tab that is awaiting payment
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** `tabId` and `phone` are required; same tab-state and amount guards as `payCash`
**Process:** Delegates to `paymentService.initiateMpesaPayment` — creates a `pending` payment and returns Daraja's checkout references
**Response:** Created payment with `mpesa.checkoutRequestId`/`merchantRequestId`

**Controller Implementation:**
```typescript
export const initiateMpesaPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabId, phone, amount } = req.body;

    // Guard — tabId required
    if (!tabId) {
      return next(errorHandler(400, "tabId is required"));
    }
    if (!phone) {
      return next(errorHandler(400, "phone is required"));
    }

    // Initiate STK push via service
    const payment = await initiateMpesaPaymentService({
      tabId,
      phone,
      amount,
      processedBy: req.user?._id as any,
    });

    // Return created payment
    res.status(202).json({
      success: true,
      message: "M-Pesa STK push initiated",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `mpesaCallback()`
**Purpose:** Receive the asynchronous Daraja STK push result
**Access:** Public — called directly by Safaricom, not by an authenticated app user
**Validation:** None — malformed or unrecognized payloads are logged and silently ignored
**Process:** Delegates to `paymentService.handleMpesaCallback`, which resolves to `completeMpesaPayment()` or `failMpesaPayment()` — each notifies `payment.processedBy` (`payment_success`/`mpesa_failed`) via `notificationService.createNotification`. **Never calls `next(error)`** — Safaricom expects a fast, clean `200` and will retry the webhook otherwise, so internal failures are caught and logged instead of surfaced
**Response:** Always `200` with `{ ResultCode: 0, ResultDesc: "Accepted" }`, regardless of internal outcome

**Controller Implementation:**
```typescript
export const mpesaCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // Process callback payload via service
    await handleMpesaCallback(req.body);
  } catch (error: any) {
    console.error("Failed to process mpesa callback:", error);
  }

  // Always acknowledge Safaricom with a clean 200
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
};
```

---

#### `retryMpesaPayment()`
**Purpose:** Re-attempt a failed M-Pesa payment against the same tab
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** Original payment must exist, be `method: 'mpesa'`, and be `status: 'failed'`; the tab must still be `awaiting_payment`; the amount must not exceed the tab's current `balanceDue`
**Process:** Delegates to `paymentService.retryMpesaPayment` — creates a **new** `pending` payment via a fresh STK push; the original failed payment is left untouched as history
**Response:** New payment with fresh Daraja checkout references

**Controller Implementation:**
```typescript
export const retryMpesaPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Retry payment via service
    const payment = await retryMpesaPaymentService(req.params.paymentId as string, req.user?._id as any);

    // Return new payment
    res.status(201).json({
      success: true,
      message: "M-Pesa payment retried",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `reversePayment()`
**Purpose:** Reverse a completed cash or M-Pesa payment
**Access:** Manager, Admin
**Validation:** `reversedReason` is required; the service further enforces `payment.status === 'completed'`, `tab.status !== 'completed'`, and `shift.status !== 'closed'`
**Process:** Delegates to `paymentService.reversePayment` — marks the payment `reversed`, writes a `PAYMENT_REVERSED` `AuditLog` entry via `auditService.logAudit` (`before`/`after` status, `ipAddress` threaded from `req.ip`), decrements `tab.amountPaid`/recomputes `balanceDue`, and decrements the matching `salesSummary.<method>Sales` counter — see `doc/modules/AUDIT_DOCUMENTATION.md`
**Response:** Reversed payment

**Controller Implementation:**
```typescript
export const reversePayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { reversedReason } = req.body;

    // Guard — reversedReason required
    if (!reversedReason) {
      return next(errorHandler(400, "reversedReason is required"));
    }

    // Reverse payment via service
    const payment = await reversePaymentService(
      req.params.paymentId as string,
      req.user?._id as any,
      reversedReason,
      req.ip
    );

    // Return reversed payment
    res.status(200).json({
      success: true,
      message: "Payment reversed",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getPayment()`
**Purpose:** Fetch a single payment with full details
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** Payment must exist
**Process:** Find payment by ID and return with populated refs
**Response:** Payment details

**Controller Implementation:**
```typescript
export const getPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find payment by ID
    const payment = await Payment.findById(req.params.paymentId)
      .populate("tab", "tabNumber status")
      .populate("branch", "name code")
      .populate("shift", "shiftNumber")
      .populate("processedBy", "firstName lastName")
      .populate("reversedBy", "firstName lastName");

    // Guard — payment must exist
    if (!payment) {
      return next(errorHandler(404, "Payment not found"));
    }

    // Return payment
    res.status(200).json({
      success: true,
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getTabPayments()`
**Purpose:** List all payment records for a given tab
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** Tab must exist
**Process:** Find payments by tab, sorted oldest first, alongside the tab's current payment summary
**Response:** Payment list and tab payment summary

**Controller Implementation:**
```typescript
export const getTabPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Fetch payments for tab
    const payments = await Payment.find({ tab: tab._id })
      .populate("processedBy", "firstName lastName")
      .sort({ createdAt: 1 });

    // Return payments with tab summary
    res.status(200).json({
      success: true,
      data: {
        payments,
        summary: {
          grandTotal: tab.grandTotal,
          amountPaid: tab.amountPaid,
          balanceDue: tab.balanceDue,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getMpesaPaymentStatus()`
**Purpose:** Manually reconcile a pending M-Pesa payment's status against Daraja
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** `checkoutRequestId` must match an existing payment
**Process:** Delegates to `paymentService.reconcileMpesaPayment` — no-ops (returns the payment as-is) if it isn't `pending`, so repeated polling never re-queries Daraja unnecessarily; otherwise resolves to the same `completeMpesaPayment()`/`failMpesaPayment()` notification-sending paths as the webhook
**Response:** Current payment status

**Controller Implementation:**
```typescript
export const getMpesaPaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Reconcile payment via service
    const payment = await reconcileMpesaPayment(req.params.checkoutRequestId as string, req.user?._id as any);

    // Return payment
    res.status(200).json({
      success: true,
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Payment Routes

### Base Path: `/api/payments`

```typescript
POST   /cash                              // Record cash payment (bartender, cashier, manager, admin)
POST   /mpesa/initiate                    // Initiate STK push (bartender, cashier, manager, admin)
POST   /mpesa/callback                    // Daraja webhook — PUBLIC, no auth
POST   /mpesa/:paymentId/retry            // Retry failed mpesa payment (bartender, cashier, manager, admin)
PATCH  /:paymentId/reverse                // Reverse a completed payment (manager, admin)
GET    /tab/:tabId                        // List payments for a tab (bartender, cashier, manager, admin, accountant)
GET    /mpesa-status/:checkoutRequestId   // Reconcile mpesa status (bartender, cashier, manager, admin, accountant)
GET    /:paymentId                        // Get single payment (bartender, cashier, manager, admin, accountant)
```

### Router Implementation

**File: `src/routes/paymentRoutes.ts`**

```typescript
import express from "express";
import {
  payCash,
  initiateMpesaPayment,
  mpesaCallback,
  retryMpesaPayment,
  reversePayment,
  getPayment,
  getTabPayments,
  getMpesaPaymentStatus,
} from "../controllers/paymentController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];
const REVERSE_ROLES: UserRole[] = ["manager", "admin"];

router.post("/cash", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, payCash);
router.post("/mpesa/initiate", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, initiateMpesaPayment);
router.post("/mpesa/callback", mpesaCallback);
router.post("/mpesa/:paymentId/retry", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, retryMpesaPayment);
router.patch("/:paymentId/reverse", authenticateToken, authorizeRoles(REVERSE_ROLES), reversePayment);
router.get("/tab/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTabPayments);
router.get("/mpesa-status/:checkoutRequestId", authenticateToken, authorizeRoles(READ_ROLES), getMpesaPaymentStatus);
router.get("/:paymentId", authenticateToken, authorizeRoles(READ_ROLES), getPayment);

export default router;
```

### Route Details

#### `POST /api/payments/cash`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "tabId": "64f1a2b3c4d5e6f7a8b9c1a1",
  "cashReceived": 1500
}
```
**Response:**
```json
{
  "success": true,
  "message": "Cash payment recorded",
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a1",
      "paymentNumber": "MAIN-PAY-2026-0001",
      "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "shift": "64f1a2b3c4d5e6f7a8b9c0e2",
      "method": "cash",
      "amount": 1200,
      "status": "completed",
      "cashReceived": 1500,
      "cashChange": 300,
      "processedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "createdAt": "2026-08-11T18:40:00.000Z",
      "updatedAt": "2026-08-11T18:40:00.000Z"
    }
  }
}
```

#### `POST /api/payments/mpesa/initiate`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "tabId": "64f1a2b3c4d5e6f7a8b9c1a1",
  "phone": "0712345678"
}
```
**Response:**
```json
{
  "success": true,
  "message": "M-Pesa STK push initiated",
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a2",
      "paymentNumber": "MAIN-PAY-2026-0002",
      "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "shift": "64f1a2b3c4d5e6f7a8b9c0e2",
      "method": "mpesa",
      "amount": 1200,
      "status": "pending",
      "mpesa": {
        "phone": "254712345678",
        "checkoutRequestId": "ws_CO_030820261840001234",
        "merchantRequestId": "29115-34620561-1"
      },
      "processedBy": "64f1a2b3c4d5e6f7a8b9c0d8",
      "createdAt": "2026-08-11T18:41:00.000Z",
      "updatedAt": "2026-08-11T18:41:00.000Z"
    }
  }
}
```

#### `POST /api/payments/mpesa/callback`
**Headers:** None required — public Daraja webhook
**Body (from Safaricom):**
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_030820261840001234",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 1200 },
          { "Name": "MpesaReceiptNumber", "Value": "SFC1A2B3C4" },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```
**Response:**
```json
{
  "ResultCode": 0,
  "ResultDesc": "Accepted"
}
```

#### `POST /api/payments/mpesa/:paymentId/retry`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "M-Pesa payment retried",
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a3",
      "paymentNumber": "MAIN-PAY-2026-0003",
      "tab": "64f1a2b3c4d5e6f7a8b9c1a1",
      "method": "mpesa",
      "amount": 1200,
      "status": "pending",
      "mpesa": {
        "phone": "254712345678",
        "checkoutRequestId": "ws_CO_030820261845005678",
        "merchantRequestId": "29115-34620561-2"
      },
      "createdAt": "2026-08-11T18:45:00.000Z",
      "updatedAt": "2026-08-11T18:45:00.000Z"
    }
  }
}
```

#### `PATCH /api/payments/:paymentId/reverse`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "reversedReason": "Cashier entered the wrong tab, payment applied in error"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Payment reversed",
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a1",
      "paymentNumber": "MAIN-PAY-2026-0001",
      "status": "reversed",
      "reversedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "reversedReason": "Cashier entered the wrong tab, payment applied in error",
      "updatedAt": "2026-08-11T18:50:00.000Z"
    }
  }
}
```

#### `GET /api/payments/tab/:tabId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c2a1",
        "paymentNumber": "MAIN-PAY-2026-0001",
        "method": "cash",
        "amount": 500,
        "status": "completed",
        "processedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "createdAt": "2026-08-11T18:40:00.000Z"
      },
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c2a2",
        "paymentNumber": "MAIN-PAY-2026-0002",
        "method": "mpesa",
        "amount": 700,
        "status": "completed",
        "processedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "createdAt": "2026-08-11T18:41:00.000Z"
      }
    ],
    "summary": {
      "grandTotal": 1200,
      "amountPaid": 1200,
      "balanceDue": 0
    }
  }
}
```

#### `GET /api/payments/mpesa-status/:checkoutRequestId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a2",
      "paymentNumber": "MAIN-PAY-2026-0002",
      "method": "mpesa",
      "amount": 1200,
      "status": "completed",
      "mpesa": {
        "phone": "254712345678",
        "checkoutRequestId": "ws_CO_030820261840001234",
        "merchantRequestId": "29115-34620561-1",
        "mpesaReceiptNumber": "SFC1A2B3C4",
        "resultCode": 0,
        "resultDesc": "The service request is processed successfully."
      },
      "updatedAt": "2026-08-11T18:42:00.000Z"
    }
  }
}
```

#### `GET /api/payments/:paymentId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "payment": {
      "_id": "64f1a2b3c4d5e6f7a8b9c2a1",
      "paymentNumber": "MAIN-PAY-2026-0001",
      "tab": {
        "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
        "tabNumber": "MAIN-TAB-000001",
        "status": "completed"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "shift": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0e2",
        "shiftNumber": "MAIN-SHIFT-2026-0001"
      },
      "method": "cash",
      "amount": 500,
      "status": "completed",
      "cashReceived": 500,
      "cashChange": 0,
      "processedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
        "firstName": "Grace",
        "lastName": "Njeri"
      },
      "createdAt": "2026-08-11T18:40:00.000Z",
      "updatedAt": "2026-08-11T18:40:00.000Z"
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
router.get("/:paymentId", authenticateToken, getPayment);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.post("/cash", authenticateToken, authorizeRoles(["bartender", "cashier", "manager", "admin"]), payCash);
```

#### `requireActiveShift`
**Purpose:** Block payment-mutating routes when the requesting user has no `open` Shift
**Usage:**
```typescript
router.post("/cash", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, payCash);
```
Applied to `payCash`, `initiateMpesaPayment`, and `retryMpesaPayment`. Not applied to `reversePayment` or `getMpesaPaymentStatus` — a manager investigating a payment issue may not personally have an open shift, and neither handler reads `req.user.currentShift`. Not applied to `mpesaCallback`, which carries no authentication at all.

---

## 📝 API Examples

### Record a Cash Payment
```bash
curl -X POST http://localhost:3500/api/payments/cash \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "tabId": "64f1a2b3c4d5e6f7a8b9c1a1", "cashReceived": 1500 }'
```

### Initiate an M-Pesa STK Push
```bash
curl -X POST http://localhost:3500/api/payments/mpesa/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "tabId": "64f1a2b3c4d5e6f7a8b9c1a1", "phone": "0712345678" }'
```

### Manually Reconcile an M-Pesa Payment
```bash
curl -X GET http://localhost:3500/api/payments/mpesa-status/ws_CO_030820261840001234 \
  -H "Authorization: Bearer <token>"
```

### Retry a Failed M-Pesa Payment
```bash
curl -X POST http://localhost:3500/api/payments/mpesa/64f1a2b3c4d5e6f7a8b9c2a2/retry \
  -H "Authorization: Bearer <token>"
```

### Reverse a Payment
```bash
curl -X PATCH http://localhost:3500/api/payments/64f1a2b3c4d5e6f7a8b9c2a1/reverse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "reversedReason": "Cashier entered the wrong tab, payment applied in error" }'
```

### List Payments for a Tab
```bash
curl -X GET http://localhost:3500/api/payments/tab/64f1a2b3c4d5e6f7a8b9c1a1 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes except the public Daraja webhook require `authenticateToken`. Taking a payment (`payCash`, `initiateMpesaPayment`, `retryMpesaPayment`) is limited to `bartender`, `cashier`, `manager`, `admin`. Reversing a payment is limited to `manager`/`admin` only. Reading (`getPayment`, `getTabPayments`, `getMpesaPaymentStatus`) is additionally open to `accountant`.
- **Shift gating:** `requireActiveShift` blocks every payment-taking route when the requesting user has no `open` Shift.
- **Branch/shift derived from the Tab:** `branch` and `shift` on every Payment are copied from the Tab being paid, never accepted from the request body — a cashier cannot misattribute a payment to a different branch's reporting.
- **Public webhook is narrow by design:** `POST /mpesa/callback` has no auth middleware (Safaricom cannot present a bearer token), but it can only ever mutate a payment it can look up by `mpesa.checkoutRequestId` — a value Safaricom itself issued in response to a prior `initiateStkPush` call. It cannot create or resolve arbitrary payments.
- **Idempotent settlement:** Both the webhook and `getMpesaPaymentStatus` no-op on a payment that is no longer `pending`, and `applySuccessfulPayment`'s tab update uses an atomic `$inc` rather than load-mutate-save — a duplicate or racing callback cannot double-credit a tab.
- **Reversal boundaries:** `reversePayment` is blocked once the tab is `completed` or its shift is `closed`, preventing a reversal from silently invalidating stock already deducted or a shift's cash reconciliation that already ran.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing `tabId`/`cashReceived`/`phone`/`reversedReason`; payment amount is `<= 0` or exceeds the tab's `balanceDue`; `cashReceived` less than the amount; retrying a non-mpesa payment; original mpesa payment has no phone to retry |
| `401` | Missing or invalid JWT token (all routes except `POST /mpesa/callback`) |
| `403` | Insufficient role; no active shift (`requireActiveShift`) |
| `404` | Tab, payment, or shift not found |
| `409` | Tab is not `awaiting_payment`; retried payment is not `failed`; reversed payment is not `completed`; tab already `completed`; shift already `closed` |
| `502` | Daraja query API failed during manual reconciliation |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Tab must be awaiting payment to accept a payment"
}
```

---

## 📊 Database Indexes

```typescript
paymentSchema.index({ branch: 1 });   // scope payments to a branch
paymentSchema.index({ shift: 1 });    // roll up a shift's payments for salesSummary reconciliation
paymentSchema.index({ tab: 1 });      // fetch all payments for a tab (getTabPayments, mixed payment)
paymentSchema.index({ status: 1 });   // filter pending/completed/failed/reversed
paymentSchema.index({ "mpesa.checkoutRequestId": 1 }, { sparse: true, unique: true }); // webhook lookup; sparse since cash payments have no mpesa key
// paymentNumber already has a unique index from { unique: true } in the schema definition
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
