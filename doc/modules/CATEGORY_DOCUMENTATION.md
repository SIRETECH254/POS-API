# 🗂️ POS API - Category Management Documentation

## 📋 Table of Contents
- [Category Management Overview](#category-management-overview)
- [Category Model](#-category-model)
- [Category Controller](#-category-controller)
- [Category Routes](#-category-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Category Management Overview

Category Management handles the shared product catalog taxonomy used across all branches. Categories group products (e.g. Beer, Wine, Whisky, Cocktails, Food) and are referenced by the Product model. Categories are not branch-scoped — they apply globally to the entire catalog. Only managers and admins can manage categories; deletion is restricted to admins.

---

## 👤 Category Model

### Schema Definition
```typescript
interface ICategory extends Document {
  name: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Category.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { ICategory } from "../type";

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

categorySchema.index({ name: 1 });
categorySchema.index({ isActive: 1 });

const Category = mongoose.model<ICategory>("Category", categorySchema);
export default Category;
```

### Validation Rules
```typescript
name:        { required: true, unique: true, trim: true }
description: { required: true, trim: true }
isActive:    { default: true }
```

---

## 🎮 Category Controller

**File:** `src/controllers/categoryController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Category from "../models/Category";
```

### Functions Overview

#### `getAllCategories()`
**Purpose:** List all categories with filtering and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by search/status, paginate, return categories
**Response:** Category list and pagination

**Controller Implementation:**
```typescript
export const getAllCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "active") {
      query.isActive = true;
    }
    if (status === "inactive") {
      query.isActive = false;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch categories and total count
    const categories = await Category.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Category.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        categories,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalCategories: total,
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

#### `getCategoryById()`
**Purpose:** Fetch a single category by ID
**Access:** Manager, Admin
**Validation:** Category must exist
**Process:** Find category by ID and return
**Response:** Category details

**Controller Implementation:**
```typescript
export const getCategoryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find category by ID
    const category = await Category.findById(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Return category
    res.status(200).json({
      success: true,
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `createCategory()`
**Purpose:** Create a new category
**Access:** Manager, Admin
**Validation:** Name and description are required; name must be unique (case-insensitive)
**Process:** Validate fields, check for duplicate name, create and save
**Response:** Created category

**Controller Implementation:**
```typescript
export const createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — description required
    if (!description) {
      return next(errorHandler(400, "Description is required"));
    }

    // Guard — name must not already exist
    const existing = await Category.findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      return next(errorHandler(409, "Category with this name already exists"));
    }

    // Create category
    const category = await Category.create({ name, description });

    // Return created category
    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateCategory()`
**Purpose:** Update a category by ID
**Access:** Manager, Admin
**Validation:** Category must exist; updated name must not conflict with another record
**Process:** Find category, apply updates, check name uniqueness if name changes, save
**Response:** Updated category

**Controller Implementation:**
```typescript
export const updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, description, isActive } = req.body;

    // Find category
    const category = await Category.findById(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Guard — updated name must not belong to another category
    if (name && name !== category.name) {
      const conflict = await Category.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: category._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Category with this name already exists"));
      }
      category.name = name;
    }

    // Apply remaining updates
    if (description !== undefined) {
      category.description = description;
    }
    if (isActive !== undefined) {
      category.isActive = isActive;
    }

    // Save and return
    await category.save();
    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: { category },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `deleteCategory()`
**Purpose:** Delete a category by ID
**Access:** Admin
**Validation:** Category must exist
**Process:** Find and delete record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete category
    const category = await Category.findByIdAndDelete(req.params.categoryId);

    // Guard — category must exist
    if (!category) {
      return next(errorHandler(404, "Category not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Category deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Category Routes

### Base Path: `/api/categories`

```
GET    /                    // Get all categories (manager, admin)
GET    /:categoryId         // Get single category (manager, admin)
POST   /                    // Create category (manager, admin)
PUT    /:categoryId         // Update category (manager, admin)
DELETE /:categoryId         // Delete category (admin only)
```

### Router Implementation

**File: `src/routes/categoryRoutes.ts`**

```typescript
import express from "express";
import {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllCategories);
router.get("/:categoryId", authenticateToken, authorizeRoles(["manager", "admin"]), getCategoryById);
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createCategory);
router.put("/:categoryId", authenticateToken, authorizeRoles(["manager", "admin"]), updateCategory);
router.delete("/:categoryId", authenticateToken, authorizeRoles(["admin"]), deleteCategory);

export default router;
```

### Route Details

#### `GET /api/categories`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<string>`, `status=active|inactive`
**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Beer",
        "description": "All beer products including bottled and draught",
        "isActive": true,
        "createdAt": "2026-07-27T10:00:00.000Z",
        "updatedAt": "2026-07-27T10:00:00.000Z"
      },
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "Wine",
        "description": "Red, white, and rosé wines",
        "isActive": true,
        "createdAt": "2026-07-26T09:00:00.000Z",
        "updatedAt": "2026-07-26T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalCategories": 2,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

#### `GET /api/categories/:categoryId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Beer",
      "description": "All beer products including bottled and draught",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

---

#### `POST /api/categories`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "Cocktails",
  "description": "Mixed drinks and signature cocktail recipes"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Category created successfully",
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "name": "Cocktails",
      "description": "Mixed drinks and signature cocktail recipes",
      "isActive": true,
      "createdAt": "2026-07-29T08:30:00.000Z",
      "updatedAt": "2026-07-29T08:30:00.000Z"
    }
  }
}
```

---

#### `PUT /api/categories/:categoryId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "description": "Bottled, canned, and draught beers from local and international breweries",
  "isActive": true
}
```
**Response:**
```json
{
  "success": true,
  "message": "Category updated successfully",
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Beer",
      "description": "Bottled, canned, and draught beers from local and international breweries",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-29T09:15:00.000Z"
    }
  }
}
```

---

#### `DELETE /api/categories/:categoryId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Category deleted"
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with role
**Usage:**
```typescript
router.get("/", authenticateToken, getAllCategories);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Restrict route to specific roles
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createCategory);
```

