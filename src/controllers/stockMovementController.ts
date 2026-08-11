import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockMovement from "../models/StockMovement";

/**
 * Get all stock movements
 * Purpose: List the stock movement ledger with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/product/sku/type/date range, paginate, return results
 * Response: Stock movement list and pagination
 */
export const getAllStockMovements = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, product, sku, type, dateFrom, dateTo } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (product) {
      query.product = product;
    }
    if (sku) {
      query.sku = sku;
    }
    if (type) {
      query.type = type;
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = new Date(dateFrom as string);
      }
      if (dateTo) {
        query.createdAt.$lte = new Date(dateTo as string);
      }
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch stock movements and total count
    const stockMovements = await StockMovement.find(query)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("performedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockMovement.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        stockMovements,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockMovements: total,
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
 * Get stock movement by ID
 * Purpose: Fetch a single stock movement ledger entry
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Stock movement must exist
 * Process: Find stock movement by ID and return
 * Response: Stock movement details
 */
export const getStockMovementById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find stock movement by ID
    const stockMovement = await StockMovement.findById(req.params.stockMovementId)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("performedBy", "firstName lastName");

    // Guard — stock movement must exist
    if (!stockMovement) {
      return next(errorHandler(404, "Stock movement not found"));
    }

    // Return stock movement
    res.status(200).json({
      success: true,
      data: { stockMovement },
    });
  } catch (error: any) {
    next(error);
  }
};
