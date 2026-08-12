import { Types } from "mongoose";
import Payment from "../../models/Payment";
import Tab from "../../models/Tab";
import Expense from "../../models/Expense";

export type ReportRange = "today" | "yesterday" | "weekly" | "monthly" | "yearly";

interface DateBranchFilter {
  branch?: string | Types.ObjectId;
  startDate: Date;
  endDate: Date;
}

/**
 * Resolves a named range into concrete start/end Dates. Every other range
 * ends at "now"; "yesterday" is the only one with a fixed end boundary
 * (the start of today), since "now" would bleed into today's figures.
 */
export const resolveDateRange = (range?: string): { startDate: Date; endDate: Date } => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === "yesterday") {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfToday.getDate() - 1);
    return { startDate: startOfYesterday, endDate: startOfToday };
  }

  if (range === "weekly") {
    const startDate = new Date(startOfToday);
    startDate.setDate(startOfToday.getDate() - 7);
    return { startDate, endDate: now };
  }

  if (range === "monthly") {
    const startDate = new Date(startOfToday);
    startDate.setMonth(startOfToday.getMonth() - 1);
    return { startDate, endDate: now };
  }

  if (range === "yearly") {
    const startDate = new Date(startOfToday);
    startDate.setFullYear(startOfToday.getFullYear() - 1);
    return { startDate, endDate: now };
  }

  // Default: today
  return { startDate: startOfToday, endDate: now };
};

/**
 * Revenue is sourced from Payment (the authoritative "money received"
 * record — see paymentService.applySuccessfulPayment), never from Tab
 * totals, and grouped by method for the cash/mpesa split every report
 * that touches money needs.
 */
export const getRevenueBreakdown = async ({
  branch,
  startDate,
  endDate,
}: DateBranchFilter): Promise<{
  totalRevenue: number;
  cashSales: number;
  mpesaSales: number;
  paymentCount: number;
}> => {
  const match: any = {
    status: "completed",
    createdAt: { $gte: startDate, $lte: endDate },
  };
  if (branch) {
    match.branch = new Types.ObjectId(branch);
  }

  const rows = await Payment.aggregate([
    { $match: match },
    { $group: { _id: "$method", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  const result = { totalRevenue: 0, cashSales: 0, mpesaSales: 0, paymentCount: 0 };
  for (const row of rows) {
    result.totalRevenue += row.total;
    result.paymentCount += row.count;
    if (row._id === "cash") {
      result.cashSales = row.total;
    }
    if (row._id === "mpesa") {
      result.mpesaSales = row.total;
    }
  }

  return result;
};

/**
 * Cost of goods sold: active line items on completed tabs, joined against
 * the selling product's SKU subdocument for buyingPrice (SKUs live embedded
 * on Product, not in their own collection — see src/models/Product.ts).
 */
export const getCostOfGoodsSold = async ({ branch, startDate, endDate }: DateBranchFilter): Promise<number> => {
  const match: any = {
    status: "completed",
    closedAt: { $gte: startDate, $lte: endDate },
  };
  if (branch) {
    match.branch = new Types.ObjectId(branch);
  }

  const rows = await Tab.aggregate([
    { $match: match },
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
        _id: null,
        cogs: { $sum: { $multiply: ["$items.quantity", { $ifNull: ["$skuInfo.buyingPrice", 0] }] } },
      },
    },
  ]);

  return rows[0]?.cogs || 0;
};

/**
 * Only approved expenses count toward reporting — matches the Expense
 * module's rule that a pending expense hasn't been vetted yet.
 */
export const getApprovedExpenseTotal = async ({ branch, startDate, endDate }: DateBranchFilter): Promise<number> => {
  const match: any = {
    status: "approved",
    expenseDate: { $gte: startDate, $lte: endDate },
  };
  if (branch) {
    match.branch = new Types.ObjectId(branch);
  }

  const rows = await Expense.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$amount" } } }]);

  return rows[0]?.total || 0;
};

export interface BestSellingProduct {
  product: Types.ObjectId;
  sku: Types.ObjectId;
  name: string;
  quantitySold: number;
  revenue: number;
}

/**
 * Ranks products by quantity sold across completed tabs in the window.
 * Shared by reportController.getProductReport (desc for best sellers, asc
 * for slow movers) and analyticsController.getTopProducts, so the ranking
 * logic only lives in one place.
 */
export const getBestSellingProducts = async ({
  branch,
  startDate,
  endDate,
  limit = 10,
  sort = "desc",
}: DateBranchFilter & { limit?: number; sort?: "desc" | "asc" }): Promise<BestSellingProduct[]> => {
  const match: any = {
    status: "completed",
    closedAt: { $gte: startDate, $lte: endDate },
  };
  if (branch) {
    match.branch = new Types.ObjectId(branch);
  }

  const rows = await Tab.aggregate([
    { $match: match },
    { $unwind: "$items" },
    { $match: { "items.status": "active" } },
    {
      $group: {
        _id: { product: "$items.product", sku: "$items.sku" },
        name: { $first: "$items.name" },
        quantitySold: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.subtotal" },
      },
    },
    { $sort: { quantitySold: sort === "desc" ? -1 : 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        product: "$_id.product",
        sku: "$_id.sku",
        name: 1,
        quantitySold: 1,
        revenue: 1,
      },
    },
  ]);

  return rows;
};
