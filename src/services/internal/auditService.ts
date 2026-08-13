import { Types } from "mongoose";
import AuditLog from "../../models/AuditLog";
import { AuditAction, AuditEntityType } from "../../type";

interface LogAuditInput {
  branch?: string | Types.ObjectId;
  user: string | Types.ObjectId;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | Types.ObjectId;
  before?: Record<string, any>;
  after?: Record<string, any>;
  ipAddress?: string | undefined;
}

/**
 * Writes one immutable AuditLog entry. Called explicitly from the four
 * "sensitive" call sites (price edits, tab cancellation, payment reversal,
 * role assignment) right after their state change already committed — not
 * a generic middleware, since none of those handlers use a res.locals-style
 * convention a middleware could read before/after state from.
 *
 * Never throws — a failed audit write must not roll back the business
 * change it's recording, same principle as notificationService.createNotification.
 */
export const logAudit = async (input: LogAuditInput): Promise<void> => {
  try {
    await AuditLog.create({
      branch: input.branch,
      user: input.user,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ipAddress: input.ipAddress,
    });
  } catch (error: any) {
    console.error(`Failed to write audit log (${input.action} on ${input.entityType} ${input.entityId}):`, error);
  }
};
