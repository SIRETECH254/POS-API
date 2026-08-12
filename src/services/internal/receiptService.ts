import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Receipt from "../../models/Receipt";
import Tab from "../../models/Tab";
import Branch from "../../models/Branch";
import { uploadToCloudinary } from "../../config/cloudinary";
import { renderReceiptPdf } from "../../utils/generateReceiptPDF";
import { generateReceiptNumber } from "../../utils/numberGenerators";
import { IReceipt, ITab, ReceiptType } from "../../type";

/**
 * Renders a receipt PDF for the given tab, uploads it to Cloudinary as a raw
 * asset, and persists the Receipt record. Shared by the automatic "sale"
 * receipt and the manual "refund" receipt — both need a fresh PDF snapshot.
 */
const buildReceipt = async (
  tab: ITab,
  input: {
    paymentId?: string | Types.ObjectId;
    performedBy: string | Types.ObjectId;
    type: ReceiptType;
    amount: number;
    refundReason?: string;
  }
): Promise<IReceipt> => {
  const branch = await Branch.findById(tab.branch);

  const activeItems = tab.items.filter((item) => item.status === "active");

  const receiptNumber = await generateReceiptNumber(branch?.code, tab.branch.toString());

  const pdfBuffer = await renderReceiptPdf({
    receiptNumber,
    type: input.type,
    branchName: branch?.name || "POS",
    ...(branch?.phone ? { branchPhone: branch.phone } : {}),
    tabNumber: tab.tabNumber,
    ...(tab.table ? { table: tab.table } : {}),
    items: activeItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    subtotal: tab.subtotal,
    discountTotal: tab.discountTotal,
    taxTotal: tab.taxTotal,
    grandTotal: tab.grandTotal,
    amount: input.amount,
    ...(input.refundReason ? { refundReason: input.refundReason } : {}),
    generatedAt: new Date(),
  });

  const uploadResult = await uploadToCloudinary(pdfBuffer, "pos-api/receipts", "raw");

  const receipt = await Receipt.create({
    receiptNumber,
    branch: tab.branch,
    tab: tab._id,
    payment: input.paymentId,
    type: input.type,
    amount: input.amount,
    pdfUrl: uploadResult.url,
    pdfPublicId: uploadResult.public_id,
    generatedBy: input.performedBy,
    refundReason: input.refundReason,
  });

  return receipt;
};

/**
 * Generates the "sale" receipt for a tab. Called automatically by
 * paymentService.applySuccessfulPayment once a payment brings the tab's
 * balance to zero.
 */
export const generateReceipt = async (input: {
  tabId: string | Types.ObjectId;
  paymentId?: string | Types.ObjectId;
  performedBy: string | Types.ObjectId;
  type?: ReceiptType;
}): Promise<IReceipt> => {
  const tab = await Tab.findById(input.tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  return buildReceipt(tab, {
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    performedBy: input.performedBy,
    type: input.type || "sale",
    amount: tab.grandTotal,
  });
};

/**
 * Marks a tab's sale receipt as printed. Idempotent — calling it again just
 * refreshes printedAt/printedBy.
 */
export const printReceipt = async (
  tabId: string | Types.ObjectId,
  performedBy: string | Types.ObjectId
): Promise<IReceipt> => {
  const receipt = await Receipt.findOne({ tab: tabId, type: "sale" }).sort({ createdAt: -1 });
  if (!receipt) {
    throw errorHandler(404, "No receipt found for this tab");
  }

  receipt.printedAt = new Date();
  receipt.printedBy = performedBy as any;
  await receipt.save();

  return receipt;
};

/**
 * Issues a reprint: a new Receipt record (its own number, its own audit
 * trail) that reuses the original sale receipt's PDF — the content hasn't
 * changed, only the fact that it was printed again.
 */
export const reprintReceipt = async (
  tabId: string | Types.ObjectId,
  performedBy: string | Types.ObjectId
): Promise<IReceipt> => {
  const source = await Receipt.findOne({ tab: tabId, type: "sale" }).sort({ createdAt: -1 });
  if (!source) {
    throw errorHandler(404, "No receipt found for this tab");
  }

  const branch = await Branch.findById(source.branch);
  const receiptNumber = await generateReceiptNumber(branch?.code, source.branch.toString());

  const reprint = await Receipt.create({
    receiptNumber,
    branch: source.branch,
    tab: source.tab,
    payment: source.payment,
    type: "reprint",
    amount: source.amount,
    pdfUrl: source.pdfUrl,
    pdfPublicId: source.pdfPublicId,
    generatedBy: performedBy,
    printedAt: new Date(),
    printedBy: performedBy,
  });

  return reprint;
};

/**
 * Generates a "refund" receipt for a tab. Manual only — not tied to
 * paymentService.reversePayment.
 */
export const generateRefundReceipt = async (
  tabId: string | Types.ObjectId,
  performedBy: string | Types.ObjectId,
  input: { amount: number; reason: string }
): Promise<IReceipt> => {
  const tab = await Tab.findById(tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  if (input.amount <= 0) {
    throw errorHandler(400, "Refund amount must be greater than zero");
  }

  if (input.amount > tab.amountPaid) {
    throw errorHandler(400, "Refund amount cannot exceed the tab's amount paid");
  }

  return buildReceipt(tab, {
    performedBy,
    type: "refund",
    amount: input.amount,
    refundReason: input.reason,
  });
};
 