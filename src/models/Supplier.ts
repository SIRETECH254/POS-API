import mongoose, { Schema } from "mongoose";
import { ISupplier } from "../type";

const supplierSchema = new Schema<ISupplier>(
  {
    companyName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    address: {
      type: Schema.Types.ObjectId,
      ref: "Address",
    },
    skusSupplied: [
      {
        type: Schema.Types.ObjectId,
        ref: "Sku",
      },
    ],
    branches: [
      {
        type: Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],
    outstandingBalance: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

supplierSchema.index({ isActive: 1 });
supplierSchema.index({ branches: 1 });

const Supplier = mongoose.model<ISupplier>("Supplier", supplierSchema);
export default Supplier;
