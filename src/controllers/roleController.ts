import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Role from "../models/Role";

/**
 * Get all roles
 * Purpose: List all roles with filtering and pagination
 * Access: Admin, Manager
 * Validation: None required
 * Process: Filter by search/status, paginate, return results
 * Response: Role list and pagination
 */
export const getAllRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }];
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

    // Fetch roles and total count
    const roles = await Role.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Role.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        roles,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalRoles: total,
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
 * Get role by ID
 * Purpose: Fetch a single role record
 * Access: Admin, Manager
 * Validation: Role must exist
 * Process: Find role by ID and return
 * Response: Role details
 */
export const getRoleById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find role by ID
    const role = await Role.findById(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Return role
    res.status(200).json({
      success: true,
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create role
 * Purpose: Create a new role record
 * Access: Admin
 * Validation: Name must be unique and a valid UserRole value
 * Process: Create and save role
 * Response: Created role
 */
export const createRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    // Guard — role name must not already exist
    const existing = await Role.findOne({ name });
    if (existing) {
      return next(errorHandler(409, "Role with this name already exists"));
    }

    // Create role
    const role = await Role.create({ name, description });

    // Return created role
    res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update role
 * Purpose: Update a role by ID
 * Access: Admin
 * Validation: Role must exist
 * Process: Apply field updates and save
 * Response: Updated role
 */
export const updateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { description, isActive } = req.body;

    // Find role
    const role = await Role.findById(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Apply updates
    if (description !== undefined) {
      role.description = description;
    }
    if (isActive !== undefined) {
      role.isActive = isActive;
    }

    // Save and return
    await role.save();
    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete role
 * Purpose: Delete a role by ID
 * Access: Admin
 * Validation: Role must exist
 * Process: Delete record
 * Response: Success message
 */
export const deleteRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete role
    const role = await Role.findByIdAndDelete(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Role deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
