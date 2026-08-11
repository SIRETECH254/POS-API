import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import StockCount from "../models/StockCount";
import StockAdjustment from "../models/StockAdjustment";
import Branch from "../models/Branch";
import Product from "../models/Product";
import { generateStockCountNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";

/**
 * Start stock count
 * Purpose: Begin a stock-take for a branch, snapshotting expected quantities for the listed SKUs
 * Access: Store Keeper, Manager, Admin
 * Validation: Branch and items required; each item's product/SKU must exist with initialized branch stock
 * Process: Snapshot expectedQuantity per item, generate count number, create stock count
 * Response: Created stock count
 */
export const startStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, items } = req.body;

    // Guard — branch and items required
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Validate each item and snapshot expected quantity
    const preparedItems: any[] = [];

    for (const item of items) {
      const { product, sku } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }

      // Guard — product must exist
      const productDoc = await Product.findById(product);
      if (!productDoc) {
        return next(errorHandler(404, `Product not found: ${product}`));
      }

      // Guard — SKU must exist on the product
      const skuDoc = productDoc.skus.id(sku);
      if (!skuDoc) {
        return next(errorHandler(404, `SKU not found on product: ${sku}`));
      }

      // Guard — branch stock must already be initialized for this SKU
      const branchEntry = (skuDoc.stockByBranch as any[]).find(
        (entry: any) => entry.branch.toString() === branch.toString()
      );
      if (!branchEntry) {
        return next(errorHandler(400, `Stock not initialized for this branch/SKU: ${sku}`));
      }

      preparedItems.push({
        product,
        sku,
        expectedQuantity: branchEntry.currentStock,
        actualQuantity: 0,
        variance: 0 - branchEntry.currentStock,
      });
    }

    // Generate count number
    const countNumber = await generateStockCountNumber(branchDoc.code, String(branchDoc._id));

    // Create stock count
    const stockCount = await StockCount.create({
      branch,
      countNumber,
      items: preparedItems,
      status: "in_progress",
      countedBy: req.user?._id,
    });

    // Return created stock count
    res.status(201).json({
      success: true,
      message: "Stock count started successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Submit stock count
 * Purpose: Record physically counted quantities for every item on an in-progress stock count
 * Access: Store Keeper, Manager, Admin
 * Validation: Stock count must exist and be in 'in_progress' status; every item must be covered
 * Process: Apply actualQuantity per item, recompute variance, mark as completed
 * Response: Updated stock count
 */
export const submitStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { items } = req.body;

    // Guard — items required
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one counted item is required"));
    }

    // Find stock count
    const stockCount = await StockCount.findById(req.params.stockCountId);

    // Guard — stock count must exist
    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    // Guard — must still be in progress
    if (stockCount.status !== "in_progress") {
      return next(errorHandler(409, "Stock count is not in progress"));
    }

    // Guard — every item on the count must be covered
    if (items.length !== stockCount.items.length) {
      return next(errorHandler(400, "All items must be counted before submitting"));
    }

    // Apply counted quantities
    for (const counted of items) {
      const { sku, actualQuantity } = counted;

      if (!sku) {
        return next(errorHandler(400, "SKU is required for each counted item"));
      }
      if (actualQuantity === undefined || actualQuantity < 0) {
        return next(errorHandler(400, "Actual quantity is required for each counted item"));
      }

      const existingItem = stockCount.items.find((i: any) => i.sku.toString() === sku.toString());
      if (!existingItem) {
        return next(errorHandler(400, `SKU was not part of this stock count: ${sku}`));
      }

      existingItem.actualQuantity = actualQuantity;
      existingItem.variance = actualQuantity - existingItem.expectedQuantity;
    }

    // Mark as completed
    stockCount.status = "completed";
    stockCount.completedAt = new Date();
    await stockCount.save();

    // Return updated stock count
    res.status(200).json({
      success: true,
      message: "Stock count submitted successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Reconcile stock count
 * Purpose: Apply each variance line as a pre-approved stock adjustment, updating branch stock
 * Access: Manager, Admin
 * Validation: Stock count must exist and be in 'completed' status
 * Process: For each non-zero variance, create a StockAdjustment and record a stock movement
 * Response: Updated stock count
 */
export const reconcileStockCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find stock count
    const stockCount = await StockCount.findById(req.params.stockCountId);

    // Guard — stock count must exist
    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    // Guard — must be completed
    if (stockCount.status !== "completed") {
      return next(errorHandler(409, "Stock count must be completed before it can be reconciled"));
    }

    // Apply a pre-approved adjustment per variance line
    for (const item of stockCount.items) {
      if (item.variance === 0) {
        continue;
      }

      const adjustment = await StockAdjustment.create({
        branch: stockCount.branch,
        product: item.product,
        sku: item.sku,
        quantityChange: item.variance,
        reason: "count_correction",
        adjustedBy: stockCount.countedBy,
        approvedBy: req.user?._id,
        appliedAt: new Date(),
        stockCount: stockCount._id,
      });

      await recordStockMovement({
        branch: stockCount.branch as any,
        product: item.product as any,
        sku: item.sku,
        type: "adjusted",
        quantity: item.variance,
        reference: { refType: "StockAdjustment", refId: adjustment._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark as reconciled
    stockCount.status = "reconciled";
    stockCount.reviewedBy = req.user?._id as any;
    await stockCount.save();

    // Return updated stock count
    res.status(200).json({
      success: true,
      message: "Stock count reconciled successfully",
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all stock counts
 * Purpose: List stock counts with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/status, paginate, return results
 * Response: Stock count list and pagination
 */
export const getAllStockCounts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, status } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (status) {
      query.status = status;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch stock counts and total count
    const stockCounts = await StockCount.find(query)
      .populate("branch", "name code")
      .populate("countedBy", "firstName lastName")
      .populate("reviewedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await StockCount.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        stockCounts,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalStockCounts: total,
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
 * Get stock count by ID
 * Purpose: Fetch a single stock count by ID
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Stock count must exist
 * Process: Find stock count by ID and return with populated refs
 * Response: Stock count details
 */
export const getStockCountById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find stock count by ID
    const stockCount = await StockCount.findById(req.params.stockCountId)
      .populate("branch", "name code")
      .populate("countedBy", "firstName lastName")
      .populate("reviewedBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — stock count must exist
    if (!stockCount) {
      return next(errorHandler(404, "Stock count not found"));
    }

    // Return stock count
    res.status(200).json({
      success: true,
      data: { stockCount },
    });
  } catch (error: any) {
    next(error);
  }
};
