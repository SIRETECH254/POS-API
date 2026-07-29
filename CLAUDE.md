# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Table of Contents
- [Overview](#overview)
- [Key Patterns](#key-patterns)
  - [API Response Format](#api-response-format)
  - [Model Structure](#model-structure)
  - [Controller Structure](#controller-structure)
  - [Pagination](#pagination)
  - [Routes Structure](#routes-structure)
  - [Middleware Chain Order](#middleware-chain-order)
- [Error Handling](#error-handling)
- [Real-time (Socket.io)](#real-time-socketio)
- [API Documentation](#api-documentation)
- [Swagger](#swagger)
- [Cloudinary](#cloudinary)
- [Project Layout](#project-layout)
- [Environment Variables](#environment-variables)
- [Commands](#commands)

---

## Overview

POS API for club/bar operations. Core business entity is the **Sale Tab** lifecycle — opening a tab, adding items, payment, and receipt. Supports multiple branches and user roles (Bartender, Cashier, Store Keeper, Manager, Admin, Accountant).

**Stack:** Express 5 + TypeScript + MongoDB (Mongoose) + Socket.io + Swagger UI. Runs on port 3500.

---

## Key Patterns

### API Response Format
All controllers must return this shape consistently:
```typescript
// Success
res.status(200).json({
  success: true,
  message: "...",
  data: { ... }
});

// Error — always via next(), never res.json() directly
return next(errorHandler(404, "Item not found"));
```

---

### Model Structure
Every model follows the interface → Schema → indexes → export pattern:

```typescript
import mongoose, { Schema, Document } from "mongoose";

// 1. Interface
interface IItem extends Document {
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 2. Schema
const itemSchema = new Schema<IItem>(
  {
    name: {
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

// 3. Indexes
itemSchema.index({ name: 1 });
itemSchema.index({ isActive: 1 });

// 4. Export
const Item = mongoose.model<IItem>("Item", itemSchema);
export default Item;
```

---

### Controller Structure
Each controller function has:
- **Outside:** a JSDoc block describing Purpose, Access, Validation, Process, and Response
- **Inside:** step comments within the try body
- Return type is always `Promise<void>`

**Enforced style rules:**

1. **`if` body always on its own line — never inline:**
   ```typescript
   // ✅ correct
   if (isActive !== undefined) {
     role.isActive = isActive;
   }

   // ❌ wrong
   if (isActive !== undefined) role.isActive = isActive;
   ```

2. **Each validation guard is independent — never combine conditions with `||` or `&&`:**
   ```typescript
   // ✅ correct
   if (!name) {
     return next(errorHandler(400, "Name is required"));
   }
   if (!description) {
     return next(errorHandler(400, "Description is required"));
   }

   // ❌ wrong
   if (!name || !description) {
     return next(errorHandler(400, "Name and description are required"));
   }
   ```

3. **All `res.json()` responses are multi-line — never compressed to one line:**
   ```typescript
   // ✅ correct
   res.status(201).json({
     success: true,
     message: "Item created successfully",
     data: { item },
   });

   // ❌ wrong
   res.status(201).json({ success: true, message: "Item created successfully", data: { item } });
   ```

```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Item from "../models/Item";

/**
 * Get item by ID
 * Purpose: Fetch a single item record
 * Access: Admin
 * Validation: Item must exist
 * Process: Find item by ID and return
 * Response: Item details
 */
export const getItemById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find item by ID
    const item = await Item.findById(req.params.itemId);

    // Guard — item must exist
    if (!item) {
      return next(errorHandler(404, "Item not found"));
    }

    // Return item
    res.status(200).json({
      success: true,
      data: { item },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Create item
 * Purpose: Create a new item record
 * Access: Admin
 * Validation: Required fields must be present
 * Process: Create and save item
 * Response: Created item
 */
export const createItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name } = req.body;

    // Create item
    const item = await Item.create({ name });

    // Return created item
    res.status(201).json({
      success: true,
      message: "Item created successfully",
      data: { item },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

### Pagination
All `getAll*` controllers must use this exact pagination shape. The entity key name in `data` and `total*` matches the module (e.g. `users` / `totalUsers`, `products` / `totalProducts`):

```typescript
/**
 * Get all items
 * Purpose: List all items with filtering and pagination
 * Access: Admin
 * Validation: None required
 * Process: Filter by query params, paginate, return results
 * Response: Item list and pagination
 */
export const getAllItems = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }];
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch items and total count
    const items = await Item.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Item.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalItems: total,
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

Standard query params accepted by every list endpoint: `page` (default 1), `limit` (default 10), `search` (optional regex).

---

### Routes Structure
Router files live in `src/routes/`. Swagger JSDoc annotations go directly above each `router.*` call. Register every new router in `src/index.ts` under `// Route registrations`.

```typescript
// src/routes/itemRoutes.ts
import express from "express";
import {
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
} from "../controllers/itemController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/items:
 *   get:
 *     summary: Get all items
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Items retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticateToken, authorizeRoles(["admin"]), getAllItems);

/**
 * @swagger
 * /api/items/{itemId}:
 *   get:
 *     summary: Get item by ID
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item retrieved successfully
 *       404:
 *         description: Item not found
 */
router.get("/:itemId", authenticateToken, authorizeRoles(["admin"]), getItemById);

export default router;
```

---

### Middleware Chain Order
On protected routes:
```
authenticateToken → authorizeRoles(...) → requireBranchAccess → requireActiveShift (tab routes only) → handler
```

---

## Error Handling

Two-part pattern — all controllers must use both pieces:

1. `src/middleware/errorHandler.ts` — utility that creates an `Error` with a `statusCode` property:
   ```typescript
   return next(errorHandler(404, "Item not found"));
   ```
2. Global error middleware at the bottom of `src/index.ts` — catches all errors, returns `{ success: false, message }`. Includes `error` + `stack` fields only when `NODE_ENV=development`.

---

## Real-time (Socket.io)

- `userId → socket.id` tracked in a `Map<string, string>` stored on the app (`app.get("socketConnections")`)
- Each user joins a private room `user_{userId}` on the `authenticate` event
- Use `io.to("user_${userId}").emit(...)` for targeted messages from controllers (access via `req.app.get("io")`)

---

## API Documentation

### Source of Truth

For a complete understanding of any module — its purpose, data model, business rules, and API contract — refer to [`doc/BACKEND_DOCUMENTATION.md`](doc/BACKEND_DOCUMENTATION.md). That file is the authoritative reference for the project.

### Module Documentation

Every module has its own documentation file at `doc/modules/<MODULE>_DOCUMENTATION.md`. The structure and content of every module doc must match this template exactly — replace "Item/item/items" with the actual module entity name. When a controller, route, or model field changes, the corresponding section in the module doc must be updated in the same commit.

**Documentation JSON style rules:**

1. All JSON blocks must be fully vertical — never compressed to a single line. Every key-value pair goes on its own line, and every nested object is expanded.

2. Never use `{ ... }` or `[ { ... } ]` as placeholder dummy data. Always write out realistic example values for every field shown in the schema.

```json
// ✅ correct
{
  "success": true,
  "message": "Item created successfully",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "Tusker Lager",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z"
    }
  }
}

// ❌ wrong — compressed
{ "success": true, "message": "Item created successfully", "data": { "item": { ... } } }

// ❌ wrong — placeholder dummy data
{
  "success": true,
  "data": {
    "item": { ... }
  }
}
```

````markdown
# 🗂️ POS API - Item Management Documentation

## 📋 Table of Contents
- [Item Management Overview](#item-management-overview)
- [Item Model](#-item-model)
- [Item Controller](#-item-controller)
- [Item Routes](#-item-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Item Management Overview

Item Management covers all items in the system. All users authenticate via JWT and are assigned roles from the Role model. Role-based access control (RBAC) governs permissions throughout the system.

---

## 👤 Item Model

### Schema Definition
```typescript
interface IItem extends Document {
  name: string;
  isActive: boolean;
  branch: Types.ObjectId | IBranch;
  createdBy: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Item.ts`**

```typescript
import mongoose, { Schema } from 'mongoose';
import { IItem } from '../types';

const itemSchema = new Schema<IItem>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Item = mongoose.model<IItem>('Item', itemSchema);

export default Item;
```

### Validation Rules
```typescript
name:      { required: true, maxlength: 100 }
isActive:  { default: true }
branch:    { required: true, ref: 'Branch' }
createdBy: { required: true, ref: 'User' }
```

---

## 🎮 Item Controller

**File:** `src/controllers/itemController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Item from "../models/Item";
```

### Functions Overview

#### `getAllItems()`
**Purpose:** List all items with filtering and pagination
**Access:** Admin
**Validation:** None
**Process:** Filter by search/status/branch, paginate, return items
**Response:** Item list and pagination

**Controller Implementation:**
```typescript
export const getAllItems = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Extract query parameters
    const { page = 1, limit = 10, search, status, branch } = req.query;

    // 2. Build filter query
    const query: any = {};
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }];
    }
    if (status === "active") query.isActive = true;
    else if (status === "inactive") query.isActive = false;
    if (branch) query.branch = branch;

    // 3. Paginate options
    const options = { page: parseInt(page as string) || 1, limit: parseInt(limit as string) || 10 };

    // 4. Fetch items and total count
    const items = await Item.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Item.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // 5. Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalItems: total,
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

#### `getItemById()`
**Purpose:** Fetch a single item by ID
**Access:** Admin
**Validation:** Item must exist
**Process:** Find item by ID and return
**Response:** Item details

**Controller Implementation:**
```typescript
export const getItemById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Find item by ID
    const item = await Item.findById(req.params.itemId).populate("branch").populate("createdBy");

    // 2. Guard — item must exist
    if (!item) return next(errorHandler(404, "Item not found"));

    // 3. Return item
    res.status(200).json({ success: true, data: { item } });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createItem()`
**Purpose:** Create a new item
**Access:** Admin/Manager
**Validation:** Required fields must be present
**Process:** Create and save item
**Response:** Created item

**Controller Implementation:**
```typescript
export const createItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Extract fields from body
    const { name, branch } = req.body;

    // 2. Create item
    const item = await Item.create({ name, branch, createdBy: req.user?._id });

    // 3. Return created item
    res.status(201).json({ success: true, message: "Item created successfully", data: { item } });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateItem()`
**Purpose:** Update an item by ID
**Access:** Admin/Manager
**Validation:** Item must exist
**Process:** Update fields and save
**Response:** Updated item

**Controller Implementation:**
```typescript
export const updateItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Extract fields from body
    const { name, isActive } = req.body;

    // 2. Find item
    const item = await Item.findById(req.params.itemId);
    if (!item) return next(errorHandler(404, "Item not found"));

    // 3. Apply updates
    if (name) item.name = name;
    if (isActive !== undefined) item.isActive = isActive;

    // 4. Save and return
    await item.save();
    res.status(200).json({ success: true, message: "Item updated successfully", data: { item } });
  } catch (error: any) {
    next(error);
  }
};
```

#### `deleteItem()`
**Purpose:** Delete an item by ID
**Access:** Admin
**Validation:** Item must exist
**Process:** Delete record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Find and delete item
    const item = await Item.findByIdAndDelete(req.params.itemId);

    // 2. Guard — item must exist
    if (!item) return next(errorHandler(404, "Item not found"));

    // 3. Return success
    res.status(200).json({ success: true, message: "Item deleted" });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Item Routes

### Base Path: `/api/items`

```typescript
GET    /                    // Get all items (admin)
GET    /:itemId             // Get single item (admin)
POST   /                    // Create item (admin/manager)
PUT    /:itemId             // Update item (admin/manager)
DELETE /:itemId             // Delete item (admin)
```

### Router Implementation

**File: `src/routes/itemRoutes.ts`**

```typescript
import express from 'express';
import {
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
} from '../controllers/itemController';
import { authenticateToken, authorizeRoles } from '../middleware/auth';

const router = express.Router();

/**
 * @swagger
 * /api/items:
 *   get:
 *     summary: Get all items
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *       - in: query
 *         name: branch
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Items retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateToken, authorizeRoles(['admin']), getAllItems);

/**
 * @swagger
 * /api/items/{itemId}:
 *   get:
 *     summary: Get item by ID
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item retrieved successfully
 *       404:
 *         description: Item not found
 */
router.get('/:itemId', authenticateToken, authorizeRoles(['admin']), getItemById);

/**
 * @swagger
 * /api/items:
 *   post:
 *     summary: Create a new item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, branch]
 *             properties:
 *               name:
 *                 type: string
 *               branch:
 *                 type: string
 *     responses:
 *       201:
 *         description: Item created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticateToken, authorizeRoles(['admin', 'manager']), createItem);

/**
 * @swagger
 * /api/items/{itemId}:
 *   put:
 *     summary: Update item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Item updated successfully
 *       404:
 *         description: Item not found
 */
router.put('/:itemId', authenticateToken, authorizeRoles(['admin', 'manager']), updateItem);

/**
 * @swagger
 * /api/items/{itemId}:
 *   delete:
 *     summary: Delete item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item deleted
 *       404:
 *         description: Item not found
 */
router.delete('/:itemId', authenticateToken, authorizeRoles(['admin']), deleteItem);

export default router;
```

### Route Details

#### `GET /api/items`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<name>`, `status=active|inactive`, `branch=<branchId>`
**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "name": "Sample Item",
        "isActive": true
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalItems": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/items/:itemId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "item": {
      "id": "...",
      "name": "Sample Item",
      "isActive": true
    }
  }
}
```

#### `POST /api/items`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "Sample Item",
  "branch": "<branchId>"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Item created successfully",
  "data": {
    "item": {
      "id": "...",
      "name": "Sample Item"
    }
  }
}
```

#### `PUT /api/items/:itemId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "Updated Item",
  "isActive": false
}
```
**Response:**
```json
{
  "success": true,
  "message": "Item updated successfully",
  "data": {
    "item": {
      "id": "...",
      "name": "Updated Item"
    }
  }
}
```

#### `DELETE /api/items/:itemId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Item deleted"
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with roles
**Usage:**
```typescript
router.get('/', authenticateToken, getAllItems);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get('/', authenticateToken, authorizeRoles(['admin']), getAllItems);
```

---

## 📝 API Examples

### Get All Items
```bash
curl -X GET "http://localhost:3500/api/items?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "name": "Sample Item",
        "isActive": true
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalItems": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Get Item by ID
```bash
curl -X GET http://localhost:3500/api/items/<itemId> \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "item": {
      "id": "...",
      "name": "Sample Item"
    }
  }
}
```

### Create Item
```bash
curl -X POST http://localhost:3500/api/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "name": "Sample Item", "branch": "<branchId>" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Item created successfully",
  "data": {
    "item": {
      "id": "...",
      "name": "Sample Item"
    }
  }
}
```

### Update Item
```bash
curl -X PUT http://localhost:3500/api/items/<itemId> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "name": "Updated Item", "isActive": false }'
```
**Response:**
```json
{
  "success": true,
  "message": "Item updated successfully",
  "data": {
    "item": {
      "id": "...",
      "name": "Updated Item"
    }
  }
}
```

### Delete Item
```bash
curl -X DELETE http://localhost:3500/api/items/<itemId> \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "message": "Item deleted"
}
```

---

## 🛡️ Security Features

- **RBAC:** Route-level authorization via `authenticateToken` and `authorizeRoles`.
- **Least Privilege:** Destructive actions (delete) limited to `admin`.
- **Branch Scoping:** All queries are scoped to the requesting user's branch.

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
itemSchema.index({ name: 1 });
itemSchema.index({ isActive: 1 });
itemSchema.index({ branch: 1 });
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
````

---

## Swagger

Swagger JSDoc annotations are written in the **routes file**, not in controllers or models. Every route needs a `@swagger` block with:

- `summary` — one-line description
- `tags` — module grouping (e.g. `[Items]`, `[Tabs]`, `[Auth]`)
- `security: - bearerAuth: []` — on all authenticated routes
- `parameters` — path params and query params
- `requestBody` — for POST and PUT routes
- `responses` — at minimum: 200, 400, 401, 403, 404 where applicable

The `bearerAuth` scheme is pre-configured in `src/config/swagger.ts`. Swagger auto-scans `./src/routes/*.ts` — no extra registration needed after adding a routes file.

```typescript
/**
 * @swagger
 * /api/items:
 *   post:
 *     summary: Create a new item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Item created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", authenticateToken, authorizeRoles(["admin"]), createItem);
```

---

## Cloudinary

Any module that involves images, files, or attachments must go through Cloudinary — files are never stored locally. The configuration and all helper exports live in `src/config/cloudinary.ts`.

### Multer Middleware (apply at route level)

| Export | Folder | Limit | Types |
|---|---|---|---|
| `uploadUserAvatar` | `pos-api/avatars` | 2 MB | Images |
| `uploadProductImage` | `pos-api/products` | 2 MB | Images |
| `uploadExpenseReceipt` | `pos-api/expense-receipts` | 5 MB | Images + PDF |

```typescript
// Route level — middleware goes before the controller
router.post("/:productId/image", authenticateToken, uploadProductImage.single("image"), uploadProductImageController);
```

### Helper Functions

```typescript
// Upload — returns { url, public_id, format, size }
const result = await uploadToCloudinary(req.file, "pos-api/products");

// Delete — always call before replacing an existing asset
await deleteFromCloudinary(entity.imagePublicId);
```

### Controller Pattern

Every model with a Cloudinary asset stores both `url` and `public_id`. Always delete the old asset before uploading a new one:

```typescript
if (req.file) {
  const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");

  if (entity.imagePublicId) {
    try {
      await deleteFromCloudinary(entity.imagePublicId);
    } catch (deleteError) {
      console.error("Failed to delete previous asset:", deleteError);
    }
  }

  entity.image = uploadResult.url;
  entity.imagePublicId = uploadResult.public_id;
}
```

Deletion errors are caught locally and logged — they must not abort the main controller flow.

---

## Project Layout

As routes and models are added, follow this structure:
```
src/
  config/         # swagger.ts, db.ts, etc.
  middleware/     # errorHandler.ts, auth.ts, validate.ts, etc.
  models/         # Mongoose schemas
  controllers/    # Route handler logic
  services/       # Business logic called by controllers
  routes/         # Express routers (scanned by Swagger)
  scripts/        # One-off scripts (e.g. seedRoles.ts)
```

---

## Environment Variables

The `CALLBACK_URL` env var dynamically adds an extra allowed CORS origin at startup.

```env
# ===== App/Runtime =====
NODE_ENV=
PORT=
APP_NAME=
TIMEZONE=
LOG_LEVEL=

# ===== URLs/CORS =====
API_BASE_URL=
FRONTEND_URL=
ADMIN_URL=
CORS_ORIGIN=

# ===== Database =====
MONGO_URI=

# ===== Auth & Security =====
JWT_SECRET=
JWT_EXPIRES_IN=
REFRESH_TOKEN_SECRET=
COOKIE_SECRET=
OTP_EXP_MINUTES=
RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX=

# ===== OAuth/Social =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_PLACE_API=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=

# ===== Email (SMTP) =====
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ===== SMS =====
SMS_PROVIDER=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
AT_API_KEY=
AT_USERNAME=

# ===== Payments =====
PAYSTACK_PUBLIC_KEY=
PAYSTACK_SECRET_KEY=
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORT_CODE=
MPESA_PASSKEY=
MPESA_ENV=
CALLBACK_URL=

# ===== Storage/CDN =====
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ===== External Services =====
REDIS_URL=

# ===== Notifications/Monitoring =====
SENTRY_DSN=
GA_MEASUREMENT_ID=
MIXPANEL_TOKEN=

# ===== Location/Maps =====
LOCATIONIQ_TOKEN=

# ===== Currency & Business Config =====
DEFAULT_CURRENCY=
ENABLE_SCHEDULING=
SCHEDULING_FEE=
DELIVERY_FEE_PER_KM=
ALLOW_PREORDERS=
MAX_UPLOAD_SIZE=

# ===== Firebase =====
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_DATABASE_URL=
```

---

## Commands

```bash
npm run dev          # Start dev server with nodemon + ts-node hot-reload
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled dist/index.js
npm run seed:roles   # Seed default roles into MongoDB
```

No test runner is configured yet.
