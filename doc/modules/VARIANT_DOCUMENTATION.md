# 🗂️ POS API - Variant Management Documentation

## 📋 Table of Contents
- [Variant Management Overview](#variant-management-overview)
- [Variant Model](#-variant-model)
- [Variant Controller](#-variant-controller)
- [Variant Routes](#-variant-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Variant Management Overview

Variant Management handles product variation attributes shared across all branches. A Variant defines a dimension along which a product differs — for example, a "Size" variant with options "250ml", "750ml", and "1L". Variants are attached at the SKU level; a SKU that comes in a single size simply has no variant reference. Options are embedded sub-documents so they travel with the variant and can be individually activated or deactivated without touching other options.

---

## 👤 Variant Model

### Schema Definition
```typescript
interface IOption {
  _id: Types.ObjectId;
  value: string;       // e.g. "250ml", "750ml", "1L", "Lime", "Original"
  isActive: boolean;
  sortOrder: number;
}

interface IVariant extends Document {
  name: string;        // e.g. "Size", "Flavour", "Strength"
  options: Types.DocumentArray<IOption & Document>;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Variant.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IVariant } from "../type";

const optionSchema = new Schema<any>(
  {
    value: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const variantSchema = new Schema<IVariant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    options: {
      type: [optionSchema],
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

variantSchema.index({ name: 1 });
variantSchema.index({ sortOrder: 1 });

const Variant = mongoose.model<IVariant>("Variant", variantSchema);
export default Variant;
```

### Validation Rules
```typescript
name:              { required: true, unique: true, trim: true }
options:           { default: [] — embedded array of IOption sub-documents }
options[].value:   { required: true, trim: true — unique within parent variant }
options[].isActive:{ default: true }
options[].sortOrder:{ default: 0 }
sortOrder:         { default: 0 }
```

---

## 🎮 Variant Controller

**File:** `src/controllers/variantController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Variant from "../models/Variant";
```

### Functions Overview

#### `getAllVariants()`
**Purpose:** List all variants with search and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by name search, sort by sortOrder then createdAt, paginate
**Response:** Variant list and pagination

**Controller Implementation:**
```typescript
export const getAllVariants = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch variants and total count
    const variants = await Variant.find(query)
      .sort({ sortOrder: 1, createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Variant.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        variants,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalVariants: total,
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

---

#### `getVariantById()`
**Purpose:** Fetch a single variant with all its options
**Access:** Manager, Admin
**Validation:** Variant must exist
**Process:** Find variant by ID and return
**Response:** Variant with embedded options array

**Controller Implementation:**
```typescript
export const getVariantById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find variant by ID
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Return variant
    res.status(200).json({
      success: true,
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `createVariant()`
**Purpose:** Create a new variant with an optional initial set of options
**Access:** Manager, Admin
**Validation:** Name required and must be unique; option values must be unique within the variant
**Process:** Validate, check for duplicate name, check for duplicate option values, create
**Response:** Created variant

**Controller Implementation:**
```typescript
export const createVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, options = [], sortOrder = 0 } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — name must not already exist
    const existing = await Variant.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "Variant with this name already exists"));
    }

    // Guard — option values must be unique within the variant
    if (Array.isArray(options) && options.length > 0) {
      const values = options.map((o: any) => String(o.value).toLowerCase());
      const uniqueValues = new Set(values);
      if (uniqueValues.size !== values.length) {
        return next(errorHandler(400, "Option values must be unique within a variant"));
      }
    }

    // Create variant
    const variant = await Variant.create({ name, options, sortOrder });

    // Return created variant
    res.status(201).json({
      success: true,
      message: "Variant created successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateVariant()`
**Purpose:** Update a variant's name or sortOrder
**Access:** Manager, Admin
**Validation:** Variant must exist; updated name must not conflict with another variant
**Process:** Find variant, check name uniqueness if name changes, apply updates, save
**Response:** Updated variant

**Controller Implementation:**
```typescript
export const updateVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, sortOrder } = req.body;

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — updated name must not belong to another variant
    if (name && name !== variant.name) {
      const conflict = await Variant.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: variant._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Variant with this name already exists"));
      }
      variant.name = name;
    }

    // Apply remaining updates
    if (sortOrder !== undefined) {
      variant.sortOrder = sortOrder;
    }

    // Save and return
    await variant.save();
    res.status(200).json({
      success: true,
      message: "Variant updated successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `deleteVariant()`
**Purpose:** Delete a variant and all its embedded options
**Access:** Admin
**Validation:** Variant must exist
**Process:** Find and delete record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete variant
    const variant = await Variant.findByIdAndDelete(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Variant deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `addOption()`
**Purpose:** Append a new option to an existing variant
**Access:** Manager, Admin
**Validation:** Variant must exist; value required and must be unique within the variant
**Process:** Find variant, check duplicate value, push to options array, save
**Response:** Updated variant with new option

**Controller Implementation:**
```typescript
export const addOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { value, sortOrder = 0 } = req.body;

    // Guard — value required
    if (!value) {
      return next(errorHandler(400, "Option value is required"));
    }

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — option value must be unique within this variant
    const duplicate = variant.options.find(
      (o) => o.value.toLowerCase() === String(value).toLowerCase()
    );
    if (duplicate) {
      return next(errorHandler(409, "An option with this value already exists on this variant"));
    }

    // Push new option
    variant.options.push({ value, isActive: true, sortOrder } as any);
    await variant.save();

    // Return updated variant
    res.status(201).json({
      success: true,
      message: "Option added successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateOption()`
**Purpose:** Update an option's value, isActive, or sortOrder
**Access:** Manager, Admin
**Validation:** Variant and option must exist; updated value must not conflict with another option
**Process:** Find variant and option by subdocument ID, apply updates, save
**Response:** Updated variant

**Controller Implementation:**
```typescript
export const updateOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { value, isActive, sortOrder } = req.body;

    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Find option by subdocument ID
    const option = variant.options.id(req.params.optionId);

    // Guard — option must exist
    if (!option) {
      return next(errorHandler(404, "Option not found"));
    }

    // Guard — updated value must not belong to another option on this variant
    if (value && value.toLowerCase() !== option.value.toLowerCase()) {
      const conflict = variant.options.find(
        (o) =>
          o.value.toLowerCase() === String(value).toLowerCase() &&
          String(o._id) !== req.params.optionId
      );
      if (conflict) {
        return next(errorHandler(409, "An option with this value already exists on this variant"));
      }
      option.value = value;
    }

    // Apply remaining updates
    if (isActive !== undefined) {
      option.isActive = isActive;
    }
    if (sortOrder !== undefined) {
      option.sortOrder = sortOrder;
    }

    // Save and return
    await variant.save();
    res.status(200).json({
      success: true,
      message: "Option updated successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `removeOption()`
**Purpose:** Delete a single option from a variant
**Access:** Admin
**Validation:** Variant and option must exist
**Process:** Find variant and option, call deleteOne() on subdocument, save
**Response:** Updated variant without the removed option

**Controller Implementation:**
```typescript
export const removeOption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find variant
    const variant = await Variant.findById(req.params.variantId);

    // Guard — variant must exist
    if (!variant) {
      return next(errorHandler(404, "Variant not found"));
    }

    // Guard — option must exist
    const option = variant.options.id(req.params.optionId);
    if (!option) {
      return next(errorHandler(404, "Option not found"));
    }

    // Remove option
    option.deleteOne();
    await variant.save();

    // Return updated variant
    res.status(200).json({
      success: true,
      message: "Option removed successfully",
      data: { variant },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Variant Routes

### Base Path: `/api/variants`

```
GET    /                                     // Get all variants (manager, admin)
GET    /:variantId                           // Get single variant (manager, admin)
POST   /                                     // Create variant (manager, admin)
PUT    /:variantId                           // Update variant (manager, admin)
DELETE /:variantId                           // Delete variant (admin only)
POST   /:variantId/options                   // Add option (manager, admin)
PUT    /:variantId/options/:optionId         // Update option (manager, admin)
DELETE /:variantId/options/:optionId         // Remove option (admin only)
```

### Router Implementation

**File: `src/routes/variantRoutes.ts`**

```typescript
import express from "express";
import {
  getAllVariants, getVariantById, createVariant, updateVariant, deleteVariant,
  addOption, updateOption, removeOption,
} from "../controllers/variantController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllVariants);
router.get("/:variantId", authenticateToken, authorizeRoles(["manager", "admin"]), getVariantById);
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createVariant);
router.put("/:variantId", authenticateToken, authorizeRoles(["manager", "admin"]), updateVariant);
router.delete("/:variantId", authenticateToken, authorizeRoles(["admin"]), deleteVariant);
router.post("/:variantId/options", authenticateToken, authorizeRoles(["manager", "admin"]), addOption);
router.put("/:variantId/options/:optionId", authenticateToken, authorizeRoles(["manager", "admin"]), updateOption);
router.delete("/:variantId/options/:optionId", authenticateToken, authorizeRoles(["admin"]), removeOption);

export default router;
```

---

### Route Details

#### `GET /api/variants`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<name>`
**Response:**
```json
{
  "success": true,
  "data": {
    "variants": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
        "name": "Size",
        "options": [
          {
            "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
            "value": "250ml",
            "isActive": true,
            "sortOrder": 0
          },
          {
            "_id": "64f1a2b3c4d5e6f7a8b9c0f2",
            "value": "750ml",
            "isActive": true,
            "sortOrder": 1
          },
          {
            "_id": "64f1a2b3c4d5e6f7a8b9c0f3",
            "value": "1L",
            "isActive": true,
            "sortOrder": 2
          }
        ],
        "sortOrder": 0,
        "createdAt": "2026-07-29T08:00:00.000Z",
        "updatedAt": "2026-07-29T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalVariants": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

#### `GET /api/variants/:variantId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Size",
      "options": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
          "value": "250ml",
          "isActive": true,
          "sortOrder": 0
        },
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c0f2",
          "value": "750ml",
          "isActive": true,
          "sortOrder": 1
        }
      ],
      "sortOrder": 0,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

---

#### `POST /api/variants`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "Size",
  "sortOrder": 0,
  "options": [
    { "value": "250ml", "sortOrder": 0 },
    { "value": "750ml", "sortOrder": 1 },
    { "value": "1L",    "sortOrder": 2 }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Variant created successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Size",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f1", "value": "250ml", "isActive": true, "sortOrder": 0 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f2", "value": "750ml", "isActive": true, "sortOrder": 1 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f3", "value": "1L",    "isActive": true, "sortOrder": 2 }
      ],
      "sortOrder": 0,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z"
    }
  }
}
```

---

#### `PUT /api/variants/:variantId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "Volume",
  "sortOrder": 1
}
```
**Response:**
```json
{
  "success": true,
  "message": "Variant updated successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Volume",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f1", "value": "250ml", "isActive": true, "sortOrder": 0 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f2", "value": "750ml", "isActive": true, "sortOrder": 1 }
      ],
      "sortOrder": 1,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T09:30:00.000Z"
    }
  }
}
```

---

#### `DELETE /api/variants/:variantId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Variant deleted"
}
```

---

#### `POST /api/variants/:variantId/options`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "value": "2L",
  "sortOrder": 3
}
```
**Response:**
```json
{
  "success": true,
  "message": "Option added successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Size",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f1", "value": "250ml", "isActive": true, "sortOrder": 0 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f2", "value": "750ml", "isActive": true, "sortOrder": 1 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f3", "value": "1L",    "isActive": true, "sortOrder": 2 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f4", "value": "2L",    "isActive": true, "sortOrder": 3 }
      ],
      "sortOrder": 0,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T10:15:00.000Z"
    }
  }
}
```

