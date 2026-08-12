# 💰 POS API - Daraja (M-Pesa) Documentation

## 📋 Table of Contents
- [Daraja Overview](#daraja-overview)
- [Configuration](#configuration)
- [External Services](#external-services)
- [Internal Services](#internal-services)
- [Usage in Controllers](#usage-in-controllers)
- [Callbacks and Webhooks](#callbacks-and-webhooks)
- [Error Handling](#error-handling)
- [API Examples](#api-examples)

---

## Daraja Overview

Daraja is the API gateway for M-Pesa, a mobile money transfer service in Kenya. In this project, the Daraja API is integrated to facilitate M-Pesa payments for **Sale Tabs** — the core sale entity of the POS — specifically using the STK Push (Sim Tool Kit Push) functionality. This lets a cashier trigger a payment prompt directly on the customer's phone when closing out a tab.

**Key Features:**
- **STK Push Initiation:** Programmatically trigger M-Pesa STK Push prompts on customer phones.
- **Transaction Callbacks:** Receive real-time notifications for payment success or failure.
- **Transaction Status Query:** Check the status of an STK Push transaction (used both by the manual reconciliation endpoint and by payment retry).
- **Secure Authentication:** Uses OAuth 2.0 for API access.

---

## Configuration

Daraja API credentials and settings are managed through environment variables. These are consumed by `src/services/external/darajaService.ts` to authenticate with Safaricom and handle transaction callbacks.

**Environment Variables:**
- `MPESA_ENV`: `sandbox` or `production`. Determines the base URL for the Daraja API.
- `MPESA_CONSUMER_KEY`: Your M-Pesa app consumer key.
- `MPESA_CONSUMER_SECRET`: Your M-Pesa app consumer secret.
- `MPESA_SHORT_CODE`: The M-Pesa Pay Bill or Buy Goods short code.
- `MPESA_PASSKEY`: The M-Pesa STK Push Passkey.
- `CALLBACK_URL`: The base URL of your API server used to construct the webhook endpoint (`/api/payments/mpesa/callback`). This same value is also pushed into the CORS `allowedOrigins` list in `src/index.ts`.

---

## External Services

`src/services/external/darajaService.ts` provides the core functions for direct interaction with the Safaricom Daraja API. Only `normalizePhoneNumber`, `getAccessToken`, `initiateStkPush`, `parseCallback`, and `queryStkPushStatus` are exported — `getBaseUrl`, `buildTimestamp`, and `buildPassword` are private helpers.

### Required imports
```typescript
import axios from "axios";
```

### Private helpers

#### `getBaseUrl()`
**Purpose:** Returns the base API URL for Daraja.
**Process:** Checks `MPESA_ENV` to return either the sandbox or production URL.

```typescript
const getBaseUrl = (): string => {
  return process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
};
```

#### `buildTimestamp()`
**Purpose:** Generates a Daraja-format timestamp.
**Process:** Returns the current time as `YYYYMMDDHHMMSS`.

```typescript
const buildTimestamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${date}${hours}${minutes}${seconds}`;
};
```

#### `buildPassword(shortCode, passkey, timestamp)`
**Purpose:** Creates the Daraja STK password.
**Process:** Concatenates short code, passkey, and timestamp, then base64-encodes the result.

```typescript
const buildPassword = (shortCode: string, passkey: string, timestamp: string): string => {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");
};
```

### Exported functions

#### `normalizePhoneNumber(phone)`
**Purpose:** Formats a phone number for Daraja.
**Process:** Converts local (`07...`) or bare 9-digit formats to `254XXXXXXXXX`; throws on anything that still doesn't match.

```typescript
export const normalizePhoneNumber = (phone: string): string => {
  const digitsOnly = String(phone).replace(/[^0-9]/g, "");
  let msisdn = digitsOnly;

  if (msisdn.startsWith("0")) {
    msisdn = `254${msisdn.slice(1)}`;
  }

  if (!msisdn.startsWith("254")) {
    if (digitsOnly.length === 9) {
      msisdn = `254${digitsOnly}`;
    }
  }

  if (!/^254\d{9}$/.test(msisdn)) {
    throw new Error(`Invalid Kenyan phone format: ${phone}`);
  }

  return msisdn;
};
```

#### `getAccessToken()`
**Purpose:** Retrieves an OAuth 2.0 token.
**Process:** Requests a new token from Daraja using client credentials.

```typescript
export const getAccessToken = async (): Promise<string> => {
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || "").trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || "").trim();

  if (!consumerKey || !consumerSecret) {
    throw new Error("Daraja credentials (MPESA_CONSUMER_KEY/SECRET) not configured");
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const base = getBaseUrl();

  try {
    const response = await axios.get(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return response.data.access_token;
  } catch (err: any) {
    throw new Error(`Daraja OAuth failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};
```

#### `initiateStkPush(params)`
**Purpose:** Initiates an M-Pesa STK push for a tab payment.
**Validation:** Requires `amount`, `phone`, `accountReference`, `transactionDesc`.
**Process:** Authenticates, builds the payload, and POSTs to Daraja. `accountReference` is always the tab's `tabNumber` — not a hardcoded business name — so the customer's M-Pesa statement shows which sale it paid for.
**Response:** Returns `merchantRequestId` and `checkoutRequestId`.

```typescript
export const initiateStkPush = async (params: {
  amount: number;
  phone: string;
  accountReference: string;
  transactionDesc: string;
}): Promise<any> => {
  const shortCode = process.env.MPESA_SHORT_CODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.CALLBACK_URL;

  if (!shortCode || !passkey || !callbackUrl) {
    throw new Error("Daraja configuration missing (MPESA_SHORT_CODE, MPESA_PASSKEY, or CALLBACK_URL)");
  }

  const accessToken = await getAccessToken();
  const base = getBaseUrl();
  const timestamp = buildTimestamp();
  const password = buildPassword(shortCode, passkey, timestamp);
  const normalizedPhone = normalizePhoneNumber(params.phone);

  const payload = {
    BusinessShortCode: Number(shortCode),
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(params.amount),
    PartyA: normalizedPhone,
    PartyB: Number(shortCode),
    PhoneNumber: normalizedPhone,
    CallBackURL: `${callbackUrl}/api/payments/mpesa/callback`,
    AccountReference: params.accountReference,
    TransactionDesc: params.transactionDesc,
  };

  try {
    const resp = await axios.post(`${base}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      merchantRequestId: resp.data.MerchantRequestID,
      checkoutRequestId: resp.data.CheckoutRequestID,
      raw: resp.data,
    };
  } catch (err: any) {
    throw new Error(`Daraja STK Push failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};
```

#### `parseCallback(body)`
**Purpose:** Processes the Daraja webhook callback payload.
**Process:** Validates the shape, extracts `CallbackMetadata` items (amount, phone, receipt number), and normalizes into a flat object.
**Response:** Object with `valid`, `success`, `checkoutRequestId`, `merchantRequestId`, `amount`, `phone`, `mpesaReceiptNumber`, `resultCode`, `resultDesc`, `raw`.

```typescript
export const parseCallback = (body: any) => {
  const stk = body?.Body?.stkCallback;
  if (!stk) return { valid: false };

  const resultCode = stk.ResultCode;
  const success = String(resultCode) === "0";
  const checkoutRequestId = stk.CheckoutRequestID;
  const merchantRequestId = stk.MerchantRequestID;
  const metadata = stk.CallbackMetadata?.Item || [];

  let amount, phone, mpesaReceiptNumber;
  for (const item of metadata) {
    if (item.Name === "Amount") amount = item.Value;
    if (item.Name === "PhoneNumber") phone = item.Value;
    if (item.Name === "MpesaReceiptNumber") mpesaReceiptNumber = item.Value;
  }

  return {
    valid: true,
    success,
    checkoutRequestId,
    merchantRequestId,
    amount,
    phone,
    mpesaReceiptNumber,
    resultCode,
    resultDesc: stk.ResultDesc,
    raw: body,
  };
};
```

#### `queryStkPushStatus(checkoutRequestId)`
**Purpose:** Queries the status of a previously initiated STK push.
**Validation:** `checkoutRequestId` must be a valid, previously-issued Daraja checkout ID.
**Process:** Authenticates and POSTs a query request to Daraja.
**Response:** `{ ok, resultCode, resultDesc, raw }` on success, or `{ ok: false, error, raw }` on failure.

```typescript
export const queryStkPushStatus = async (checkoutRequestId: string): Promise<any> => {
  const shortCode = process.env.MPESA_SHORT_CODE;
  const passkey = process.env.MPESA_PASSKEY;

  if (!shortCode || !passkey) {
    throw new Error("Daraja configuration missing (MPESA_SHORT_CODE, MPESA_PASSKEY)");
  }

  const accessToken = await getAccessToken();
  const base = getBaseUrl();
  const timestamp = buildTimestamp();
  const password = buildPassword(shortCode, passkey, timestamp);

  try {
    const resp = await axios.post(
      `${base}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: Number(shortCode),
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return {
      ok: true,
      resultCode: resp.data.ResultCode,
      resultDesc: resp.data.ResultDesc,
      raw: resp.data,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.response?.data?.errorMessage || err.message,
      raw: err.response?.data,
    };
  }
};
```

---

## Internal Services

The internal payment service (`src/services/internal/paymentService.ts`) orchestrates M-Pesa (and cash) payments within the application's Sale Tab lifecycle. This project has no Invoice/Order/Receipt/Customer concepts — every payment applies directly to a **Tab**, and success flows straight into `tabService.completeTab()`.

### Required imports
```typescript
import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Payment from "../../models/Payment";
import Tab from "../../models/Tab";
import Shift from "../../models/Shift";
import Branch from "../../models/Branch";
import { completeTab } from "./tabService";
import { generatePaymentNumber } from "../../utils/numberGenerators";
import {
  initiateStkPush,
  parseCallback,
  queryStkPushStatus,
  normalizePhoneNumber,
} from "../external/darajaService";
import { IPayment } from "../../type";
```

### Shared internal helpers (not exported)

#### `applySuccessfulPayment(payment, performedBy)`
**Purpose:** Applies a completed payment's effects to its tab and shift — the core of the module.
**Process:** Marks the payment `completed`; atomically increments `tab.amountPaid` via `$inc` (avoids a lost update when a cash payment and an M-Pesa callback land on the same tab near-simultaneously); recomputes `tab.balanceDue` (the Tab's `pre("save")` hook only recalculates totals when `items` changes, not when `amountPaid` is set directly, so this function must do it manually); credits `Shift.salesSummary.cashSales` or `.mpesaSales`; and once `balanceDue <= 0`, delegates to the existing `tabService.completeTab()` to finalize the sale (deduct stock, mark `completed`, increment `salesSummary.totalSales`).

```typescript
const applySuccessfulPayment = async (
  payment: IPayment,
  performedBy: string | Types.ObjectId
): Promise<void> => {
  payment.status = "completed";
  await payment.save();

  const tab = await Tab.findByIdAndUpdate(
    payment.tab,
    { $inc: { amountPaid: payment.amount } },
    { new: true }
  );

  if (!tab) {
    throw errorHandler(404, "Tab not found for payment");
  }

  tab.balanceDue = tab.grandTotal - tab.amountPaid;
  await tab.save();

  const salesField = payment.method === "cash" ? "salesSummary.cashSales" : "salesSummary.mpesaSales";
  await Shift.findByIdAndUpdate(payment.shift, { $inc: { [salesField]: payment.amount } });

  if (tab.balanceDue <= 0) {
    await completeTab(tab._id as Types.ObjectId, performedBy);
  }
};
```

#### `completeMpesaPayment(payment, details, performedBy)` / `failMpesaPayment(payment, details)`
**Purpose:** Shared success/failure paths for a pending M-Pesa payment, used by both the Daraja webhook (`handleMpesaCallback`) and manual reconciliation (`reconcileMpesaPayment`) — avoids duplicating the same logic in two places.
**Process:** `completeMpesaPayment` records `mpesaReceiptNumber`/`resultCode`/`resultDesc` and calls `applySuccessfulPayment`; `failMpesaPayment` sets `status: "failed"` with the result fields and makes no tab/shift changes.

### Exported functions

#### `payCash(input)`
**Purpose:** Records a cash payment against a tab awaiting payment.
**Validation:** Tab must exist and be `awaiting_payment`; `amount` (defaults to the tab's `balanceDue`) must be `> 0` and `<= balanceDue`; `cashReceived >= amount`.
**Process:** Cash is always synchronous — the Payment is created and immediately applied via `applySuccessfulPayment`, no pending state. `cashChange = cashReceived - amount`.
**Response:** The completed `Payment` document.

#### `initiateMpesaPayment(input)`
**Purpose:** Triggers an STK push and creates a pending payment for a tab awaiting payment.
**Validation:** Same tab-state and amount guards as `payCash`.
**Process:** Normalizes the phone, calls `initiateStkPush` with `accountReference: tab.tabNumber`, and creates a `Payment` with `status: "pending"` and `mpesa.{phone, checkoutRequestId, merchantRequestId}` set.
**Response:** The pending `Payment` document.

#### `handleMpesaCallback(body)`
**Purpose:** Processes a raw Daraja webhook payload.
**Process:** Parses via `parseCallback`, looks up the payment by `mpesa.checkoutRequestId`, and — only if it's still `pending` — routes to `completeMpesaPayment` or `failMpesaPayment`. Any payload that doesn't resolve to a known pending payment is silently ignored; the webhook controller always acks Safaricom with `200` regardless (see [Callbacks and Webhooks](#callbacks-and-webhooks)).

#### `retryMpesaPayment(paymentId, processedBy)`
**Purpose:** Re-attempts a failed M-Pesa payment.
**Validation:** The referenced payment must be `method: "mpesa"` and `status: "failed"`; its tab must still be `awaiting_payment`; its amount must not exceed the tab's current `balanceDue` (it may have changed since the failed attempt, e.g. via a partial cash payment in the meantime).
**Process:** Creates a **new** `Payment` document via a fresh `initiateStkPush` call — the original failed payment is left untouched as history. This project has no `AuditLog` model, so the Payment collection is the only durable record of what happened; overwriting the failed doc would erase that.
**Response:** The new pending `Payment` document.

#### `reconcileMpesaPayment(checkoutRequestId, performedBy)`
**Purpose:** Manually checks Daraja for a pending payment's outcome, for when the webhook never arrives.
**Process:** No-ops (returns the payment as-is) if it isn't `pending` — makes repeated polling idempotent. Otherwise calls `queryStkPushStatus` and routes to `completeMpesaPayment`/`failMpesaPayment` exactly like the webhook does.
**Response:** The (possibly now resolved) `Payment` document.

#### `reversePayment(paymentId, reversedBy, reversedReason)`
**Purpose:** Reverses a completed payment — cash or M-Pesa.
**Validation:** Payment must be `completed`; its tab must not already be `completed` (stock would already be deducted, and this codebase has no refund/stock-reversal path yet); its shift must not be `closed` (reversing after `endShift`'s cash reconciliation ran would silently invalidate a settled shift close-out).
**Process:** Marks the payment `reversed` with `reversedBy`/`reversedReason`, decrements `tab.amountPaid`/recomputes `balanceDue`, and decrements the matching `Shift.salesSummary.<method>Sales` counter.
**Response:** The reversed `Payment` document.

---

## Usage in Controllers

`src/controllers/paymentController.ts` is the primary interface for payment requests, delegating all business logic to `paymentService`.

### Required imports
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

### Function overview

#### `initiateMpesaPayment()`
**Purpose:** Validates `tabId`/`phone` and initiates an M-Pesa STK push for a tab.
**Response:** `202 Accepted` with the pending payment (including `mpesa.checkoutRequestId`/`merchantRequestId`).

```typescript
export const initiateMpesaPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { tabId, phone, amount } = req.body;

    if (!tabId) {
      return next(errorHandler(400, "tabId is required"));
    }
    if (!phone) {
      return next(errorHandler(400, "phone is required"));
    }

    const payment = await initiateMpesaPaymentService({
      tabId,
      phone,
      amount,
      processedBy: req.user?._id as any,
    });

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

#### `mpesaCallback()`
**Purpose:** Handles the asynchronous Daraja webhook.
**Note:** Deliberately never calls `next(error)` — see [Callbacks and Webhooks](#callbacks-and-webhooks).

```typescript
export const mpesaCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    await handleMpesaCallback(req.body);
  } catch (error: any) {
    console.error("Failed to process mpesa callback:", error);
  }

  res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
};
```

#### `getMpesaPaymentStatus()`
**Purpose:** Manually reconciles a pending checkout request against Daraja.

```typescript
export const getMpesaPaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await reconcileMpesaPayment(req.params.checkoutRequestId as string, req.user?._id as any);

    res.status(200).json({
      success: true,
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
```

The full controller (`payCash`, `retryMpesaPayment`, `reversePayment`, `getPayment`, `getTabPayments`) follows the same pattern and is documented in full in [`doc/modules/PAYMENT_DOCUMENTATION.md`](../modules/PAYMENT_DOCUMENTATION.md).

---

## Callbacks and Webhooks

The Daraja API relies on a callback (webhook) to notify the application of an STK push outcome. `mpesaCallback` (mounted at `POST /api/payments/mpesa/callback`, **no auth middleware** — Safaricom calls it directly) is that endpoint.

This handler is a deliberate special case, not a normal controller:
- It **never** calls `next(error)`. Doing so would produce this app's standard `{success:false, message}` error envelope with a non-2xx status, and Safaricom retries the webhook on anything other than a clean `200`.
- Internal failures (unrecognized payload, no matching payment, DB errors) are caught and logged via `console.error`, never surfaced to the caller.
- It always responds `200` with `{ ResultCode: 0, ResultDesc: "Accepted" }`, regardless of whether processing actually found and updated a payment.

For cases where the webhook never arrives (network issue, sandbox flakiness), `GET /api/payments/mpesa-status/:checkoutRequestId` lets a cashier or manager manually trigger reconciliation via `queryStkPushStatus`.

---

## Error Handling

Daraja service functions use `try/catch` blocks with custom error messages that surface the underlying Safaricom `errorMessage` when available. `paymentService` functions throw via `errorHandler(statusCode, message)` (matching this project's convention for service-layer errors outside the Express request/response cycle); controllers catch and forward to `next(error)` — except `mpesaCallback`, which is exempt for the reasons above.

---

## API Examples

**Initiate an M-Pesa STK push against a tab**

```bash
curl -X POST http://localhost:3500/api/payments/mpesa/initiate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "tabId": "64f1a2b3c4d5e6f7a8b9c0d1", "phone": "0712345678" }'
```

**Check M-Pesa payment status by checkout request ID**

```bash
curl -X GET http://localhost:3500/api/payments/mpesa-status/ws_CO_030820260930001234 \
  -H "Authorization: Bearer <token>"
```

**Record a cash payment against a tab**

```bash
curl -X POST http://localhost:3500/api/payments/cash \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "tabId": "64f1a2b3c4d5e6f7a8b9c0d1", "cashReceived": 1500 }'
```

---

**Last Updated:** 2026-08-11
**Version:** 2.0.0
**Maintainer:** POS API Development Team
