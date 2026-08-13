# 📦 POS API - Product Management Documentation

## 📋 Table of Contents
- [Product Management Overview](#product-management-overview)
- [Product Model](#-product-model)
- [Product Controller](#-product-controller)
- [SKU Controller](#-sku-controller)
- [Product Routes](#-product-routes)
- [SKU Routes](#-sku-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Product Management Overview

Product Management covers the catalog of all sellable items in the POS system. Each Product is the shared catalog entry (name, category, description, image). SKUs are embedded subdocuments within the Product that carry pricing, unit, barcode, and per-branch stock levels. When a product has variants linked, SKUs are auto-generated — one per unique combination of active variant options. Products without variants receive a single default SKU automatically. All controllers follow the project's JSDoc + step-comment pattern.

---

## 📦 Product Model

### Schema Definition

```typescript
export interface ISKUAttribute {
  variantId: Types.ObjectId;
  optionId: Types.ObjectId;
}

export interface IStockByBranch {
  branch: Types.ObjectId | IBranch;
  currentStock: number;
  minimumStock: number;
}

export interface ISKU extends Document {
  attributes: ISKUAttribute[];
  skuCode: string;
  barcode?: string;
  unit: SkuUnit;
  buyingPrice: number;
  sellingPrice: number;
  supplier?: Types.ObjectId;
  stockByBranch: Types.DocumentArray<IStockByBranch & Document>;
  status: ProductStatus;
  isActive: boolean;
  createdBy: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProduct extends Document {
  name: string;
  category: Types.ObjectId | ICategory;
  variants: Types.ObjectId[] | IVariant[];
  description: string;
  image?: string;
  imagePublicId?: string;
  status: ProductStatus;
  createdBy: Types.ObjectId | IUser;
  skus: Types.DocumentArray<ISKU>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Product.ts`**

```typescript
import mongoose, { Schema, Types } from "mongoose";
import { IProduct, ISKU, ISKUAttribute } from "../type";

interface IProductDocument extends IProduct {
  generateSKUs(): Promise<IProductDocument>;
  generateCombinations(variants: any[]): any[][];
  generateSKUCode(attributes: ISKUAttribute[]): string;
  updateSKU(skuId: string | Types.ObjectId, updateData: Partial<ISKU>): Promise<IProductDocument>;
  deleteSKU(skuId: string | Types.ObjectId): Promise<IProductDocument>;
}

const skuAttributeSchema = new Schema<ISKUAttribute>(
  {
    variantId: { type: Schema.Types.ObjectId, ref: "Variant", required: true },
    optionId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

const stockByBranchSchema = new Schema(
  {
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    currentStock: { type: Number, default: 0, min: 0 },
    minimumStock: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const skuSchema = new Schema<ISKU>(
  {
    attributes: { type: [skuAttributeSchema], default: [] },
    skuCode: { type: String, required: true, unique: true, trim: true },
    barcode: { type: String, trim: true, sparse: true },
    unit: {
      type: String,
      enum: ["bottle", "shot", "pack", "plate", "crate", "unit"],
      required: true,
      default: "unit",
    },
    buyingPrice: { type: Number, required: true, min: 0, default: 0 },
    sellingPrice: { type: Number, required: true, min: 0, default: 0 },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier" },
    stockByBranch: { type: [stockByBranchSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, _id: true }
);

const productSchema = new Schema<IProductDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    variants: [{ type: Schema.Types.ObjectId, ref: "Variant" }],
    description: { type: String, required: true, trim: true },
    image: { type: String },
    imagePublicId: { type: String },
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    skus: { type: [skuSchema], default: [] },
  },
  { timestamps: true }
);
```

### Validation Rules

```typescript
name:         { required: true, trim: true, unique: true }
description:  { required: true, trim: true }
category:     { required: true, ref: "Category" }
variants:     { default: [], ref: "Variant" }
status:       { enum: ["active","inactive","discontinued"], default: "active" }
createdBy:    { required: true, ref: "User" }
skus.skuCode:      { required: true, unique: true }
skus.unit:         { required: true, enum: ["bottle","shot","pack","plate","crate","unit"] }
skus.buyingPrice:  { required: true, min: 0, default: 0 }
skus.sellingPrice: { required: true, min: 0, default: 0 }
skus.barcode:      { optional, unique, sparse: true }
skus.isActive:     { default: true }
skus.createdBy:    { required: true, ref: "User" }
```

---

## 🎮 Product Controller

**File:** `src/controllers/productController.ts`

### Required Imports

```typescript
import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { errorHandler } from "../middleware/errorHandler";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary";
import Product from "../models/Product";
import Category from "../models/Category";
import Variant from "../models/Variant";
```

### Functions Overview

#### `getAllProducts()`
**Purpose:** List all products with search, category filter, status filter, and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Build query from params, paginate, populate, return
**Response:** Product list and pagination

**Controller Implementation:**
```typescript
export const getAllProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, category, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (category) {
      query.category = category;
    }
    if (status) {
      query.status = status;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch products and total count
    const products = await Product.find(query)
      .populate("category", "name description")
      .populate("variants", "name options sortOrder")
      .populate("createdBy", "firstName lastName email")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Product.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalProducts: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `getProductById()`
**Purpose:** Fetch a single product with its SKUs and populated references
**Access:** Manager, Admin
**Validation:** Product must exist
**Process:** findById with populate; 404 guard; return
**Response:** Product details with embedded SKUs

**Controller Implementation:**
```typescript
export const getProductById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product by ID with populated references
    const product = await Product.findById(req.params.productId)
      .populate("category", "name description")
      .populate("variants", "name options sortOrder")
      .populate("createdBy", "firstName lastName email");

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Return product
    res.status(200).json({
      success: true,
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createProduct()`
**Purpose:** Create a new product, upload image if provided, and auto-generate SKUs
**Access:** Manager, Admin
**Validation:** name, description, category required; name unique; category must exist; each variantId must exist
**Process:** Validate refs → upload image → create product → generateSKUs() → populate → return
**Response:** Created product with generated SKUs

**Controller Implementation:**
```typescript
export const createProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, category, variants, status } = req.body;

    // Guard — required fields
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }
    if (!description) {
      return next(errorHandler(400, "Description is required"));
    }
    if (!category) {
      return next(errorHandler(400, "Category is required"));
    }

    // Guard — name must be unique
    const existing = await Product.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "A product with this name already exists"));
    }

    // Guard — category must exist
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return next(errorHandler(404, "Category not found"));
    }

    // Guard — each variant must exist
    const variantIds: string[] = Array.isArray(variants) ? variants : [];
    for (const variantId of variantIds) {
      if (!mongoose.Types.ObjectId.isValid(variantId)) {
        return next(errorHandler(400, `Invalid variant ID: ${variantId}`));
      }
      const variantDoc = await Variant.findById(variantId);
      if (!variantDoc) {
        return next(errorHandler(404, `Variant not found: ${variantId}`));
      }
    }

    // Upload image to Cloudinary if file provided
    let image: string | undefined;
    let imagePublicId: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");
      image = uploadResult.url;
      imagePublicId = uploadResult.public_id;
    }

    // Create product
    const product = new Product({
      name,
      description,
      category,
      variants: variantIds,
      image,
      imagePublicId,
      status: status || "active",
      createdBy: (req as any).user._id,
    });

    // Generate SKUs — creates default SKU when no variants provided
    await product.generateSKUs();

    // Populate references before returning
    await product.populate("category", "name description");
    await product.populate("variants", "name options sortOrder");
    await product.populate("createdBy", "firstName lastName email");

    // Return created product
    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateProduct()`
**Purpose:** Update product fields, replace image if provided, regenerate SKUs when variants change
**Access:** Manager, Admin
**Validation:** Product must exist; updated name must not conflict; category and variants must exist if provided
**Process:** Apply field updates individually → Cloudinary image swap if file → generateSKUs() when variants change → save
**Response:** Updated product

**Controller Implementation:**
```typescript
export const updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, category, variants, status } = req.body;

    // Find product
    const product = await Product.findById(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — updated name must not belong to another product
    if (name && name !== product.name) {
      const conflict = await Product.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: product._id },
      });
      if (conflict) {
        return next(errorHandler(409, "A product with this name already exists"));
      }
      product.name = name;
    }

    // Guard — category must exist if provided
    if (category) {
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc) {
        return next(errorHandler(404, "Category not found"));
      }
      product.category = category;
    }

    // Guard — each variant must exist if provided
    if (variants !== undefined) {
      const variantIds: string[] = Array.isArray(variants) ? variants : [];
      for (const variantId of variantIds) {
        if (!mongoose.Types.ObjectId.isValid(variantId)) {
          return next(errorHandler(400, `Invalid variant ID: ${variantId}`));
        }
        const variantDoc = await Variant.findById(variantId);
        if (!variantDoc) {
          return next(errorHandler(404, `Variant not found: ${variantId}`));
        }
      }
      product.variants = variantIds as any;
    }

    // Apply remaining field updates
    if (description) {
      product.description = description;
    }
    if (status) {
      product.status = status;
    }

    // Handle image replacement
    if (req.file) {
      if (product.imagePublicId) {
        try {
          await deleteFromCloudinary(product.imagePublicId);
        } catch (deleteError) {
          console.error("Failed to delete previous product image:", deleteError);
        }
      }
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");
      product.image = uploadResult.url;
      product.imagePublicId = uploadResult.public_id;
    }

    // Regenerate SKUs when variants changed; otherwise plain save
    if (variants !== undefined) {
      await product.generateSKUs();
    } else {
      await product.save();
    }

    // Populate references before returning
    await product.populate("category", "name description");
    await product.populate("variants", "name options sortOrder");
    await product.populate("createdBy", "firstName lastName email");

    // Return updated product
    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `deleteProduct()`
