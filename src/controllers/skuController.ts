import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { errorHandler } from "../middleware/errorHandler";
import Product from "../models/Product";

/**
 * Get all SKUs
 * Purpose: List all SKUs across all products with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Aggregate product.skus, filter by status, paginate, return results
 * Response: Flat SKU list with product context and pagination
 */
export const getAllSkus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, status } = req.query;

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Build match stage for optional status filter
    const matchStage: any = {};
    if (status) {
      matchStage["skus.status"] = status;
    }

    // Aggregate SKUs across all products
    const pipeline: any[] = [
      { $unwind: "$skus" },
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      {
        $project: {
          _id: "$skus._id",
          productId: "$_id",
          productName: "$name",
          attributes: "$skus.attributes",
          skuCode: "$skus.skuCode",
          barcode: "$skus.barcode",
          unit: "$skus.unit",
          buyingPrice: "$skus.buyingPrice",
          sellingPrice: "$skus.sellingPrice",
          supplier: "$skus.supplier",
          stockByBranch: "$skus.stockByBranch",
          status: "$skus.status",
          isActive: "$skus.isActive",
          createdBy: "$skus.createdBy",
          createdAt: "$skus.createdAt",
          updatedAt: "$skus.updatedAt",
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    // Get total count and paginated results
    const countResult = await Product.aggregate([...pipeline, { $count: "total" }]);
    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / options.limit);

    const skus = await Product.aggregate([
      ...pipeline,
      { $skip: (options.page - 1) * options.limit },
      { $limit: options.limit },
    ]);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        skus,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSkus: total,
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
 * Get SKU by ID
 * Purpose: Fetch a single SKU subdocument by its ID
 * Access: Manager, Admin
 * Validation: SKU must exist
 * Process: Find product containing the SKU, extract subdocument, return
 * Response: SKU details with product context
 */
export const getSkuById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product containing this SKU
    const product = await Product.findOne({ "skus._id": req.params.skuId })
      .populate("category", "name")
      .populate("createdBy", "firstName lastName");

    // Guard — SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found"));
    }

    // Extract the matching SKU subdocument
    const sku = product.skus.id(req.params.skuId as string);

    // Return SKU with product context
    res.status(200).json({
      success: true,
      data: {
        sku,
        product: {
          _id: product._id,
          name: product.name,
          category: product.category,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create SKU
 * Purpose: Add a new SKU to an existing product
 * Access: Manager, Admin
 * Validation: Product must exist; skuCode required and must be unique; unit required
 * Process: Push new SKU subdocument into product.skus and save
 * Response: Updated product with new SKU
 */
export const createSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { skuCode, barcode, unit, buyingPrice, sellingPrice, supplier, stockByBranch, status } = req.body;

    // Guard — required fields
    if (!skuCode) {
      return next(errorHandler(400, "SKU code is required"));
    }
    if (!unit) {
      return next(errorHandler(400, "Unit is required"));
    }
    if (buyingPrice === undefined) {
      return next(errorHandler(400, "Buying price is required"));
    }
    if (sellingPrice === undefined) {
      return next(errorHandler(400, "Selling price is required"));
    }

    // Find product
    const product = await Product.findById(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — skuCode must be unique across all products
    const codeConflict = await Product.findOne({ "skus.skuCode": skuCode });
    if (codeConflict) {
      return next(errorHandler(409, "A SKU with this code already exists"));
    }

    // Guard — barcode must be unique if provided
    if (barcode) {
      const barcodeConflict = await Product.findOne({ "skus.barcode": barcode });
      if (barcodeConflict) {
        return next(errorHandler(409, "A SKU with this barcode already exists"));
      }
    }

    // Push new SKU
    product.skus.push({
      attributes: [],
      skuCode,
      barcode,
      unit,
      buyingPrice,
      sellingPrice,
      supplier,
      stockByBranch: stockByBranch || [],
      status: status || "active",
      isActive: true,
      createdBy: (req as any).user._id,
    } as any);

    await product.save();

    // Return success
    res.status(201).json({
      success: true,
      message: "SKU created successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update SKU
 * Purpose: Update fields on an existing SKU subdocument
 * Access: Manager, Admin
 * Validation: SKU must exist within the specified product; skuCode uniqueness if changed
 * Process: Find product and SKU, apply field updates, save
 * Response: Updated product
 */
export const updateSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { skuCode, barcode, unit, buyingPrice, sellingPrice, supplier, status, isActive } = req.body;

    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Guard — updated skuCode must not belong to another SKU
    if (skuCode) {
      const conflict = await Product.findOne({
        "skus.skuCode": skuCode,
        "skus._id": { $ne: new mongoose.Types.ObjectId(req.params.skuId as string) },
      });
      if (conflict) {
        return next(errorHandler(409, "A SKU with this code already exists"));
      }
    }

    // Guard — updated barcode must not belong to another SKU
    if (barcode) {
      const barcodeConflict = await Product.findOne({
        "skus.barcode": barcode,
        "skus._id": { $ne: new mongoose.Types.ObjectId(req.params.skuId as string) },
      });
      if (barcodeConflict) {
        return next(errorHandler(409, "A SKU with this barcode already exists"));
      }
    }

    // Build update object from provided fields
    const updateData: any = {};
    if (skuCode !== undefined) {
      updateData.skuCode = skuCode;
    }
    if (barcode !== undefined) {
      updateData.barcode = barcode;
    }
    if (unit !== undefined) {
      updateData.unit = unit;
    }
    if (buyingPrice !== undefined) {
      updateData.buyingPrice = buyingPrice;
    }
    if (sellingPrice !== undefined) {
      updateData.sellingPrice = sellingPrice;
    }
    if (supplier !== undefined) {
      updateData.supplier = supplier;
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // Apply update via instance method
    await product.updateSKU(req.params.skuId as string, updateData);

    // Return success
    res.status(200).json({
      success: true,
      message: "SKU updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete SKU
 * Purpose: Remove a SKU subdocument from a product
 * Access: Admin
 * Validation: SKU must exist within the specified product
 * Process: Find product and SKU, remove subdocument, save
 * Response: Success message
 */
export const deleteSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Remove SKU via instance method
    await product.deleteSKU(req.params.skuId as string);

    // Return success
    res.status(200).json({
      success: true,
      message: "SKU deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get low stock SKUs
 * Purpose: List SKUs where currentStock is at or below minimumStock for a given branch
 * Access: Manager, Admin, Store Keeper
 * Validation: branch query param required
 * Process: Aggregate and unwind stockByBranch, match branch and low stock condition
 * Response: Low stock SKU list with product context
 */
export const getLowStockSkus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch, page = 1, limit = 10 } = req.query;

    // Guard — branch required
    if (!branch) {
      return next(errorHandler(400, "Branch ID is required"));
    }

    // Guard — valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(branch as string)) {
      return next(errorHandler(400, "Invalid branch ID"));
    }

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    const branchId = new mongoose.Types.ObjectId(branch as string);

    const pipeline: any[] = [
      { $unwind: "$skus" },
      { $unwind: "$skus.stockByBranch" },
      {
        $match: {
          "skus.stockByBranch.branch": branchId,
          $expr: {
            $lte: [
              "$skus.stockByBranch.currentStock",
              "$skus.stockByBranch.minimumStock",
            ],
          },
        },
      },
      {
        $project: {
          _id: "$skus._id",
          productId: "$_id",
          productName: "$name",
          skuCode: "$skus.skuCode",
          barcode: "$skus.barcode",
          unit: "$skus.unit",
          sellingPrice: "$skus.sellingPrice",
          status: "$skus.status",
          currentStock: "$skus.stockByBranch.currentStock",
          minimumStock: "$skus.stockByBranch.minimumStock",
        },
      },
      { $sort: { currentStock: 1 } },
    ];

    // Total count and paginated results
    const countResult = await Product.aggregate([...pipeline, { $count: "total" }]);
    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / options.limit);

    const skus = await Product.aggregate([
      ...pipeline,
      { $skip: (options.page - 1) * options.limit },
      { $limit: options.limit },
    ]);

    // Return response
    res.status(200).json({
      success: true,
      data: {
        skus,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSkus: total,
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
 * Search SKU by barcode
 * Purpose: Locate a SKU using its barcode, scoped to the requesting user's branch
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: Barcode param required; SKU must exist
 * Process: Find product where skus.barcode matches, extract SKU subdocument
 * Response: Matching SKU with product context
 */
export const searchByBarcode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product with matching barcode
    const product = await Product.findOne({ "skus.barcode": req.params.code });

    // Guard — SKU must exist
    if (!product) {
      return next(errorHandler(404, "No SKU found with this barcode"));
    }

    // Extract the matching SKU
    const sku = product.skus.find((s: any) => s.barcode === req.params.code);

    // Return SKU with product context
    res.status(200).json({
      success: true,
      data: {
        sku,
        product: {
          _id: product._id,
          name: product.name,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Set branch stock level
 * Purpose: Initialize or correct the stockByBranch entry for a given branch on a SKU
 * Access: Manager, Admin
 * Validation: Product and SKU must exist; branch required; currentStock and minimumStock required
 * Process: Find SKU subdocument, upsert stockByBranch entry for the branch, save
 * Response: Updated product
 */
export const setBranchStockLevel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, currentStock, minimumStock } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (currentStock === undefined) {
      return next(errorHandler(400, "Current stock is required"));
    }
    if (minimumStock === undefined) {
      return next(errorHandler(400, "Minimum stock is required"));
    }

    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Find SKU subdocument
    const sku = product.skus.id(req.params.skuId as string);
    if (!sku) {
      return next(errorHandler(404, "SKU not found"));
    }

    // Upsert the branch stock entry
    const branchEntry = (sku.stockByBranch as any[]).find(
      (entry: any) => entry.branch.toString() === branch.toString()
    );
    if (branchEntry) {
      branchEntry.currentStock = currentStock;
      branchEntry.minimumStock = minimumStock;
    } else {
      (sku.stockByBranch as any[]).push({ branch, currentStock, minimumStock });
    }

    await product.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "Branch stock level updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
