import mongoose, { Schema } from "mongoose";
import { ISettings, IPrinterConfig } from "../type";

// Nested as its own sub-schema — a plain inline object would collide with
// Mongoose's reserved `type` key, since printerConfig itself has a `type` field.
const printerConfigSchema = new Schema<IPrinterConfig>(
  {
    type: {
      type: String,
      enum: ["usb", "network"],
      default: "usb",
    },
    target: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const settingsSchema = new Schema<ISettings>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      unique: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "KES",
      trim: true,
    },
    receiptFooterNote: {
      type: String,
      trim: true,
      default: "Thank you for your business!",
    },
    paymentMethodsEnabled: {
      type: [String],
      enum: ["cash", "mpesa", "card"],
      default: ["cash", "mpesa"],
    },
    printerConfig: {
      type: printerConfigSchema,
      default: () => ({ type: "usb", target: "" }),
    },
    lowStockThresholdDefault: {
      type: Number,
      default: 0,
      min: 0,
    },
    theme: {
      type: Schema.Types.Mixed,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes
settingsSchema.index({ branch: 1 }, { unique: true });

const Settings = mongoose.model<ISettings>("Settings", settingsSchema);
export default Settings;
