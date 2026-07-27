import mongoose, { Schema } from "mongoose";
import { IUser } from "../type";

const userSchema = new Schema<IUser>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
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
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    pin: {
      type: String,
      select: false,
    },
    role: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
    },
    status: {
      type: Boolean,
      default: true,
    },
    avatar: {
      type: String,
    },
    avatarPublicId: {
      type: String,
    },
    lastLoginAt: {
      type: Date,
    },
    currentShift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpiry: {
      type: Date,
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ branch: 1 });

const User = mongoose.model<IUser>("User", userSchema);
export default User;
