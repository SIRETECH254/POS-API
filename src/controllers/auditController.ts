import type { Request, Response, NextFunction } from "express";
import AuditLog from "../models/AuditLog";

/**
 * Get audit logs
 * Purpose: List audit log entries with filtering and pagination
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by branch/user/entityType/action/date range, paginate, return results
 * Response: Audit log list and pagination
 */
export const getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, branch, user, entityType, action, from, to } = req.query;

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (user) {
      query.user = user;
    }
    if (entityType) {
      query.entityType = entityType;
    }
    if (action) {
      query.action = action;
    }
    if (from || to) {
      query.createdAt = {};
      if (from) {
        query.createdAt.$gte = new Date(from as string);
      }
      if (to) {
        query.createdAt.$lte = new Date(to as string);
      }
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch audit logs and total count
    const auditLogs = await AuditLog.find(query)
      .populate("branch", "name code")
      .populate("user", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await AuditLog.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        auditLogs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalAuditLogs: total,
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
 * Get entity history
 * Purpose: List every audit log entry recorded against a single entity
 * Access: Manager, Admin
 * Validation: None required
 * Process: Filter by entityType/entityId from the path, paginate, return oldest first
 * Response: Audit log list and pagination
 */
export const getEntityHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract path and query parameters
    const { entityType, entityId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch audit logs and total count, oldest first — a history read top to bottom
    const query = { entityType, entityId };
    const auditLogs = await AuditLog.find(query)
      .populate("branch", "name code")
      .populate("user", "firstName lastName")
      .sort({ createdAt: "asc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await AuditLog.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        auditLogs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalAuditLogs: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
