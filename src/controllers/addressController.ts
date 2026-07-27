import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Address from "../models/Address";
import Location from "../models/Location";

/**
 * Get user addresses
 * Purpose: List all addresses for the authenticated user with pagination
 * Access: Authenticated
 * Validation: None required
 * Process: Filter by userId, paginate, populate location, return results
 * Response: Address list and pagination
 */
export const getUserAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search } = req.query;

    // Build filter query scoped to authenticated user
    const query: any = { userId: req.user?._id };
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }];
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch addresses and total count
    const addresses = await Address.find(query)
      .populate("location")
      .sort({ isDefault: -1, createdAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Address.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        addresses,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalAddresses: total,
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
 * Get address by ID
 * Purpose: Fetch a single address record for the authenticated user
 * Access: Authenticated
 * Validation: Address must exist and belong to the requesting user
 * Process: Find address by ID scoped to userId, populate location, return
 * Response: Address details
 */
export const getAddressById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find address by ID scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    }).populate("location");

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Return address
    res.status(200).json({
      success: true,
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create address
 * Purpose: Create a new address for the authenticated user
 * Access: Authenticated
 * Validation: name and locationId are required; location must exist
 * Process: Verify location, create address linked to Location document
 * Response: Created address with populated location
 */
export const createAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, locationId, details, isDefault } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — locationId required
    if (!locationId) {
      return next(errorHandler(400, "Location ID is required"));
    }

    // Verify location exists
    const locationDoc = await Location.findById(locationId);
    if (!locationDoc) {
      return next(errorHandler(404, "Location not found"));
    }

    // Create address
    const address = new Address({
      userId: req.user?._id,
      name: name.trim(),
      location: locationId,
      details: details ?? undefined,
      isDefault: isDefault ?? false,
    });

    await address.save();

    // Populate location and return
    await address.populate("location");
    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update address
 * Purpose: Update an address belonging to the authenticated user
 * Access: Authenticated
 * Validation: Address must exist and belong to the requesting user; location must exist if locationId provided
 * Process: Apply field updates and save
 * Response: Updated address with populated location
 */
export const updateAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, locationId, details, isDefault } = req.body;

    // Find address scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Verify location exists if locationId provided
    if (locationId) {
      const locationDoc = await Location.findById(locationId);
      if (!locationDoc) {
        return next(errorHandler(404, "Location not found"));
      }
      address.location = locationId;
    }

    // Apply updates
    if (name !== undefined) {
      address.name = name.trim();
    }
    if (details !== undefined) {
      address.details = details;
    }
    if (isDefault !== undefined) {
      address.isDefault = isDefault;
    }

    // Save and return
    await address.save();
    await address.populate("location");
    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Delete address
 * Purpose: Remove an address belonging to the authenticated user
 * Access: Authenticated
 * Validation: Address must exist and belong to the requesting user
 * Process: Find and delete the address record
 * Response: Success message
 */
export const deleteAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete address scoped to authenticated user
    const address = await Address.findOneAndDelete({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Set default address
 * Purpose: Mark an existing address as the user's default delivery address
 * Access: Authenticated
 * Validation: Address must exist and belong to the requesting user
 * Process: Set isDefault true and trigger pre-save hook to unset previous default
 * Response: Updated address with populated location
 */
export const setDefaultAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find address scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Set as default and trigger pre-save hook
    address.isDefault = true;
    await address.save();
    await address.populate("location");

    // Return updated address
    res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};
