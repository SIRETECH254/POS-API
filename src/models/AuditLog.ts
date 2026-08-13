import mongoose, { Schema } from "mongoose";
import { IAuditLog } from "../type";

const auditLogSchema = new Schema<IAuditLog>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: ["PRICE_CHANGE", "TAB_CANCELLED", "PAYMENT_REVERSED", "ROLE_CHANGED"],
      required: true,
    },
    entityType: {
      type: String,
      enum: ["SKU", "Tab", "Payment", "User"],
      required: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    before: {
      type: Schema.Types.Mixed,
    },
    after: {
      type: Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes
auditLogSchema.index({ branch: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
export default AuditLog;
