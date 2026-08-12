# 📊 POS API - Report Management Documentation

## 📋 Table of Contents
- [Report Management Overview](#report-management-overview)
- [Report Model](#-report-model)
- [Report Controller](#-report-controller)
- [Report Routes](#-report-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Report Management Overview

Report delivers snapshot figures for a selected period — today, yesterday, this week, this month, this year, or a `branch`-scoped slice of any of those. It is entirely read-only: no data is ever written by this module. Every figure is computed on demand from the same collections the rest of the system already writes to (Tab, Payment, Purchase, Expense, Product, Shift), so a report is always a live reflection of current data, never a stored snapshot.

**Scope notes for this pass:**
- **`range`/`branch` query params were added to every endpoint for consistency**, even where the original doc's route list showed a bare path (`GET /inventory`, `GET /employees`, `GET /suppliers`). A report without a time window isn't meaningful, so all seven accept `branch`, and all except `getInventoryReport` (a point-in-time stock snapshot, not a period figure) accept `range`.
- **Heavy aggregations are shared with the Analytics module** via `src/services/internal/reportingService.ts` (`resolveDateRange`, `getRevenueBreakdown`, `getCostOfGoodsSold`, `getApprovedExpenseTotal`, `getBestSellingProducts`) — see `doc/modules/ANALYTICS_DOCUMENTATION.md` for the endpoints that reuse the same helpers.
- **No `AuditLog` write anywhere in this module** — reports don't mutate state, so nothing to log.

---

## 📄 Report Model

**There is no dedicated Report model or collection.** Report is a pure read-only aggregation layer over existing collections — confirmed against `doc/BACKEND_DOCUMENTATION.md`'s Database Models list, which has no "Report" entry. Every endpoint queries one or more of:

```typescript
// Collections read by this module (no schema of its own)
Payment   // revenue, cash/mpesa split, payment status breakdown
Tab       // tab counts, discounts, tax, best/slow-selling items, employee activity
Purchase  // supplier spend
Expense   // approved expense totals (feeds Profit Report)
Product   // SKU stock levels and buying price (feeds Inventory and Profit Reports)
Shift     // per-employee shift performance and cash variance
```

The shared aggregation helpers each function is built on live in `src/services/internal/reportingService.ts`, following this codebase's "service does the aggregation, controller stays thin" split:

```typescript
export const resolveDateRange = (range?: string): { startDate: Date; endDate: Date } => { /* ... */ };
export const getRevenueBreakdown = async ({ branch, startDate, endDate }): Promise<{
  totalRevenue: number; cashSales: number; mpesaSales: number; paymentCount: number;
}> => { /* ... */ };
export const getCostOfGoodsSold = async ({ branch, startDate, endDate }): Promise<number> => { /* ... */ };
export const getApprovedExpenseTotal = async ({ branch, startDate, endDate }): Promise<number> => { /* ... */ };
export const getBestSellingProducts = async ({ branch, startDate, endDate, limit, sort }): Promise<
  { product: Types.ObjectId; sku: Types.ObjectId; name: string; quantitySold: number; revenue: number }[]
> => { /* ... */ };
```

---

## 🎮 Report Controller

**File:** `src/controllers/reportController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import Tab from "../models/Tab";
import Payment from "../models/Payment";
import Product from "../models/Product";
import Purchase from "../models/Purchase";
import Shift from "../models/Shift";
import User from "../models/User";
import {
  resolveDateRange,
  getRevenueBreakdown,
  getCostOfGoodsSold,
  getApprovedExpenseTotal,
  getBestSellingProducts,
} from "../services/internal/reportingService";
```

### Functions Overview

#### `getSalesReport()`
**Purpose:** Snapshot revenue/tab figures for a named range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Resolve range, aggregate revenue by method and tab-level totals
**Response:** Revenue, method split, tab stats

**Controller Implementation:**
```typescript
export const getSalesReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;

    // Resolve date window
    const { startDate, endDate } = resolveDateRange(range as string);

    // Revenue via Payment (authoritative money-received record)
    const revenue = await getRevenueBreakdown({ branch: branch as string, startDate, endDate });

    // Tab-level stats for the same window
    const match: any = {
      status: "completed",
      closedAt: { $gte: startDate, $lte: endDate },
    };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const tabStats = await Tab.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTabs: { $sum: 1 },
          averageTabValue: { $avg: "$grandTotal" },
          totalDiscount: { $sum: "$discountTotal" },
          totalTax: { $sum: "$taxTotal" },
        },
      },
    ]);
    const stats = tabStats[0] || { totalTabs: 0, averageTabValue: 0, totalDiscount: 0, totalTax: 0 };

    // Return report
    res.status(200).json({
      success: true,
      data: {
        range: range || "today",
        branch: branch || null,
        totalRevenue: revenue.totalRevenue,
        byMethod: {
          cash: revenue.cashSales,
          mpesa: revenue.mpesaSales,
        },
        totalTabs: stats.totalTabs,
        averageTabValue: stats.averageTabValue,
        totalDiscount: stats.totalDiscount,
        totalTax: stats.totalTax,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getProductReport()`
**Purpose:** Best sellers, slow movers, and never-sold products for a range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Rank sold items via `reportingService.getBestSellingProducts`, diff against the active catalog for never-sold
**Response:** Best sellers, slow movers, never sold

**Controller Implementation:**
```typescript
export const getProductReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch, limit } = req.query;

    const { startDate, endDate } = resolveDateRange(range as string);
    const resultLimit = parseInt(limit as string) || 10;

    // Best sellers and slow movers share the same ranking pipeline
    const bestSellers = await getBestSellingProducts({
      branch: branch as string,
      startDate,
      endDate,
      limit: resultLimit,
      sort: "desc",
    });
    const slowMovers = await getBestSellingProducts({
      branch: branch as string,
      startDate,
      endDate,
      limit: resultLimit,
      sort: "asc",
    });

    // Never sold — active SKUs with zero appearances in the sold-items set
    const soldSkuRows = await Tab.aggregate([
      {
        $match: {
          status: "completed",
          closedAt: { $gte: startDate, $lte: endDate },
          ...(branch ? { branch: new Types.ObjectId(branch as string) } : {}),
        },
      },
      { $unwind: "$items" },
      { $match: { "items.status": "active" } },
      { $group: { _id: "$items.sku" } },
    ]);
    const soldSkuIdSet = new Set(soldSkuRows.map((row) => row._id.toString()));

    const products = await Product.find({ status: "active" });
    const neverSold: any[] = [];
    for (const product of products) {
      for (const sku of product.skus) {
        if (sku.isActive && !soldSkuIdSet.has((sku._id as Types.ObjectId).toString())) {
          neverSold.push({
            product: product._id,
            name: product.name,
            sku: sku._id,
            skuCode: sku.skuCode,
          });
        }
      }
    }

    // Return report
    res.status(200).json({
      success: true,
      data: {
        bestSellers,
        slowMovers,
        neverSold,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getPaymentReport()`
**Purpose:** Payment breakdown by method and status for a range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Aggregate Payment grouped by method (completed only) and by status
**Response:** Method split, status split, totals

**Controller Implementation:**
```typescript
export const getPaymentReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const match: any = { createdAt: { $gte: startDate, $lte: endDate } };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const byMethod = await Payment.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$method", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]);

    const byStatus = await Payment.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]);

    const grandTotal = byMethod.reduce((sum, row) => sum + row.totalAmount, 0);
    const reversedRow = byStatus.find((row) => row._id === "reversed");
    const failedRow = byStatus.find((row) => row._id === "failed");

    // Return report
    res.status(200).json({
      success: true,
      data: {
        byMethod,
        byStatus,
        grandTotal,
        totalReversed: reversedRow?.totalAmount || 0,
        totalFailed: failedRow?.totalAmount || 0,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getInventoryReport()`
**Purpose:** Stock levels and stock value across the active catalog
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Walk active SKUs, sum currentStock (branch-scoped or all-branch), flag low stock
**Response:** Per-SKU stock rows, total stock value, low-stock count

**Controller Implementation:**
```typescript
export const getInventoryReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch } = req.query;

    const products = await Product.find({ status: "active" });

    const items: any[] = [];
    let totalStockValue = 0;
    let lowStockCount = 0;

    for (const product of products) {
      for (const sku of product.skus) {
        if (!sku.isActive) {
          continue;
        }

        let currentStock = 0;
        let minimumStock = 0;
        if (branch) {
          const branchStock = sku.stockByBranch.find((s: any) => s.branch.toString() === branch);
          currentStock = branchStock?.currentStock || 0;
          minimumStock = branchStock?.minimumStock || 0;
        } else {
          currentStock = sku.stockByBranch.reduce((sum: number, s: any) => sum + s.currentStock, 0);
          minimumStock = sku.stockByBranch.reduce((sum: number, s: any) => sum + s.minimumStock, 0);
        }

        const stockValue = currentStock * sku.buyingPrice;
        totalStockValue += stockValue;
        const lowStock = currentStock <= minimumStock;
        if (lowStock) {
          lowStockCount += 1;
        }

        items.push({
          product: product._id,
          productName: product.name,
          sku: sku._id,
          skuCode: sku.skuCode,
          currentStock,
          minimumStock,
          buyingPrice: sku.buyingPrice,
          stockValue,
          lowStock,
        });
      }
    }

    // Return report
    res.status(200).json({
      success: true,
      data: {
        items,
        totalStockValue,
        lowStockCount,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getProfitReport()`
**Purpose:** `Net Profit = Revenue − Cost of Goods − Expenses` for a range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Combine reportingService's revenue/COGS/expense helpers
**Response:** Revenue, COGS, expenses, gross and net profit

**Controller Implementation:**
```typescript
export const getProfitReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const revenue = await getRevenueBreakdown({ branch: branch as string, startDate, endDate });
    const cogs = await getCostOfGoodsSold({ branch: branch as string, startDate, endDate });
    const expenses = await getApprovedExpenseTotal({ branch: branch as string, startDate, endDate });

    const grossProfit = revenue.totalRevenue - cogs;
    const netProfit = grossProfit - expenses;

    // Return report
    res.status(200).json({
      success: true,
      data: {
        range: range || "today",
        branch: branch || null,
        revenue: revenue.totalRevenue,
        cogs,
        expenses,
        grossProfit,
        netProfit,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getEmployeeReport()`
**Purpose:** Per-staff sales, cancellations, discounts, and shift performance
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Group Tab by openedBy and Shift by staff, merge by user
**Response:** Per-employee activity rows

**Controller Implementation:**
```typescript
export const getEmployeeReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const branchFilter = branch ? { branch: new Types.ObjectId(branch as string) } : {};

    const tabStats = await Tab.aggregate([
      {
        $match: {
          ...branchFilter,
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $in: ["completed", "cancelled"] },
        },
      },
      {
        $group: {
          _id: "$openedBy",
          tabsCompleted: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          tabsCancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          salesTotal: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$grandTotal", 0] } },
          discountsGiven: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$discountTotal", 0] } },
        },
      },
    ]);

    const shiftStats = await Shift.aggregate([
      {
        $match: {
          ...branchFilter,
          startedAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$staff",
          shiftsWorked: { $sum: 1 },
          totalShiftSales: { $sum: "$salesSummary.totalSales" },
          avgVariance: { $avg: "$closingCash.variance" },
        },
      },
    ]);

    const shiftStatsByUser = new Map(shiftStats.map((row) => [row._id.toString(), row]));
    const userIds = Array.from(
      new Set([...tabStats.map((row) => row._id.toString()), ...shiftStats.map((row) => row._id.toString())])
    );

    const users = await User.find({ _id: { $in: userIds } }, "firstName lastName");
    const usersById = new Map(users.map((u) => [(u._id as Types.ObjectId).toString(), u]));

    const employees = userIds.map((userId) => {
      const tabRow = tabStats.find((row) => row._id.toString() === userId);
      const shiftRow = shiftStatsByUser.get(userId);
      const user = usersById.get(userId);

      return {
        user: user ? { _id: user._id, firstName: user.firstName, lastName: user.lastName } : userId,
        tabsCompleted: tabRow?.tabsCompleted || 0,
        tabsCancelled: tabRow?.tabsCancelled || 0,
        salesTotal: tabRow?.salesTotal || 0,
        discountsGiven: tabRow?.discountsGiven || 0,
        shiftsWorked: shiftRow?.shiftsWorked || 0,
        totalShiftSales: shiftRow?.totalShiftSales || 0,
        avgVariance: shiftRow?.avgVariance || 0,
      };
    });

    // Return report
    res.status(200).json({
      success: true,
      data: { employees },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getSupplierReport()`
**Purpose:** Purchase spend per supplier for a range
**Access:** Manager, Admin, Accountant
**Validation:** None required
**Process:** Aggregate Purchase (excluding cancelled) grouped by supplier
**Response:** Per-supplier order count and spend

**Controller Implementation:**
```typescript
export const getSupplierReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { range, branch } = req.query;
    const { startDate, endDate } = resolveDateRange(range as string);

    const match: any = {
      status: { $ne: "cancelled" },
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (branch) {
      match.branch = new Types.ObjectId(branch as string);
    }

    const suppliers = await Purchase.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$supplier",
          totalOrders: { $sum: 1 },
          totalSpend: { $sum: "$totalAmount" },
          averageOrderValue: { $avg: "$totalAmount" },
        },
      },
      {
        $lookup: {
          from: "suppliers",
          localField: "_id",
          foreignField: "_id",
          as: "supplierInfo",
        },
      },
      { $unwind: "$supplierInfo" },
      {
        $project: {
          _id: 0,
          supplier: "$_id",
          companyName: "$supplierInfo.companyName",
          totalOrders: 1,
          totalSpend: 1,
          averageOrderValue: 1,
        },
      },
      { $sort: { totalSpend: -1 } },
    ]);

    // Return report
    res.status(200).json({
      success: true,
      data: { suppliers },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Report Routes

### Base Path: `/api/reports`

```typescript
GET    /sales       // Sales snapshot (manager, admin, accountant)
GET    /products    // Best sellers / slow movers / never sold (manager, admin, accountant)
GET    /payments    // Payment method + status breakdown (manager, admin, accountant)
GET    /inventory   // Stock levels and value (manager, admin, accountant)
GET    /profit      // Net Profit = Revenue - COGS - Expenses (manager, admin, accountant)
GET    /employees   // Per-staff activity (manager, admin, accountant)
GET    /suppliers   // Per-supplier spend (manager, admin, accountant)
```

### Router Implementation

**File: `src/routes/reportRoutes.ts`**

```typescript
import express from "express";
import {
  getSalesReport,
  getProductReport,
  getPaymentReport,
  getInventoryReport,
  getProfitReport,
  getEmployeeReport,
  getSupplierReport,
} from "../controllers/reportController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const REPORT_ROLES: UserRole[] = ["manager", "admin", "accountant"];

router.get("/sales", authenticateToken, authorizeRoles(REPORT_ROLES), getSalesReport);
router.get("/products", authenticateToken, authorizeRoles(REPORT_ROLES), getProductReport);
router.get("/payments", authenticateToken, authorizeRoles(REPORT_ROLES), getPaymentReport);
router.get("/inventory", authenticateToken, authorizeRoles(REPORT_ROLES), getInventoryReport);
router.get("/profit", authenticateToken, authorizeRoles(REPORT_ROLES), getProfitReport);
router.get("/employees", authenticateToken, authorizeRoles(REPORT_ROLES), getEmployeeReport);
router.get("/suppliers", authenticateToken, authorizeRoles(REPORT_ROLES), getSupplierReport);

export default router;
```

### Route Details

#### `GET /api/reports/sales`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=weekly`, `branch=<branchId>`
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "weekly",
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "totalRevenue": 184500,
    "byMethod": {
      "cash": 96500,
      "mpesa": 88000
    },
    "totalTabs": 142,
    "averageTabValue": 1299.3,
    "totalDiscount": 4200,
    "totalTax": 14760
  }
}
```

#### `GET /api/reports/products`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=monthly`, `limit=5`
**Response:**
```json
{
  "success": true,
  "data": {
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 412,
        "revenue": 103000
      }
    ],
    "slowMovers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5b1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5b2",
        "name": "Imported Whisky 250ml",
        "quantitySold": 2,
        "revenue": 5000
      }
    ],
    "neverSold": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5c1",
        "name": "Seasonal Cocktail Mixer",
        "sku": "64f1a2b3c4d5e6f7a8b9c5c2",
        "skuCode": "SEASONAL-COCKTAIL-MIXER-DEFAULT"
      }
    ]
  }
}
```

#### `GET /api/reports/payments`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=weekly`
**Response:**
```json
{
  "success": true,
  "data": {
    "byMethod": [
      {
        "_id": "cash",
        "count": 88,
        "totalAmount": 96500
      },
      {
        "_id": "mpesa",
        "count": 66,
        "totalAmount": 88000
      }
    ],
    "byStatus": [
      {
        "_id": "completed",
        "count": 154,
        "totalAmount": 184500
      },
      {
        "_id": "reversed",
        "count": 3,
        "totalAmount": 3200
      },
      {
        "_id": "failed",
        "count": 5,
        "totalAmount": 4100
      }
    ],
    "grandTotal": 184500,
    "totalReversed": 3200,
    "totalFailed": 4100
  }
}
```

#### `GET /api/reports/inventory`
**Headers:** `Authorization: Bearer <token>`
**Query:** `branch=64f1a2b3c4d5e6f7a8b9c0d3`
**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "productName": "Tusker Lager",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "skuCode": "TUSKER-LAGER-DEFAULT",
        "currentStock": 240,
        "minimumStock": 48,
        "buyingPrice": 150,
        "stockValue": 36000,
        "lowStock": false
      },
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5b1",
        "productName": "Imported Whisky 250ml",
        "sku": "64f1a2b3c4d5e6f7a8b9c5b2",
        "skuCode": "IMPORTED-WHISKY-250ML-DEFAULT",
        "currentStock": 4,
        "minimumStock": 6,
        "buyingPrice": 1800,
        "stockValue": 7200,
        "lowStock": true
      }
    ],
    "totalStockValue": 43200,
    "lowStockCount": 1
  }
}
```

#### `GET /api/reports/profit`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=monthly`
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "monthly",
    "branch": null,
    "revenue": 742000,
    "cogs": 298000,
    "expenses": 86500,
    "grossProfit": 444000,
    "netProfit": 357500
  }
}
```

#### `GET /api/reports/employees`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=weekly`
**Response:**
```json
{
  "success": true,
  "data": {
    "employees": [
      {
        "user": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "tabsCompleted": 58,
        "tabsCancelled": 2,
        "salesTotal": 71200,
        "discountsGiven": 1800,
        "shiftsWorked": 5,
        "totalShiftSales": 71200,
        "avgVariance": -50
      }
    ]
  }
}
```

