import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Tab from "../models/Tab";
import Branch from "../models/Branch";
import Product from "../models/Product";
import Shift from "../models/Shift";
import { IRole } from "../type";
import { generateTabNumber } from "../utils/numberGenerators";
import { mergeTabs as mergeTabsService, splitBill as splitBillService } from "../services/internal/tabService";
import { createNotification } from "../services/internal/notificationService";
import { logAudit } from "../services/internal/auditService";

/**
 * Resolves the branch a list endpoint should be scoped to.
 * Admin/accountant may pass an explicit `branch` query param for a cross-branch view;
 * everyone else is scoped to their own assigned branch.
 */
const resolveBranchFilter = (req: Request): string | undefined => {
  const roleName = (req.user?.role as IRole)?.name;
  if (req.query.branch && (roleName === "admin" || roleName === "accountant")) {
    return req.query.branch as string;
  }
  return req.user?.branch ? String(req.user.branch) : undefined;
};

/**
 * Create tab
 * Purpose: Open a new sale tab at the requesting staff member's branch
 * Access: Bartender, Manager, Admin
 * Validation: Staff must be assigned to a branch; requires an active shift (enforced by requireActiveShift)
 * Process: Generate tab number, create tab in "open" status, increment shift.salesSummary.tabsOpened
 * Response: Created tab
 */