---

## 📝 API Examples

### Get All Categories
```bash
curl -X GET "http://localhost:3500/api/categories?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "Beer",
        "description": "All beer products including bottled and draught",
        "isActive": true,
        "createdAt": "2026-07-27T10:00:00.000Z",
        "updatedAt": "2026-07-27T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalCategories": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Search Categories
```bash
curl -X GET "http://localhost:3500/api/categories?search=whisky" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
        "name": "Whisky",
        "description": "Single malts, blends, and bourbon selections",
        "isActive": true,
        "createdAt": "2026-07-25T11:00:00.000Z",
        "updatedAt": "2026-07-25T11:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalCategories": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Get Category by ID
```bash
curl -X GET http://localhost:3500/api/categories/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Beer",
      "description": "All beer products including bottled and draught",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### Create Category
```bash
curl -X POST http://localhost:3500/api/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Soft Drinks",
    "description": "Non-alcoholic beverages including sodas, juices, and water"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Category created successfully",
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
      "name": "Soft Drinks",
      "description": "Non-alcoholic beverages including sodas, juices, and water",
      "isActive": true,
      "createdAt": "2026-07-29T08:45:00.000Z",
      "updatedAt": "2026-07-29T08:45:00.000Z"
    }
  }
}
```

### Update Category
```bash
curl -X PUT http://localhost:3500/api/categories/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "description": "Bottled, canned, and draught beers from local and international breweries",
    "isActive": true
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Category updated successfully",
  "data": {
    "category": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Beer",
      "description": "Bottled, canned, and draught beers from local and international breweries",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-29T09:15:00.000Z"
    }
  }
}
```

### Delete Category
```bash
curl -X DELETE http://localhost:3500/api/categories/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "message": "Category deleted"
}
```

### Duplicate Name Error
```bash
curl -X POST http://localhost:3500/api/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "name": "Beer", "description": "Duplicate test" }'
```
**Response:**
```json
{
  "success": false,
  "message": "Category with this name already exists"
}
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`; write access limited to `manager` and `admin`; delete restricted to `admin` only.
- **Least Privilege:** Bartenders, cashiers, store keepers, and accountants have no category access.
- **Case-Insensitive Uniqueness:** Name uniqueness is enforced case-insensitively on both create and update to prevent duplicates like `beer` vs `Beer`.

---

## 🚨 Error Handling

```json
{
  "success": false,
  "message": "Name is required"
}
```

| Status | Scenario |
|--------|----------|
| `400` | Missing `name` or `description` on create |
| `401` | Missing or invalid JWT token |
| `403` | Role not permitted for the action |
| `404` | Category ID not found |
| `409` | Category name already exists (create or update) |
| `500` | Unexpected server error |

---

## 📊 Database Indexes

```typescript
categorySchema.index({ name: 1 });
categorySchema.index({ isActive: 1 });
```

- `name` index: supports fast lookups and uniqueness enforcement
- `isActive` index: supports filtered list queries by status

---

**Last Updated:** 2026-07-29
**Version:** 1.0.0
**Maintainer:** POS API Development Team
