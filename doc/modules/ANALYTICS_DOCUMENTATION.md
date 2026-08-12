# 📈 POS API - Analytics Management Documentation

## 📋 Table of Contents
- [Analytics Management Overview](#analytics-management-overview)
- [Analytics Model](#-analytics-model)
- [Analytics Controller](#-analytics-controller)
- [Analytics Routes](#-analytics-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Analytics Management Overview

Where Report answers "what happened in this period" with a single snapshot, Analytics answers "how has this been trending" — time-bucketed series and rankings shaped for charts and dashboards rather than a one-off figure. Like Report, it is entirely read-only and computes everything on demand from Tab, Payment, Expense, Product, StockMovement, and Branch.

**Scope notes for this pass:**
- **Trend endpoints (`sales-trend`, `profit-trend`, `inventory-value`) use a rolling window**, not a fixed calendar range: `days` (default 30) or an explicit `from`/`to` pair, always bucketed to the day and zero-filled so a chart never has to handle missing dates itself.
- **`getInventoryValueTrend`'s `cumulativeValue` is relative to the start of the requested window, not an absolute stock valuation** — there's no stored baseline inventory value to anchor it to (see `doc/modules/REPORT_DOCUMENTATION.md`'s `getInventoryReport` for the actual point-in-time stock value). Treat it as "how much has inventory value moved," not "what is inventory worth right now."
- **Heavy aggregations are shared with the Report module** via `src/services/internal/reportingService.ts` — `getTopProducts` is a thin wrapper around the same `getBestSellingProducts` helper `reportController.getProductReport` uses for its best-sellers bucket, and `getBranchComparison` reuses the same revenue/COGS/expense helpers `getProfitReport` uses, just run once per branch.
- **`getBranchComparison` is admin-only**, exactly per the original doc annotation — every other Analytics route is `manager`/`admin`/`accountant`, same tier as Report.

---

## 📄 Analytics Model

**There is no dedicated Analytics model or collection.** Same reasoning as Report (see `doc/modules/REPORT_DOCUMENTATION.md`'s Model section): no "Analytics" entry exists in `doc/BACKEND_DOCUMENTATION.md`'s Database Models list. Every endpoint queries one or more of:

```typescript
// Collections read by this module (no schema of its own)
Payment        // sales trend, payment method distribution
Tab            // peak hours, top products, profit trend (COGS), branch comparison
Expense        // profit trend (approved expenses), branch comparison
Product        // SKU buyingPrice for COGS and inventory value calculations
StockMovement  // inventory value trend (signed quantity x buyingPrice per movement)
Branch         // branch comparison rows
```

Four of the five `reportingService` helpers are reused here unchanged (see `doc/modules/REPORT_DOCUMENTATION.md`'s Model section for their signatures: `resolveDateRange`, `getRevenueBreakdown`, `getCostOfGoodsSold`, `getApprovedExpenseTotal`, `getBestSellingProducts`). Two additional helpers are local to this controller (not exported — Analytics-specific bucketing, unlike the shared `reportingService` helpers):

```typescript
// src/controllers/analyticsController.ts (local, not exported)
const resolveTrendWindow = (query: any): { startDate: Date; endDate: Date } => { /* days | from/to */ };
const buildDateKeys = (startDate: Date, endDate: Date): string[] => { /* zero-fill helper */ };
```

---

## 🎮 Analytics Controller

**File:** `src/controllers/analyticsController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import Tab from "../models/Tab";
import Payment from "../models/Payment";
import Expense from "../models/Expense";
import StockMovement from "../models/StockMovement";
import Branch from "../models/Branch";
import {
  resolveDateRange,
  getRevenueBreakdown,
  getCostOfGoodsSold,
  getApprovedExpenseTotal,
  getBestSellingProducts,
} from "../services/internal/reportingService";
```

### Local Helpers
```typescript
/**
 * Resolves the bucketing window for trend endpoints: either an explicit
 * from/to pair, or a rolling window of `days` (default 30) ending now.
 */
const resolveTrendWindow = (query: any): { startDate: Date; endDate: Date } => {
  const { from, to, days } = query;

  if (from && to) {
    return { startDate: new Date(from as string), endDate: new Date(to as string) };
  }

  const numDays = parseInt(days as string) || 30;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - numDays);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
};

/**
 * Builds every YYYY-MM-DD date key between startDate and endDate inclusive,
 * so trend series are zero-filled instead of skipping days with no data.
 */
const buildDateKeys = (startDate: Date, endDate: Date): string[] => {
  const keys: string[] = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
};
```

### Functions Overview

#### `getSalesTrend()`
**Purpose:** Daily-bucketed revenue series for dashboards
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Bucket completed Payments by day over the window, zero-fill gaps
**Response:** Array of `{ date, totalSales, paymentCount }`

**Controller Implementation:**
```typescript
export const getSalesTrend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch } = req.query;
    const { startDate, endDate } = resolveTrendWindow(req.query);

    const match: any = {
      status: "completed",
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const rows = await Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalSales: { $sum: "$amount" },
          paymentCount: { $sum: 1 },
        },
      },
    ]);
    const rowsByDate = new Map(rows.map((row) => [row._id, row]));

    const points = buildDateKeys(startDate, endDate).map((date) => ({
      date,
      totalSales: rowsByDate.get(date)?.totalSales || 0,
      paymentCount: rowsByDate.get(date)?.paymentCount || 0,
    }));

    // Return trend
    res.status(200).json({
      success: true,
      data: { points },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getProfitTrend()`
**Purpose:** Daily-bucketed net profit series (revenue − COGS − expenses)
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Bucket revenue, COGS, and approved expenses by day, merge, zero-fill gaps
**Response:** Array of `{ date, revenue, cogs, expenses, netProfit }`

**Controller Implementation:**
```typescript
export const getProfitTrend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch } = req.query;
    const { startDate, endDate } = resolveTrendWindow(req.query);
    const branchMatch = branch ? { branch: new Types.ObjectId(branch as string) } : {};

    const revenueRows = await Payment.aggregate([
      { $match: { ...branchMatch, status: "completed", createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$amount" },
        },
      },
    ]);

    const cogsRows = await Tab.aggregate([
      { $match: { ...branchMatch, status: "completed", closedAt: { $gte: startDate, $lte: endDate } } },
      { $unwind: "$items" },
      { $match: { "items.status": "active" } },
      {
        $lookup: {
          from: "products",
          let: { productId: "$items.product", skuId: "$items.sku" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$productId"] } } },
            { $unwind: "$skus" },
            { $match: { $expr: { $eq: ["$skus._id", "$$skuId"] } } },
            { $project: { _id: 0, buyingPrice: "$skus.buyingPrice" } },
          ],
          as: "skuInfo",
        },
      },
      { $unwind: { path: "$skuInfo", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$closedAt" } },
          cogs: { $sum: { $multiply: ["$items.quantity", { $ifNull: ["$skuInfo.buyingPrice", 0] }] } },
        },
      },
    ]);

    const expenseRows = await Expense.aggregate([
      { $match: { ...branchMatch, status: "approved", expenseDate: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$expenseDate" } },
          expenses: { $sum: "$amount" },
        },
      },
    ]);

    const revenueByDate = new Map(revenueRows.map((row) => [row._id, row.revenue]));
    const cogsByDate = new Map(cogsRows.map((row) => [row._id, row.cogs]));
    const expensesByDate = new Map(expenseRows.map((row) => [row._id, row.expenses]));

    const points = buildDateKeys(startDate, endDate).map((date) => {
      const revenue = revenueByDate.get(date) || 0;
      const cogs = cogsByDate.get(date) || 0;
      const expenses = expensesByDate.get(date) || 0;
      return {
        date,
        revenue,
        cogs,
        expenses,
        netProfit: revenue - cogs - expenses,
      };
    });

    // Return trend
    res.status(200).json({
      success: true,
      data: { points },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getPeakHours()`
**Purpose:** Tab volume and revenue by hour of day
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Group completed Tabs by hour-of-day on closedAt
**Response:** Array of 24 `{ hour, tabCount, totalSales }` rows

**Controller Implementation:**
```typescript
export const getPeakHours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch, range } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const match: any = {
      status: "completed",
      closedAt: { $gte: startDate, $lte: endDate },
    };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const rows = await Tab.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $hour: "$closedAt" },
          tabCount: { $sum: 1 },
          totalSales: { $sum: "$grandTotal" },
        },
      },
    ]);
    const rowsByHour = new Map(rows.map((row) => [row._id, row]));

    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      tabCount: rowsByHour.get(hour)?.tabCount || 0,
      totalSales: rowsByHour.get(hour)?.totalSales || 0,
    }));

    // Return peak hours
    res.status(200).json({
      success: true,
      data: { hours },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getTopProducts()`
**Purpose:** Ranked best-selling products for a range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Delegates to `reportingService.getBestSellingProducts` (descending)
**Response:** Ranked product list

**Controller Implementation:**
```typescript
export const getTopProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch, limit } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);
    const resultLimit = parseInt(limit as string) || 10;

    const topProducts = await getBestSellingProducts({
      branch: branch as string,
      startDate,
      endDate,
      limit: resultLimit,
      sort: "desc",
    });

    // Return top products
    res.status(200).json({
      success: true,
      data: { topProducts },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getPaymentDistribution()`
**Purpose:** Share of revenue by payment method
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Group completed Payments by method, compute percentage share
**Response:** Per-method count/amount/percentage

**Controller Implementation:**
```typescript
export const getPaymentDistribution = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const match: any = {
      status: "completed",
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const rows = await Payment.aggregate([
      { $match: match },
      { $group: { _id: "$method", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]);

    const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);

    const distribution = rows.map((row) => ({
      method: row._id,
      count: row.count,
      totalAmount: row.totalAmount,
      percentage: grandTotal > 0 ? Math.round((row.totalAmount / grandTotal) * 1000) / 10 : 0,
    }));

    // Return distribution
    res.status(200).json({
      success: true,
      data: { distribution, grandTotal },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getInventoryValueTrend()`
**Purpose:** Daily inventory value movement, derived from the StockMovement ledger
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Bucket signed `StockMovement.quantity × SKU.buyingPrice` by day, run a cumulative sum
**Response:** Array of `{ date, valueChange, cumulativeValue }` — `cumulativeValue` is relative to the start of the window, not an absolute stock valuation (no baseline snapshot exists)

**Controller Implementation:**
```typescript
export const getInventoryValueTrend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch } = req.query;
    const { startDate, endDate } = resolveTrendWindow(req.query);

    const match: any = { createdAt: { $gte: startDate, $lte: endDate } };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const rows = await StockMovement.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "products",
          let: { productId: "$product", skuId: "$sku" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$productId"] } } },
            { $unwind: "$skus" },
            { $match: { $expr: { $eq: ["$skus._id", "$$skuId"] } } },
            { $project: { _id: 0, buyingPrice: "$skus.buyingPrice" } },
          ],
          as: "skuInfo",
        },
      },
      { $unwind: { path: "$skuInfo", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          valueChange: { $sum: { $multiply: ["$quantity", { $ifNull: ["$skuInfo.buyingPrice", 0] }] } },
        },
      },
    ]);
    const rowsByDate = new Map(rows.map((row) => [row._id, row.valueChange]));

    let runningValue = 0;
    const points = buildDateKeys(startDate, endDate).map((date) => {
      const valueChange = rowsByDate.get(date) || 0;
      runningValue += valueChange;
      return { date, valueChange, cumulativeValue: runningValue };
    });

    // Return trend
    res.status(200).json({
      success: true,
      data: { points },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getBranchComparison()`
**Purpose:** Side-by-side revenue/COGS/expenses/profit across branches
**Access:** Admin only
**Validation:** None required
**Process:** Run reportingService's revenue/COGS/expense helpers per active branch
**Response:** One row per branch, sorted by revenue descending

**Controller Implementation:**
```typescript
export const getBranchComparison = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const branches = await Branch.find({ isActive: true });

    const comparison = await Promise.all(
      branches.map(async (branchDoc) => {
        const branchId = branchDoc._id as Types.ObjectId;
        const revenue = await getRevenueBreakdown({ branch: branchId, startDate, endDate });
        const cogs = await getCostOfGoodsSold({ branch: branchId, startDate, endDate });
        const expenses = await getApprovedExpenseTotal({ branch: branchId, startDate, endDate });
        const tabCount = await Tab.countDocuments({
          branch: branchId,
          status: "completed",
          closedAt: { $gte: startDate, $lte: endDate },
        });

        return {
          branch: { _id: branchDoc._id, name: branchDoc.name, code: branchDoc.code },
          revenue: revenue.totalRevenue,
          cogs,
          expenses,
          netProfit: revenue.totalRevenue - cogs - expenses,
          tabCount,
        };
      })
    );

    comparison.sort((a, b) => b.revenue - a.revenue);

    // Return comparison
    res.status(200).json({
      success: true,
      data: { range: range || "today", branches: comparison },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Analytics Routes

### Base Path: `/api/analytics`

```typescript
GET    /sales-trend          // Daily revenue series (manager, admin, accountant)
GET    /profit-trend         // Daily net profit series (manager, admin, accountant)
GET    /peak-hours           // Tab volume/revenue by hour (manager, admin, accountant)
GET    /top-products         // Ranked best sellers (manager, admin, accountant)
GET    /payment-distribution // Revenue share by method (manager, admin, accountant)
GET    /inventory-value      // Daily inventory value movement (manager, admin, accountant)
GET    /branch-comparison    // Side-by-side branch performance (admin only)
```

### Router Implementation

**File: `src/routes/analyticsRoutes.ts`**

```typescript
import express from "express";
import {
  getSalesTrend,
  getProfitTrend,
  getPeakHours,
  getTopProducts,
  getPaymentDistribution,
  getInventoryValueTrend,
  getBranchComparison,
} from "../controllers/analyticsController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const ANALYTICS_ROLES: UserRole[] = ["manager", "admin", "accountant"];

router.get("/sales-trend", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getSalesTrend);
router.get("/profit-trend", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getProfitTrend);
router.get("/peak-hours", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getPeakHours);
router.get("/top-products", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getTopProducts);
router.get("/payment-distribution", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getPaymentDistribution);
router.get("/inventory-value", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getInventoryValueTrend);
router.get("/branch-comparison", authenticateToken, authorizeRoles(["admin"]), getBranchComparison);

export default router;
```

### Route Details

#### `GET /api/analytics/sales-trend`
**Headers:** `Authorization: Bearer <token>`
**Query:** `days=7`
**Response:**
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "date": "2026-08-08",
        "totalSales": 24500,
        "paymentCount": 18
      },
      {
        "date": "2026-08-09",
        "totalSales": 31200,
        "paymentCount": 22
      },
      {
        "date": "2026-08-10",
        "totalSales": 0,
        "paymentCount": 0
      },
      {
        "date": "2026-08-11",
        "totalSales": 28900,
        "paymentCount": 20
      },
      {
        "date": "2026-08-12",
        "totalSales": 33100,
        "paymentCount": 25
      },
      {
        "date": "2026-08-13",
        "totalSales": 26700,
        "paymentCount": 19
      },
      {
        "date": "2026-08-14",
        "totalSales": 19800,
        "paymentCount": 14
      }
    ]
  }
}
```

#### `GET /api/analytics/profit-trend`
**Headers:** `Authorization: Bearer <token>`
**Query:** `from=2026-08-01`, `to=2026-08-03`
**Response:**
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "date": "2026-08-01",
        "revenue": 22500,
        "cogs": 9800,
        "expenses": 3000,
        "netProfit": 9700
      },
      {
        "date": "2026-08-02",
        "revenue": 27100,
        "cogs": 11400,
        "expenses": 0,
        "netProfit": 15700
      },
      {
        "date": "2026-08-03",
        "revenue": 19800,
        "cogs": 8200,
        "expenses": 1500,
        "netProfit": 10100
      }
    ]
  }
}
```

#### `GET /api/analytics/peak-hours`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=weekly`
**Response:**
```json
{
  "success": true,
  "data": {
    "hours": [
      {
        "hour": 0,
        "tabCount": 3,
        "totalSales": 4200
      },
      {
        "hour": 1,
        "tabCount": 0,
        "totalSales": 0
      },
      {
        "hour": 18,
        "tabCount": 22,
        "totalSales": 31400
      },
      {
        "hour": 21,
        "tabCount": 45,
        "totalSales": 68900
      },
      {
        "hour": 22,
        "tabCount": 51,
        "totalSales": 79200
      },
      {
        "hour": 23,
        "tabCount": 38,
        "totalSales": 54100
      }
    ]
  }
}
```

#### `GET /api/analytics/top-products`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=monthly`, `limit=5`
**Response:**
```json
{
  "success": true,
  "data": {
    "topProducts": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 412,
        "revenue": 103000
      }
    ]
  }
}
```

#### `GET /api/analytics/payment-distribution`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=weekly`
**Response:**
```json
{
  "success": true,
  "data": {
    "distribution": [
      {
        "method": "cash",
        "count": 88,
        "totalAmount": 96500,
        "percentage": 52.3
      },
      {
        "method": "mpesa",
        "count": 66,
        "totalAmount": 88000,
        "percentage": 47.7
      }
    ],
    "grandTotal": 184500
  }
}
```

#### `GET /api/analytics/inventory-value`
**Headers:** `Authorization: Bearer <token>`
**Query:** `days=5`
**Response:**
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "date": "2026-08-10",
        "valueChange": 45000,
        "cumulativeValue": 45000
      },
      {
        "date": "2026-08-11",
        "valueChange": -12000,
        "cumulativeValue": 33000
      },
      {
        "date": "2026-08-12",
        "valueChange": -8600,
        "cumulativeValue": 24400
      },
      {
        "date": "2026-08-13",
        "valueChange": 0,
        "cumulativeValue": 24400
      },
      {
        "date": "2026-08-14",
        "valueChange": -5200,
        "cumulativeValue": 19200
      }
    ]
  }
}
```

#### `GET /api/analytics/branch-comparison`
**Headers:** `Authorization: Bearer <token>` (admin)
**Query:** `range=monthly`
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "monthly",
    "branches": [
      {
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "revenue": 742000,
        "cogs": 298000,
        "expenses": 86500,
        "netProfit": 357500,
        "tabCount": 512
      },
      {
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
          "name": "Westlands Branch",
          "code": "WEST"
        },
        "revenue": 415000,
        "cogs": 172000,
        "expenses": 51000,
        "netProfit": 192000,
        "tabCount": 298
      }
    ]
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
router.get("/branch-comparison", authenticateToken, getBranchComparison);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get("/branch-comparison", authenticateToken, authorizeRoles(["admin"]), getBranchComparison);
```
`branch-comparison` is the one Analytics route with a narrower role set than the rest of the module — every other route uses `ANALYTICS_ROLES` (`manager`, `admin`, `accountant`).

