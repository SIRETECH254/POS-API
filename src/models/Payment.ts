import mongoose, { Schema } from "mongoose";
import { IPayment } from "../type";

const paymentSchema = new Schema<IPayment>(
  {
    paymentNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    tab: {
      type: Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    method: {
      type: String,
      enum: ["cash", "mpesa"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "pending",
    },
    cashReceived: {
      type: Number,
      min: 0,
    },
    cashChange: {
      type: Number,
      min: 0,
    },
    mpesa: {
      phone: { type: String, trim: true },
      checkoutRequestId: { type: String, trim: true },
      merchantRequestId: { type: String, trim: true },
      mpesaReceiptNumber: { type: String, trim: true },
      resultCode: { type: Number },
      resultDesc: { type: String, trim: true },
    },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reversedReason: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
paymentSchema.index({ branch: 1 });
paymentSchema.index({ shift: 1 });
paymentSchema.index({ tab: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ "mpesa.checkoutRequestId": 1 }, { sparse: true, unique: true });

const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
export default Payment;
