import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Variant from "../models/Variant";

/**
 * Get all variants
 * Purpose: List all variants with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by search, paginate, return results
 * Response: Variant list and pagination
 */
export const getAllVariants = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch variants and total count
    const variants = await Variant.find(query)
      .sort({ sortOrder: 1, createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Variant.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        variants,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalVariants: total,
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
 * Get variant by ID
 * Purpose: Fetch a single variant with all its options
 * Access: Manager, Admin
 * Validation: Variant must exist
 * Process: Find variant by ID and return with options
 * Response: Variant details
 */
export const getVariantById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find variant by ID
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Return variant
    res.status(200).json({
      success: true,
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create variant
 * Purpose: Create a new variant with an initial set of options
 * Access: Manager, Admin
 * Validation: Name required and must be unique; options values must be unique within the variant
 * Process: Create and save variant
 * Response: Created variant
 */
export const createVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, options = [], sortOrder = 0 } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — name must not already exist
    const existing = await Variant.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "Variant with this name already exists"));
    }

    // Guard — option values must be unique within the variant
    if (Array.isArray(options) && options.length > 0) {
      const values = options.map((o: any) => String(o.value).toLowerCase());
      const uniqueValues = new Set(values);
      if (uniqueValues.size !== values.length) {
        return next(errorHandler(400, "Option values must be unique within a variant"));
      }
    }

    // Create variant
    const variant = await Variant.create({ name, options, sortOrder });

    // Return created variant
    res.status(201).json({
      success: true,
      message: "Variant created successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update variant
 * Purpose: Update a variant's name or sortOrder
 * Access: Manager, Admin
 * Validation: Variant must exist; updated name must not conflict with another variant
 * Process: Apply updates and save
 * Response: Updated variant
 */
export const updateVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, sortOrder } = req.body;

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — updated name must not belong to another variant
    if (name && name !== variant.name) {
      const conflict = await Variant.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: variant._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Variant with this name already exists"));
      }
      variant.name = name;
    }

    // Apply remaining updates
    if (sortOrder !== undefined) {
      variant.sortOrder = sortOrder;
    }

    // Save and return
    await variant.save();
    res.status(200).json({
      success: true,
      message: "Variant updated successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete variant
 * Purpose: Delete a variant and all its options
 * Access: Admin
 * Validation: Variant must exist
 * Process: Delete record
 * Response: Success message
 */
export const deleteVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete variant
    const variant = await Variant.findByIdAndDelete(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Variant deleted",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Add option
 * Purpose: Append a new option to an existing variant
 * Access: Manager, Admin
 * Validation: Variant must exist; option value required and must be unique within the variant
 * Process: Push new option into options array and save
 * Response: Updated variant
 */
export const addOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { value, sortOrder = 0 } = req.body;

    // Guard — value required
    if (!value) {
      return next(errorHandler(400, "Option value is required"));
    }

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — option value must be unique within this variant
    const duplicate = variant.options.find(
      (o) => o.value.toLowerCase() === String(value).toLowerCase()
    );
    if (duplicate) {
      return next(errorHandler(409, "An option with this value already exists on this variant"));
    }

    // Push new option
    variant.options.push({ value, isActive: true, sortOrder } as any);
    await variant.save();

    // Return updated variant
    res.status(201).json({
      success: true,
      message: "Option added successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update option
 * Purpose: Update an option's value, sortOrder, or isActive status
 * Access: Manager, Admin
 * Validation: Variant and option must exist; updated value must not conflict with another option
 * Process: Find option by ID, apply updates, save variant
 * Response: Updated variant
 */
export const updateOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { value, isActive, sortOrder } = req.body;

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Find option by subdocument ID
    const option = variant.options.id(req.params.optionId as string);

    // Guard — option must exist
    if (!option) {
      return next(errorHandler(404, "Option not found"));
    }

    // Guard — updated value must not belong to another option on this variant
    if (value && value.toLowerCase() !== option.value.toLowerCase()) {
      const conflict = variant.options.find(
        (o) =>
          o.value.toLowerCase() === String(value).toLowerCase() &&
          String(o._id) !== req.params.optionId
      );
      if (conflict) {
        return next(errorHandler(409, "An option with this value already exists on this variant"));
      }
      option.value = value;
    }

    // Apply remaining updates
    if (isActive !== undefined) {
      option.isActive = isActive;
    }
    if (sortOrder !== undefined) {
      option.sortOrder = sortOrder;
    }

    // Save and return
    await variant.save();
    res.status(200).json({
      success: true,
      message: "Option updated successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Remove option
 * Purpose: Delete a single option from a variant
 * Access: Admin
 * Validation: Variant and option must exist
 * Process: Pull option from options array and save
 * Response: Updated variant
 */
export const removeOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — option must exist
    const option = variant.options.id(req.params.optionId as string);
    if (!option) {
      return next(errorHandler(404, "Option not found"));
    }

    // Remove option
    option.deleteOne();
    await variant.save();

    // Return updated variant
    res.status(200).json({
      success: true,
      message: "Option removed successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
