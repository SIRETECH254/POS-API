# 🗂️ POS API - Shift Management Documentation

## 📋 Table of Contents
- [Shift Management Overview](#shift-management-overview)
- [Shift Model](#-shift-model)
- [Shift Controller](#-shift-controller)
- [Shift Routes](#-shift-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Shift Management Overview

A **Shift** represents a single working session for a staff member at a branch. Shifts are a foundational module — a bartender cannot open a Sale Tab without an active shift at their branch. Each shift tracks the opening cash float, a running sales summary (updated by the Payment module), and a closing cash reconciliation with variance sign-off by a manager.

**Key rules:**
- A user can only have one `open` shift at a time.
- Shift numbers are auto-generated via `src/utils/numberGenerators.ts` in the format `{BRANCH_CODE}-SHIFT-{YYYY}-{NNNN}`.
- Closing a shift computes `expected = openingFloat + cashSales` and `variance = actual − expected`.
- A manager must review and sign off on any variance via `review-variance`.
- The `requireActiveShift` middleware (applied to Tab routes) enforces that no tab can be opened without a current active shift.

---

## 👤 Shift Model

### Schema Definition
```typescript
interface IShift extends Document {
  branch: Types.ObjectId | IBranch;
  shiftNumber: string;
  staff: Types.ObjectId | IUser;
  openingFloat: number;
  closingCash: {
    expected: number;
    actual: number;
    variance: number;
  };
  salesSummary: {
    totalSales: number;
    cashSales: number;
    mpesaSales: number;
    cardSales: number;
    tabsOpened: number;
    tabsCancelled: number;
    discountsGiven: number;
  };
  status: "open" | "closed";
  startedAt: Date;
  endedAt?: Date;
  closedBy?: Types.ObjectId | IUser;
  varianceReviewedBy?: Types.ObjectId | IUser;
  varianceNotes?: string;
  createdAt: Date;
}
```

### Model Implementation

**File: `src/models/Shift.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IShift, ShiftStatus } from "../type";

const SHIFT_STATUSES: ShiftStatus[] = ["open", "closed"];

const shiftSchema = new Schema<IShift>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    shiftNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openingFloat: {
      type: Number,
      required: true,
      default: 0,
    },
    closingCash: {
      expected: { type: Number, default: 0 },
      actual: { type: Number, default: 0 },
      variance: { type: Number, default: 0 },
    },
    salesSummary: {
      totalSales: { type: Number, default: 0 },
      cashSales: { type: Number, default: 0 },
      mpesaSales: { type: Number, default: 0 },
      cardSales: { type: Number, default: 0 },
      tabsOpened: { type: Number, default: 0 },
      tabsCancelled: { type: Number, default: 0 },
      discountsGiven: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: SHIFT_STATUSES,
      default: "open",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: { type: Date },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    varianceReviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    varianceNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);
```

### Validation Rules
```typescript
branch:       { required: true, ref: "Branch" }
shiftNumber:  { required: true, unique: true }
staff:        { required: true, ref: "User" }
openingFloat: { required: true, default: 0 }
status:       { enum: ["open", "closed"], default: "open" }
startedAt:    { default: Date.now }
```

---

## 🎮 Shift Controller

**File:** `src/controllers/shiftController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Shift from "../models/Shift";
import User from "../models/User";
import Branch from "../models/Branch";
import { IRole } from "../type";
import { generateShiftNumber } from "../utils/numberGenerators";
```

### Functions Overview

---

#### `startShift()`
**Purpose:** Open a new shift for the authenticated staff member at their branch
**Access:** All authenticated staff roles
**Validation:** `openingFloat` required; user must have a branch; user must not already have an open shift
**Process:** Generate shift number, create shift with `status: "open"`, link to `user.currentShift`
**Response:** 201 — created shift

**Controller Implementation:**
```typescript
export const startShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { openingFloat } = req.body;

    // Guard — openingFloat required
    if (openingFloat === undefined || openingFloat === null) {
      return next(errorHandler(400, "Opening float is required"));
    }

    // Guard — user must have a branch assigned
    if (!req.user?.branch) {
      return next(errorHandler(400, "You must be assigned to a branch before starting a shift"));
    }

    // Guard — user must not already have an open shift
    if (req.user.currentShift) {
      const existingShift = await Shift.findById(req.user.currentShift);
      if (existingShift && existingShift.status === "open") {
        return next(errorHandler(409, "You already have an active shift. End your current shift first"));
      }
    }

    // Fetch branch for code generation
    const branch = await Branch.findById(req.user.branch);
    if (!branch) {
      return next(errorHandler(404, "Assigned branch not found"));
    }

    // Generate unique shift number via utility
    const shiftNumber = await generateShiftNumber(branch.code, branch._id.toString());

    // Create shift
    const shift = await Shift.create({
      branch: branch._id,
      shiftNumber,
      staff: req.user._id,
      openingFloat,
      status: "open",
      startedAt: new Date(),
    });

    // Link shift to user
    await User.findByIdAndUpdate(req.user._id, { currentShift: shift._id });

    // Populate for response
    await shift.populate([{ path: "staff" }, { path: "branch" }]);

    // Return created shift
    res.status(201).json({
      success: true,
      message: "Shift started successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `endShift()`
**Purpose:** Close an open shift and compute the cash variance
**Access:** Shift owner (self-close) or Manager/Admin
**Validation:** `actualCash` required; shift must exist and be open; requester must own the shift or be manager/admin
**Process:** Compute `expected = openingFloat + cashSales`, `variance = actualCash − expected`, set `closingCash`, mark `status: "closed"`, clear `user.currentShift`
**Response:** 200 — closed shift with variance data

**Controller Implementation:**
```typescript
export const endShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { actualCash } = req.body;

    // Guard — actualCash required
    if (actualCash === undefined || actualCash === null) {
      return next(errorHandler(400, "Actual cash amount is required"));
    }

    // Find shift by ID
    const shift = await Shift.findById(req.params.shiftId);

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Guard — shift must be open
    if (shift.status !== "open") {
      return next(errorHandler(400, "Shift is already closed"));
    }

    // Guard — requester must be shift owner or manager/admin
    const roleName = (req.user?.role as IRole).name;
    const isOwner = shift.staff.toString() === req.user?._id.toString();
    const isManagerOrAdmin = roleName === "manager" || roleName === "admin";

    if (!isOwner && !isManagerOrAdmin) {
      return next(errorHandler(403, "You are not authorised to close this shift"));
    }

    // Compute expected cash and variance
    const expected = shift.openingFloat + shift.salesSummary.cashSales;
    const variance = actualCash - expected;

    // Apply closing data
    shift.closingCash = { expected, actual: actualCash, variance };
    shift.status = "closed";
    shift.endedAt = new Date();
    shift.closedBy = req.user?._id;

    // Save shift
    await shift.save();

    // Clear currentShift on the staff member
    await User.findByIdAndUpdate(shift.staff, { $unset: { currentShift: 1 } });

    // Populate for response
    await shift.populate([
      { path: "staff" },
      { path: "branch" },
      { path: "closedBy" },
    ]);

    // Return closed shift
    res.status(200).json({
      success: true,
      message: "Shift ended successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getActiveShifts()`
**Purpose:** List all currently open shifts
**Access:** Manager, Admin
**Validation:** None required
**Process:** Find all `status: "open"` shifts, filter by `branch` query param if provided, populate staff and branch
**Response:** 200 — array of active shifts

**Controller Implementation:**
```typescript
export const getActiveShifts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Build filter query
    const query: any = { status: "open" };

    if (req.query.branch) {
      query.branch = req.query.branch;
    }

    // Fetch active shifts
    const shifts = await Shift.find(query)
      .populate("staff")
      .populate("branch")
      .sort({ startedAt: -1 });

    // Return active shifts
    res.status(200).json({
      success: true,
      data: { shifts },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getShiftHistory()`
**Purpose:** List all shifts with filtering and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by branch, staff, status, startDate, endDate; paginate; return results
**Response:** 200 — shift list and pagination

**Controller Implementation:**
```typescript
export const getShiftHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, staff, status, startDate, endDate } = req.query;

    // Build filter query
    const query: any = {};

    if (branch) {
      query.branch = branch;
    }
    if (staff) {
      query.staff = staff;
    }
    if (status === "open") {
      query.status = "open";
    }
    if (status === "closed") {
      query.status = "closed";
    }
    if (startDate) {
      query.startedAt = { ...query.startedAt, $gte: new Date(startDate as string) };
    }
    if (endDate) {
      query.startedAt = { ...query.startedAt, $lte: new Date(endDate as string) };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch shifts and total count
    const shifts = await Shift.find(query)
      .populate("staff")
      .populate("branch")
      .populate("closedBy")
      .sort({ startedAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total = await Shift.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        shifts,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalShifts: total,
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

#### `getShift()`
**Purpose:** Fetch a single shift by ID
**Access:** All authenticated users
**Validation:** Shift must exist
**Process:** Find by ID, populate all references, return
**Response:** 200 — shift details

**Controller Implementation:**
```typescript
export const getShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find shift by ID with populated references
    const shift = await Shift.findById(req.params.shiftId)
      .populate("staff")
      .populate("branch")
      .populate("closedBy")
      .populate("varianceReviewedBy");

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Return shift
    res.status(200).json({
      success: true,
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `reviewVariance()`
**Purpose:** Manager reviews and signs off on a cash variance after shift close
**Access:** Manager, Admin
**Validation:** `varianceNotes` required; shift must exist and be closed; cannot review twice
**Process:** Set `varianceReviewedBy` and `varianceNotes`, save
**Response:** 200 — updated shift

**Controller Implementation:**
```typescript
export const reviewVariance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { varianceNotes } = req.body;

    // Guard — varianceNotes required
    if (!varianceNotes) {
      return next(errorHandler(400, "Variance notes are required"));
    }

    // Find shift by ID
    const shift = await Shift.findById(req.params.shiftId);

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Guard — shift must be closed
    if (shift.status !== "closed") {
      return next(errorHandler(400, "Only closed shifts can have variance reviewed"));
    }

    // Guard — cannot review twice
    if (shift.varianceReviewedBy) {
      return next(errorHandler(409, "Variance has already been reviewed for this shift"));
    }

    // Set variance review fields
    shift.varianceReviewedBy = req.user?._id;
    shift.varianceNotes = varianceNotes;

    // Save and populate
    await shift.save();
    await shift.populate([
      { path: "staff" },
      { path: "branch" },
      { path: "closedBy" },
      { path: "varianceReviewedBy" },
    ]);

    // Return updated shift
    res.status(200).json({
      success: true,
      message: "Variance reviewed successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Shift Routes

### Base Path: `/api/shifts`

```typescript
POST   /start                       // Start shift (all staff roles)
GET    /active                      // Get active shifts (manager, admin)
GET    /                            // Get shift history (manager, admin)
GET    /:shiftId                    // Get shift by ID (all staff roles)
PATCH  /:shiftId/end                // End shift (shift owner, manager, admin)
PATCH  /:shiftId/review-variance    // Review variance (manager, admin)
```

### Router Implementation

**File: `src/routes/shiftRoutes.ts`**

```typescript
import express from "express";
import {
  startShift,
  endShift,
  getActiveShifts,
  getShiftHistory,
  getShift,
  reviewVariance,
} from "../controllers/shiftController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.post(
  "/start",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  startShift
);

router.get("/active", authenticateToken, authorizeRoles(["manager", "admin"]), getActiveShifts);

router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getShiftHistory);

router.get(
  "/:shiftId",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  getShift
);

router.patch(
  "/:shiftId/end",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  endShift
);

router.patch(
  "/:shiftId/review-variance",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  reviewVariance
);

export default router;
```

### Route Details

#### `POST /api/shifts/start`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "openingFloat": 5000
}
```
**Response:**
```json
{
  "success": true,
  "message": "Shift started successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0aa",
        "name": "Main Branch",
        "code": "MB"
      },
      "shiftNumber": "MB-SHIFT-2026-0001",
      "staff": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
        "firstName": "James",
        "lastName": "Odhiambo"
      },
      "openingFloat": 5000,
      "salesSummary": {
        "totalSales": 0,
        "cashSales": 0,
        "mpesaSales": 0,
        "cardSales": 0,
        "tabsOpened": 0,
        "tabsCancelled": 0,
        "discountsGiven": 0
      },
      "status": "open",
      "startedAt": "2026-07-29T08:00:00.000Z",
      "createdAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

#### `GET /api/shifts/active`
**Headers:** `Authorization: Bearer <token>`
**Query:** `branch=<branchId>` (optional)
**Response:**
```json
{
  "success": true,
  "data": {
    "shifts": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "shiftNumber": "MB-SHIFT-2026-0001",
        "staff": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
          "firstName": "James",
          "lastName": "Odhiambo"
        },
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0aa",
          "name": "Main Branch",
          "code": "MB"
        },
        "openingFloat": 5000,
        "status": "open",
        "startedAt": "2026-07-29T08:00:00.000Z"
      }
    ]
  }
}
```

#### `GET /api/shifts`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `branch=<id>`, `staff=<id>`, `status=open|closed`, `startDate=2026-07-01`, `endDate=2026-07-31`
**Response:**
```json
{
  "success": true,
  "data": {
    "shifts": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "shiftNumber": "MB-SHIFT-2026-0001",
        "staff": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
          "firstName": "James",
          "lastName": "Odhiambo"
        },
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0aa",
          "name": "Main Branch",
          "code": "MB"
        },
        "openingFloat": 5000,
        "status": "closed",
        "startedAt": "2026-07-29T08:00:00.000Z",
        "endedAt": "2026-07-29T18:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalShifts": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/shifts/:shiftId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "staff": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
        "firstName": "James",
        "lastName": "Odhiambo"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0aa",
        "name": "Main Branch",
        "code": "MB"
      },
      "openingFloat": 5000,
      "closingCash": {
        "expected": 7500,
        "actual": 7200,
        "variance": -300
      },
      "salesSummary": {
        "totalSales": 12500,
        "cashSales": 2500,
        "mpesaSales": 8000,
        "cardSales": 2000,
        "tabsOpened": 14,
        "tabsCancelled": 1,
        "discountsGiven": 0
      },
      "status": "closed",
      "startedAt": "2026-07-29T08:00:00.000Z",
      "endedAt": "2026-07-29T18:00:00.000Z",
      "closedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
        "firstName": "James",
        "lastName": "Odhiambo"
      }
    }
  }
}
```

#### `PATCH /api/shifts/:shiftId/end`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "actualCash": 7200
}
```
**Response:**
```json
{
  "success": true,
  "message": "Shift ended successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "openingFloat": 5000,
      "closingCash": {
        "expected": 5000,
        "actual": 7200,
        "variance": 2200
      },
      "status": "closed",
      "endedAt": "2026-07-29T18:00:00.000Z",
      "closedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0bb",
        "firstName": "James",
        "lastName": "Odhiambo"
      }
    }
  }
}
```