#### `GET /api/reports/suppliers`
**Headers:** `Authorization: Bearer <token>`
**Query:** `range=monthly`
**Response:**
```json
{
  "success": true,
  "data": {
    "suppliers": [
      {
        "supplier": "64f1a2b3c4d5e6f7a8b9c6a1",
        "companyName": "Nairobi Beverage Distributors",
        "totalOrders": 14,
        "totalSpend": 412000,
        "averageOrderValue": 29428.57
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
router.get("/profit", authenticateToken, getProfitReport);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get("/profit", authenticateToken, authorizeRoles(["manager", "admin", "accountant"]), getProfitReport);
```
Every Report route uses the same `REPORT_ROLES` set — none is more restrictive than another, unlike Analytics' `branch-comparison`.

---

## 📝 API Examples

### Weekly Sales Report
```bash
curl -X GET "http://localhost:3500/api/reports/sales?range=weekly" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "weekly",
    "branch": null,
    "totalRevenue": 184500,
    "byMethod": {
      "cash": 96500,
      "mpesa": 88000
    },
    "totalTabs": 142,
    "averageTabValue": 1299.3,
    "totalDiscount": 4200,
    "totalTax": 14760
  }
}
```

### Monthly Profit Report for a Branch
```bash
curl -X GET "http://localhost:3500/api/reports/profit?range=monthly&branch=64f1a2b3c4d5e6f7a8b9c0d3" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "range": "monthly",
    "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
    "revenue": 742000,
    "cogs": 298000,
    "expenses": 86500,
    "grossProfit": 444000,
    "netProfit": 357500
  }
}
```

