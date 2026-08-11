import mongoose, { Schema } from "mongoose";
import { IStockAdjustment } from "../type";

const stockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    sku: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    quantityChange: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      enum: ["breakage", "theft", "expired", "count_correction", "other"],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    adjustedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    appliedAt: {
      type: Date,
    },
    stockCount: {
      type: Schema.Types.ObjectId,
      ref: "StockCount",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
stockAdjustmentSchema.index({ branch: 1, sku: 1 });
stockAdjustmentSchema.index({ reason: 1 });
stockAdjustmentSchema.index({ appliedAt: 1 });

const StockAdjustment = mongoose.model<IStockAdjustment>("StockAdjustment", stockAdjustmentSchema);
export default StockAdjustment;
