import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Payment from "../models/Payment";
import Tab from "../models/Tab";
import {
  payCash as payCashService,
  initiateMpesaPayment as initiateMpesaPaymentService,
  handleMpesaCallback,
  retryMpesaPayment as retryMpesaPaymentService,
  reconcileMpesaPayment,
  reversePayment as reversePaymentService,
} from "../services/internal/paymentService";

/**
 * Pay cash
 * Purpose: Record a cash payment against a tab that is awaiting payment
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: tabId and cashReceived are required
 * Process: Delegates to paymentService.payCash — completes immediately, applies to tab/shift
 * Response: Created payment
 */
export const payCash = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabId, amount, cashReceived } = req.body;

    // Guard — tabId required
    if (!tabId) {
      return next(errorHandler(400, "tabId is required"));
    }
    if (!cashReceived) {
      return next(errorHandler(400, "cashReceived is required"));
    }

    // Record cash payment via service
    const payment = await payCashService({
      tabId,
      amount,
      cashReceived,
      processedBy: req.user?._id as any,
    });

    // Return created payment
    res.status(201).json({
      success: true,
      message: "Cash payment recorded",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Initiate mpesa payment
 * Purpose: Trigger an M-Pesa STK push for a tab that is awaiting payment
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: tabId and phone are required
 * Process: Delegates to paymentService.initiateMpesaPayment — creates a pending payment
 * Response: Created payment with Daraja checkout references
 */
export const initiateMpesaPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabId, phone, amount } = req.body;

    // Guard — tabId required
    if (!tabId) {
      return next(errorHandler(400, "tabId is required"));
    }
    if (!phone) {
      return next(errorHandler(400, "phone is required"));
    }

    // Initiate STK push via service
    const payment = await initiateMpesaPaymentService({
      tabId,
      phone,
      amount,
      processedBy: req.user?._id as any,
    });

    // Return created payment
    res.status(202).json({
      success: true,
      message: "M-Pesa STK push initiated",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * M-Pesa callback
 * Purpose: Receive the asynchronous Daraja STK push result
 * Access: Public — called directly by Safaricom, not by an authenticated app user
 * Validation: None — malformed/unrecognized payloads are logged and ignored
 * Process: Delegates to paymentService.handleMpesaCallback
 * Response: Always a 200 acknowledgement, regardless of internal outcome — Daraja
 *           retries the webhook on anything other than a clean 200, so failures
 *           here are logged internally rather than surfaced via next(error)
 */
export const mpesaCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // Process callback payload via service
    await handleMpesaCallback(req.body);
  } catch (error: any) {
    console.error("Failed to process mpesa callback:", error);
  }

  // Always acknowledge Safaricom with a clean 200
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
};

/**
 * Retry mpesa payment
 * Purpose: Re-attempt a failed M-Pesa payment against the same tab
 * Access: Bartender, Cashier, Manager, Admin
 * Validation: Original payment must exist, be mpesa, and be failed
 * Process: Delegates to paymentService.retryMpesaPayment — creates a new pending payment
 * Response: New payment with fresh Daraja checkout references
 */
export const retryMpesaPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Retry payment via service
    const payment = await retryMpesaPaymentService(req.params.paymentId as string, req.user?._id as any);

    // Return new payment
    res.status(201).json({
      success: true,
      message: "M-Pesa payment retried",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Reverse payment
 * Purpose: Reverse a completed cash or mpesa payment
 * Access: Manager, Admin
 * Validation: reversedReason is required; rest enforced in service
 * Process: Delegates to paymentService.reversePayment
 * Response: Reversed payment
 */
export const reversePayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { reversedReason } = req.body;

    // Guard — reversedReason required
    if (!reversedReason) {
      return next(errorHandler(400, "reversedReason is required"));
    }

    // Reverse payment via service
    const payment = await reversePaymentService(
      req.params.paymentId as string,
      req.user?._id as any,
      reversedReason,
      req.ip
    );

    // Return reversed payment
    res.status(200).json({
      success: true,
      message: "Payment reversed",
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get payment by ID
 * Purpose: Fetch a single payment with full details
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: Payment must exist
 * Process: Find payment by ID and return with populated refs
 * Response: Payment details
 */
export const getPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find payment by ID
    const payment = await Payment.findById(req.params.paymentId)
      .populate("tab", "tabNumber status")
      .populate("branch", "name code")
      .populate("shift", "shiftNumber")
      .populate("processedBy", "firstName lastName")
      .populate("reversedBy", "firstName lastName");

    // Guard — payment must exist
    if (!payment) {
      return next(errorHandler(404, "Payment not found"));
    }

    // Return payment
    res.status(200).json({
      success: true,
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get tab payments
 * Purpose: List all payment records for a given tab
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: Tab must exist
 * Process: Find payments by tab, sorted oldest first
 * Response: Payment list and tab payment summary
 */
export const getTabPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Fetch payments for tab
    const payments = await Payment.find({ tab: tab._id })
      .populate("processedBy", "firstName lastName")
      .sort({ createdAt: 1 });

    // Return payments with tab summary
    res.status(200).json({
      success: true,
      data: {
        payments,
        summary: {
          grandTotal: tab.grandTotal,
          amountPaid: tab.amountPaid,
          balanceDue: tab.balanceDue,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get mpesa payment status
 * Purpose: Manually reconcile a pending M-Pesa payment against Daraja
 * Access: Bartender, Cashier, Manager, Admin, Accountant
 * Validation: checkoutRequestId must match an existing payment
 * Process: Delegates to paymentService.reconcileMpesaPayment — no-op if already resolved
 * Response: Current payment status
 */
export const getMpesaPaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Reconcile payment via service
    const payment = await reconcileMpesaPayment(req.params.checkoutRequestId as string, req.user?._id as any);

    // Return payment
    res.status(200).json({
      success: true,
      data: { payment },
    });
  } catch (error: any) {
    next(error);
  }
};
