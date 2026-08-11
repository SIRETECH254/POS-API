import mongoose, { Schema } from "mongoose";
import { IOption, IVariant } from "../type";

const optionSchema = new Schema<IOption>(
  {
    value: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const variantSchema = new Schema<IVariant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    options: {
      type: [optionSchema],
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

variantSchema.index({ sortOrder: 1 });

const Variant = mongoose.model<IVariant>("Variant", variantSchema);
export default Variant;