---

#### `PUT /api/variants/:variantId/options/:optionId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "isActive": false
}
```
**Response:**
```json
{
  "success": true,
  "message": "Option updated successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Size",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f1", "value": "250ml", "isActive": false, "sortOrder": 0 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f2", "value": "750ml", "isActive": true,  "sortOrder": 1 }
      ],
      "sortOrder": 0,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T11:00:00.000Z"
    }
  }
}
```

---

#### `DELETE /api/variants/:variantId/options/:optionId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Option removed successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e1",
      "name": "Size",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0f2", "value": "750ml", "isActive": true, "sortOrder": 1 }
      ],
      "sortOrder": 0,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T11:30:00.000Z"
    }
  }
}
```

---

## 📝 API Examples

### Create Variant with Options
```bash
curl -X POST http://localhost:3500/api/variants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Flavour",
    "sortOrder": 1,
    "options": [
      { "value": "Original", "sortOrder": 0 },
      { "value": "Lime",     "sortOrder": 1 },
      { "value": "Mango",    "sortOrder": 2 }
    ]
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Variant created successfully",
  "data": {
    "variant": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0e2",
      "name": "Flavour",
      "options": [
        { "_id": "64f1a2b3c4d5e6f7a8b9c0a1", "value": "Original", "isActive": true, "sortOrder": 0 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0a2", "value": "Lime",     "isActive": true, "sortOrder": 1 },
        { "_id": "64f1a2b3c4d5e6f7a8b9c0a3", "value": "Mango",    "isActive": true, "sortOrder": 2 }
      ],
      "sortOrder": 1,
      "createdAt": "2026-07-29T08:30:00.000Z",
      "updatedAt": "2026-07-29T08:30:00.000Z"
    }
  }
}
```

### Deactivate an Option
```bash
curl -X PUT \
  http://localhost:3500/api/variants/64f1a2b3c4d5e6f7a8b9c0e2/options/64f1a2b3c4d5e6f7a8b9c0a3 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "isActive": false }'
