import mongoose, { Schema } from "mongoose";
import { IReceipt } from "../type";

const receiptSchema = new Schema<IReceipt>(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    tab: {
      type: Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    payment: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    type: {
      type: String,
      enum: ["sale", "refund", "reprint"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    pdfUrl: {
      type: String,
      required: true,
    },
    pdfPublicId: {
      type: String,
      required: true,
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    printedAt: {
      type: Date,
    },
    printedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    refundReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes
receiptSchema.index({ branch: 1 });
receiptSchema.index({ tab: 1 });
receiptSchema.index({ type: 1 });

const Receipt = mongoose.model<IReceipt>("Receipt", receiptSchema);
export default Receipt;
