import mongoose, { Schema } from "mongoose";
import { IShift, ShiftStatus } from "../type";

const SHIFT_STATUSES: ShiftStatus[] = ["open", "closed"];

const shiftSchema = new Schema<IShift>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    shiftNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openingFloat: {
      type: Number,
      required: true,
      default: 0,
    },
    closingCash: {
      expected: { type: Number, default: 0 },
      actual: { type: Number, default: 0 },
      variance: { type: Number, default: 0 },
    },
    salesSummary: {
      totalSales: { type: Number, default: 0 },
      cashSales: { type: Number, default: 0 },
      mpesaSales: { type: Number, default: 0 },
      cardSales: { type: Number, default: 0 },
      tabsOpened: { type: Number, default: 0 },
      tabsCancelled: { type: Number, default: 0 },
      discountsGiven: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: SHIFT_STATUSES,
      default: "open",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    varianceReviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    varianceNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

shiftSchema.index({ branch: 1 });
shiftSchema.index({ staff: 1 });
shiftSchema.index({ status: 1 });
shiftSchema.index({ startedAt: -1 });

const Shift = mongoose.model<IShift>("Shift", shiftSchema);
export default Shift;
