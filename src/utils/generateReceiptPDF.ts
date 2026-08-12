import PDFDocument from "pdfkit";
import { ReceiptType } from "../type";

interface ReceiptPdfItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ReceiptPdfData {
  receiptNumber: string;
  type: ReceiptType;
  branchName: string;
  branchPhone?: string;
  tabNumber: string;
  table?: string;
  items: ReceiptPdfItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  amount: number;
  refundReason?: string;
  generatedAt: Date;
}

/**
 * Renders a receipt as a PDF buffer using pdfkit. Kept to a plain,
 * thermal-printer-width-friendly layout — no logo/styling.
 */
export const renderReceiptPdf = (data: ReceiptPdfData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [226, 600], margin: 12 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(12).text(data.branchName, { align: "center" });
    if (data.branchPhone) {
      doc.fontSize(8).text(data.branchPhone, { align: "center" });
    }
    doc.moveDown(0.5);

    doc.fontSize(9).text(`Receipt: ${data.receiptNumber}`);
    doc.text(`Type: ${data.type.toUpperCase()}`);
    doc.text(`Tab: ${data.tabNumber}`);
    if (data.table) {
      doc.text(`Table: ${data.table}`);
    }
    doc.text(`Date: ${data.generatedAt.toISOString()}`);
    doc.moveDown(0.5);
    doc.text("--------------------------------");

    for (const item of data.items) {
      doc.text(`${item.name} x${item.quantity}`);
      doc.text(`  @ ${item.unitPrice.toFixed(2)}  = ${item.subtotal.toFixed(2)}`, { align: "right" });
    }

    doc.text("--------------------------------");
    doc.text(`Subtotal: ${data.subtotal.toFixed(2)}`, { align: "right" });
    doc.text(`Discount: ${data.discountTotal.toFixed(2)}`, { align: "right" });
    doc.text(`Tax: ${data.taxTotal.toFixed(2)}`, { align: "right" });
    doc.text(`Grand Total: ${data.grandTotal.toFixed(2)}`, { align: "right" });

    if (data.type === "refund") {
      doc.moveDown(0.5);
      doc.text(`Refund Amount: ${data.amount.toFixed(2)}`, { align: "right" });
      if (data.refundReason) {
        doc.text(`Reason: ${data.refundReason}`);
      }
    }

    doc.moveDown(1);
    doc.fontSize(8).text("Thank you for your business!", { align: "center" });

    doc.end();
  });
};
