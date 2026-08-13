import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Notification from "../models/Notification";

/**
 * Get my notifications
 * Purpose: List the authenticated user's notifications, filterable and paginated
 * Access: Any authenticated user
 * Validation: None required
 * Process: Filter by recipient (always the caller) and optional isRead, paginate, return results
 * Response: Notification list and pagination
 */
export const getMyNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, isRead } = req.query;

    // Build filter query — always scoped to the caller
    const query: any = { recipient: req.user?._id };
    if (isRead !== undefined) {
      query.isRead = isRead === "true";
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch notifications and total count
    const notifications = await Notification.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Notification.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalNotifications: total,
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
 * Get unread count
 * Purpose: Count the authenticated user's unread notifications, for a bell badge
 * Access: Any authenticated user
 * Validation: None required
 * Process: Count notifications scoped to the caller with isRead false
 * Response: Unread count
 */
export const getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Count unread notifications for the caller
    const count = await Notification.countDocuments({ recipient: req.user?._id, isRead: false });

    // Return count
    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Mark notification as read
 * Purpose: Mark a single notification read
 * Access: Any authenticated user
 * Validation: Notification must exist and belong to the caller
 * Process: Find by ID scoped to the caller, set isRead/readAt
 * Response: Updated notification
 */
export const markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find notification scoped to the caller
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      recipient: req.user?._id,
    });

    // Guard — notification must exist and belong to the caller
    if (!notification) {
      return next(errorHandler(404, "Notification not found"));
    }

    // Mark read
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    // Return updated notification
    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: { notification },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Mark all notifications as read
 * Purpose: Mark every one of the caller's unread notifications read in one call
 * Access: Any authenticated user
 * Validation: None required
 * Process: Bulk update scoped to the caller
 * Response: Number of notifications marked read
 */
export const markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Bulk mark read, scoped to the caller
    const result = await Notification.updateMany(
      { recipient: req.user?._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    // Return count
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error: any) {
    next(error);
  }
};
