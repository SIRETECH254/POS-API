import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Settings from "../models/Settings";
import Branch from "../models/Branch";

/**
 * Finds a branch's Settings document, creating one with sane defaults on
 * first access. One document per branch — every write path in this
 * controller goes through this so no branch is ever left without one.
 */
const getOrCreateSettings = async (branchId: string) => {
  let settings = await Settings.findOne({ branch: branchId });

  if (!settings) {
    const branchDoc = await Branch.findById(branchId);
    if (!branchDoc) {
      throw errorHandler(404, "Branch not found");
    }

    settings = await Settings.create({
      branch: branchDoc._id,
      businessName: branchDoc.name,
      phone: branchDoc.phone || "",
    });
  }

  return settings;
};

/**
 * Get settings
 * Purpose: Fetch a branch's Settings document, creating one on first access
 * Access: Any authenticated user
 * Validation: Branch must exist
 * Process: Delegates to getOrCreateSettings
 * Response: Settings document
 */
export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Return settings
    res.status(200).json({
      success: true,
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update settings
 * Purpose: Update general branch settings
 * Access: Manager, Admin
 * Validation: Branch must exist
 * Process: Find or create settings, apply provided fields, stamp updatedBy, save
 * Response: Updated settings document
 */
export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const {
      businessName,
      address,
      phone,
      taxRate,
      currency,
      paymentMethodsEnabled,
      lowStockThresholdDefault,
      theme,
    } = req.body;

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply updates
    if (businessName !== undefined) {
      settings.businessName = businessName;
    }
    if (address !== undefined) {
      settings.address = address;
    }
    if (phone !== undefined) {
      settings.phone = phone;
    }
    if (taxRate !== undefined) {
      settings.taxRate = taxRate;
    }
    if (currency !== undefined) {
      settings.currency = currency;
    }
    if (paymentMethodsEnabled !== undefined) {
      settings.paymentMethodsEnabled = paymentMethodsEnabled;
    }
    if (lowStockThresholdDefault !== undefined) {
      settings.lowStockThresholdDefault = lowStockThresholdDefault;
    }
    if (theme !== undefined) {
      settings.theme = theme;
    }
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update printer config
 * Purpose: Update a branch's printer configuration
 * Access: Manager, Admin
 * Validation: Branch must exist; type is required
 * Process: Find or create settings, replace printerConfig, stamp updatedBy, save
 * Response: Updated settings document
 */
export const updatePrinterConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { type, target } = req.body;

    // Guard — type required
    if (!type) {
      return next(errorHandler(400, "type is required"));
    }

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply printer config
    settings.printerConfig = { type, target: target || "" };
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Printer config updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update receipt layout
 * Purpose: Update a branch's receipt footer note
 * Access: Manager, Admin
 * Validation: Branch must exist; receiptFooterNote is required
 * Process: Find or create settings, replace receiptFooterNote, stamp updatedBy, save
 * Response: Updated settings document
 */
export const updateReceiptLayout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { receiptFooterNote } = req.body;

    // Guard — receiptFooterNote required
    if (receiptFooterNote === undefined) {
      return next(errorHandler(400, "receiptFooterNote is required"));
    }

    // Find or create settings for the branch
    const settings = await getOrCreateSettings(req.params.branchId as string);

    // Apply receipt layout
    settings.receiptFooterNote = receiptFooterNote;
    settings.updatedBy = req.user?._id as any;

    // Save and return
    await settings.save();
    res.status(200).json({
      success: true,
      message: "Receipt layout updated successfully",
      data: { settings },
    });
  } catch (error: any) {
    next(error);
  }
};
