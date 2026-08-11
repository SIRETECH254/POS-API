import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Supplier from "../models/Supplier";
import Purchase from "../models/Purchase";

/**
 * Get all suppliers
 * Purpose: List all suppliers with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by search/status/branch, paginate, return results
 * Response: Supplier list and pagination
 */
export const getAllSuppliers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status, branch } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPerson: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "active") {
      query.isActive = true;
    }
    if (status === "inactive") {
      query.isActive = false;
    }
    if (branch) {
      query.branches = branch;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch suppliers and total count
    const suppliers = await Supplier.find(query)
      .populate("address")
      .populate("branches", "name code")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Supplier.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        suppliers,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSuppliers: total,
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
 * Get supplier by ID
 * Purpose: Fetch a single supplier record
 * Access: Manager, Admin
 * Validation: Supplier must exist
 * Process: Find supplier by ID and return with populated refs
 * Response: Supplier details
 */
export const getSupplierById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find supplier by ID
    const supplier = await Supplier.findById(req.params.supplierId)
      .populate("address")
      .populate("branches", "name code")
      .populate("skusSupplied", "skuCode barcode unit sellingPrice");

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Return supplier
    res.status(200).json({
      success: true,
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create supplier
 * Purpose: Create a new supplier record
 * Access: Manager, Admin
 * Validation: Required fields present; companyName, phone, and email must be unique
 * Process: Create and save supplier
 * Response: Created supplier
 */
export const createSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { companyName, contactPerson, phone, email, address, branches } = req.body;

    // Guard — companyName required
    if (!companyName) {
      return next(errorHandler(400, "Company name is required"));
    }

    // Guard — contactPerson required
    if (!contactPerson) {
      return next(errorHandler(400, "Contact person is required"));
    }

    // Guard — phone required
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }

    // Guard — companyName must be unique
    const existingCompany = await Supplier.findOne({ companyName: { $regex: `^${companyName}$`, $options: "i" } });
    if (existingCompany) {
      return next(errorHandler(409, "Supplier with this company name already exists"));
    }

    // Guard — phone must be unique
    const existingPhone = await Supplier.findOne({ phone });
    if (existingPhone) {
      return next(errorHandler(409, "Supplier with this phone number already exists"));
    }

    // Guard — email must be unique if provided
    if (email) {
      const existingEmail = await Supplier.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return next(errorHandler(409, "Supplier with this email already exists"));
      }
    }

    // Create supplier
    const supplier = await Supplier.create({
      companyName,
      contactPerson,
      phone,
      email,
      address,
      branches: branches || [],
    });

    // Return created supplier
    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update supplier
 * Purpose: Update a supplier by ID
 * Access: Manager, Admin
 * Validation: Supplier must exist; updated companyName, phone, email must not conflict
 * Process: Apply field updates and save
 * Response: Updated supplier
 */
export const updateSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { companyName, contactPerson, phone, email, address, branches, isActive } = req.body;

    // Find supplier
    const supplier = await Supplier.findById(req.params.supplierId);

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Guard — updated companyName must not belong to another supplier
    if (companyName && companyName !== supplier.companyName) {
      const conflict = await Supplier.findOne({
        companyName: { $regex: `^${companyName}$`, $options: "i" },
        _id: { $ne: supplier._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this company name already exists"));
      }
      supplier.companyName = companyName;
    }

    // Guard — updated phone must not belong to another supplier
    if (phone && phone !== supplier.phone) {
      const conflict = await Supplier.findOne({ phone, _id: { $ne: supplier._id } });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this phone number already exists"));
      }
      supplier.phone = phone;
    }

    // Guard — updated email must not belong to another supplier
    if (email && email.toLowerCase() !== supplier.email) {
      const conflict = await Supplier.findOne({
        email: email.toLowerCase(),
        _id: { $ne: supplier._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this email already exists"));
      }
      supplier.email = email;
    }

    // Apply remaining updates
    if (contactPerson !== undefined) {
      supplier.contactPerson = contactPerson;
    }
    if (address !== undefined) {
      supplier.address = address;
    }
    if (branches !== undefined) {
      supplier.branches = branches;
    }
    if (isActive !== undefined) {
      supplier.isActive = isActive;
    }

    // Save and return
    await supplier.save();
    res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete supplier
 * Purpose: Delete a supplier by ID
 * Access: Admin
 * Validation: Supplier must exist
 * Process: Delete record
 * Response: Success message
 */
export const deleteSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete supplier
    const supplier = await Supplier.findByIdAndDelete(req.params.supplierId);

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Supplier deleted",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get supplier history
 * Purpose: Fetch purchase history, invoices, and outstanding balance for a supplier
 * Access: Manager, Admin
 * Validation: Supplier must exist
 * Process: Find supplier, query purchase records, return summary
 * Response: Supplier details, outstanding balance, and purchase history
 */
export const getSupplierHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10 } = req.query;

    // Find supplier by ID
    const supplier = await Supplier.findById(req.params.supplierId)
      .populate("address")
      .populate("branches", "name code");

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch purchase history for this supplier
    const purchases = await Purchase.find({ supplier: supplier._id })
      .populate("branch", "name code")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Purchase.countDocuments({ supplier: supplier._id });
    const totalPages = Math.ceil(total / options.limit);

    // Return supplier history
    res.status(200).json({
      success: true,
      data: {
        supplier,
        outstandingBalance: supplier.outstandingBalance,
        purchases,
        pagination: {
          currentPage: options.page,
          totalPages,
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