**Purpose:** Permanently remove a product and its Cloudinary image
**Access:** Admin
**Validation:** Product must exist
**Process:** findByIdAndDelete → delete Cloudinary image (non-blocking error) → return
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete product
    const product = await Product.findByIdAndDelete(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Delete image from Cloudinary if present
    if (product.imagePublicId) {
      try {
        await deleteFromCloudinary(product.imagePublicId);
      } catch (deleteError) {
        console.error("Failed to delete product image from Cloudinary:", deleteError);
      }
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🎮 SKU Controller

**File:** `src/controllers/skuController.ts`

### Required Imports

```typescript
import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { errorHandler } from "../middleware/errorHandler";
import Product from "../models/Product";
import { logAudit } from "../services/internal/auditService";
```

### Functions Overview

#### `getAllSkus()`
**Purpose:** List all SKUs across all products, flat, with optional status filter and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Aggregate `$unwind skus` → optional status match → `$project` flat shape → paginate
**Response:** Flat SKU list with productId, productName, and pagination

**Controller Implementation:**
```typescript
export const getAllSkus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, status } = req.query;

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Build match stage for optional status filter
    const matchStage: any = {};
    if (status) {
      matchStage["skus.status"] = status;
    }

    // Aggregate SKUs across all products
    const pipeline: any[] = [
      { $unwind: "$skus" },
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      {
        $project: {
          _id: "$skus._id",
          productId: "$_id",
          productName: "$name",
          attributes: "$skus.attributes",
          skuCode: "$skus.skuCode",
          barcode: "$skus.barcode",
          unit: "$skus.unit",
          buyingPrice: "$skus.buyingPrice",
          sellingPrice: "$skus.sellingPrice",
          supplier: "$skus.supplier",
          stockByBranch: "$skus.stockByBranch",
          status: "$skus.status",
          isActive: "$skus.isActive",
          createdBy: "$skus.createdBy",
          createdAt: "$skus.createdAt",
          updatedAt: "$skus.updatedAt",
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    // Get total count and paginated results
    const countResult = await Product.aggregate([...pipeline, { $count: "total" }]);
    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / options.limit);

    const skus = await Product.aggregate([
      ...pipeline,
      { $skip: (options.page - 1) * options.limit },
      { $limit: options.limit },
    ]);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        skus,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSkus: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `getSkuById()`
**Purpose:** Fetch a single SKU subdocument by its _id
**Access:** Manager, Admin
**Validation:** SKU must exist
**Process:** `findOne({ "skus._id": skuId })` → extract with `.id()` → return
**Response:** SKU details with product context

**Controller Implementation:**
```typescript
export const getSkuById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product containing this SKU
    const product = await Product.findOne({ "skus._id": req.params.skuId })
      .populate("category", "name")
      .populate("createdBy", "firstName lastName");

    // Guard — SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found"));
    }

    // Extract the matching SKU subdocument
    const sku = product.skus.id(req.params.skuId);

    // Return SKU with product context
    res.status(200).json({
      success: true,
      data: {
        sku,
        product: {
          _id: product._id,
          name: product.name,
          category: product.category,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createSku()`
**Purpose:** Manually add a new SKU to an existing product
**Access:** Manager, Admin
**Validation:** Product must exist; skuCode required and unique; barcode unique if provided; unit and prices required
**Process:** Find product → uniqueness guards → push new SKU → save
**Response:** Updated product with new SKU

**Controller Implementation:**
```typescript
export const createSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { skuCode, barcode, unit, buyingPrice, sellingPrice, supplier, stockByBranch, status } = req.body;

    // Guard — required fields
    if (!skuCode) {
      return next(errorHandler(400, "SKU code is required"));
    }
    if (!unit) {
      return next(errorHandler(400, "Unit is required"));
    }
    if (buyingPrice === undefined) {
      return next(errorHandler(400, "Buying price is required"));
    }
    if (sellingPrice === undefined) {
      return next(errorHandler(400, "Selling price is required"));
    }

    // Find product
    const product = await Product.findById(req.params.productId);

    // Guard — product must exist
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — skuCode must be unique across all products
    const codeConflict = await Product.findOne({ "skus.skuCode": skuCode });
    if (codeConflict) {
      return next(errorHandler(409, "A SKU with this code already exists"));
    }

    // Guard — barcode must be unique if provided
    if (barcode) {
      const barcodeConflict = await Product.findOne({ "skus.barcode": barcode });
      if (barcodeConflict) {
        return next(errorHandler(409, "A SKU with this barcode already exists"));
      }
    }

    // Push new SKU
    product.skus.push({
      attributes: [],
      skuCode,
      barcode,
      unit,
      buyingPrice,
      sellingPrice,
      supplier,
      stockByBranch: stockByBranch || [],
      status: status || "active",
      isActive: true,
      createdBy: (req as any).user._id,
    } as any);

    await product.save();

    // Return success
    res.status(201).json({
      success: true,
      message: "SKU created successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateSku()`
**Purpose:** Update individual fields on an existing SKU subdocument
**Access:** Manager, Admin
**Validation:** Product and SKU must exist; skuCode/barcode uniqueness if changed
**Process:** Find product+SKU → build updateData → call product.updateSKU(skuId, data) → audit a `PRICE_CHANGE` if the update touched `buyingPrice`/`sellingPrice`
**Response:** Updated product

**Controller Implementation:**
```typescript
export const updateSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { skuCode, barcode, unit, buyingPrice, sellingPrice, supplier, status, isActive } = req.body;

    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Guard — updated skuCode must not belong to another SKU
    if (skuCode) {
      const conflict = await Product.findOne({
        "skus.skuCode": skuCode,
        "skus._id": { $ne: new mongoose.Types.ObjectId(req.params.skuId) },
      });
      if (conflict) {
        return next(errorHandler(409, "A SKU with this code already exists"));
      }
    }

    // Guard — updated barcode must not belong to another SKU
    if (barcode) {
      const barcodeConflict = await Product.findOne({
        "skus.barcode": barcode,
        "skus._id": { $ne: new mongoose.Types.ObjectId(req.params.skuId) },
      });
      if (barcodeConflict) {
        return next(errorHandler(409, "A SKU with this barcode already exists"));
      }
    }

    // Build update object from provided fields
    const updateData: any = {};
    if (skuCode !== undefined) {
      updateData.skuCode = skuCode;
    }
    if (barcode !== undefined) {
      updateData.barcode = barcode;
    }
    if (unit !== undefined) {
      updateData.unit = unit;
    }
    if (buyingPrice !== undefined) {
      updateData.buyingPrice = buyingPrice;
    }
    if (sellingPrice !== undefined) {
      updateData.sellingPrice = sellingPrice;
    }
    if (supplier !== undefined) {
      updateData.supplier = supplier;
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // Snapshot pre-update price fields — product.updateSKU mutates the
    // subdocument in place, so this must happen before that call
    const skuBeforeUpdate = product.skus.id(req.params.skuId);
    const priceBefore = { buyingPrice: skuBeforeUpdate?.buyingPrice, sellingPrice: skuBeforeUpdate?.sellingPrice };

    // Apply update via instance method
    await product.updateSKU(req.params.skuId, updateData);

    // Audit price changes only — skip barcode/status-only edits.
    // SKUs aren't branch-scoped (only stockByBranch is), so this is
    // attributed to the acting user's own branch.
    if (buyingPrice !== undefined || sellingPrice !== undefined) {
      await logAudit({
        branch: req.user?.branch,
        user: req.user?._id,
        action: "PRICE_CHANGE",
        entityType: "SKU",
        entityId: req.params.skuId,
        before: priceBefore,
        after: { buyingPrice, sellingPrice },
        ipAddress: req.ip,
      });
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "SKU updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```
> See `doc/modules/AUDIT_DOCUMENTATION.md` for the full `PRICE_CHANGE` audit trigger.

#### `deleteSku()`
**Purpose:** Remove a SKU subdocument from a product
**Access:** Admin
**Validation:** SKU must exist on specified product
**Process:** findOne({ _id: productId, "skus._id": skuId }) → product.deleteSKU(skuId)
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteSku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Remove SKU via instance method
    await product.deleteSKU(req.params.skuId);

    // Return success
    res.status(200).json({
      success: true,
      message: "SKU deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `getLowStockSkus()`
**Purpose:** Return all SKUs where currentStock ≤ minimumStock for a given branch
**Access:** Manager, Admin, Store Keeper
**Validation:** branch query param required and must be a valid ObjectId
**Process:** Aggregate — `$unwind skus` → `$unwind skus.stockByBranch` → `$match` branch + `$lte` → paginate
**Response:** Low stock SKU list sorted by currentStock ascending

**Controller Implementation:**
```typescript
export const getLowStockSkus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { branch, page = 1, limit = 10 } = req.query;

    // Guard — branch required
    if (!branch) {
      return next(errorHandler(400, "Branch ID is required"));
    }

    // Guard — valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(branch as string)) {
      return next(errorHandler(400, "Invalid branch ID"));
    }

    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    const branchId = new mongoose.Types.ObjectId(branch as string);

    const pipeline: any[] = [
      { $unwind: "$skus" },
      { $unwind: "$skus.stockByBranch" },
      {
        $match: {
          "skus.stockByBranch.branch": branchId,
          $expr: {
            $lte: ["$skus.stockByBranch.currentStock", "$skus.stockByBranch.minimumStock"],
          },
        },
      },
      {
        $project: {
          _id: "$skus._id",
          productId: "$_id",
          productName: "$name",
          skuCode: "$skus.skuCode",
          barcode: "$skus.barcode",
          unit: "$skus.unit",
          sellingPrice: "$skus.sellingPrice",
          status: "$skus.status",
          currentStock: "$skus.stockByBranch.currentStock",
          minimumStock: "$skus.stockByBranch.minimumStock",
        },
      },
      { $sort: { currentStock: 1 } },
    ];

    // Total count and paginated results
    const countResult = await Product.aggregate([...pipeline, { $count: "total" }]);
    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / options.limit);

    const skus = await Product.aggregate([
      ...pipeline,
      { $skip: (options.page - 1) * options.limit },
      { $limit: options.limit },
    ]);

    // Return response
    res.status(200).json({
      success: true,
      data: {
        skus,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSkus: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `searchByBarcode()`
**Purpose:** Look up a SKU by barcode
**Access:** Bartender, Cashier, Manager, Admin
**Validation:** SKU with given barcode must exist
**Process:** `findOne({ "skus.barcode": code })` → extract matching subdoc
**Response:** Matching SKU with product context

**Controller Implementation:**
```typescript
export const searchByBarcode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product with matching barcode
    const product = await Product.findOne({ "skus.barcode": req.params.code });

    // Guard — SKU must exist
    if (!product) {
      return next(errorHandler(404, "No SKU found with this barcode"));
    }

    // Extract the matching SKU
    const sku = product.skus.find((s: any) => s.barcode === req.params.code);

    // Return SKU with product context
    res.status(200).json({
      success: true,
      data: {
        sku,
        product: {
          _id: product._id,
          name: product.name,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `setBranchStockLevel()`
**Purpose:** Initialize or correct the stockByBranch entry for a branch on a SKU
**Access:** Manager, Admin
**Validation:** branch, currentStock, minimumStock required; product and SKU must exist
**Process:** Find product+SKU → upsert branch entry in stockByBranch array → save
**Response:** Updated product

**Controller Implementation:**
```typescript
export const setBranchStockLevel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { branch, currentStock, minimumStock } = req.body;

    // Guard — required fields
    if (!branch) {
      return next(errorHandler(400, "Branch is required"));
    }
    if (currentStock === undefined) {
      return next(errorHandler(400, "Current stock is required"));
    }
    if (minimumStock === undefined) {
      return next(errorHandler(400, "Minimum stock is required"));
    }

    // Find product containing this SKU
    const product = await Product.findOne({
      _id: req.params.productId,
      "skus._id": req.params.skuId,
    });

    // Guard — product and SKU must exist
    if (!product) {
      return next(errorHandler(404, "SKU not found on this product"));
    }

    // Find SKU subdocument
    const sku = product.skus.id(req.params.skuId);
    if (!sku) {
      return next(errorHandler(404, "SKU not found"));
    }

    // Upsert the branch stock entry
    const branchEntry = (sku.stockByBranch as any[]).find(
      (entry: any) => entry.branch.toString() === branch.toString()
    );
    if (branchEntry) {
      branchEntry.currentStock = currentStock;
      branchEntry.minimumStock = minimumStock;
    } else {
      (sku.stockByBranch as any[]).push({ branch, currentStock, minimumStock });
    }

    await product.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "Branch stock level updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Product Routes

### Base Path: `/api/products`

```typescript
GET    /              // Get all products (manager, admin)
GET    /:productId    // Get single product (manager, admin)
POST   /              // Create product (manager, admin) — multipart/form-data
PUT    /:productId    // Update product (manager, admin) — multipart/form-data
DELETE /:productId    // Delete product (admin)
```

### Router Implementation

**File: `src/routes/productRoutes.ts`**

```typescript
import express from "express";
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { uploadProductImage } from "../config/cloudinary";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllProducts);
router.get("/:productId", authenticateToken, authorizeRoles(["manager", "admin"]), getProductById);
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), uploadProductImage.single("image"), createProduct);
router.put("/:productId", authenticateToken, authorizeRoles(["manager", "admin"]), uploadProductImage.single("image"), updateProduct);
router.delete("/:productId", authenticateToken, authorizeRoles(["admin"]), deleteProduct);

export default router;
```

### Route Details

#### `GET /api/products`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<text>`, `category=<categoryId>`, `status=active|inactive|discontinued`
**Response:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
        "name": "Tusker Lager",
        "description": "Premium Kenyan lager beer",
        "category": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
          "name": "Beer",
          "description": "All beer products"
        },
        "variants": [],
        "image": null,
        "status": "active",
        "createdAt": "2026-07-29T08:00:00.000Z",
        "updatedAt": "2026-07-29T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalProducts": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/products/:productId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "description": "Premium Kenyan lager beer",
      "category": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Beer",
        "description": "All beer products"
      },
      "variants": [],
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "attributes": [],
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "barcode": "254001000001",
          "unit": "bottle",
          "buyingPrice": 120,
          "sellingPrice": 200,
          "stockByBranch": [
            {
              "branch": "64f0a1b2c3d4e5f6a7b8c9d1",
              "currentStock": 48,
              "minimumStock": 12
            }
          ],
          "status": "active",
          "isActive": true,
          "createdAt": "2026-07-29T08:00:00.000Z",
          "updatedAt": "2026-07-29T09:00:00.000Z"
        }
      ],
      "status": "active",
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

#### `POST /api/products`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
**Body:** `name`, `description`, `category`, `variants[]` (optional), `status` (optional), `image` (file, optional)
**Response:**
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "description": "Premium Kenyan lager beer",
      "category": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Beer",
        "description": "All beer products"
      },
      "variants": [],
      "image": null,
      "imagePublicId": null,
      "status": "active",
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "attributes": [],
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "unit": "unit",
          "buyingPrice": 0,
          "sellingPrice": 0,
          "stockByBranch": [],
          "status": "active",
          "isActive": true,
          "createdAt": "2026-07-29T08:00:00.000Z",
          "updatedAt": "2026-07-29T08:00:00.000Z"
        }
      ],
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

#### `PUT /api/products/:productId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
**Body:** Any subset of `name`, `description`, `category`, `variants[]`, `status`, `image` (file)
**Response:**
```json
{
  "success": true,
  "message": "Product updated successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager Premium",
      "description": "Premium Kenyan lager beer",
      "status": "active",
      "updatedAt": "2026-07-29T10:00:00.000Z"
    }
  }
}
```

#### `DELETE /api/products/:productId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

---

## 🛣️ SKU Routes

### Base Path: `/api/skus`

```typescript
GET    /                                    // Get all SKUs (manager, admin)
GET    /low-stock                           // Get low stock SKUs (manager, admin, store_keeper)
GET    /barcode/:code                       // Search by barcode (bartender, cashier, manager, admin)
GET    /:skuId                              // Get SKU by ID (manager, admin)
POST   /:productId                          // Create SKU (manager, admin)
PUT    /:productId/skus/:skuId              // Update SKU (manager, admin)
DELETE /:productId/skus/:skuId              // Delete SKU (admin)
PATCH  /:productId/skus/:skuId/branch-stock // Set branch stock level (manager, admin)
```

### Route Details

#### `GET /api/skus`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `status=active|inactive|discontinued`
**Response:**
```json
{
  "success": true,
  "data": {
    "skus": [
      {
        "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
        "productId": "64f2b3c4d5e6f7a8b9c0d1e2",
        "productName": "Tusker Lager",
        "attributes": [],
        "skuCode": "TUSKER-LAGER-DEFAULT",
        "barcode": "254001000001",
        "unit": "bottle",
        "buyingPrice": 120,
        "sellingPrice": 200,
        "stockByBranch": [
          {
            "branch": "64f0a1b2c3d4e5f6a7b8c9d1",
            "currentStock": 48,
            "minimumStock": 12
          }
        ],
        "status": "active",
        "isActive": true,
        "createdAt": "2026-07-29T08:00:00.000Z",
        "updatedAt": "2026-07-29T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalSkus": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/skus/low-stock`
**Headers:** `Authorization: Bearer <token>`
**Query:** `branch=<branchId>` (required), `page=1`, `limit=10`
**Response:**
```json
{
  "success": true,
  "data": {
    "skus": [
      {
        "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
        "productId": "64f2b3c4d5e6f7a8b9c0d1e2",
        "productName": "Tusker Lager",
        "skuCode": "TUSKER-LAGER-DEFAULT",
        "barcode": "254001000001",
        "unit": "bottle",
        "sellingPrice": 200,
        "status": "active",
        "currentStock": 5,
        "minimumStock": 12
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalSkus": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/skus/barcode/:code`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "sku": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
      "skuCode": "TUSKER-LAGER-DEFAULT",
      "barcode": "254001000001",
      "unit": "bottle",
      "buyingPrice": 120,
      "sellingPrice": 200,
      "status": "active",
      "isActive": true
    },
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager"
    }
  }
}
```

#### `POST /api/skus/:productId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "skuCode": "TUSKER-LAGER-CRATE",
  "barcode": "254001000002",
  "unit": "crate",
  "buyingPrice": 1200,
  "sellingPrice": 1800
}
```
**Response:**
```json
{
  "success": true,
  "message": "SKU created successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "unit": "bottle",
          "buyingPrice": 120,
          "sellingPrice": 200
        },
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e4",
          "skuCode": "TUSKER-LAGER-CRATE",
          "barcode": "254001000002",
          "unit": "crate",
          "buyingPrice": 1200,
          "sellingPrice": 1800,
          "status": "active",
          "isActive": true,
          "createdAt": "2026-07-29T09:30:00.000Z",
          "updatedAt": "2026-07-29T09:30:00.000Z"
        }
      ]
    }
  }
}
```

#### `PUT /api/skus/:productId/skus/:skuId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:** Any subset of `skuCode`, `barcode`, `unit`, `buyingPrice`, `sellingPrice`, `supplier`, `status`, `isActive`
**Response:**
```json
{
  "success": true,
  "message": "SKU updated successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "barcode": "254001000001",
          "unit": "bottle",
          "buyingPrice": 120,
          "sellingPrice": 200,
          "status": "active",
          "isActive": true,
          "updatedAt": "2026-07-29T10:00:00.000Z"
        }
      ]
    }
  }
}
```

