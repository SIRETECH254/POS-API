import mongoose, { Schema } from "mongoose";
import { ITab, ITabItem } from "../type";

const tabItemSchema = new Schema<ITabItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  sku: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ["active", "cancelled"],
    default: "active",
  },
  addedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const tabSchema = new Schema<ITab>(
  {
    tabNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    table: {
      type: String,
      trim: true,
    },
    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    items: {
      type: [tabItemSchema],
      default: [],
    },
    mergedFrom: {
      type: [Schema.Types.ObjectId],
      ref: "Tab",
      default: [],
    },
    splitInto: {
      type: [Schema.Types.ObjectId],
      ref: "Tab",
      default: [],
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["draft", "open", "held", "awaiting_payment", "paid", "completed", "cancelled", "archived"],
      default: "open",
    },
    holdReason: {
      type: String,
      trim: true,
    },
    cancelReason: {
      type: String,
      trim: true,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    closedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Recalculate totals from active items whenever items change.
// Item.subtotal stays net (quantity*unitPrice - discount) for line display;
// Tab-level subtotal is the gross pre-discount sum so discountTotal remains meaningful.
tabSchema.pre("save", function (next) {
  if (this.isModified("items")) {
    let grossSubtotal = 0;
    let discountTotal = 0;

    for (const item of this.items) {
      if (item.status === "active") {
        grossSubtotal += item.quantity * item.unitPrice;
        discountTotal += item.discount;
      }
    }

    this.subtotal = grossSubtotal;
    this.discountTotal = discountTotal;
    this.grandTotal = grossSubtotal - discountTotal + this.taxTotal;
    this.balanceDue = this.grandTotal - this.amountPaid;
  }

  next();
});

// Indexes
tabSchema.index({ branch: 1 });
tabSchema.index({ status: 1 });
tabSchema.index({ shift: 1 });

const Tab = mongoose.model<ITab>("Tab", tabSchema);
export default Tab;
