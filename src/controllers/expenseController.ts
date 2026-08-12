import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary";
import Expense from "../models/Expense";

/**
 * Create expense
 * Purpose: Record a new operational expense against a branch
 * Access: Store Keeper, Manager, Admin
 * Validation: branch, category, description, amount, paymentMethod, expenseDate are required
 * Process: Upload receipt to Cloudinary if provided, create expense as pending
 * Response: Created expense
 */
export const createExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, category, description, amount, paymentMethod, expenseDate } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "branch is required"));
    }
    if (!category) {
      return next(errorHandler(400, "category is required"));
    }
    if (!description) {
      return next(errorHandler(400, "description is required"));
    }
    if (!amount) {
      return next(errorHandler(400, "amount is required"));
    }
    if (!paymentMethod) {
      return next(errorHandler(400, "paymentMethod is required"));
    }
    if (!expenseDate) {
      return next(errorHandler(400, "expenseDate is required"));
    }

    // Upload receipt to Cloudinary if provided
    let receiptUrl: string | undefined;
    let receiptPublicId: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/expense-receipts");
      receiptUrl = uploadResult.url;
      receiptPublicId = uploadResult.public_id;
    }

    // Create expense
    const expense = await Expense.create({
      branch,
      category,
      description,
      amount,
      paymentMethod,
      expenseDate,
      receiptUrl,
      receiptPublicId,
      status: "pending",
      recordedBy: req.user?._id,
    });

    // Return created expense
    res.status(201).json({
      success: true,
      message: "Expense recorded successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all expenses
 * Purpose: List all expenses with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/category/status/paymentMethod/search, paginate, return results
 * Response: Expense list and pagination
 */
export const getAllExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, category, status, paymentMethod, search } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (category) {
      query.category = category;
    }
    if (status) {
      query.status = status;
    }
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }
    if (search) {
      query.description = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch expenses and total count
    const expenses = await Expense.find(query)
      .populate("branch", "name code")
      .populate("recordedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName")
      .sort({ expenseDate: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Expense.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        expenses,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalExpenses: total,
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
 * Get expense by ID
 * Purpose: Fetch a single expense record
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Expense must exist
 * Process: Find expense by ID and return with populated refs
 * Response: Expense details
 */
export const getExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense by ID
    const expense = await Expense.findById(req.params.expenseId)
      .populate("branch", "name code")
      .populate("recordedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName");

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Return expense
    res.status(200).json({
      success: true,
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update expense
 * Purpose: Update an expense record by ID
 * Access: Store Keeper, Manager, Admin
 * Validation: Expense must exist; approved expenses cannot be updated
 * Process: Apply field updates, replace receipt if a new file is provided
 * Response: Updated expense
 */
export const updateExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { category, description, amount, paymentMethod, expenseDate } = req.body;

    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — approved expenses are immutable
    if (expense.status === "approved") {
      return next(errorHandler(409, "An approved expense cannot be updated"));
    }

    // Apply updates
    if (category) {
      expense.category = category;
    }
    if (description) {
      expense.description = description;
    }
    if (amount) {
      expense.amount = amount;
    }
    if (paymentMethod) {
      expense.paymentMethod = paymentMethod;
    }
    if (expenseDate) {
      expense.expenseDate = expenseDate;
    }

    // Handle receipt replacement
    if (req.file) {
      if (expense.receiptPublicId) {
        try {
          await deleteFromCloudinary(expense.receiptPublicId);
        } catch (deleteError) {
          console.error("Failed to delete previous expense receipt:", deleteError);
        }
      }
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/expense-receipts");
      expense.receiptUrl = uploadResult.url;
      expense.receiptPublicId = uploadResult.public_id;
    }

    // Save and return
    await expense.save();
    res.status(200).json({
      success: true,
      message: "Expense updated successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete expense
 * Purpose: Delete an expense record by ID
 * Access: Admin
 * Validation: Expense must exist; approved expenses cannot be deleted
 * Process: Delete receipt from Cloudinary if present, delete record
 * Response: Success message
 */
export const deleteExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — approved expenses cannot be deleted
    if (expense.status === "approved") {
      return next(errorHandler(409, "An approved expense cannot be deleted"));
    }

    // Delete receipt from Cloudinary if present
    if (expense.receiptPublicId) {
      try {
        await deleteFromCloudinary(expense.receiptPublicId);
      } catch (deleteError) {
        console.error("Failed to delete expense receipt from Cloudinary:", deleteError);
      }
    }

    // Delete expense record
    await expense.deleteOne();

    // Return success
    res.status(200).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Approve expense
 * Purpose: Approve a pending expense
 * Access: Manager, Admin
 * Validation: Expense must exist and be pending
 * Process: Mark expense approved, stamp approvedBy/approvedAt
 * Response: Approved expense
 */
export const approveExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find expense
    const expense = await Expense.findById(req.params.expenseId);

    // Guard — expense must exist
    if (!expense) {
      return next(errorHandler(404, "Expense not found"));
    }

    // Guard — only a pending expense can be approved
    if (expense.status !== "pending") {
      return next(errorHandler(409, "Only a pending expense can be approved"));
    }

    // Mark approved
    expense.status = "approved";
    expense.approvedBy = req.user?._id as any;
    expense.approvedAt = new Date();
    await expense.save();

    // Return approved expense
    res.status(200).json({
      success: true,
      message: "Expense approved successfully",
      data: { expense },
    });
  } catch (error: any) {
    next(error);
  }
};
