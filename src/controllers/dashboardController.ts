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

/**
 * Get bartender dashboard
 * Purpose: At-a-glance view for front-of-house staff — open tabs, today's sales, low stock, pending mpesa
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: Caller must have a branch assigned
 * Process: Run open-tab lookup, today's revenue, low-stock, and pending-mpesa queries in parallel, all scoped to the caller's own branch
 * Response: Combined dashboard payload
 */
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

/**
 * Get manager dashboard
 * Purpose: At-a-glance view for management — revenue, profit, stock value, best sellers, open tabs, staff online
 * Access: Manager, Admin
 * Validation: None required
 * Process: Resolve branch scope (manager: always their own branch; admin: optional ?branch= query, omitted = consolidated across all branches), run every widget's query in parallel over today's date window
 * Response: Combined dashboard payload
 */
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