#### `DELETE /api/skus/:productId/skus/:skuId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "SKU deleted successfully"
}
```

#### `PATCH /api/skus/:productId/skus/:skuId/branch-stock`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "branch": "64f0a1b2c3d4e5f6a7b8c9d1",
  "currentStock": 48,
  "minimumStock": 12
}
```
**Response:**
```json
{
  "success": true,
  "message": "Branch stock level updated successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "stockByBranch": [
            {
              "branch": "64f0a1b2c3d4e5f6a7b8c9d1",
              "currentStock": 48,
              "minimumStock": 12
            }
          ],
          "updatedAt": "2026-07-29T10:10:00.000Z"
        }
      ]
    }
  }
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with roles
**Usage:**
```typescript
router.get("/", authenticateToken, getAllProducts);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllProducts);
```

### File Upload Middleware

#### `uploadProductImage.single("image")`
**Purpose:** Accept a single image file (max 2 MB, images only), stream to Cloudinary `pos-api/products`
**Usage:** Applied before the controller on `POST /` and `PUT /:productId`
```typescript
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), uploadProductImage.single("image"), createProduct);
```

---

## 📝 API Examples

### Create Product (no variants)

```bash
curl -X POST http://localhost:3500/api/products \
  -H "Authorization: Bearer <token>" \
  -F "name=Tusker Lager" \
  -F "description=Premium Kenyan lager beer" \
  -F "category=64f1a2b3c4d5e6f7a8b9c0d1"
