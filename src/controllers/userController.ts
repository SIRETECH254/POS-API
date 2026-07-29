import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { errorHandler } from "../middleware/errorHandler";
import User from "../models/User";
import Role from "../models/Role";
import Branch from "../models/Branch";
import { deleteFromCloudinary } from "../config/cloudinary";

/**
 * Create staff
 * Purpose: Admin/Manager creates a new staff account
 * Access: Admin, Manager
 * Validation: All required fields must be present; email and phone must be unique; role and branch must exist
 * Process: Validate uniqueness, verify role/branch exist, hash password, create user, populate role and branch
 * Response: Created staff member
 */
export const createStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { firstName, lastName, email, phone, password, roleId, branchId } = req.body;

    // Guard — required fields
    if (!firstName) {
      return next(errorHandler(400, "First name is required"));
    }
    if (!lastName) {
      return next(errorHandler(400, "Last name is required"));
    }
    if (!email) {
      return next(errorHandler(400, "Email is required"));
    }
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }
    if (!password) {
      return next(errorHandler(400, "Password is required"));
    }
    if (!roleId) {
      return next(errorHandler(400, "Role is required"));
    }
    if (!branchId) {
      return next(errorHandler(400, "Branch is required"));
    }

    // Guard — email uniqueness
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return next(errorHandler(409, "Email already in use"));
    }

    // Guard — phone uniqueness
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return next(errorHandler(409, "Phone number already in use"));
    }

    // Guard — role must exist
    const role = await Role.findById(roleId);
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Guard — branch must exist
    const branch = await Branch.findById(branchId);
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Create staff account
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: roleId,
      branch: branchId,
      status: true,
    });

    // Populate role and branch for response
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return created staff
    res.status(201).json({
      success: true,
      message: "Staff account created successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all staff
 * Purpose: List staff members with filtering, branch scoping, and pagination
 * Access: Admin, Manager
 * Validation: None required
 * Process: Filter by branch, search, and status; paginate; populate role and branch
 * Response: Staff list and pagination
 */
export const getAllStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status, branch } = req.query;

    // Build filter query
    const query: any = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    if (status === "active") {
      query.status = true;
    }
    if (status === "inactive") {
      query.status = false;
    }

    if (branch) {
      query.branch = branch;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch staff and total count
    const staff = await User.find(query)
      .populate("role")
      .populate("branch")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total = await User.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        staff,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalStaff: total,
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
 * Get staff by ID
 * Purpose: Fetch a single staff member by ID
 * Access: Admin, Manager
 * Validation: User must exist
 * Process: Find user by userId param, populate role and branch, return
 * Response: Staff member details
 */
export const getStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find staff by ID with populated references
    const user = await User.findById(req.params.userId).populate("role").populate("branch");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Return staff member
    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update staff
 * Purpose: Admin/Manager updates a staff member's details
 * Access: Admin, Manager
 * Validation: User must exist; phone must remain unique if changed; role and branch must exist if changed
 * Process: Find user, validate uniqueness and references, apply updates, save, return
 * Response: Updated staff member
 */
export const updateStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract updatable fields — email excluded for security
    const { firstName, lastName, phone, roleId, branchId } = req.body;

    // Find staff by ID
    const user = await User.findById(req.params.userId);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Guard — phone uniqueness if changing
    if (phone !== undefined && phone !== user.phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return next(errorHandler(409, "Phone number already in use"));
      }
    }

    // Guard — role must exist if changing
    if (roleId !== undefined) {
      const role = await Role.findById(roleId);
      if (!role) {
        return next(errorHandler(404, "Role not found"));
      }
    }

    // Guard — branch must exist if changing
    if (branchId !== undefined) {
      const branch = await Branch.findById(branchId);
      if (!branch) {
        return next(errorHandler(404, "Branch not found"));
      }
    }

    // Apply updates
    if (firstName !== undefined) {
      user.firstName = firstName;
    }
    if (lastName !== undefined) {
      user.lastName = lastName;
    }
    if (phone !== undefined) {
      user.phone = phone;
    }
    if (roleId !== undefined) {
      user.role = roleId;
    }
    if (branchId !== undefined) {
      user.branch = branchId;
    }

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated staff
    res.status(200).json({
      success: true,
      message: "Staff member updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Set user status
 * Purpose: Admin toggles a staff member's active/suspended status
 * Access: Admin
 * Validation: User must exist; admin cannot change their own status
 * Process: Toggle the boolean status field and save
 * Response: Updated user with new status
 */
export const setUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find staff by ID
    const user = await User.findById(req.params.userId);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Guard — cannot change own status
    if (user._id.toString() === req.user?._id.toString()) {
      return next(errorHandler(400, "You cannot change your own account status"));
    }

    // Toggle status
    user.status = !user.status;

    // Save
    await user.save();

    // Return updated status
    res.status(200).json({
      success: true,
      message: `User status set to ${user.status ? "active" : "suspended"}`,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get profile
 * Purpose: Authenticated user retrieves their own profile
 * Access: Any authenticated user
 * Validation: User must exist
 * Process: Fetch user by req.user._id, populate role and branch
 * Response: Full user profile (no sensitive fields)
 */
export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Fetch authenticated user's profile
    const user = await User.findById(req.user?._id).populate("role").populate("branch");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Return profile
    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update profile
 * Purpose: Authenticated user updates their own profile
 * Access: Any authenticated user
 * Validation: User must exist; phone must remain unique if changed; email and role updates are blocked
 * Process: Apply permitted field updates (firstName, lastName, phone only) and save
 * Response: Updated user profile
 */
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract only permitted fields — email and role deliberately excluded
    const { firstName, lastName, phone } = req.body;

    // Find authenticated user
    const user = await User.findById(req.user?._id);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Guard — phone uniqueness if changing
    if (phone !== undefined && phone !== user.phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return next(errorHandler(409, "Phone number already in use"));
      }
    }

    // Apply permitted updates
    if (firstName !== undefined) {
      user.firstName = firstName;
    }
    if (lastName !== undefined) {
      user.lastName = lastName;
    }
    if (phone !== undefined) {
      user.phone = phone;
    }

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated profile
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Change password
 * Purpose: Authenticated user changes their own password
 * Access: Any authenticated user
 * Validation: currentPassword and newPassword required; currentPassword must match stored hash; new password must differ
 * Process: Explicitly select password field, verify current password with bcrypt, hash new password, save
 * Response: Success confirmation
 */
export const changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { currentPassword, newPassword } = req.body;

    // Guard — required fields
    if (!currentPassword) {
      return next(errorHandler(400, "Current password is required"));
    }
    if (!newPassword) {
      return next(errorHandler(400, "New password is required"));
    }

    // Fetch user with password field
    const user = await User.findById(req.user?._id).select("+password");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Guard — current password must match
    const isMatch = bcrypt.compareSync(currentPassword, user.password);
    if (!isMatch) {
      return next(errorHandler(401, "Current password is incorrect"));
    }

    // Guard — new password must differ from current
    const isSame = bcrypt.compareSync(newPassword, user.password);
    if (isSame) {
      return next(errorHandler(400, "New password must be different from current password"));
    }

    // Hash and save new password
    user.password = bcrypt.hashSync(newPassword, 10);
    await user.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Set PIN
 * Purpose: Authenticated user sets or updates their 4-6 digit PIN for PIN-based shift login
 * Access: Any authenticated user
 * Validation: pin required; must be 4-6 numeric digits
 * Process: Explicitly select pin field, validate format, hash with bcrypt, save
 * Response: Success confirmation
 */
export const setPin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract PIN from body
    const { pin } = req.body;

    // Guard — PIN required
    if (!pin) {
      return next(errorHandler(400, "PIN is required"));
    }

    // Guard — PIN must be 4-6 numeric digits
    const pinString = pin.toString();
    if (!/^\d{4,6}$/.test(pinString)) {
      return next(errorHandler(400, "PIN must be 4 to 6 numeric digits"));
    }

    // Fetch user with pin field
    const user = await User.findById(req.user?._id).select("+pin");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Hash and save PIN
    user.pin = bcrypt.hashSync(pinString, 10);
    await user.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "PIN set successfully",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update avatar
 * Purpose: Authenticated user uploads or replaces their avatar image
 * Access: Any authenticated user
 * Validation: File must be present; user must exist
 * Process: Delete old avatar from Cloudinary if exists, set new avatar URL and public ID from multer result, save
 * Response: Updated user with new avatar URL
 */
export const updateAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Guard — file must be present
    if (!req.file) {
      return next(errorHandler(400, "Avatar image is required"));
    }

    // Find authenticated user
    const user = await User.findById(req.user?._id);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Delete old avatar from Cloudinary if it exists
    if (user.avatarPublicId) {
      try {
        await deleteFromCloudinary(user.avatarPublicId);
      } catch (deleteError) {
        console.error("Failed to delete previous avatar:", deleteError);
      }
    }

    // Set new avatar from multer-cloudinary result
    user.avatar = req.file.path;
    user.avatarPublicId = req.file.filename;

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated user
    res.status(200).json({
      success: true,
      message: "Avatar updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