---

## 📝 API Examples

### 30-Day Sales Trend
```bash
curl -X GET "http://localhost:3500/api/analytics/sales-trend?days=30" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "date": "2026-07-16",
        "totalSales": 21400,
        "paymentCount": 16
      },
      {
        "date": "2026-07-17",
        "totalSales": 0,
        "paymentCount": 0
      },
      {
        "date": "2026-08-14",
        "totalSales": 19800,
        "paymentCount": 14
      }
    ]
  }
}
```

### Profit Trend for a Custom Range
```bash
curl -X GET "http://localhost:3500/api/analytics/profit-trend?from=2026-07-01&to=2026-07-31" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "date": "2026-07-01",
        "revenue": 22500,
        "cogs": 9800,
        "expenses": 3000,
        "netProfit": 9700
      },
      {
        "date": "2026-07-31",
        "revenue": 19800,
        "cogs": 8200,
        "expenses": 1500,
        "netProfit": 10100
      }
    ]
  }
}
```

### Peak Hours This Week
```bash
curl -X GET "http://localhost:3500/api/analytics/peak-hours?range=weekly" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "hours": [
      {
        "hour": 0,
        "tabCount": 3,
        "totalSales": 4200
      },
      {
        "hour": 21,
        "tabCount": 45,
        "totalSales": 68900
      },
      {
        "hour": 23,
        "tabCount": 38,
        "totalSales": 54100
      }
    ]
  }
}
```

