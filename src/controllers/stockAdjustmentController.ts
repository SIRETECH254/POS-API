import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockAdjustment from "../models/StockAdjustment";
import Product from "../models/Product";
import { recordStockMovement } from "../services/internal/stockMovementService";

/**
 * Create stock adjustment
 * Purpose: Record a manual correction to branch stock (breakage, theft, expiry, count correction, other)
 * Access: Store Keeper, Manager, Admin
 * Validation: Branch, product, sku, quantityChange, reason required; notes required when reason is 'other'
 * Process: Create the adjustment record; positive changes apply immediately, negative changes stay pending approval
 * Response: Created stock adjustment
 */
export const createStockAdjustment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, product, sku, quantityChange, reason, notes } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!product) {
      return next(errorHandler(400, "Product is required"));
    }
    if (!sku) {
      return next(errorHandler(400, "SKU is required"));
    }
    if (quantityChange === undefined || quantityChange === null) {
      return next(errorHandler(400, "Quantity change is required"));
    }
    if (quantityChange === 0) {
      return next(errorHandler(400, "Quantity change cannot be zero"));
    }
    if (!reason) {
      return next(errorHandler(400, "Reason is required"));
    }
    if (reason === "other" && !notes) {
      return next(errorHandler(400, "Notes are required when reason is 'other'"));
    }

    // Guard — product must exist
    const productDoc = await Product.findById(product);
    if (!productDoc) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — SKU must exist on the product
    const skuDoc = productDoc.skus.id(sku);
    if (!skuDoc) {
      return next(errorHandler(404, "SKU not found on product"));
    }

    // Create the adjustment record
    const adjustment = await StockAdjustment.create({
      branch,
      product,
      sku,
      quantityChange,
      reason,
      notes,
      adjustedBy: req.user?._id,
    });

    // Positive adjustments apply immediately; negative ones stay pending manager approval
    if (quantityChange > 0) {
      await recordStockMovement({
        branch,
        product,
        sku,
        type: "adjusted",
        quantity: quantityChange,
        reference: { refType: "StockAdjustment", refId: adjustment._id as any },
        performedBy: req.user?._id as any,
      });

      adjustment.appliedAt = new Date();
      await adjustment.save();
    }

    // Return created adjustment
    res.status(201).json({
      success: true,
      message: quantityChange > 0 ? "Stock adjustment applied successfully" : "Stock adjustment created and pending approval",
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Approve stock adjustment
 * Purpose: Approve a pending negative stock adjustment and apply it to branch stock
 * Access: Manager, Admin
 * Validation: Adjustment must exist, must be negative, must not already be applied
 * Process: Record the stock movement, mark the adjustment as approved and applied
 * Response: Updated stock adjustment
 */
export const approveStockAdjustment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find adjustment
    const adjustment = await StockAdjustment.findById(req.params.stockAdjustmentId);

    // Guard — adjustment must exist
    if (!adjustment) {
      return next(errorHandler(404, "Stock adjustment not found"));
    }

    // Guard — only negative adjustments require approval
    if (adjustment.quantityChange >= 0) {
      return next(errorHandler(409, "This adjustment does not require approval"));
    }

    // Guard — must not already be applied
    if (adjustment.appliedAt) {
      return next(errorHandler(409, "Adjustment already applied"));
    }

    // Record the stock movement
    await recordStockMovement({
      branch: adjustment.branch as any,
      product: adjustment.product as any,
      sku: adjustment.sku,
      type: "adjusted",
      quantity: adjustment.quantityChange,
      reference: { refType: "StockAdjustment", refId: adjustment._id as any },
      performedBy: req.user?._id as any,
    });

    // Mark as approved and applied
    adjustment.approvedBy = req.user?._id as any;
    adjustment.appliedAt = new Date();
    await adjustment.save();

    // Return updated adjustment
    res.status(200).json({
      success: true,
      message: "Stock adjustment approved and applied successfully",
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all stock adjustments
 * Purpose: List stock adjustments with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/sku/reason/pending, paginate, return results
 * Response: Stock adjustment list and pagination
 */
export const getAllStockAdjustments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, sku, reason, pending } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (sku) {
      query.sku = sku;
    }
    if (reason) {
      query.reason = reason;
    }
    if (pending === "true") {
      query.appliedAt = { $exists: false };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch adjustments and total count
    const stockAdjustments = await StockAdjustment.find(query)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("adjustedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockAdjustment.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        stockAdjustments,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockAdjustments: total,
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
 * Get stock adjustment by ID
 * Purpose: Fetch a single stock adjustment by ID
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Stock adjustment must exist
 * Process: Find adjustment by ID and return with populated refs
 * Response: Stock adjustment details
 */
export const getStockAdjustmentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find adjustment by ID
    const adjustment = await StockAdjustment.findById(req.params.stockAdjustmentId)
      .populate("branch", "name code")
      .populate("product", "name")
      .populate("adjustedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName");

    // Guard — adjustment must exist
    if (!adjustment) {
      return next(errorHandler(404, "Stock adjustment not found"));
    }

    // Return adjustment
    res.status(200).json({
      success: true,
      data: { adjustment },
    });
  } catch (error: any) {
    next(error);
  }
};
