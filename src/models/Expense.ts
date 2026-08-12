import mongoose, { Schema } from "mongoose";
import { IExpense } from "../type";

const expenseSchema = new Schema<IExpense>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    category: {
      type: String,
      enum: ["rent", "electricity", "water", "dj", "security", "cleaning", "fuel", "repairs", "marketing", "other"],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "mpesa", "bank"],
      required: true,
    },
    receiptUrl: {
      type: String,
    },
    receiptPublicId: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "pending",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expenseDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
expenseSchema.index({ branch: 1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: 1 });

const Expense = mongoose.model<IExpense>("Expense", expenseSchema);
export default Expense;
