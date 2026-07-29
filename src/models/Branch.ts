import mongoose, { Schema } from "mongoose";
import { IBranch } from "../type";

const branchSchema = new Schema<IBranch>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    address: {
      type: Schema.Types.ObjectId,
      ref: "Address",
    },
    isMain: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

branchSchema.index({ isActive: 1 });
branchSchema.index({ isMain: 1 });
branchSchema.index({ address: 1 });

const Branch = mongoose.model<IBranch>("Branch", branchSchema);
export default Branch;
