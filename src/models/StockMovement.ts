import mongoose, { Schema } from "mongoose";
import { IStockMovement } from "../type";

const stockMovementSchema = new Schema<IStockMovement>(
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
    type: {
      type: String,
      enum: ["purchased", "sold", "adjusted", "returned", "damaged", "transferred_out", "transferred_in"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      refType: {
        type: String,
        enum: ["Purchase", "Tab", "StockAdjustment", "Transfer"],
      },
      refId: {
        type: Schema.Types.ObjectId,
      },
    },
    reason: {
      type: String,
      trim: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
stockMovementSchema.index({ branch: 1, sku: 1 });
stockMovementSchema.index({ branch: 1, createdAt: -1 });
stockMovementSchema.index({ type: 1 });
stockMovementSchema.index({ "reference.refType": 1, "reference.refId": 1 });

const StockMovement = mongoose.model<IStockMovement>("StockMovement", stockMovementSchema);
export default StockMovement;
