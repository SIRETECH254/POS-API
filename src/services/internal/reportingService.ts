import { Types } from "mongoose";
import Payment from "../../models/Payment";
import Tab from "../../models/Tab";
import Expense from "../../models/Expense";
import Product from "../../models/Product";

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

interface InventoryRow {
  product: Types.ObjectId;
  productName: string;
  sku: Types.ObjectId;
  skuCode: string;
  currentStock: number;
  minimumStock: number;
  buyingPrice: number;
  stockValue: number;
  lowStock: boolean;
}

/**
 * Walks every active SKU on every active Product, computing branch-scoped
 * (or all-branch-summed) stock figures. Shared by getLowStockItems and
 * getInventorySummary — mirrors reportController.getInventoryReport's own
 * per-SKU loop, kept separate from it since that report needs a full row
 * per item regardless of stock level, not just the low/summary slices these
 * two need.
 */
const getInventoryRows = async (branch?: string | Types.ObjectId): Promise<InventoryRow[]> => {
  const products = await Product.find({ status: "active" });
  const rows: InventoryRow[] = [];

  for (const product of products) {
    for (const sku of product.skus) {
      if (!sku.isActive) {
        continue;
      }

      let currentStock = 0;
      let minimumStock = 0;
      if (branch) {
        const branchStock = sku.stockByBranch.find((s: any) => s.branch.toString() === branch.toString());
        currentStock = branchStock?.currentStock || 0;
        minimumStock = branchStock?.minimumStock || 0;
      } else {
        currentStock = sku.stockByBranch.reduce((sum: number, s: any) => sum + s.currentStock, 0);
        minimumStock = sku.stockByBranch.reduce((sum: number, s: any) => sum + s.minimumStock, 0);
      }

      rows.push({
        product: product._id as Types.ObjectId,
        productName: product.name,
        sku: sku._id as Types.ObjectId,
        skuCode: sku.skuCode,
        currentStock,
        minimumStock,
        buyingPrice: sku.buyingPrice,
        stockValue: currentStock * sku.buyingPrice,
        lowStock: currentStock <= minimumStock,
      });
    }
  }

  return rows;
};

export interface LowStockItem {
  product: Types.ObjectId;
  productName: string;
  sku: Types.ObjectId;
  skuCode: string;
  currentStock: number;
  minimumStock: number;
}

/**
 * Active SKUs at or below their branch minimum. Used by the Dashboard
 * module's low-stock widget.
 */
export const getLowStockItems = async ({
  branch,
  limit = 10,
}: {
  branch?: string | Types.ObjectId;
  limit?: number;
}): Promise<{ items: LowStockItem[]; count: number }> => {
  const rows = await getInventoryRows(branch);
  const low = rows.filter((row) => row.lowStock);

  return {
    items: low.slice(0, limit).map((row) => ({
      product: row.product,
      productName: row.productName,
      sku: row.sku,
      skuCode: row.skuCode,
      currentStock: row.currentStock,
      minimumStock: row.minimumStock,
    })),
    count: low.length,
  };
};

/**
 * Total stock value and low-stock count across the active catalog. Used by
 * the Dashboard module's manager view.
 */
export const getInventorySummary = async (
  branch?: string | Types.ObjectId
): Promise<{ totalStockValue: number; lowStockCount: number }> => {
  const rows = await getInventoryRows(branch);

  return {
    totalStockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
    lowStockCount: rows.filter((row) => row.lowStock).length,
  };
};