### Top 5 Products This Month
```bash
curl -X GET "http://localhost:3500/api/analytics/top-products?range=monthly&limit=5" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "topProducts": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 412,
        "revenue": 103000
      }
    ]
  }
}
```

### Payment Method Distribution
```bash
curl -X GET "http://localhost:3500/api/analytics/payment-distribution?range=weekly" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "distribution": [
      {
        "method": "cash",
        "count": 88,
        "totalAmount": 96500,
        "percentage": 52.3
      },
      {
        "method": "mpesa",
        "count": 66,
        "totalAmount": 88000,
        "percentage": 47.7
      }
    ],
    "grandTotal": 184500
  }
}
```

### Branch Comparison (admin only)
```bash
curl -X GET "http://localhost:3500/api/analytics/branch-comparison?range=monthly" \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "monthly",
    "branches": [
      {
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "revenue": 742000,
        "cogs": 298000,
        "expenses": 86500,
        "netProfit": 357500,
        "tabCount": 512
      }
    ]
  }
}
```

---

## 🛡️ Security Features

- **RBAC:** `manager`, `admin`, `accountant` for six of the seven routes; `admin` only for `branch-comparison`, matching the original doc's explicit annotation.
- **Read-only:** no Analytics endpoint writes to any collection.
- **Branch scoping is opt-in, not enforced:** same as Report — omitting `branch` returns a consolidated figure across all branches for any authorized role, except `branch-comparison`, which is inherently cross-branch and admin-gated instead.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. a manager calling `branch-comparison`) |
| `500` | Unexpected server error (e.g. invalid `branch`/`from`/`to` value) |

**Error response shape:**
```json
{
  "success": false,
  "message": "Cast to ObjectId failed for value \"not-an-id\" (type string) at path \"branch\""
}
```

---

## 📊 Database Indexes

No new indexes — every aggregation runs over existing, already-indexed collections:
```typescript
paymentSchema.index({ branch: 1 });
paymentSchema.index({ status: 1 });
tabSchema.index({ branch: 1 });
tabSchema.index({ status: 1 });
expenseSchema.index({ branch: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: 1 });
stockMovementSchema.index({ branch: 1, sku: 1 });
stockMovementSchema.index({ branch: 1, createdAt: -1 });
branchSchema.index({ isActive: 1 });
```
`StockMovement.index({ branch: 1, createdAt: -1 })` in particular is what keeps `getInventoryValueTrend` fast over large date windows.

---

**Last Updated:** 2026-08-14
**Version:** 1.0.0
**Maintainer:** POS API Development Team
