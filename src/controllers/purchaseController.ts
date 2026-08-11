import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Purchase from "../models/Purchase";
import Branch from "../models/Branch";
import Supplier from "../models/Supplier";
import Product from "../models/Product";
import { generatePurchaseNumber } from "../utils/numberGenerators";
import { recordStockMovement } from "../services/internal/stockMovementService";

/**
 * Create purchase order
 * Purpose: Create a new purchase order for goods to be received from a supplier
 * Access: Store Keeper, Manager, Admin
 * Validation: Branch, supplier, and items required; each item's product and SKU must exist
 * Process: Validate items, compute subtotals/total, generate purchase number, create purchase
 * Response: Created purchase order
 */
export const createPurchaseOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, supplier, items } = req.body;

    // Guard — branch required
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (!supplier) {
      return next(errorHandler(400, "Supplier is required"));
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(errorHandler(400, "At least one item is required"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — supplier must exist
    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Validate each item and compute subtotals
    const preparedItems: any[] = [];
    let totalAmount = 0;

    for (const item of items) {
      const { product, sku, quantity, purchasePrice } = item;

      if (!product) {
        return next(errorHandler(400, "Product is required for each item"));
      }
      if (!sku) {
        return next(errorHandler(400, "SKU is required for each item"));
      }
      if (!quantity || quantity < 1) {
        return next(errorHandler(400, "Quantity must be at least 1 for each item"));
      }
      if (purchasePrice === undefined || purchasePrice < 0) {
        return next(errorHandler(400, "Purchase price is required for each item"));
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

      const subtotal = quantity * purchasePrice;
      totalAmount += subtotal;

      preparedItems.push({ product, sku, quantity, purchasePrice, subtotal });
    }

    // Generate purchase number
    const purchaseNumber = await generatePurchaseNumber(branchDoc.code, String(branchDoc._id));

    // Create purchase order
    const purchase = await Purchase.create({
      purchaseNumber,
      branch,
      supplier,
      items: preparedItems,
      totalAmount,
      status: "ordered",
      createdBy: req.user?._id,
    });

    // Return created purchase order
    res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Receive goods
 * Purpose: Mark a purchase order as received and increment branch stock for each item
 * Access: Store Keeper, Manager, Admin
 * Validation: Purchase must exist and be in 'ordered' status
 * Process: Record a stock movement per item, mark purchase as received
 * Response: Updated purchase order
 */
export const receiveGoods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find purchase order
    const purchase = await Purchase.findById(req.params.purchaseId);

    // Guard — purchase must exist
    if (!purchase) {
      return next(errorHandler(404, "Purchase order not found"));
    }

    // Guard — purchase must still be ordered
    if (purchase.status !== "ordered") {
      return next(errorHandler(409, "Purchase order has already been received or cancelled"));
    }

    // Record a stock movement per item
    for (const item of purchase.items) {
      await recordStockMovement({
        branch: purchase.branch as any,
        product: item.product as any,
        sku: item.sku,
        type: "purchased",
        quantity: item.quantity,
        reference: { refType: "Purchase", refId: purchase._id as any },
        performedBy: req.user?._id as any,
      });
    }

    // Mark purchase as received
    purchase.status = "received";
    purchase.receivedBy = req.user?._id as any;
    purchase.receivedAt = new Date();
    await purchase.save();

    // Return updated purchase order
    res.status(200).json({
      success: true,
      message: "Goods received successfully",
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all purchases
 * Purpose: List all purchase orders with filtering and pagination
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/supplier/status/search, paginate, return results
 * Response: Purchase list and pagination
 */
export const getAllPurchases = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, supplier, status, search } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (supplier) {
      query.supplier = supplier;
    }
    if (status) {
      query.status = status;
    }
    if (search) {
      query.purchaseNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch purchases and total count
    const purchases = await Purchase.find(query)
      .populate("branch", "name code")
      .populate("supplier", "companyName")
      .populate("receivedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Purchase.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        purchases,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalPurchases: total,
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
 * Get purchase by ID
 * Purpose: Fetch a single purchase order by ID
 * Access: Store Keeper, Manager, Admin, Accountant
 * Validation: Purchase must exist
 * Process: Find purchase by ID and return with populated refs
 * Response: Purchase order details
 */
export const getPurchaseById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find purchase by ID
    const purchase = await Purchase.findById(req.params.purchaseId)
      .populate("branch", "name code")
      .populate("supplier", "companyName")
      .populate("receivedBy", "firstName lastName")
      .populate("createdBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — purchase must exist
    if (!purchase) {
      return next(errorHandler(404, "Purchase order not found"));
    }

    // Return purchase
    res.status(200).json({
      success: true,
      data: { purchase },
    });
  } catch (error: any) {
    next(error);
  }
};
