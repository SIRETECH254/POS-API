import mongoose, { Schema } from "mongoose";
import { ITransfer } from "../type";

const transferItemSchema = new Schema(
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
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const transferSchema = new Schema<ITransfer>(
  {
    transferNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    fromBranch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    toBranch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    items: {
      type: [transferItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "in_transit", "received", "cancelled"],
      default: "pending",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sentBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
transferSchema.index({ fromBranch: 1 });
transferSchema.index({ toBranch: 1 });
transferSchema.index({ status: 1 });

const Transfer = mongoose.model<ITransfer>("Transfer", transferSchema);
export default Transfer;
