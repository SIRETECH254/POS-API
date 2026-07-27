import mongoose, { Schema } from "mongoose";
import { IUser, UserRole } from "../type";

const ROLE_VALUES: UserRole[] = [
  "bartender",
  "cashier",
  "store_keeper",
  "manager",
  "admin",
  "accountant",
];

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    roles: {
      type: [String],
      enum: ROLE_VALUES,
      default: ["bartender"],
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    avatar: {
      type: String,
    },
    avatarPublicId: {
      type: String,
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ roles: 1 });
userSchema.index({ isActive: 1 });

const User = mongoose.model<IUser>("User", userSchema);
export default User;
