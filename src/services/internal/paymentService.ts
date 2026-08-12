import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Payment from "../../models/Payment";
import Tab from "../../models/Tab";
import Shift from "../../models/Shift";
import Branch from "../../models/Branch";
import { completeTab } from "./tabService";
import { generateReceipt } from "./receiptService";
import { generatePaymentNumber } from "../../utils/numberGenerators";
import {
  initiateStkPush,
  parseCallback,
  queryStkPushStatus,
  normalizePhoneNumber,
} from "../external/darajaService";
import { IPayment } from "../../type";

/**
 * Applies a completed payment's effects to its tab and shift: increments
 * amountPaid atomically (mixed cash+mpesa payments can land near-simultaneously),
 * recomputes balanceDue (Tab's pre-save hook only does this when items change),
 * credits the shift's per-method sales counter, and completes the tab via the
 * existing tabService.completeTab once the balance is fully covered.
 */
const applySuccessfulPayment = async (
  payment: IPayment,
  performedBy: string | Types.ObjectId
): Promise<void> => {
  payment.status = "completed";
  await payment.save();

  const tab = await Tab.findByIdAndUpdate(
    payment.tab,
    { $inc: { amountPaid: payment.amount } },
    { new: true }
  );

  if (!tab) {
    throw errorHandler(404, "Tab not found for payment");
  }

  tab.balanceDue = tab.grandTotal - tab.amountPaid;
  await tab.save();

  const salesField = payment.method === "cash" ? "salesSummary.cashSales" : "salesSummary.mpesaSales";
  await Shift.findByIdAndUpdate(payment.shift, { $inc: { [salesField]: payment.amount } });

  if (tab.balanceDue <= 0) {
    await completeTab(tab._id as Types.ObjectId, performedBy);
    await generateReceipt({
      tabId: tab._id as Types.ObjectId,
      paymentId: payment._id as Types.ObjectId,
      performedBy,
      type: "sale",
    });
  }
};

/**
 * Marks a pending mpesa payment successful and applies its effects.
 * Shared by the Daraja webhook and manual status reconciliation.
 */
const completeMpesaPayment = async (
  payment: IPayment,
  details: { mpesaReceiptNumber?: string; resultCode?: number; resultDesc?: string },
  performedBy: string | Types.ObjectId
): Promise<IPayment> => {
  const mpesa = { ...payment.mpesa };
  if (details.mpesaReceiptNumber !== undefined) {
    mpesa.mpesaReceiptNumber = details.mpesaReceiptNumber;
  }
  if (details.resultCode !== undefined) {
    mpesa.resultCode = details.resultCode;
  }
  if (details.resultDesc !== undefined) {
    mpesa.resultDesc = details.resultDesc;
  }
  payment.mpesa = mpesa;
  await payment.save();

  await applySuccessfulPayment(payment, performedBy);

  return payment;
};

/**
 * Marks a pending mpesa payment failed. No tab/shift mutation.
 * Shared by the Daraja webhook and manual status reconciliation.
 */
const failMpesaPayment = async (
  payment: IPayment,
  details: { resultCode?: number; resultDesc?: string }
): Promise<IPayment> => {
  payment.status = "failed";
  const mpesa = { ...payment.mpesa };
  if (details.resultCode !== undefined) {
    mpesa.resultCode = details.resultCode;
  }
  if (details.resultDesc !== undefined) {
    mpesa.resultDesc = details.resultDesc;
  }
  payment.mpesa = mpesa;
  await payment.save();

  return payment;
};

/**
 * Records a cash payment against a tab. Cash is always synchronous —
 * completed immediately, no pending state.
 */
