import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Shift from "../models/Shift";
import User from "../models/User";
import Branch from "../models/Branch";
import { IRole } from "../type";
import { generateShiftNumber } from "../utils/numberGenerators";
import { createNotification } from "../services/internal/notificationService";

/**
 * Start shift
 * Purpose: Open a new shift for the authenticated staff member at their branch
 * Access: All authenticated staff
 * Validation: openingFloat required; user must have a branch; user must not already have an open shift
 * Process: Generate shift number, create shift with status "open", link shift to user.currentShift
 * Response: Created shift
 */
export const startShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { openingFloat } = req.body;

    // Guard — openingFloat required
    if (openingFloat === undefined || openingFloat === null) {
      return next(errorHandler(400, "Opening float is required"));
    }

    // Guard — user must have a branch assigned
    if (!req.user?.branch) {
      return next(errorHandler(400, "You must be assigned to a branch before starting a shift"));
    }

    // Guard — user must not already have an open shift
    if (req.user.currentShift) {
      const existingShift = await Shift.findById(req.user.currentShift);
      if (existingShift && existingShift.status === "open") {
        return next(errorHandler(409, "You already have an active shift. End your current shift first"));
      }
    }

    // Fetch branch for code generation
    const branch = await Branch.findById(req.user.branch);
    if (!branch) {
      return next(errorHandler(404, "Assigned branch not found"));
    }

    // Generate unique shift number via utility
    const shiftNumber = await generateShiftNumber(branch.code, branch._id.toString());

    // Create shift
    const shift = await Shift.create({
      branch: branch._id,
      shiftNumber,
      staff: req.user._id,
      openingFloat,
      status: "open",
      startedAt: new Date(),
    });

    // Link shift to user
    await User.findByIdAndUpdate(req.user._id, { currentShift: shift._id });

    // Populate for response
    await shift.populate([{ path: "staff" }, { path: "branch" }]);

    // Return created shift
    res.status(201).json({
      success: true,
      message: "Shift started successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * End shift
 * Purpose: Close an open shift and compute cash variance
 * Access: Shift owner (self-close) or Manager/Admin
 * Validation: actualCash required; shift must exist and be open; requester must own the shift or be manager/admin
 * Process: Compute expected cash and variance, set closingCash, mark shift closed, clear user.currentShift
 * Response: Closed shift with variance data
 */
export const endShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { actualCash } = req.body;

    // Guard — actualCash required
    if (actualCash === undefined || actualCash === null) {
      return next(errorHandler(400, "Actual cash amount is required"));
    }

    // Find shift by ID
    const shift = await Shift.findById(req.params.shiftId);

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Guard — shift must be open
    if (shift.status !== "open") {
      return next(errorHandler(400, "Shift is already closed"));
    }

    // Guard — requester must be the shift owner or a manager/admin
    const roleName = (req.user?.role as IRole).name;
    const isOwner = shift.staff.toString() === req.user?._id.toString();
    const isManagerOrAdmin = roleName === "manager" || roleName === "admin";

    if (!isOwner && !isManagerOrAdmin) {
      return next(errorHandler(403, "You are not authorised to close this shift"));
    }

    // Compute expected cash and variance
    const expected = shift.openingFloat + shift.salesSummary.cashSales;
    const variance = actualCash - expected;

    // Apply closing data
    shift.closingCash = { expected, actual: actualCash, variance };
    shift.status = "closed";
    shift.endedAt = new Date();
    shift.closedBy = req.user!._id;

    // Save shift
    await shift.save();

    // Notify managers of the branch that the shift closed, with variance
    await createNotification({
      branch: shift.branch as any,
      recipientRole: "manager",
      type: "shift_closed",
      title: "Shift closed",
      message: `Shift ${shift.shiftNumber} closed. Expected KES ${expected}, actual KES ${actualCash}, variance KES ${variance}.`,
      metadata: { shiftId: shift._id, expected, actual: actualCash, variance },
    });

    // Clear currentShift on the staff member
    await User.findByIdAndUpdate(shift.staff, { $unset: { currentShift: 1 } });

    // Populate for response
    await shift.populate([
      { path: "staff" },
      { path: "branch" },
      { path: "closedBy" },
    ]);

    // Return closed shift
    res.status(200).json({
      success: true,
      message: "Shift ended successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get active shifts
 * Purpose: List all currently open shifts for a branch
 * Access: Manager, Admin
 * Validation: None required
 * Process: Find all open shifts, filter by branch query param if provided, populate staff and branch
 * Response: Array of active shifts
 */
export const getActiveShifts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Build filter query
    const query: any = { status: "open" };

    if (req.query.branch) {
      query.branch = req.query.branch;
    }

    // Fetch active shifts
    const shifts = await Shift.find(query)
      .populate("staff")
      .populate("branch")
      .sort({ startedAt: -1 });

    // Return active shifts
    res.status(200).json({
      success: true,
      data: { shifts },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get shift history
 * Purpose: List all shifts with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by branch, staff, status, startDate, endDate; paginate; return results
 * Response: Shift list and pagination
 */
export const getShiftHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, staff, status, startDate, endDate } = req.query;

    // Build filter query
    const query: any = {};

    if (branch) {
      query.branch = branch;
    }
    if (staff) {
      query.staff = staff;
    }
    if (status === "open") {
      query.status = "open";
    }
    if (status === "closed") {
      query.status = "closed";
    }
    if (startDate) {
      query.startedAt = { ...query.startedAt, $gte: new Date(startDate as string) };
    }
    if (endDate) {
      query.startedAt = { ...query.startedAt, $lte: new Date(endDate as string) };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch shifts and total count
    const shifts = await Shift.find(query)
      .populate("staff")
      .populate("branch")
      .populate("closedBy")
      .sort({ startedAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total = await Shift.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        shifts,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalShifts: total,
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
 * Get shift by ID
 * Purpose: Fetch a single shift record
 * Access: All authenticated users
 * Validation: Shift must exist
 * Process: Find shift by ID, populate all references, return
 * Response: Shift details
 */
export const getShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find shift by ID with populated references
    const shift = await Shift.findById(req.params.shiftId)
      .populate("staff")
      .populate("branch")
      .populate("closedBy")
      .populate("varianceReviewedBy");

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Return shift
    res.status(200).json({
      success: true,
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Review variance
 * Purpose: Manager reviews and signs off on a cash variance after shift close
 * Access: Manager, Admin
 * Validation: varianceNotes required; shift must exist and be closed; cannot review twice
 * Process: Set varianceReviewedBy and varianceNotes, save
 * Response: Updated shift
 */
export const reviewVariance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { varianceNotes } = req.body;

    // Guard — varianceNotes required
    if (!varianceNotes) {
      return next(errorHandler(400, "Variance notes are required"));
    }

    // Find shift by ID
    const shift = await Shift.findById(req.params.shiftId);

    // Guard — shift must exist
    if (!shift) {
      return next(errorHandler(404, "Shift not found"));
    }

    // Guard — shift must be closed
    if (shift.status !== "closed") {
      return next(errorHandler(400, "Only closed shifts can have variance reviewed"));
    }

    // Guard — cannot review twice
    if (shift.varianceReviewedBy) {
      return next(errorHandler(409, "Variance has already been reviewed for this shift"));
    }

    // Set variance review fields
    shift.varianceReviewedBy = req.user!._id;
    shift.varianceNotes = varianceNotes;

    // Save and populate
    await shift.save();
    await shift.populate([
      { path: "staff" },
      { path: "branch" },
      { path: "closedBy" },
      { path: "varianceReviewedBy" },
    ]);

    // Return updated shift
    res.status(200).json({
      success: true,
      message: "Variance reviewed successfully",
      data: { shift },
    });
  } catch (error: any) {
    next(error);
  }
};