```

### Duplicate Name Error
```bash
curl -X POST http://localhost:3500/api/variants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "name": "Size" }'
```
**Response:**
```json
{
  "success": false,
  "message": "Variant with this name already exists"
}
```

### Duplicate Option Value Error
```bash
curl -X POST http://localhost:3500/api/variants/64f1a2b3c4d5e6f7a8b9c0e1/options \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "value": "750ml" }'
```
**Response:**
```json
{
  "success": false,
  "message": "An option with this value already exists on this variant"
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with role
**Usage:**
```typescript
router.get("/", authenticateToken, getAllVariants);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Restrict route to specific roles
**Usage:**
```typescript
router.delete("/:variantId", authenticateToken, authorizeRoles(["admin"]), deleteVariant);
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`; write access (create, update, add option, update option) limited to `manager` and `admin`; delete operations (variant and option) restricted to `admin` only.
- **Least Privilege:** Bartenders, cashiers, store keepers, and accountants have no variant access.
- **Case-Insensitive Uniqueness:** Variant name uniqueness and option value uniqueness within a variant are both enforced case-insensitively to prevent duplicates like `size` vs `Size` or `750ml` vs `750ML`.

---

## 🚨 Error Handling

```json
{
  "success": false,
  "message": "..."
}
```

| Status | Scenario |
|--------|----------|
| `400` | Missing `name` on variant create; missing `value` on option add; duplicate option values in create body |
| `401` | Missing or invalid JWT token |
| `403` | Role not permitted for the action |
| `404` | Variant ID not found; option subdocument ID not found |
| `409` | Variant name already exists; option value already exists on the variant |
| `500` | Unexpected server error |

---

## 📊 Database Indexes

```typescript
variantSchema.index({ name: 1 });
variantSchema.index({ sortOrder: 1 });
```

- `name` index: fast lookups and uniqueness enforcement
- `sortOrder` index: supports ordered list queries (menus render variants by sort position)

---

**Last Updated:** 2026-07-29
**Version:** 1.0.0
**Maintainer:** POS API Development Team