export const payCash = async (input: {
  tabId: string | Types.ObjectId;
  amount?: number;
  cashReceived: number;
  processedBy: string | Types.ObjectId;
}): Promise<IPayment> => {
  const tab = await Tab.findById(input.tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  if (tab.status !== "awaiting_payment") {
    throw errorHandler(409, "Tab must be awaiting payment to accept a payment");
  }

  const amount = input.amount ?? tab.balanceDue;

  if (amount <= 0) {
    throw errorHandler(400, "Payment amount must be greater than zero");
  }

  if (amount > tab.balanceDue) {
    throw errorHandler(400, "Payment amount cannot exceed the tab's balance due");
  }

  if (input.cashReceived < amount) {
    throw errorHandler(400, "Cash received is less than the payment amount");
  }

  const branchDoc = await Branch.findById(tab.branch);
  const paymentNumber = await generatePaymentNumber(branchDoc?.code, tab.branch.toString());

  const payment = await Payment.create({
    paymentNumber,
    tab: tab._id,
    branch: tab.branch,
    shift: tab.shift,
    method: "cash",
    amount,
    status: "pending",
    cashReceived: input.cashReceived,
    cashChange: input.cashReceived - amount,
    processedBy: input.processedBy,
  });

  await applySuccessfulPayment(payment, input.processedBy);

  return payment;
};

/**
 * Initiates an mpesa STK push payment against a tab. Creates the Payment
 * as pending — it is flipped to completed/failed by the Daraja callback.
 */
export const initiateMpesaPayment = async (input: {
  tabId: string | Types.ObjectId;
  phone: string;
  amount?: number;
  processedBy: string | Types.ObjectId;
}): Promise<IPayment> => {
  const tab = await Tab.findById(input.tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  if (tab.status !== "awaiting_payment") {
    throw errorHandler(409, "Tab must be awaiting payment to accept a payment");
  }

  const amount = input.amount ?? tab.balanceDue;

  if (amount <= 0) {
    throw errorHandler(400, "Payment amount must be greater than zero");
  }

  if (amount > tab.balanceDue) {
    throw errorHandler(400, "Payment amount cannot exceed the tab's balance due");
  }

  const normalizedPhone = normalizePhoneNumber(input.phone);

  const daraja = await initiateStkPush({
    amount,
    phone: normalizedPhone,
    accountReference: tab.tabNumber,
    transactionDesc: `Tab ${tab.tabNumber} payment`,
  });

  const branchDoc = await Branch.findById(tab.branch);
  const paymentNumber = await generatePaymentNumber(branchDoc?.code, tab.branch.toString());

  const payment = await Payment.create({
    paymentNumber,
    tab: tab._id,
    branch: tab.branch,
    shift: tab.shift,
    method: "mpesa",
    amount,
    status: "pending",
    mpesa: {
      phone: normalizedPhone,
      checkoutRequestId: daraja.checkoutRequestId,
      merchantRequestId: daraja.merchantRequestId,
    },
    processedBy: input.processedBy,
  });

  return payment;
};

/**
 * Processes a Daraja STK callback payload. Silently ignores payloads that
 * don't match a known pending payment — the webhook controller always acks
 * Safaricom with 200 regardless, so failures here are logged, not thrown.
 */
export const handleMpesaCallback = async (body: any): Promise<void> => {
  const parsed = parseCallback(body);

  if (!parsed.valid) {
    return;
  }

  const payment = await Payment.findOne({ "mpesa.checkoutRequestId": parsed.checkoutRequestId });

  if (!payment) {
    return;
  }

  if (payment.status !== "pending") {
    return;
  }

  if (parsed.success) {
    await completeMpesaPayment(
      payment,
      {
        mpesaReceiptNumber: parsed.mpesaReceiptNumber,
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
      },
      payment.processedBy as Types.ObjectId
    );
  } else {
    await failMpesaPayment(payment, {
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
    });
  }
};

/**
 * Retries a failed mpesa payment by creating a NEW Payment record — the
 * failed one is left untouched as history, since this codebase has no
 * AuditLog to otherwise preserve what happened on the first attempt.
 */
export const retryMpesaPayment = async (
  paymentId: string | Types.ObjectId,
  processedBy: string | Types.ObjectId
): Promise<IPayment> => {
  const failedPayment = await Payment.findById(paymentId);
  if (!failedPayment) {
    throw errorHandler(404, "Payment not found");
  }

  if (failedPayment.method !== "mpesa") {
    throw errorHandler(400, "Only mpesa payments can be retried");
  }

  if (failedPayment.status !== "failed") {
    throw errorHandler(409, "Only a failed payment can be retried");
  }

  const tab = await Tab.findById(failedPayment.tab);
  if (!tab) {
    throw errorHandler(404, "Tab not found for payment");
  }

  if (tab.status !== "awaiting_payment") {
    throw errorHandler(409, "Tab must be awaiting payment to retry a payment");
  }

  if (failedPayment.amount > tab.balanceDue) {
    throw errorHandler(400, "Payment amount exceeds the tab's current balance due");
  }

  const phone = failedPayment.mpesa?.phone;
  if (!phone) {
    throw errorHandler(400, "Original payment has no phone number to retry");
  }

  const daraja = await initiateStkPush({
    amount: failedPayment.amount,
    phone,
    accountReference: tab.tabNumber,
    transactionDesc: `Tab ${tab.tabNumber} payment (retry)`,
  });

  const branchDoc = await Branch.findById(tab.branch);
  const paymentNumber = await generatePaymentNumber(branchDoc?.code, tab.branch.toString());

  const payment = await Payment.create({
    paymentNumber,
    tab: tab._id,
    branch: tab.branch,
    shift: tab.shift,
    method: "mpesa",
    amount: failedPayment.amount,
    status: "pending",
    mpesa: {
      phone,
      checkoutRequestId: daraja.checkoutRequestId,
      merchantRequestId: daraja.merchantRequestId,
    },
    processedBy,
  });

  return payment;
};

/**
 * Manually reconciles a pending mpesa payment against Daraja, for when the
 * webhook never arrives. No-ops (idempotent) once the payment has already
 * resolved, so repeated polling never re-queries Daraja unnecessarily.
 */
export const reconcileMpesaPayment = async (
  checkoutRequestId: string,
  performedBy: string | Types.ObjectId
): Promise<IPayment> => {
  const payment = await Payment.findOne({ "mpesa.checkoutRequestId": checkoutRequestId });
  if (!payment) {
    throw errorHandler(404, "Payment not found for this checkout request");
  }

  if (payment.status !== "pending") {
    return payment;
  }

  const result = await queryStkPushStatus(checkoutRequestId);

  if (!result.ok) {
    throw errorHandler(502, result.error || "Failed to query Daraja API");
  }

  if (result.resultCode === 0) {
    await completeMpesaPayment(
      payment,
      { resultCode: result.resultCode, resultDesc: result.resultDesc },
      performedBy
    );
  } else {
    await failMpesaPayment(payment, { resultCode: result.resultCode, resultDesc: result.resultDesc });
  }

  return payment;
};

/**
 * Reverses a completed payment (cash or mpesa). Blocked once the tab has
 * completed (stock already deducted, no refund path exists yet) or once the
 * shift has closed (its cash reconciliation already ran against salesSummary).
 */
export const reversePayment = async (
  paymentId: string | Types.ObjectId,
  reversedBy: string | Types.ObjectId,
  reversedReason: string
): Promise<IPayment> => {
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw errorHandler(404, "Payment not found");
  }

  if (payment.status !== "completed") {
    throw errorHandler(409, "Only a completed payment can be reversed");
  }

  const tab = await Tab.findById(payment.tab);
  if (!tab) {
    throw errorHandler(404, "Tab not found for payment");
  }

  if (tab.status === "completed") {
    throw errorHandler(409, "Payment cannot be reversed once the tab is completed");
  }

  const shift = await Shift.findById(payment.shift);
  if (!shift) {
    throw errorHandler(404, "Shift not found for payment");
  }

  if (shift.status === "closed") {
    throw errorHandler(409, "Payment cannot be reversed after the shift has been closed");
  }

  payment.status = "reversed";
  payment.reversedBy = reversedBy as any;
  payment.reversedReason = reversedReason;
  await payment.save();

  tab.amountPaid -= payment.amount;
  tab.balanceDue = tab.grandTotal - tab.amountPaid;
  await tab.save();

  const salesField = payment.method === "cash" ? "salesSummary.cashSales" : "salesSummary.mpesaSales";
  await Shift.findByIdAndUpdate(payment.shift, { $inc: { [salesField]: -payment.amount } });

  return payment;
};