```

**Response:**
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "product": {
      "_id": "64f2b3c4d5e6f7a8b9c0d1e2",
      "name": "Tusker Lager",
      "description": "Premium Kenyan lager beer",
      "category": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Beer",
        "description": "All beer products"
      },
      "variants": [],
      "image": null,
      "imagePublicId": null,
      "status": "active",
      "skus": [
        {
          "_id": "64f2b3c4d5e6f7a8b9c0d1e3",
          "attributes": [],
          "skuCode": "TUSKER-LAGER-DEFAULT",
          "unit": "unit",
          "buyingPrice": 0,
          "sellingPrice": 0,
          "stockByBranch": [],
          "status": "active",
          "isActive": true,
          "createdAt": "2026-07-29T08:00:00.000Z",
          "updatedAt": "2026-07-29T08:00:00.000Z"
        }
      ],
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

### Get All Products

```bash
curl -X GET "http://localhost:3500/api/products?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```

### Set Branch Stock Level

```bash
curl -X PATCH http://localhost:3500/api/skus/64f2b3c4d5e6f7a8b9c0d1e2/skus/64f2b3c4d5e6f7a8b9c0d1e3/branch-stock \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "branch": "64f0a1b2c3d4e5f6a7b8c9d1",
    "currentStock": 48,
    "minimumStock": 12
  }'
```

