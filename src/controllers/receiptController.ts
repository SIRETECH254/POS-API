import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Receipt from "../models/Receipt";
import Tab from "../models/Tab";
import {
  printReceipt as printReceiptService,
  reprintReceipt as reprintReceiptService,
  generateRefundReceipt as generateRefundReceiptService,
} from "../services/internal/receiptService";

/**
 * Get tab receipts
 * Purpose: List every receipt (sale, refund, reprint) issued for a tab, filtered and paginated
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: Tab must exist
 * Process: Find receipts by tab, optionally filtered by type/search, paginate, return results
 * Response: Receipt list and pagination
 */
export const getTabReceipts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);

    // Guard — tab must exist
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Extract query parameters
    const { page = 1, limit = 10, type, search } = req.query;

    // Build filter query
    const query: any = { tab: tab._id };
    if (type) {
      query.type = type;
    }
    if (search) {
      query.receiptNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch receipts and total count
    const receipts = await Receipt.find(query)
      .populate("generatedBy", "firstName lastName")
      .populate("printedBy", "firstName lastName")
      .sort({ createdAt: 1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Receipt.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        receipts,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalReceipts: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get receipt by ID
 * Purpose: Fetch a single receipt with full details
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: Receipt must exist
 * Process: Find receipt by ID and return with populated refs
 * Response: Receipt details
 */
export const getReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find receipt by ID
    const receipt = await Receipt.findById(req.params.receiptId)
      .populate("tab", "tabNumber status")
      .populate("branch", "name code")
      .populate("payment", "paymentNumber method")
      .populate("generatedBy", "firstName lastName")
      .populate("printedBy", "firstName lastName");

    // Guard — receipt must exist
    if (!receipt) {
      return next(errorHandler(404, "Receipt not found"));
    }

    // Return receipt
    res.status(200).json({
      success: true,
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Print receipt
 * Purpose: Mark a tab's sale receipt as printed
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: A sale receipt must exist for the tab
 * Process: Delegates to receiptService.printReceipt
 * Response: Updated receipt with printedAt/printedBy
 */
export const printReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Mark receipt printed
    const receipt = await printReceiptService(req.params.tabId as string, req.user?._id as any);

    // Return receipt
    res.status(200).json({
      success: true,
      message: "Receipt marked as printed",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Reprint receipt
 * Purpose: Issue a new receipt record for a tab that already has a sale receipt
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: A sale receipt must exist for the tab
 * Process: Delegates to receiptService.reprintReceipt — reuses the original PDF
 * Response: New reprint receipt record
 */
export const reprintReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Create reprint record
    const receipt = await reprintReceiptService(req.params.tabId as string, req.user?._id as any);

    // Return receipt
    res.status(201).json({
      success: true,
      message: "Receipt reprinted",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Generate refund receipt
 * Purpose: Issue a refund receipt for a tab
 * Access: Manager, Admin
 * Validation: amount and reason are required
 * Process: Delegates to receiptService.generateRefundReceipt
 * Response: New refund receipt record
 */
export const generateRefundReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { amount, reason } = req.body;

    if (!amount) {
      return next(errorHandler(400, "amount is required"));
    }
    if (!reason) {
      return next(errorHandler(400, "reason is required"));
    }

    // Create refund receipt
    const receipt = await generateRefundReceiptService(req.params.tabId as string, req.user?._id as any, {
      amount,
      reason,
    });

    // Return receipt
    res.status(201).json({
      success: true,
      message: "Refund receipt generated",
      data: { receipt },
    });
  } catch (error: any) {
    next(error);
  }
};
