import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Category from "../models/Category";

/**
 * Get all categories
 * Purpose: List all categories with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by search/status, paginate, return results
 * Response: Category list and pagination
 */
export const getAllCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "active") {
      query.isActive = true;
    }
    if (status === "inactive") {
      query.isActive = false;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch categories and total count
    const categories = await Category.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Category.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        categories,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalCategories: total,
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
 * Get category by ID
 * Purpose: Fetch a single category record
 * Access: Manager, Admin
 * Validation: Category must exist
 * Process: Find category by ID and return
 * Response: Category details
 */
export const getCategoryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find category by ID
    const category = await Category.findById(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Return category
    res.status(200).json({
      success: true,
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create category
 * Purpose: Create a new category record
 * Access: Manager, Admin
 * Validation: Name and description required; name must be unique
 * Process: Create and save category
 * Response: Created category
 */
export const createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — description required
    if (!description) {
      return next(errorHandler(400, "Description is required"));
    }

    // Guard — name must not already exist
    const existing = await Category.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "Category with this name already exists"));
    }

    // Create category
    const category = await Category.create({ name, description });

    // Return created category
    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update category
 * Purpose: Update a category by ID
 * Access: Manager, Admin
 * Validation: Category must exist; updated name must not conflict with another category
 * Process: Apply field updates and save
 * Response: Updated category
 */
export const updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, isActive } = req.body;

    // Find category
    const category = await Category.findById(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Guard — updated name must not belong to another category
    if (name && name !== category.name) {
      const conflict = await Category.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: category._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Category with this name already exists"));
      }
      category.name = name;
    }

    // Apply remaining updates
    if (description !== undefined) {
      category.description = description;
    }
    if (isActive !== undefined) {
      category.isActive = isActive;
    }

    // Save and return
    await category.save();
    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete category
 * Purpose: Delete a category by ID
 * Access: Admin
 * Validation: Category must exist
 * Process: Delete record
 * Response: Success message
 */
export const deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete category
    const category = await Category.findByIdAndDelete(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Category deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
