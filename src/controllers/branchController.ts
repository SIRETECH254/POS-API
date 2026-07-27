import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Branch from "../models/Branch";
import Address from "../models/Address";

/**
 * Get all branches
 * Purpose: List all branches with filtering and pagination
 * Access: Admin, Manager
 * Validation: None required
 * Process: Filter by search/status, sort main branch first, paginate, return results
 * Response: Branch list and pagination
 */
export const getAllBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
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

    // Fetch branches and total count
    const branches = await Branch.find(query)
      .populate({ path: "address", populate: { path: "location" } })
      .sort({ isMain: -1, createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Branch.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        branches,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalBranches: total,
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
 * Get branch by ID
 * Purpose: Fetch a single branch record
 * Access: Admin, Manager
 * Validation: Branch must exist
 * Process: Find branch by ID, populate address with location, return
 * Response: Branch details
 */
export const getBranchById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find branch by ID
    const branch = await Branch.findById(req.params.branchId)
      .populate({ path: "address", populate: { path: "location" } });

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Return branch
    res.status(200).json({
      success: true,
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create branch
 * Purpose: Create a new branch record
 * Access: Admin
 * Validation: name is required; name must be unique; address must exist if provided
 * Process: Create and save branch
 * Response: Created branch
 */
export const createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, code, phone, email, addressId, isMain, isActive } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Branch name is required"));
    }

    // Guard — branch name must be unique
    const existing = await Branch.findOne({ name });
    if (existing) {
      return next(errorHandler(409, "Branch with this name already exists"));
    }

    // Verify address exists if provided
    if (addressId) {
      const addressDoc = await Address.findById(addressId);
      if (!addressDoc) {
        return next(errorHandler(404, "Address not found"));
      }
    }

    // Create branch
    const branch = await Branch.create({
      name,
      code,
      phone,
      email,
      address: addressId,
      isMain: isMain ?? false,
      isActive: isActive ?? true,
    });

    // Return created branch
    res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update branch
 * Purpose: Update a branch by ID
 * Access: Admin
 * Validation: Branch must exist; name must remain unique if changed; address must exist if provided
 * Process: Apply field updates and save
 * Response: Updated branch
 */
export const updateBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, code, phone, email, addressId, isMain, isActive } = req.body;

    // Find branch
    const branch = await Branch.findById(req.params.branchId);

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — if name is changing, check uniqueness
    if (name !== undefined && name !== branch.name) {
      const existing = await Branch.findOne({ name });
      if (existing) {
        return next(errorHandler(409, "Branch with this name already exists"));
      }
    }

    // Verify address exists if provided
    if (addressId) {
      const addressDoc = await Address.findById(addressId);
      if (!addressDoc) {
        return next(errorHandler(404, "Address not found"));
      }
    }

    // Apply updates
    if (name !== undefined) {
      branch.name = name;
    }
    if (code !== undefined) {
      branch.code = code;
    }
    if (phone !== undefined) {
      branch.phone = phone;
    }
    if (email !== undefined) {
      branch.email = email;
    }
    if (addressId !== undefined) {
      branch.address = addressId;
    }
    if (isMain !== undefined) {
      branch.isMain = isMain;
    }
    if (isActive !== undefined) {
      branch.isActive = isActive;
    }

    // Save and return
    await branch.save();
    await branch.populate({ path: "address", populate: { path: "location" } });
    res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete branch
 * Purpose: Delete a branch by ID
 * Access: Admin
 * Validation: Branch must exist; main branch cannot be deleted
 * Process: Guard isMain then delete record
 * Response: Success message
 */
export const deleteBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find branch
    const branch = await Branch.findById(req.params.branchId);

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — main branch cannot be deleted
    if (branch.isMain) {
      return next(errorHandler(400, "Main branch cannot be deleted"));
    }

    // Delete branch
    await branch.deleteOne();

    // Return success
    res.status(200).json({
      success: true,
      message: "Branch deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
