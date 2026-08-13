# ⚙️ POS API - Settings Management Documentation

## 📋 Table of Contents
- [Settings Management Overview](#settings-management-overview)
- [Settings Model](#-settings-model)
- [Settings Controller](#-settings-controller)
- [Settings Routes](#-settings-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Settings Management Overview

Settings is a single per-branch configuration document — business identity for receipts, tax rate, currency, enabled payment methods, printer config, a default low-stock threshold, and a free-form theme blob. It intentionally duplicates a few `Branch` fields (`businessName`, `address`, `phone`) as plain strings rather than refs, so a location's public-facing/receipt identity can diverge from its internal `Branch` record without touching it.

**Scope notes for this pass:**
- **Get-or-create, not a separate create route.** The original spec's only hint at provisioning is a Notes line — "each Branch gets its own Settings document created at branch setup time" — but no `createSettings` route exists anywhere in the spec. Rather than hooking creation into `branchController.createBranch` (coupling a new module into an existing one), `getSettings()` does get-or-create: the first read for a branch creates its Settings document with sane defaults. This is simpler, self-contained, and also retroactively covers branches that already existed before this module did (e.g. a seeded main branch) with no migration needed.
- **Two extra routes beyond the original spec.** The Controller section documented four functions (`getSettings`, `updateSettings`, `updatePrinterConfig`, `updateReceiptLayout`) but the Routes section only showed two paths. Added `PATCH /:branchId/printer` and `PATCH /:branchId/receipt-layout` to match the controller — mirrors real POS UX (separate "printer" and "receipt layout" screens from general business settings).
- **`taxRate` and `receiptFooterNote` are stored and API-editable but not wired into anything yet, by explicit choice.** `taxRate` is commented "applied at Tab close" in the original spec, but `Tab.taxTotal` is dead today — nothing anywhere sets it, so every tab has always computed zero tax. `receiptFooterNote` has a real hardcoded counterpart: `generateReceiptPDF.ts` prints a static `"Thank you for your business!"` string. Both integrations were considered and explicitly deferred as separate follow-up work, rather than changing two already-working modules' money math/output as a side effect of building Settings. This doc's defaults intentionally mirror the current hardcoded behavior (`taxRate: 0`, `receiptFooterNote: "Thank you for your business!"`) so nothing changes for existing tabs/receipts until that follow-up happens.
- **`'card'` stays in `paymentMethodsEnabled`'s enum** even though the Payment module only processes `cash`/`mpesa` today — a harmless forward-looking toggle, same treatment as other documented-but-deferred fields this session.

---

## ⚙️ Settings Model

### Schema Definition
```typescript
export type PrinterType = "usb" | "network";
export type SettingsPaymentMethod = "cash" | "mpesa" | "card";

export interface IPrinterConfig {
  type: PrinterType;
  target: string;
}

export interface ISettings extends Document {
  branch: Types.ObjectId | IBranch;
  businessName: string;
  address: string;
  phone: string;
  taxRate: number;
  currency: string;
  receiptFooterNote: string;
  paymentMethodsEnabled: SettingsPaymentMethod[];
  printerConfig: IPrinterConfig;
  lowStockThresholdDefault: number;
  theme?: Record<string, any>;
  updatedBy?: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Settings.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { ISettings, IPrinterConfig } from "../type";

// Nested as its own sub-schema — a plain inline object would collide with
// Mongoose's reserved `type` key, since printerConfig itself has a `type` field.
const printerConfigSchema = new Schema<IPrinterConfig>(
  {
    type: {
      type: String,
      enum: ["usb", "network"],
      default: "usb",
    },
    target: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const settingsSchema = new Schema<ISettings>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      unique: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "KES",
      trim: true,
    },
    receiptFooterNote: {
      type: String,
      trim: true,
      default: "Thank you for your business!",
    },
    paymentMethodsEnabled: {
      type: [String],
      enum: ["cash", "mpesa", "card"],
      default: ["cash", "mpesa"],
    },
    printerConfig: {
      type: printerConfigSchema,
      default: () => ({ type: "usb", target: "" }),
    },
    lowStockThresholdDefault: {
      type: Number,
      default: 0,
      min: 0,
    },
    theme: {
      type: Schema.Types.Mixed,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

settingsSchema.index({ branch: 1 }, { unique: true });

const Settings = mongoose.model<ISettings>("Settings", settingsSchema);
export default Settings;
```

### Validation Rules
```typescript
branch:                    { required: true, unique: true, ObjectId ref: 'Branch' — one document per branch }
businessName:               { required: true, trim: true — defaults to Branch.name on auto-create }
address:                    { optional, trim, default: '' }
phone:                       { optional, trim, default: '' — defaults to Branch.phone on auto-create }
taxRate:                    { default: 0, min: 0 — not yet wired into Tab totals, see Scope notes }
currency:                   { default: 'KES', trim }
receiptFooterNote:          { default: 'Thank you for your business!' — not yet wired into receipt PDFs, see Scope notes }
paymentMethodsEnabled:      { default: ['cash', 'mpesa'], enum values per item: ['cash', 'mpesa', 'card'] }
printerConfig:              { sub-schema, default: { type: 'usb', target: '' } }
printerConfig.type:         { enum: ['usb', 'network'], default: 'usb' }
printerConfig.target:       { optional, trim, default: '' }
lowStockThresholdDefault:   { default: 0, min: 0 }
theme:                      { optional, Mixed — free-form, frontend concern only }
updatedBy:                  { optional, ObjectId ref: 'User' — set on every write, absent until the first write }
```

---

## 🎮 Settings Controller

**File:** `src/controllers/settingsController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Settings from "../models/Settings";
import Branch from "../models/Branch";
```

### Shared Helper
```typescript
/**
 * Finds a branch's Settings document, creating one with sane defaults on
 * first access. One document per branch — every write path in this
 * controller goes through this so no branch is ever left without one.
 */
const getOrCreateSettings = async (branchId: string) => {
  let settings = await Settings.findOne({ branch: branchId });

  if (!settings) {
    const branchDoc = await Branch.findById(branchId);
    if (!branchDoc) {
      throw errorHandler(404, "Branch not found");
    }

    settings = await Settings.create({
      branch: branchDoc._id,
      businessName: branchDoc.name,
      phone: branchDoc.phone || "",
    });
  }

  return settings;
};
```

### Functions Overview

#### `getSettings()`
**Purpose:** Fetch a branch's Settings document, creating one on first access
**Access:** Any authenticated user
**Validation:** Branch must exist
**Process:** Delegates to `getOrCreateSettings`
**Response:** Settings document

**Controller Implementation:**
```typescript
export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Return settings
    res.status(200).json({
      success: true,
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateSettings()`
**Purpose:** Update general branch settings
**Access:** Manager, Admin
**Validation:** Branch must exist
**Process:** Find or create settings, apply provided fields, stamp `updatedBy`, save
**Response:** Updated settings document

**Controller Implementation:**
```typescript
export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const {
      businessName,
      address,
      phone,
      taxRate,
      currency,
      paymentMethodsEnabled,
      lowStockThresholdDefault,
      theme,
    } = req.body;

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply updates
    if (businessName !== undefined) {
      settings.businessName = businessName;
    }
    if (address !== undefined) {
      settings.address = address;
    }
    if (phone !== undefined) {
      settings.phone = phone;
    }
    if (taxRate !== undefined) {
      settings.taxRate = taxRate;
    }
    if (currency !== undefined) {
      settings.currency = currency;
    }
    if (paymentMethodsEnabled !== undefined) {
      settings.paymentMethodsEnabled = paymentMethodsEnabled;
    }
    if (lowStockThresholdDefault !== undefined) {
      settings.lowStockThresholdDefault = lowStockThresholdDefault;
    }
    if (theme !== undefined) {
      settings.theme = theme;
    }
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updatePrinterConfig()`
**Purpose:** Update a branch's printer configuration
**Access:** Manager, Admin
**Validation:** Branch must exist; `type` is required
**Process:** Find or create settings, replace `printerConfig`, stamp `updatedBy`, save
**Response:** Updated settings document

**Controller Implementation:**
```typescript
export const updatePrinterConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { type, target } = req.body;

    // Guard — type required
    if (!type) {
      return next(errorHandler(400, "type is required"));
    }

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply printer config
    settings.printerConfig = { type, target: target || "" };
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Printer config updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateReceiptLayout()`
**Purpose:** Update a branch's receipt footer note
**Access:** Manager, Admin
**Validation:** Branch must exist; `receiptFooterNote` is required
**Process:** Find or create settings, replace `receiptFooterNote`, stamp `updatedBy`, save
**Response:** Updated settings document

**Controller Implementation:**
```typescript
export const updateReceiptLayout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { receiptFooterNote } = req.body;

    // Guard — receiptFooterNote required
    if (receiptFooterNote === undefined) {
      return next(errorHandler(400, "receiptFooterNote is required"));
    }

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply receipt layout
    settings.receiptFooterNote = receiptFooterNote;
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Receipt layout updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Settings Routes

### Base Path: `/api/settings`

```typescript
GET   /:branchId                  // Get (or auto-create) settings (any authenticated user)
PUT   /:branchId                  // Update general settings (manager, admin)
PATCH /:branchId/printer          // Update printer config (manager, admin)
PATCH /:branchId/receipt-layout   // Update receipt footer note (manager, admin)
```

### Router Implementation

**File: `src/routes/settingsRoutes.ts`**

```typescript
import express from "express";
import {
  getSettings,
  updateSettings,
  updatePrinterConfig,
  updateReceiptLayout,
} from "../controllers/settingsController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const SETTINGS_WRITE_ROLES: UserRole[] = ["manager", "admin"];

router.get("/:branchId", authenticateToken, getSettings);
router.put("/:branchId", authenticateToken, authorizeRoles(SETTINGS_WRITE_ROLES), updateSettings);
router.patch("/:branchId/printer", authenticateToken, authorizeRoles(SETTINGS_WRITE_ROLES), updatePrinterConfig);
router.patch(
  "/:branchId/receipt-layout",
  authenticateToken,
  authorizeRoles(SETTINGS_WRITE_ROLES),
  updateReceiptLayout
);

export default router;
```

### Route Details

#### `GET /api/settings/:branchId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "settings": {
      "_id": "64f1a2b3c4d5e6f7a8b9caa1",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "businessName": "Main Branch",
      "address": "",
      "phone": "0712345678",
      "taxRate": 0,
      "currency": "KES",
      "receiptFooterNote": "Thank you for your business!",
      "paymentMethodsEnabled": ["cash", "mpesa"],
      "printerConfig": {
        "type": "usb",
        "target": ""
      },
      "lowStockThresholdDefault": 0,
      "createdAt": "2026-08-13T09:00:00.000Z",
      "updatedAt": "2026-08-13T09:00:00.000Z"
    }
  }
}
```

#### `PUT /api/settings/:branchId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "businessName": "The Copper Still",
  "address": "Moi Avenue, Nairobi",
  "taxRate": 16,
  "currency": "KES"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Settings updated successfully",
  "data": {
    "settings": {
      "_id": "64f1a2b3c4d5e6f7a8b9caa1",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "businessName": "The Copper Still",
      "address": "Moi Avenue, Nairobi",
      "phone": "0712345678",
      "taxRate": 16,
      "currency": "KES",
      "receiptFooterNote": "Thank you for your business!",
      "paymentMethodsEnabled": ["cash", "mpesa"],
      "printerConfig": {
        "type": "usb",
        "target": ""
      },
      "lowStockThresholdDefault": 0,
      "updatedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "createdAt": "2026-08-13T09:00:00.000Z",
      "updatedAt": "2026-08-13T10:15:00.000Z"
    }
  }
}
```

#### `PATCH /api/settings/:branchId/printer`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "type": "network",
  "target": "192.168.1.50:9100"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Printer config updated successfully",
  "data": {
    "settings": {
      "_id": "64f1a2b3c4d5e6f7a8b9caa1",
      "printerConfig": {
        "type": "network",
        "target": "192.168.1.50:9100"
      },
      "updatedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "updatedAt": "2026-08-13T10:20:00.000Z"
    }
  }
}
```

#### `PATCH /api/settings/:branchId/receipt-layout`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "receiptFooterNote": "Karibu tena! Follow us @copperstillnairobi"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Receipt layout updated successfully",
  "data": {
    "settings": {
      "_id": "64f1a2b3c4d5e6f7a8b9caa1",
      "receiptFooterNote": "Karibu tena! Follow us @copperstillnairobi",
      "updatedBy": "64f1a2b3c4d5e6f7a8b9c0d9",
      "updatedAt": "2026-08-13T10:25:00.000Z"
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
router.get("/:branchId", authenticateToken, getSettings);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.put("/:branchId", authenticateToken, authorizeRoles(["manager", "admin"]), updateSettings);
```
`GET /:branchId` is the only route in this module open to every authenticated role — the other three are `manager`/`admin` only.

---

## 📝 API Examples

### Get a Branch's Settings
```bash
curl -X GET http://localhost:3500/api/settings/64f1a2b3c4d5e6f7a8b9c0d3 \
  -H "Authorization: Bearer <token>"
```

### Update General Settings
```bash
curl -X PUT http://localhost:3500/api/settings/64f1a2b3c4d5e6f7a8b9c0d3 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "businessName": "The Copper Still", "taxRate": 16 }'
```

### Update Printer Config
```bash
curl -X PATCH http://localhost:3500/api/settings/64f1a2b3c4d5e6f7a8b9c0d3/printer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "type": "network", "target": "192.168.1.50:9100" }'
```

### Update Receipt Footer
```bash
curl -X PATCH http://localhost:3500/api/settings/64f1a2b3c4d5e6f7a8b9c0d3/receipt-layout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "receiptFooterNote": "Karibu tena!" }'
```

---

## 🛡️ Security Features

- **RBAC:** Reading is open to any authenticated role; all three write routes (`updateSettings`, `updatePrinterConfig`, `updateReceiptLayout`) are `manager`/`admin` only.
- **Get-or-create is race-safe in practice, not in theory.** A unique index on `branch` means a true concurrent double-create would throw a duplicate-key error on the loser — acceptable here since Settings creation only ever happens lazily on a rare first read, not on a hot path.
- **`updatedBy` is an audit trail of its own**, separate from the `AuditLog` module — every write stamps who last touched a branch's configuration, though (unlike `AuditLog`) no before/after history is kept, only the most recent editor.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | `updatePrinterConfig` missing `type`; `updateReceiptLayout` missing `receiptFooterNote` |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (write routes) |
| `404` | Branch not found |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Branch not found"
}
```

---

## 📊 Database Indexes

```typescript
settingsSchema.index({ branch: 1 }, { unique: true }); // one document per branch, and the only lookup this module ever does
```

---

**Last Updated:** 2026-08-13
**Version:** 1.0.0
**Maintainer:** POS API Development Team
