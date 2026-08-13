# 🏠 POS API - Dashboard Management Documentation

## 📋 Table of Contents
- [Dashboard Management Overview](#dashboard-management-overview)
- [Dashboard Model](#-dashboard-model)
- [Dashboard Controller](#-dashboard-controller)
- [Dashboard Routes](#-dashboard-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Dashboard Management Overview

Dashboard answers "what does a staff member see the moment they open the app" — two purpose-built, role-shaped snapshots rather than a queryable report. Where Report/Analytics let you pick a range and drill in, Dashboard is always "right now, today," combining several already-built aggregations into one payload per screen: a front-of-house view for bartenders/cashiers, and a management view for managers/admins.

**Scope notes for this pass:**
- **Two new shared aggregation helpers, not a new service module.** `getLowStockItems` and `getInventorySummary` were added to the existing `src/services/internal/reportingService.ts` (the same shared home `resolveDateRange`/`getRevenueBreakdown`/`getCostOfGoodsSold`/`getApprovedExpenseTotal`/`getBestSellingProducts` already live in) rather than a dashboard-specific service — both are exactly the kind of cross-module aggregation that file exists for. `reportController.getInventoryReport`'s own existing per-SKU loop was **left untouched** — it returns a full row per item regardless of stock level, which is more than either new helper needs, so refactoring it to share code wasn't in scope here.
- **Always "today."** Neither dashboard accepts a `range` query param — both always call `resolveDateRange("today")`. Historical/range-based views are what Report and Analytics are for.
- **A manager can never see another branch's dashboard.** `getManagerDashboard`'s branch resolution ignores any `?branch=` query param for the `manager` role entirely — only `admin` can pass one (or omit it for a consolidated cross-branch view, matching `analyticsController.getBranchComparison`'s existing convention).
- **`staffOnline` is derived from `Shift`, not a live presence system.** An open `Shift` *is* a clocked-in staff member — `User.currentShift` is exactly that link — so "staff online" is `Shift.find({ branch, status: "open" })`, not a websocket-tracked presence list.

---

## 📄 Dashboard Model

**There is no dedicated Dashboard model.** Like Report and Analytics, this module is a pure read-only aggregation layer over existing collections — confirmed against `doc/BACKEND_DOCUMENTATION.md`'s Database Models list, which has no "Dashboard" entry. Each function reads from:

| Collection | What Dashboard reads from it |
|---|---|
| `Tab` | Open tabs (both dashboards), best-selling products (manager) |
| `Payment` | Today's revenue (both dashboards, via `reportingService`), pending mpesa payments (bartender) |
| `Expense` | Approved expense total (manager, via `reportingService`) |
| `Product` | Stock levels/value for low-stock and stock-value widgets (via the two new `reportingService` helpers) |
| `Shift` | Staff online (manager) |

Reused from `reportingService.ts` (already documented in `doc/modules/REPORT_DOCUMENTATION.md`): `resolveDateRange`, `getRevenueBreakdown`, `getCostOfGoodsSold`, `getApprovedExpenseTotal`, `getBestSellingProducts`.

New in `reportingService.ts`, added for this module:
```typescript
export interface LowStockItem {
  product: Types.ObjectId;
  productName: string;
  sku: Types.ObjectId;
  skuCode: string;
  currentStock: number;
  minimumStock: number;
}

export const getLowStockItems = async ({ branch, limit }): Promise<{ items: LowStockItem[]; count: number }> => { /* ... */ };
export const getInventorySummary = async (branch?): Promise<{ totalStockValue: number; lowStockCount: number }> => { /* ... */ };
```
Both share one unexported `getInventoryRows(branch?)` walk — every active SKU on every active Product, computing branch-scoped (or all-branch-summed) `currentStock`/`minimumStock`/`stockValue`/`lowStock`, mirroring `reportController.getInventoryReport`'s own per-SKU loop.

---

## 🎮 Dashboard Controller

**File:** `src/controllers/dashboardController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Tab from "../models/Tab";
import Payment from "../models/Payment";
import Shift from "../models/Shift";
import {
  resolveDateRange,
  getRevenueBreakdown,
  getCostOfGoodsSold,
  getApprovedExpenseTotal,
  getBestSellingProducts,
  getLowStockItems,
  getInventorySummary,
} from "../services/internal/reportingService";
import { IRole } from "../type";

const OPEN_TAB_STATUSES = ["open", "held", "awaiting_payment"];
```

### Functions Overview

#### `getBartenderDashboard()`
**Purpose:** At-a-glance view for front-of-house staff — open tabs, today's sales, low stock, pending mpesa
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** Caller must have a branch assigned
**Process:** Run open-tab lookup, today's revenue, low-stock, and pending-mpesa queries in parallel, all scoped to the caller's own branch
**Response:** Combined dashboard payload

**Controller Implementation:**
```typescript
export const getBartenderDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Guard — caller must have a branch assigned
    const branch = req.user?.branch;
    if (!branch) {
      return next(errorHandler(400, "You must be assigned to a branch"));
    }

    // Resolve today's date window
    const { startDate, endDate } = resolveDateRange("today");

    // Run every widget's query in parallel
    const [openTabs, todaysSales, lowStock, pendingMpesaPayments] = await Promise.all([
      Tab.find({ branch, status: { $in: OPEN_TAB_STATUSES } })
        .select("tabNumber table status grandTotal openedBy createdAt")
        .populate("openedBy", "firstName lastName")
        .sort({ createdAt: -1 })
        .limit(50),
      getRevenueBreakdown({ branch: branch as any, startDate, endDate }),
      getLowStockItems({ branch: branch as any, limit: 5 }),
      Payment.find({ branch, method: "mpesa", status: "pending" })
        .select("paymentNumber amount mpesa createdAt")
        .sort({ createdAt: -1 }),
    ]);

    // Return dashboard
    res.status(200).json({
      success: true,
      data: {
        openTabs: { count: openTabs.length, tabs: openTabs },
        todaysSales,
        lowStock,
        pendingMpesaPayments: { count: pendingMpesaPayments.length, payments: pendingMpesaPayments },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getManagerDashboard()`
**Purpose:** At-a-glance view for management — revenue, profit, stock value, best sellers, open tabs, staff online
**Access:** Manager, Admin
**Validation:** None required
**Process:** Resolve branch scope (manager: always their own branch; admin: optional `?branch=` query, omitted = consolidated across all branches), run every widget's query in parallel over today's date window
**Response:** Combined dashboard payload

**Controller Implementation:**
```typescript
export const getManagerDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Resolve branch scope — a manager can never override their own branch via query param
    const roleName = (req.user?.role as IRole)?.name;
    const isAdmin = roleName === "admin";
    const branch = isAdmin ? (req.query.branch as string | undefined) : (req.user?.branch as any);

    // Resolve today's date window
    const { startDate, endDate } = resolveDateRange("today");

    // Run every widget's query in parallel
    const [revenue, cogs, expenses, stockValue, bestSellers, openTabs, staffOnline] = await Promise.all([
      getRevenueBreakdown({ branch, startDate, endDate }),
      getCostOfGoodsSold({ branch, startDate, endDate }),
      getApprovedExpenseTotal({ branch, startDate, endDate }),
      getInventorySummary(branch),
      getBestSellingProducts({ branch, startDate, endDate, limit: 5, sort: "desc" }),
      Tab.find({ ...(branch ? { branch } : {}), status: { $in: OPEN_TAB_STATUSES } })
        .select("tabNumber table status grandTotal branch openedBy createdAt")
        .populate("openedBy", "firstName lastName")
        .sort({ createdAt: -1 })
        .limit(10),
      Shift.find({ ...(branch ? { branch } : {}), status: "open" })
        .select("staff branch startedAt")
        .populate("staff", "firstName lastName"),
    ]);
    const netProfit = revenue.totalRevenue - cogs - expenses;

    // Return dashboard
    res.status(200).json({
      success: true,
      data: {
        branch: branch || null,
        revenue: revenue.totalRevenue,
        cogs,
        expenses,
        netProfit,
        stockValue,
        bestSellers,
        openTabs: { count: openTabs.length, tabs: openTabs },
        staffOnline: { count: staffOnline.length, shifts: staffOnline },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Dashboard Routes

### Base Path: `/api/dashboard`

```typescript
GET /bartender  // Front-of-house dashboard (bartender, cashier, manager, admin)
GET /manager     // Management dashboard (manager, admin)
```

### Router Implementation

**File: `src/routes/dashboardRoutes.ts`**

```typescript
import express from "express";
import { getBartenderDashboard, getManagerDashboard } from "../controllers/dashboardController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const BARTENDER_DASHBOARD_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const MANAGER_DASHBOARD_ROLES: UserRole[] = ["manager", "admin"];

router.get("/bartender", authenticateToken, authorizeRoles(BARTENDER_DASHBOARD_ROLES), getBartenderDashboard);
router.get("/manager", authenticateToken, authorizeRoles(MANAGER_DASHBOARD_ROLES), getManagerDashboard);

export default router;
```

### Route Details

#### `GET /api/dashboard/bartender`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "openTabs": {
      "count": 2,
      "tabs": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
          "tabNumber": "MAIN-TAB-000042",
          "table": "12",
          "status": "open",
          "grandTotal": 2450,
          "openedBy": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "createdAt": "2026-08-13T18:40:00.000Z"
        }
      ]
    },
    "todaysSales": {
      "totalRevenue": 24500,
      "cashSales": 14500,
      "mpesaSales": 10000,
      "paymentCount": 18
    },
    "lowStock": {
      "items": [
        {
          "product": "64f1a2b3c4d5e6f7a8b9c5b1",
          "productName": "Imported Whisky 250ml",
          "sku": "64f1a2b3c4d5e6f7a8b9c5b2",
          "skuCode": "IMPORTED-WHISKY-250ML-DEFAULT",
          "currentStock": 4,
          "minimumStock": 6
        }
      ],
      "count": 1
    },
    "pendingMpesaPayments": {
      "count": 1,
      "payments": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c2a2",
          "paymentNumber": "MAIN-PAY-2026-0002",
          "amount": 1200,
          "mpesa": {
            "phone": "254712345678",
            "checkoutRequestId": "ws_CO_030820261840001234"
          },
          "createdAt": "2026-08-13T18:41:00.000Z"
        }
      ]
    }
  }
}
```

#### `GET /api/dashboard/manager`
**Headers:** `Authorization: Bearer <token>`
**Query (admin only):** `branch=<branchId>` — omit for a consolidated cross-branch view
**Response:**
```json
{
  "success": true,
  "data": {
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "revenue": 184500,
    "cogs": 78200,
    "expenses": 12500,
    "netProfit": 93800,
    "stockValue": {
      "totalStockValue": 412000,
      "lowStockCount": 3
    },
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 42,
        "revenue": 10500
      }
    ],
    "openTabs": {
      "count": 6,
      "tabs": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
          "tabNumber": "MAIN-TAB-000042",
          "table": "12",
          "status": "open",
          "grandTotal": 2450,
          "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
          "openedBy": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "createdAt": "2026-08-13T18:40:00.000Z"
        }
      ]
    },
    "staffOnline": {
      "count": 3,
      "shifts": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c8a1",
          "staff": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
          "startedAt": "2026-08-13T14:00:00.000Z"
        }
      ]
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
router.get("/manager", authenticateToken, authorizeRoles(["manager", "admin"]), getManagerDashboard);
```
`/bartender` additionally allows `cashier`, `manager`, `admin` — the same front-of-house tier used for payment-taking routes elsewhere. `/manager` is strictly `manager`/`admin`.

---

## 📝 API Examples

Every Dashboard route is a `GET` with no request body — the examples below show each call's headers/query and its response.

### Bartender Dashboard
```bash
curl -X GET http://localhost:3500/api/dashboard/bartender \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "openTabs": {
      "count": 2,
      "tabs": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
          "tabNumber": "MAIN-TAB-000042",
          "table": "12",
          "status": "open",
          "grandTotal": 2450,
          "openedBy": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "createdAt": "2026-08-13T18:40:00.000Z"
        },
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1a2",
          "tabNumber": "MAIN-TAB-000043",
          "table": "7",
          "status": "awaiting_payment",
          "grandTotal": 1800,
          "openedBy": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "createdAt": "2026-08-13T19:05:00.000Z"
        }
      ]
    },
    "todaysSales": {
      "totalRevenue": 24500,
      "cashSales": 14500,
      "mpesaSales": 10000,
      "paymentCount": 18
    },
    "lowStock": {
      "items": [
        {
          "product": "64f1a2b3c4d5e6f7a8b9c5b1",
          "productName": "Imported Whisky 250ml",
          "sku": "64f1a2b3c4d5e6f7a8b9c5b2",
          "skuCode": "IMPORTED-WHISKY-250ML-DEFAULT",
          "currentStock": 4,
          "minimumStock": 6
        }
      ],
      "count": 1
    },
    "pendingMpesaPayments": {
      "count": 1,
      "payments": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c2a2",
          "paymentNumber": "MAIN-PAY-2026-0002",
          "amount": 1200,
          "mpesa": {
            "phone": "254712345678",
            "checkoutRequestId": "ws_CO_030820261840001234"
          },
          "createdAt": "2026-08-13T18:41:00.000Z"
        }
      ]
    }
  }
}
```

### Manager Dashboard (own branch)
```bash
curl -X GET http://localhost:3500/api/dashboard/manager \
  -H "Authorization: Bearer <manager-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "revenue": 184500,
    "cogs": 78200,
    "expenses": 12500,
    "netProfit": 93800,
    "stockValue": {
      "totalStockValue": 412000,
      "lowStockCount": 3
    },
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 42,
        "revenue": 10500
      }
    ],
    "openTabs": {
      "count": 6,
      "tabs": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
          "tabNumber": "MAIN-TAB-000042",
          "table": "12",
          "status": "open",
          "grandTotal": 2450,
          "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
          "openedBy": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "createdAt": "2026-08-13T18:40:00.000Z"
        }
      ]
    },
    "staffOnline": {
      "count": 3,
      "shifts": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c8a1",
          "staff": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
            "firstName": "Grace",
            "lastName": "Njeri"
          },
          "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
          "startedAt": "2026-08-13T14:00:00.000Z"
        }
      ]
    }
  }
}
```

### Manager Dashboard, One Branch (admin)
```bash
curl -X GET "http://localhost:3500/api/dashboard/manager?branch=64f1a2b3c4d5e6f7a8b9c0d4" \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "branch": "64f1a2b3c4d5e6f7a8b9c0d4",
    "revenue": 61200,
    "cogs": 24700,
    "expenses": 5100,
    "netProfit": 31400,
    "stockValue": {
      "totalStockValue": 158000,
      "lowStockCount": 1
    },
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 15,
        "revenue": 3750
      }
    ],
    "openTabs": {
      "count": 2,
      "tabs": []
    },
    "staffOnline": {
      "count": 1,
      "shifts": []
    }
  }
}
```

### Manager Dashboard, Consolidated (admin)
```bash
curl -X GET http://localhost:3500/api/dashboard/manager \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "branch": null,
    "revenue": 245700,
    "cogs": 102900,
    "expenses": 17600,
    "netProfit": 125200,
    "stockValue": {
      "totalStockValue": 570000,
      "lowStockCount": 4
    },
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 57,
        "revenue": 14250
      }
    ],
    "openTabs": {
      "count": 8,
      "tabs": []
    },
    "staffOnline": {
      "count": 4,
      "shifts": []
    }
  }
}
```

---

## 🛡️ Security Features

- **RBAC:** `/bartender` open to bartender/cashier/manager/admin; `/manager` restricted to manager/admin.
- **Branch isolation is enforced in code, not just by convention.** `getManagerDashboard` reads `req.user?.branch` for any non-admin caller and ignores `req.query.branch` entirely for that role — a manager cannot pass a query parameter to view another branch's figures.
- **Read-only:** neither dashboard writes to any collection.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Caller has no branch assigned (`getBartenderDashboard`) |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "You must be assigned to a branch"
}
```

---

## 📊 Database Indexes

No new indexes — every query runs over existing, already-indexed collections (`Tab.branch`/`.status`, `Payment.branch`/`.status`, `Shift.branch`/`.status`, `Product.status`). See each collection's own module documentation for its full index list.

---

**Last Updated:** 2026-08-13
**Version:** 1.0.0
**Maintainer:** POS API Development Team