#### `PATCH /api/shifts/:shiftId/review-variance`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "varianceNotes": "KES 2,200 overage — reconciled against MPesa settlements not reflected in cashSales at time of close"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Variance reviewed successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "status": "closed",
      "varianceReviewedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0cc",
        "firstName": "Grace",
        "lastName": "Wanjiru"
      },
      "varianceNotes": "KES 2,200 overage — reconciled against MPesa settlements not reflected in cashSales at time of close"
    }
  }
}
```

---

## 🔐 Middleware

### `requireActiveShift`

**File:** `src/middleware/requireActiveShift.ts`

**Purpose:** Block access to Tab routes when the authenticated user has no active open shift at their branch. Applied by the Tab routes file — not by Shift routes.

**Usage:**
```typescript
// In tabRoutes.ts (when implemented)
router.post(
  "/",
  authenticateToken,
  authorizeRoles(["bartender", "cashier"]),
  requireActiveShift,
  createTab
);
```

**Logic:**
1. If `req.user.currentShift` is falsy → 403 `"No active shift. Start a shift before opening a tab."`
2. Fetch the shift from the database and verify `status === "open"` → 403 if not open
3. Call `next()` if shift is valid

---

### `authenticateToken`
**Purpose:** Verify JWT token and load user with populated role onto `req.user`

### `authorizeRoles(allowedRoles)`
**Purpose:** Restrict route access to specified roles

---

## 📝 API Examples

### Start a Shift
```bash
curl -X POST http://localhost:3500/api/shifts/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "openingFloat": 5000 }'
```
**Response:**
```json
{
  "success": true,
  "message": "Shift started successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "openingFloat": 5000,
      "status": "open",
      "startedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

### Get Active Shifts
```bash
curl -X GET "http://localhost:3500/api/shifts/active?branch=64f1a2b3c4d5e6f7a8b9c0aa" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "shifts": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "shiftNumber": "MB-SHIFT-2026-0001",
        "openingFloat": 5000,
        "status": "open",
        "startedAt": "2026-07-29T08:00:00.000Z"
      }
    ]
  }
}
```

### End a Shift
```bash
curl -X PATCH http://localhost:3500/api/shifts/64f1a2b3c4d5e6f7a8b9c0d1/end \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "actualCash": 7200 }'
```
**Response:**
```json
{
  "success": true,
  "message": "Shift ended successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "openingFloat": 5000,
      "closingCash": {
        "expected": 5000,
        "actual": 7200,
        "variance": 2200
      },
      "status": "closed",
      "endedAt": "2026-07-29T18:00:00.000Z"
    }
  }
}
```

### Get Shift History
```bash
curl -X GET "http://localhost:3500/api/shifts?page=1&limit=10&status=closed" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "shifts": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "shiftNumber": "MB-SHIFT-2026-0001",
        "openingFloat": 5000,
        "status": "closed",
        "startedAt": "2026-07-29T08:00:00.000Z",
        "endedAt": "2026-07-29T18:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalShifts": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Review Variance
```bash
curl -X PATCH http://localhost:3500/api/shifts/64f1a2b3c4d5e6f7a8b9c0d1/review-variance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "varianceNotes": "KES 2,200 overage explained by MPesa settlements" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Variance reviewed successfully",
  "data": {
    "shift": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "shiftNumber": "MB-SHIFT-2026-0001",
      "status": "closed",
      "varianceNotes": "KES 2,200 overage explained by MPesa settlements",
      "varianceReviewedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0cc",
        "firstName": "Grace",
        "lastName": "Wanjiru"
      }
    }
  }
}
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Role restrictions enforce that history and active-shift views are manager/admin only.
- **Ownership enforcement:** Only the shift owner or a manager/admin can close a shift — enforced inline in `endShift()`.
- **One shift at a time:** A user cannot start a second shift while one is already open — enforced via `user.currentShift` check.
- **Immutable variance review:** `varianceReviewedBy` can only be set once — the guard prevents a second review from overwriting the first.
- **Tab gate:** The `requireActiveShift` middleware prevents any tab from being opened without a valid open shift, ensuring all sales are traceable to a shift.

---

## 🚨 Error Handling

```json
{
  "success": false,
  "message": "..."
}
```

| Status | Scenario |
|---|---|
| 400 | `openingFloat` or `actualCash` missing; shift already closed; shift not closed (for review) |
| 401 | Missing or invalid JWT token |
| 403 | Attempting to close another user's shift without manager/admin role; tab opened without active shift |
| 404 | Shift not found; assigned branch not found |
| 409 | User already has an active shift; variance already reviewed |

---

## 📊 Database Indexes

```typescript
shiftSchema.index({ branch: 1 });
shiftSchema.index({ staff: 1 });
shiftSchema.index({ status: 1 });
shiftSchema.index({ startedAt: -1 });
```

---

**Last Updated:** 2026-07-29
**Version:** 1.0.0
**Maintainer:** POS API Development Team