### Product Report, Top 5
```bash
curl -X GET "http://localhost:3500/api/reports/products?range=monthly&limit=5" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "bestSellers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "name": "Tusker Lager",
        "quantitySold": 412,
        "revenue": 103000
      }
    ],
    "slowMovers": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5b1",
        "sku": "64f1a2b3c4d5e6f7a8b9c5b2",
        "name": "Imported Whisky 250ml",
        "quantitySold": 2,
        "revenue": 5000
      }
    ],
    "neverSold": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5c1",
        "name": "Seasonal Cocktail Mixer",
        "sku": "64f1a2b3c4d5e6f7a8b9c5c2",
        "skuCode": "SEASONAL-COCKTAIL-MIXER-DEFAULT"
      }
    ]
  }
}
```

### Current Inventory Snapshot
```bash
curl -X GET "http://localhost:3500/api/reports/inventory" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "product": "64f1a2b3c4d5e6f7a8b9c5a1",
        "productName": "Tusker Lager",
        "sku": "64f1a2b3c4d5e6f7a8b9c5a2",
        "skuCode": "TUSKER-LAGER-DEFAULT",
        "currentStock": 240,
        "minimumStock": 48,
        "buyingPrice": 150,
        "stockValue": 36000,
        "lowStock": false
      }
    ],
    "totalStockValue": 36000,
    "lowStockCount": 0
  }
}
```

