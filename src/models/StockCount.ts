import mongoose, { Schema } from "mongoose";
import { IStockCount } from "../type";

const stockCountItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    sku: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    expectedQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    actualQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    variance: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const stockCountSchema = new Schema<IStockCount>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    countNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    items: {
      type: [stockCountItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "reconciled"],
      default: "in_progress",
    },
    countedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
stockCountSchema.index({ branch: 1 });
stockCountSchema.index({ status: 1 });

const StockCount = mongoose.model<IStockCount>("StockCount", stockCountSchema);
export default StockCount;
