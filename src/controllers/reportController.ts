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

/**
 * Get sales report
 * Purpose: Snapshot revenue/tab figures for a named range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Resolve range, aggregate revenue by method and tab-level totals
 * Response: Revenue, method split, tab stats
 */
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

/**
 * Get product report
 * Purpose: Best sellers, slow movers, and never-sold products for a range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Rank sold items via reportingService, diff against the active catalog for never-sold
 * Response: Best sellers, slow movers, never sold
 */
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

/**
 * Get payment report
 * Purpose: Payment breakdown by method and status for a range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Aggregate Payment grouped by method (completed only) and by status
 * Response: Method split, status split, totals
 */
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

/**
 * Get inventory report
 * Purpose: Stock levels and stock value across the active catalog
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Walk active SKUs, sum currentStock (branch-scoped or all-branch), flag low stock
 * Response: Per-SKU stock rows, total stock value, low-stock count
 */
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

/**
 * Get profit report
 * Purpose: Net Profit = Revenue − Cost of Goods − Expenses for a range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Combine reportingService's revenue/COGS/expense helpers
 * Response: Revenue, COGS, expenses, gross and net profit
 */
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

/**
 * Get employee report
 * Purpose: Per-staff sales, cancellations, discounts, and shift performance
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Group Tab by openedBy and Shift by staff, merge by user
 * Response: Per-employee activity rows
 */
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

/**
 * Get supplier report
 * Purpose: Purchase spend per supplier for a range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Aggregate Purchase (excluding cancelled) grouped by supplier
 * Response: Per-supplier order count and spend
 */
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