### Employee Report
```bash
curl -X GET "http://localhost:3500/api/reports/employees?range=weekly" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "employees": [
      {
        "user": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d8",
          "firstName": "Grace",
          "lastName": "Njeri"
        },
        "tabsCompleted": 58,
        "tabsCancelled": 2,
        "salesTotal": 71200,
        "discountsGiven": 1800,
        "shiftsWorked": 5,
        "totalShiftSales": 71200,
        "avgVariance": -50
      }
    ]
  }
}
```

### Supplier Report
```bash
curl -X GET "http://localhost:3500/api/reports/suppliers?range=monthly" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "suppliers": [
      {
        "supplier": "64f1a2b3c4d5e6f7a8b9c6a1",
        "companyName": "Nairobi Beverage Distributors",
        "totalOrders": 14,
        "totalSpend": 412000,
        "averageOrderValue": 29428.57
      }
    ]
  }
}
```

---

## 🛡️ Security Features

- **RBAC:** Every Report route is limited to `manager`, `admin`, `accountant` — bartender/cashier/store_keeper have no access, since these are financial/operational summaries rather than day-to-day tools.
- **Read-only:** No Report endpoint writes to any collection — there is nothing to reverse, approve, or audit.
- **Branch scoping is opt-in, not enforced:** any authorized role can omit `branch` to see a consolidated multi-branch figure — this module does not restrict a manager to only their own branch's data (see the doc's own wording: "admins can request a consolidated multi-branch view", generalized here to any Report-authorized role).

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role |
| `500` | Unexpected server error (e.g. invalid `branch` ObjectId string) |

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
purchaseSchema.index({ branch: 1 });
purchaseSchema.index({ status: 1 });
expenseSchema.index({ branch: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: 1 });
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
```
See each collection's own module documentation for its full index list.

---

**Last Updated:** 2026-08-14
**Version:** 1.0.0
**Maintainer:** POS API Development Team
