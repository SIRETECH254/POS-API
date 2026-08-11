import mongoose, { Schema } from "mongoose";
import { ICategory } from "../type";

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

categorySchema.index({ isActive: 1 });

const Category = mongoose.model<ICategory>("Category", categorySchema);
export default Category;
