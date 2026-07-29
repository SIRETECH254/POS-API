import mongoose, { Schema } from "mongoose";
import { IRole, UserRole } from "../type";

const ROLE_VALUES: UserRole[] = [
  "bartender",
  "cashier",
  "store_keeper",
  "manager",
  "admin",
  "accountant",
];

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ROLE_VALUES,
      trim: true,
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

roleSchema.index({ isActive: 1 });

const Role = mongoose.model<IRole>("Role", roleSchema);
export default Role;