### Get Low Stock SKUs

```bash
curl -X GET "http://localhost:3500/api/skus/low-stock?branch=64f0a1b2c3d4e5f6a7b8c9d1" \
  -H "Authorization: Bearer <token>"
```

### Search by Barcode

```bash
curl -X GET http://localhost:3500/api/skus/barcode/254001000001 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require authentication. Write operations restricted to `manager` and `admin`. Deletes restricted to `admin`. Barcode search available to `bartender` and `cashier` for point-of-sale use.
- **Uniqueness Guards:** Product name, SKU code, and barcode uniqueness enforced at controller level before DB write.
- **Relational Integrity:** Category and variant IDs validated to exist individually before create or update.
- **Cloudinary Cleanup:** Old product images deleted from Cloudinary before uploading a replacement, and on product deletion. Deletion errors are caught locally and logged — they do not abort the controller flow.

---

## 🚨 Error Handling

Common responses:
```json
{
  "success": false,
  "message": "..."
}
```

---

## 📊 Database Indexes

```typescript
// Product
productSchema.index({ name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
productSchema.index({ createdBy: 1 });
productSchema.index({ createdAt: -1 });

// SKU (within product.skus)
skuSchema.index({ skuCode: 1 });
skuSchema.index({ barcode: 1 }, { sparse: true });
```

---

**Last Updated:** 2026-07-29
**Version:** 1.0.0
**Maintainer:** POS API Development Team
