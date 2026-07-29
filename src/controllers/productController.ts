import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { errorHandler } from "../middleware/errorHandler";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary";
import Product from "../models/Product";
import Category from "../models/Category";
import Variant from "../models/Variant";

/**
 * Get all products
 * Purpose: List all products with search, filtering, and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by search/category/status, paginate, return results
 * Response: Product list and pagination
 */
export const getAllProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, category, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (category) {
      query.category = category;
    }
    if (status) {
      query.status = status;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch products and total count
    const products = await Product.find(query)
      .populate("category", "name description")
      .populate("variants", "name options sortOrder")
      .populate("createdBy", "firstName lastName email")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Product.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalProducts: total,
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
 * Get product by ID
 * Purpose: Fetch a single product with all its SKUs and related data
 * Access: Manager, Admin
 * Validation: Product must exist
 * Process: Find product by ID, populate relations, return
 * Response: Product details with SKUs
 */
export const getProductById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product by ID with populated references
    const product = await Product.findById(req.params.productId)
      .populate("category", "name description")
      .populate("variants", "name options sortOrder")
      .populate("createdBy", "firstName lastName email");

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Return product
    res.status(200).json({
      success: true,
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create product
 * Purpose: Create a new product, upload image if provided, and generate initial SKUs
 * Access: Manager, Admin
 * Validation: name, category, description required; category must exist; each variantId must exist
 * Process: Validate refs, upload image, create product, generate SKUs
 * Response: Created product with generated SKUs
 */
export const createProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, category, variants, status } = req.body;

    // Guard — required fields
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }
    if (!description) {
      return next(errorHandler(400, "Description is required"));
    }
    if (!category) {
      return next(errorHandler(400, "Category is required"));
    }

    // Guard — name must be unique
    const existing = await Product.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "A product with this name already exists"));
    }

    // Guard — category must exist
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return next(errorHandler(404, "Category not found"));
    }

    // Guard — each variant must exist
    const variantIds: string[] = Array.isArray(variants) ? variants : [];
    for (const variantId of variantIds) {
      if (!mongoose.Types.ObjectId.isValid(variantId)) {
        return next(errorHandler(400, `Invalid variant ID: ${variantId}`));
      }
      const variantDoc = await Variant.findById(variantId);
      if (!variantDoc) {
        return next(errorHandler(404, `Variant not found: ${variantId}`));
      }
    }

    // Upload image to Cloudinary if file provided
    let image: string | undefined;
    let imagePublicId: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");
      image = uploadResult.url;
      imagePublicId = uploadResult.public_id;
    }

    // Create product
    const product = new Product({
      name,
      description,
      category,
      variants: variantIds,
      image,
      imagePublicId,
      status: status || "active",
      createdBy: (req as any).user._id,
    });

    // Generate SKUs (always — creates default SKU when no variants)
    await product.generateSKUs();

    // Populate references before returning
    await product.populate("category", "name description");
    await product.populate("variants", "name options sortOrder");
    await product.populate("createdBy", "firstName lastName email");

    // Return created product
    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update product
 * Purpose: Update product fields, replace image if provided, regenerate SKUs when variants change
 * Access: Manager, Admin
 * Validation: Product must exist; updated name must not conflict; category and variant IDs must exist
 * Process: Apply field updates, handle image swap, re-run generateSKUs on variant change
 * Response: Updated product
 */
export const updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, category, variants, status } = req.body;

    // Find product
    const product = await Product.findById(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — updated name must not belong to another product
    if (name && name !== product.name) {
      const conflict = await Product.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: product._id },
      });
      if (conflict) {
        return next(errorHandler(409, "A product with this name already exists"));
      }
      product.name = name;
    }

    // Guard — category must exist if provided
    if (category) {
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc) {
        return next(errorHandler(404, "Category not found"));
      }
      product.category = category;
    }

    // Guard — each variant must exist if provided
    if (variants !== undefined) {
      const variantIds: string[] = Array.isArray(variants) ? variants : [];
      for (const variantId of variantIds) {
        if (!mongoose.Types.ObjectId.isValid(variantId)) {
          return next(errorHandler(400, `Invalid variant ID: ${variantId}`));
        }
        const variantDoc = await Variant.findById(variantId);
        if (!variantDoc) {
          return next(errorHandler(404, `Variant not found: ${variantId}`));
        }
      }
      product.variants = variantIds as any;
    }

    // Apply remaining field updates
    if (description) {
      product.description = description;
    }
    if (status) {
      product.status = status;
    }

    // Handle image replacement
    if (req.file) {
      if (product.imagePublicId) {
        try {
          await deleteFromCloudinary(product.imagePublicId);
        } catch (deleteError) {
          console.error("Failed to delete previous product image:", deleteError);
        }
      }
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");
      product.image = uploadResult.url;
      product.imagePublicId = uploadResult.public_id;
    }

    // Regenerate SKUs when variants changed
    if (variants !== undefined) {
      await product.generateSKUs();
    } else {
      await product.save();
    }

    // Populate references before returning
    await product.populate("category", "name description");
    await product.populate("variants", "name options sortOrder");
    await product.populate("createdBy", "firstName lastName email");

    // Return updated product
    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete product
 * Purpose: Permanently remove a product and its Cloudinary image
 * Access: Admin
 * Validation: Product must exist
 * Process: Delete image from Cloudinary, then delete product record
 * Response: Success message
 */
export const deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete product
    const product = await Product.findByIdAndDelete(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Delete image from Cloudinary if present
    if (product.imagePublicId) {
      try {
        await deleteFromCloudinary(product.imagePublicId);
      } catch (deleteError) {
        console.error("Failed to delete product image from Cloudinary:", deleteError);
      }
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
