import mongoose, { Schema, Types } from "mongoose";
import { IProduct, ISKU, ISKUAttribute } from "../type";

// Local extension for instance methods (not exported from type file)
interface IProductDocument extends IProduct {
  generateSKUs(): Promise<IProductDocument>;
  generateCombinations(variants: any[]): any[][];
  generateSKUCode(attributes: ISKUAttribute[]): string;
  updateSKU(skuId: string | Types.ObjectId, updateData: Partial<ISKU>): Promise<IProductDocument>;
  deleteSKU(skuId: string | Types.ObjectId): Promise<IProductDocument>;
}

const skuAttributeSchema = new Schema<ISKUAttribute>(
  {
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "Variant",
      required: true,
    },
    optionId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
  },
  { _id: false }
);

const stockByBranchSchema = new Schema(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    currentStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    minimumStock: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const skuSchema = new Schema<ISKU>(
  {
    attributes: {
      type: [skuAttributeSchema],
      default: [],
    },
    skuCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
      sparse: true,
    },
    unit: {
      type: String,
      enum: ["bottle", "shot", "pack", "plate", "crate", "unit"],
      required: true,
      default: "unit",
    },
    buyingPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
    },
    stockByBranch: {
      type: [stockByBranchSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, _id: true }
);

const productSchema = new Schema<IProductDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    variants: [
      {
        type: Schema.Types.ObjectId,
        ref: "Variant",
      },
    ],
    description: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
    },
    imagePublicId: {
      type: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    skus: {
      type: [skuSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Indexes
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
productSchema.index({ createdBy: 1 });
productSchema.index({ createdAt: -1 });

/**
 * Generate or regenerate all SKUs based on the product's linked variants.
 * If no variants exist or none have active options, creates one default SKU.
 * Preserves existing SKU data (buyingPrice, sellingPrice, stock) where attribute
 * combinations match, so updates don't wipe manual field edits.
 */
productSchema.methods.generateSKUs = async function (this: IProductDocument): Promise<IProductDocument> {
  const nameSlug = this.name.toUpperCase().replace(/\s+/g, "-");

  // No variants — create single default SKU
  if (!this.variants || this.variants.length === 0) {
    const defaultCode = `${nameSlug}-DEFAULT`;
    this.skus = [
      {
        attributes: [],
        skuCode: defaultCode,
        unit: "unit",
        buyingPrice: 0,
        sellingPrice: 0,
        stockByBranch: [],
        status: "active",
        isActive: true,
        createdBy: this.createdBy,
      },
    ] as any;
    return this.save();
  }

  // Fetch variant documents and keep only those with active options
  const Variant = mongoose.model("Variant");
  const variantDocs = await Variant.find({ _id: { $in: this.variants } });

  const variantsWithActiveOptions = variantDocs
    .map((v: any) => ({
      _id: v._id,
      options: v.options.filter((o: any) => o.isActive),
    }))
    .filter((v: any) => v.options.length > 0);

  // If all linked variants have no active options — fall back to default SKU
  if (variantsWithActiveOptions.length === 0) {
    const defaultCode = `${nameSlug}-DEFAULT`;
    this.skus = [
      {
        attributes: [],
        skuCode: defaultCode,
        unit: "unit",
        buyingPrice: 0,
        sellingPrice: 0,
        stockByBranch: [],
        status: "active",
        isActive: true,
        createdBy: this.createdBy,
      },
    ] as any;
    return this.save();
  }

  const combinations = this.generateCombinations(variantsWithActiveOptions);

  // Build lookup key for matching existing SKUs
  const buildKey = (attributes: ISKUAttribute[]) =>
    (attributes || [])
      .map((a) => `${a.variantId.toString()}:${a.optionId.toString()}`)
      .sort()
      .join("|");

  const existingMap = new Map<string, any>();
  this.skus.forEach((sku: any) => {
    existingMap.set(buildKey(sku.attributes), sku);
  });

  this.skus = combinations.map((combo: ISKUAttribute[]) => {
    const key = buildKey(combo);
    const existing = existingMap.get(key);
    return {
      attributes: combo,
      skuCode: existing?.skuCode ?? this.generateSKUCode(combo),
      barcode: existing?.barcode,
      unit: existing?.unit ?? "unit",
      buyingPrice: existing?.buyingPrice ?? 0,
      sellingPrice: existing?.sellingPrice ?? 0,
      supplier: existing?.supplier,
      stockByBranch: existing?.stockByBranch ?? [],
      status: existing?.status ?? "active",
      isActive: existing?.isActive ?? true,
      createdBy: this.createdBy,
    };
  }) as any;

  return this.save();
};

/**
 * Recursively produces the cartesian product of all variant option arrays.
 * Each entry in the returned array is one ISKUAttribute combination.
 */
productSchema.methods.generateCombinations = function (
  this: IProductDocument,
  variants: any[]
): any[][] {
  if (variants.length === 0) {
    return [[]];
  }
  const [first, ...rest] = variants;
  const restCombinations = this.generateCombinations(rest);
  const combinations: any[][] = [];
  first.options.forEach((option: any) => {
    const attribute: ISKUAttribute = { variantId: first._id, optionId: option._id };
    restCombinations.forEach((restCombo: any[]) => {
      combinations.push([attribute, ...restCombo]);
    });
  });
  return combinations;
};

/**
 * Builds a unique SKU code from the product name and each optionId's last 4 chars.
 */
productSchema.methods.generateSKUCode = function (
  this: IProductDocument,
  attributes: ISKUAttribute[]
): string {
  const nameSlug = this.name.toUpperCase().replace(/\s+/g, "-");
  if (attributes.length === 0) {
    return `${nameSlug}-DEFAULT`;
  }
  const parts = attributes
    .map((a) => a.optionId.toString().slice(-4).toUpperCase())
    .join("-");
  return `${nameSlug}-${parts}`;
};

/**
 * Updates fields on a specific SKU subdocument by its _id.
 */
productSchema.methods.updateSKU = function (
  this: IProductDocument,
  skuId: string | Types.ObjectId,
  updateData: Partial<ISKU>
): Promise<IProductDocument> {
  const sku = this.skus.id(skuId);
  if (!sku) {
    throw new Error("SKU not found");
  }
  Object.assign(sku, updateData);
  return this.save();
};

/**
 * Removes a SKU subdocument by its _id.
 */
productSchema.methods.deleteSKU = function (
  this: IProductDocument,
  skuId: string | Types.ObjectId
): Promise<IProductDocument> {
  const idStr = skuId.toString();
  this.skus = this.skus.filter((sku: any) => sku._id.toString() !== idStr) as any;
  return this.save();
};

const Product = mongoose.model<IProductDocument>("Product", productSchema);
export default Product;
