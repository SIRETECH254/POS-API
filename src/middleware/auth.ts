import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import User from "../models/User";
import { IUser, UserRole } from "../type";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

/**
 * Verify JWT token and load the user onto req.user
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({ success: false, message: "Access token required" });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "User unauthorized or inactive" });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

/**
 * Enforce role-based access control
 */
export const authorizeRoles = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      res.status(403).json({ success: false, message: "Insufficient permissions for this action" });
      return;
    }

    next();
  };
};
