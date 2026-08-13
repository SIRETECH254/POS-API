import mongoose, { Schema } from "mongoose";
import { INotification } from "../type";

const notificationSchema = new Schema<INotification>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientRole: {
      type: String,
      enum: ["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"],
    },
    type: {
      type: String,
      enum: [
        "low_stock",
        "shift_started",
        "shift_closed",
        "mpesa_failed",
        "payment_success",
        "daily_summary",
        "expense_pending_approval",
        "purchase_received",
        "transfer_received",
        "tab_cancelled",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ branch: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.model<INotification>("Notification", notificationSchema);
export default Notification;
