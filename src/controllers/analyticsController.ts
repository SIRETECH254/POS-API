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

/**
 * Get sales trend
 * Purpose: Daily-bucketed revenue series for dashboards
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Bucket completed Payments by day over the window, zero-fill gaps
 * Response: Array of { date, totalSales, paymentCount }
 */
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

/**
 * Get profit trend
 * Purpose: Daily-bucketed net profit series (revenue − COGS − expenses)
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Bucket revenue, COGS, and approved expenses by day, merge, zero-fill gaps
 * Response: Array of { date, revenue, cogs, expenses, netProfit }
 */
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

/**
 * Get peak hours
 * Purpose: Tab volume and revenue by hour of day
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Group completed Tabs by hour-of-day on closedAt
 * Response: Array of 24 { hour, tabCount, totalSales } rows
 */
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

/**
 * Get top products
 * Purpose: Ranked best-selling products for a range
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Delegates to reportingService.getBestSellingProducts (desc)
 * Response: Ranked product list
 */
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

/**
 * Get payment distribution
 * Purpose: Share of revenue by payment method
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Group completed Payments by method, compute percentage share
 * Response: Per-method count/amount/percentage
 */
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

/**
 * Get inventory value trend
 * Purpose: Daily inventory value movement, derived from the StockMovement ledger
 * Access: Manager, Admin, Accountant
 * Validation: None required
 * Process: Bucket signed StockMovement.quantity × SKU.buyingPrice by day, run a cumulative sum
 * Response: Array of { date, valueChange, cumulativeValue } — cumulativeValue is relative to the
 *           start of the window, not an absolute stock valuation (no baseline snapshot exists)
 */
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

/**
 * Get branch comparison
 * Purpose: Side-by-side revenue/COGS/expenses/profit across branches
 * Access: Admin only
 * Validation: None required
 * Process: Run reportingService's revenue/COGS/expense helpers per active branch
 * Response: One row per branch, sorted by revenue descending
 */
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
