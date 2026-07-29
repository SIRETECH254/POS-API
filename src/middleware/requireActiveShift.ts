import type { Request, Response, NextFunction } from "express";
import Shift from "../models/Shift";

/**
 * Blocks access when the authenticated user has no open shift at their branch.
 * Applied to Tab routes — a bartender cannot open a tab without an active shift.
 */
export const requireActiveShift = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user?.currentShift) {
    res.status(403).json({
      success: false,
      message: "No active shift. Start a shift before opening a tab.",
    });
    return;
  }

  const shift = await Shift.findById(req.user.currentShift);

  if (!shift || shift.status !== "open") {
    res.status(403).json({
      success: false,
      message: "Your shift is not active. Start a new shift to continue.",
    });
    return;
  }

  next();
};
