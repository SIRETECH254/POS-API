import { Types } from "mongoose";
import cron from "node-cron";
import Notification from "../../models/Notification";
import Role from "../../models/Role";
import User from "../../models/User";
import Tab from "../../models/Tab";
import Branch from "../../models/Branch";
import { getIo } from "../../config/socket";
import { getRevenueBreakdown, getCostOfGoodsSold, getApprovedExpenseTotal } from "./reportingService";
import { INotification, NotificationType, UserRole } from "../../type";
import { sendPasswordResetEmail } from "../external/emailService";
import { sendPasswordResetSMS } from "../external/smsService";

/**
 * Password-reset email + SMS fan-out — predates the in-app Notification
 * model below and is unrelated to it (auth flow, not a persisted
 * Notification document). Used by authController.ts.
 */
export const sendPasswordResetNotification = async (
  email: string,
  phone: string,
  resetToken: string,
  name: string
): Promise<void> => {
  const results = await Promise.allSettled([
    sendPasswordResetEmail(email, resetToken, name),
    sendPasswordResetSMS(phone, resetToken, name),
  ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Password reset notification failed (${index === 0 ? "email" : "sms"}):`, result.reason);
    }
  });
};

interface CreateNotificationInput {
  branch: string | Types.ObjectId;
  recipient?: string | Types.ObjectId;
  recipientRole?: UserRole | UserRole[];
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

interface NotificationTarget {
  recipient: Types.ObjectId;
  recipientRole?: UserRole;
}

/**
 * Resolves who a notification should fan out to: either the single explicit
 * recipient, or every active user in the branch holding one of the given
 * roles. Each role is queried separately so recipientRole on the resulting
 * document accurately records which role rule matched that user.
 */
const resolveTargets = async (input: CreateNotificationInput): Promise<NotificationTarget[]> => {
  if (input.recipient) {
    return [{ recipient: new Types.ObjectId(input.recipient) }];
  }

  if (!input.recipientRole) {
    return [];
  }

  const roleNames = Array.isArray(input.recipientRole) ? input.recipientRole : [input.recipientRole];
  const targets: NotificationTarget[] = [];

  for (const roleName of roleNames) {
    const roleDoc = await Role.findOne({ name: roleName });
    if (!roleDoc) {
      continue;
    }

    const users = await User.find({ branch: input.branch, role: roleDoc._id, status: true });
    for (const user of users) {
      targets.push({ recipient: user._id as Types.ObjectId, recipientRole: roleName });
    }
  }

  return targets;
};

/**
 * Core notification primitive — every trigger site across the app calls
 * this. Fans out to one Notification document per resolved recipient and
 * pushes each over Socket.io to that user's `user_<id>` room. Never throws:
 * every DB/socket step is caught and logged internally, so a notification
 * failure can never abort the business transaction that triggered it (same
 * "must not block the main flow" principle used for Cloudinary deletes).
 */
export const createNotification = async (input: CreateNotificationInput): Promise<INotification[]> => {
  const created: INotification[] = [];

  try {
    const targets = await resolveTargets(input);
    const io = getIo();

    for (const target of targets) {
      try {
        const notification = await Notification.create({
          branch: input.branch,
          recipient: target.recipient,
          recipientRole: target.recipientRole,
          type: input.type,
          title: input.title,
          message: input.message,
          metadata: input.metadata,
        });
        created.push(notification);

        if (io) {
          io.to(`user_${target.recipient.toString()}`).emit("notification:new", notification);
        }
      } catch (error: any) {
        console.error(`Failed to create/emit notification for user ${target.recipient}:`, error);
      }
    }
  } catch (error: any) {
    console.error("Failed to resolve notification recipients:", error);
  }

  return created;
};

/**
 * Fires the moment a decreasing stock movement pushes a SKU at or below its
 * branch minimum — see stockMovementService.recordStockMovement.
 */
export const sendLowStockAlert = async (input: {
  branch: string | Types.ObjectId;
  productName: string;
  skuCode: string;
  currentStock: number;
  minimumStock: number;
}): Promise<void> => {
  await createNotification({
    branch: input.branch,
    recipientRole: ["manager", "store_keeper"],
    type: "low_stock",
    title: "Low stock alert",
    message: `${input.productName} (${input.skuCode}) is at ${input.currentStock} units — at or below the minimum of ${input.minimumStock}.`,
    metadata: {
      skuCode: input.skuCode,
      currentStock: input.currentStock,
      minimumStock: input.minimumStock,
    },
  });
};

/**
 * Summarizes the previous calendar day's revenue/COGS/expenses/profit for a
 * branch and notifies its managers. Called by the daily cron job in
 * src/index.ts, and callable directly for manual/on-demand summaries.
 */
export const sendDailySummary = async (branch: string | Types.ObjectId): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  const revenue = await getRevenueBreakdown({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const cogs = await getCostOfGoodsSold({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const expenses = await getApprovedExpenseTotal({ branch, startDate: startOfYesterday, endDate: startOfToday });
  const tabCount = await Tab.countDocuments({
    branch,
    status: "completed",
    closedAt: { $gte: startOfYesterday, $lte: startOfToday },
  });
  const netProfit = revenue.totalRevenue - cogs - expenses;

  await createNotification({
    branch,
    recipientRole: "manager",
    type: "daily_summary",
    title: "Yesterday's summary",
    message: `Revenue: ${revenue.totalRevenue}, Tabs completed: ${tabCount}, Net profit: ${netProfit}.`,
    metadata: {
      revenue: revenue.totalRevenue,
      cogs,
      expenses,
      netProfit,
      tabCount,
    },
  });
};

/**
 * Registers the daily summary cron job — once at 01:00 server time, runs
 * sendDailySummary for every active branch. Called once from src/index.ts
 * at startup.
 */
export const scheduleDailySummaryCron = (): void => {
  cron.schedule("0 1 * * *", async () => {
    const branches = await Branch.find({ isActive: true });

    for (const branch of branches) {
      try {
        await sendDailySummary(branch._id as Types.ObjectId);
      } catch (error: any) {
        console.error(`Failed to send daily summary for branch ${branch._id}:`, error);
      }
    }
  });
};