export const createTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { table } = req.body;

    // Guard — staff must be assigned to a branch
    if (!req.user?.branch) {
      return next(errorHandler(400, "You are not assigned to a branch"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(req.user.branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Generate tab number
    const tabNumber = await generateTabNumber(branchDoc.code, String(branchDoc._id));

    // Create tab
    const tab = await Tab.create({
      tabNumber,
      branch: branchDoc._id,
      table,
      openedBy: req.user._id,
      shift: req.user.currentShift,
      status: "open",
    });

    // Increment shift tabsOpened counter
    await Shift.findByIdAndUpdate(req.user.currentShift, {
      $inc: { "salesSummary.tabsOpened": 1 },
    });

    // Return created tab
    res.status(201).json({
      success: true,
      message: "Tab opened successfully",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get open tabs
 * Purpose: List tabs currently open or held at the requesting branch
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch and status in [open, held]
 * Response: List of open/held tabs
 */
export const getOpenTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Resolve branch scope
    const branch = resolveBranchFilter(req);

    // Build filter query
    const query: any = { status: { $in: ["open", "held"] } };
    if (branch) {
      query.branch = branch;
    }

    // Fetch open/held tabs
    const tabs = await Tab.find(query)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .sort({ createdAt: "desc" });

    // Return tabs
    res.status(200).json({
      success: true,
      data: { tabs },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get tab by ID
 * Purpose: Fetch a single tab with full details
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: Tab must exist
 * Process: Find tab by ID and return with populated refs
 * Response: Tab details
 */
export const getTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab by ID
    const tab = await Tab.findById(req.params.tabId)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .populate("closedBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — tab must exist
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Return tab
    res.status(200).json({
      success: true,
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Add item to tab
 * Purpose: Add a product/SKU line item to an open or held tab
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and be open/held; product and SKU must exist
 * Process: Snapshot name/price from the SKU, push item, save (recalculates totals)
 * Response: Updated tab
 */
export const addItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { product, sku, quantity, discount = 0 } = req.body;

    // Guard — required fields
    if (!product) {
      return next(errorHandler(400, "Product is required"));
    }
    if (!sku) {
      return next(errorHandler(400, "SKU is required"));
    }
    if (!quantity || quantity < 1) {
      return next(errorHandler(400, "Quantity must be at least 1"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be added to an open or held tab"));
    }

    // Guard — product must exist
    const productDoc = await Product.findById(product);
    if (!productDoc) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — SKU must exist on the product
    const skuDoc = productDoc.skus.id(sku);
    if (!skuDoc) {
      return next(errorHandler(404, "SKU not found on product"));
    }

    // Snapshot name/price and compute line subtotal
    const subtotal = quantity * skuDoc.sellingPrice - discount;

    // Push item onto tab
    tab.items.push({
      product: productDoc._id,
      sku: skuDoc._id,
      name: productDoc.name,
      unitPrice: skuDoc.sellingPrice,
      quantity,
      discount,
      subtotal,
      status: "active",
      addedBy: req.user?._id,
      addedAt: new Date(),
    } as any);

    // Save tab (totals recalculated in pre-save hook)
    await tab.save();

    // Return updated tab
    res.status(201).json({
      success: true,
      message: "Item added to tab",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Update item quantity
 * Purpose: Change the quantity of an active line item on a tab
 * Access: Bartender, Manager, Admin
 * Validation: Tab and item must exist; item must be active; quantity must be at least 1
 * Process: Update quantity and recompute the line subtotal, save
 * Response: Updated tab
 */
export const updateItemQuantity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { quantity } = req.body;

    // Guard — quantity required
    if (!quantity || quantity < 1) {
      return next(errorHandler(400, "Quantity must be at least 1"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be updated on an open or held tab"));
    }

    // Find item
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Guard — item must be active
    if (item.status !== "active") {
      return next(errorHandler(409, "Cancelled items cannot be updated"));
    }

    // Update quantity and recompute subtotal
    item.quantity = quantity;
    item.subtotal = quantity * item.unitPrice - item.discount;

    // Save tab (totals recalculated in pre-save hook)
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item quantity updated",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Remove item from tab
 * Purpose: Delete a line item from an open or held tab
 * Access: Bartender, Manager, Admin
 * Validation: Tab and item must exist
 * Process: Remove the item subdocument, save
 * Response: Updated tab
 */
export const removeItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be removed from an open or held tab"));
    }

    // Guard — item must exist
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Remove item and save (totals recalculated in pre-save hook)
    tab.items.pull(req.params.itemId as string);
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item removed from tab",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Cancel item
 * Purpose: Mark a single line item as cancelled without deleting it
 * Access: Bartender, Manager, Admin
 * Validation: Tab and item must exist; item must be active
 * Process: Set item status to cancelled, save
 * Response: Updated tab
 */
export const cancelItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be cancelled on an open or held tab"));
    }

    // Find item
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Guard — item must currently be active
    if (item.status !== "active") {
      return next(errorHandler(409, "Item is already cancelled"));
    }

    // Cancel item and save (totals recalculated in pre-save hook)
    item.status = "cancelled";
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item cancelled",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Hold tab
 * Purpose: Put an open tab on hold
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and be open; holdReason is required
 * Process: Set status to held with the given reason
 * Response: Updated tab
 */
export const holdTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { holdReason } = req.body;

    // Guard — hold reason required
    if (!holdReason) {
      return next(errorHandler(400, "Hold reason is required"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must currently be open
    if (tab.status !== "open") {
      return next(errorHandler(409, "Only an open tab can be held"));
    }

    // Put tab on hold
    tab.status = "held";
    tab.holdReason = holdReason;
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab put on hold",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Resume tab
 * Purpose: Resume a held tab back to open
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and be held
 * Process: Set status back to open, clear hold reason
 * Response: Updated tab
 */
export const resumeTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must currently be held
    if (tab.status !== "held") {
      return next(errorHandler(409, "Only a held tab can be resumed"));
    }

    // Resume tab
    tab.status = "open";
    tab.holdReason = undefined;
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab resumed",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Merge tabs
 * Purpose: Merge one or more tabs into a single target tab on the same branch
 * Access: Bartender, Manager, Admin
 * Validation: At least two tab IDs required; all tabs must share a branch and be open/held
 * Process: Delegates to tabService.mergeTabs — appends active items into the target, cancels sources
 * Response: Merged target tab
 */
export const mergeTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabIds } = req.body;

    // Guard — at least two tabs required
    if (!tabIds || !Array.isArray(tabIds) || tabIds.length < 2) {
      return next(errorHandler(400, "At least two tab IDs are required to merge"));
    }

    // Merge tabs via service
    const target = await mergeTabsService(tabIds, req.user?._id as any);

    // Return merged tab
    res.status(200).json({
      success: true,
      message: "Tabs merged successfully",
      data: { tab: target },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Split bill
 * Purpose: Split a tab's active items into multiple new tabs
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and be open/held; groups must exactly partition the active items
 * Process: Delegates to tabService.splitBill — creates new tabs per group, cancels the original
 * Response: Newly created tabs
 */
export const splitBill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { groups } = req.body;

    // Guard — at least two groups required
    if (!groups || !Array.isArray(groups) || groups.length < 2) {
      return next(errorHandler(400, "At least two item groups are required to split a bill"));
    }

    // Split bill via service
    const newTabs = await splitBillService(req.params.tabId as string, groups, req.user?._id as any);

    // Return new tabs
    res.status(201).json({
      success: true,
      message: "Bill split successfully",
      data: { tabs: newTabs },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Cancel tab
 * Purpose: Cancel a tab before payment
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and not already be completed/cancelled/archived; cancelReason required
 * Process: Set status to cancelled, increment shift.salesSummary.tabsCancelled
 * Response: Updated tab
 */
export const cancelTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { cancelReason } = req.body;

    // Guard — cancel reason required
    if (!cancelReason) {
      return next(errorHandler(400, "Cancel reason is required"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must not already be completed, cancelled, or archived
    if (tab.status === "completed" || tab.status === "cancelled" || tab.status === "archived") {
      return next(errorHandler(409, "Tab cannot be cancelled in its current status"));
    }

    // Snapshot pre-cancellation status
    const statusBefore = tab.status;

    // Cancel tab
    tab.status = "cancelled";
    tab.cancelReason = cancelReason;
    await tab.save();

    // Audit the cancellation
    await logAudit({
      branch: tab.branch as any,
      user: req.user?._id as any,
      action: "TAB_CANCELLED",
      entityType: "Tab",
      entityId: tab._id as any,
      before: { status: statusBefore },
      after: { status: "cancelled", cancelReason },
      ipAddress: req.ip,
    });

    // Increment shift tabsCancelled counter
    await Shift.findByIdAndUpdate(tab.shift, {
      $inc: { "salesSummary.tabsCancelled": 1 },
    });

    // Notify managers of the branch
    await createNotification({
      branch: tab.branch as any,
      recipientRole: "manager",
      type: "tab_cancelled",
      title: "Tab cancelled",
      message: `Tab ${tab.tabNumber} was cancelled: ${cancelReason}`,
      metadata: { tabId: tab._id, cancelReason },
    });

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab cancelled",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Close tab
 * Purpose: Close an open/held tab out for payment
 * Access: Bartender, Manager, Admin
 * Validation: Tab must exist and be open/held
 * Process: Set status to awaiting_payment
 * Response: Updated tab
 */
export const closeTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Only an open or held tab can be closed"));
    }

    // Move tab to awaiting payment
    tab.status = "awaiting_payment";
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab closed, awaiting payment",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get all tabs
 * Purpose: List tab history with filtering and pagination
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: None required
 * Process: Filter by branch/status/search, paginate, return results
 * Response: Tab list and pagination
 */
export const getAllTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, status, search } = req.query;

    // Resolve branch scope
    const branch = resolveBranchFilter(req);

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (status) {
      query.status = status;
    }
    if (search) {
      query.tabNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch tabs and total count
    const tabs = await Tab.find(query)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Tab.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        tabs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalTabs: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
