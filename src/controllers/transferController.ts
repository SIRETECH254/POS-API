import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Transfer from "../models/Transfer";
import Branch from "../models/Branch";
import Product from "../models/Product";
import { generateTransferNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";
import { createNotification } from "../services/internal/notificationService";

/**
 * Create transfer
 * Purpose: Create a new branch-to-branch stock transfer request
 * Access: Store Keeper, Manager, Admin
 * Validation: fromBranch/toBranch required and must differ; items required; each item's product and SKU must exist
 * Process: Validate branches and items, generate transfer number, create transfer
 * Response: Created transfer
 */
export const createTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { fromBranch, toBranch, items } = req.body;

    // Guard — branches required
    if (!fromBranch) {
      return next(errorHandler(400, "fromBranch is required"));
    }
    if (!toBranch) {
      return next(errorHandler(400, "toBranch is required"));
    }
    if (fromBranch === toBranch) {
      return next(errorHandler(400, "fromBranch and toBranch must be different"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    // Guard — both branches must exist
    const fromBranchDoc = await Branch.findById(fromBranch);
    if (!fromBranchDoc) {
      return next(errorHandler(404, "fromBranch not found"));
    }
    const toBranchDoc = await Branch.findById(toBranch);
    if (!toBranchDoc) {
      return next(errorHandler(404, "toBranch not found"));
    }

    // Validate each item
    const preparedItems: any[] = [];

    for (const item of items) {
      const { product, sku, quantity } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }
      if (!quantity || quantity < 1) {
        return next(errorHandler(400, "Quantity must be at least 1 for each item"));
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

      preparedItems.push({ product, sku, quantity });
    }

    // Generate transfer number
    const transferNumber = await generateTransferNumber(fromBranchDoc.code, String(fromBranchDoc._id));

    // Create transfer
    const transfer = await Transfer.create({
      transferNumber,
      fromBranch,
      toBranch,
      items: preparedItems,
      status: "pending",
      createdBy: req.user?._id,
    });

    // Return created transfer
    res.status(201).json({
      success: true,
      message: "Transfer created successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Dispatch transfer
 * Purpose: Send a pending transfer, decrementing stock at the source branch
 * Access: Store Keeper, Manager, Admin
 * Validation: Transfer must exist and be in 'pending' status
 * Process: Record a transferred_out stock movement per item, mark as in_transit
 * Response: Updated transfer
 */
export const dispatchTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find transfer
    const transfer = await Transfer.findById(req.params.transferId);

    // Guard — transfer must exist
    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }

    // Guard — must still be pending
    if (transfer.status !== "pending") {
      return next(errorHandler(409, "Transfer is not pending"));
    }

    // Record a transferred_out stock movement per item
    for (const item of transfer.items) {
      await recordStockMovement({
        branch: transfer.fromBranch as any,
        product: item.product as any,
        sku: item.sku,
        type: "transferred_out",
        quantity: item.quantity,
        reference: { refType: "Transfer", refId: transfer._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark as in transit
    transfer.status = "in_transit";
    transfer.sentBy = req.user?._id as any;
    await transfer.save();

    // Return updated transfer
    res.status(200).json({
      success: true,
      message: "Transfer dispatched successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Receive transfer
 * Purpose: Receive an in-transit transfer, incrementing stock at the destination branch
 * Access: Store Keeper, Manager, Admin
 * Validation: Transfer must exist and be in 'in_transit' status
 * Process: Record a transferred_in stock movement per item, mark as received
 * Response: Updated transfer
 */
export const receiveTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find transfer
    const transfer = await Transfer.findById(req.params.transferId);

    // Guard — transfer must exist
    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }

    // Guard — must be in transit
    if (transfer.status !== "in_transit") {
      return next(errorHandler(409, "Transfer is not in transit"));
    }

    // Record a transferred_in stock movement per item
    for (const item of transfer.items) {
      await recordStockMovement({
        branch: transfer.toBranch as any,
        product: item.product as any,
        sku: item.sku,
        type: "transferred_in",
        quantity: item.quantity,
        reference: { refType: "Transfer", refId: transfer._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark as received
    transfer.status = "received";
    transfer.receivedBy = req.user?._id as any;
    transfer.receivedAt = new Date();
    await transfer.save();

    // Notify managers at the receiving branch
    await createNotification({
      branch: transfer.toBranch as any,
      recipientRole: "manager",
      type: "transfer_received",
      title: "Stock transfer received",
      message: `Transfer ${transfer.transferNumber} has arrived and been added to stock.`,
      metadata: { transferId: transfer._id, fromBranch: transfer.fromBranch },
    });

    // Return updated transfer
    res.status(200).json({
      success: true,
      message: "Transfer received successfully",
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all transfers
 * Purpose: List transfers with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by fromBranch/toBranch/status, paginate, return results
 * Response: Transfer list and pagination
 */
export const getAllTransfers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, fromBranch, toBranch, status } = req.query;

    // Build filter query
    const query: any = {};
    if (fromBranch) {
      query.fromBranch = fromBranch;
    }
    if (toBranch) {
      query.toBranch = toBranch;
    }
    if (status) {
      query.status = status;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch transfers and total count
    const transfers = await Transfer.find(query)
      .populate("fromBranch", "name code")
      .populate("toBranch", "name code")
      .populate("createdBy", "firstName lastName")
      .populate("sentBy", "firstName lastName")
      .populate("receivedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Transfer.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        transfers,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalTransfers: total,
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
 * Get transfer by ID
 * Purpose: Fetch a single transfer by ID
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Transfer must exist
 * Process: Find transfer by ID and return with populated refs
 * Response: Transfer details
 */
export const getTransferById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find transfer by ID
    const transfer = await Transfer.findById(req.params.transferId)
      .populate("fromBranch", "name code")
      .populate("toBranch", "name code")
      .populate("createdBy", "firstName lastName")
      .populate("sentBy", "firstName lastName")
      .populate("receivedBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — transfer must exist
    if (!transfer) {
      return next(errorHandler(404, "Transfer not found"));
    }

    // Return transfer
    res.status(200).json({
      success: true,
      data: { transfer },
    });
  } catch (error: any) {
    next(error);
  }
};
