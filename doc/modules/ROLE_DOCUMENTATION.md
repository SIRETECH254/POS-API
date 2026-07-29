# 🗂️ POS API - Role Management Documentation

## 📋 Table of Contents
- [Role Management Overview](#role-management-overview)
- [Role Model](#-role-model)
- [Role Controller](#-role-controller)
- [Role Routes](#-role-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Role Management Overview

Role Management covers the six fixed roles in the POS system. Roles are seeded via `npm run seed:roles` and are referenced by the User model to drive RBAC across every module. All users authenticate via JWT and are assigned one role. Role-based access control governs which endpoints each user can reach.

Available roles: `admin`, `manager`, `cashier`, `bartender`, `store_keeper`, `accountant`.

---

## 👤 Role Model

### Schema Definition
```typescript
interface IRole extends Document {
  name: UserRole;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Role.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IRole, UserRole } from "../type";

const ROLE_VALUES: UserRole[] = [
  "bartender", "cashier", "store_keeper", "manager", "admin", "accountant",
];

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ROLE_VALUES,
      trim: true,
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

const Role = mongoose.model<IRole>("Role", roleSchema);
export default Role;
```

### Validation Rules
```typescript
name:        { required: true, unique: true, enum: UserRole values }
description: { required: true }
isActive:    { default: true }
```

---

## 🎮 Role Controller

**File:** `src/controllers/roleController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Role from "../models/Role";
```

### Functions Overview

#### `getAllRoles()`
**Purpose:** List all roles with filtering and pagination
**Access:** Admin, Manager
**Validation:** None required
**Process:** Filter by search/status, paginate, return roles
**Response:** Role list and pagination

**Controller Implementation:**
```typescript
export const getAllRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }];
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

    // Fetch roles and total count
    const roles = await Role.find(query)
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Role.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        roles,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalRoles: total,
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

#### `getRoleById()`
**Purpose:** Fetch a single role record
**Access:** Admin, Manager
**Validation:** Role must exist
**Process:** Find role by ID and return
**Response:** Role details

**Controller Implementation:**
```typescript
export const getRoleById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find role by ID
    const role = await Role.findById(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Return role
    res.status(200).json({
      success: true,
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createRole()`
**Purpose:** Create a new role record
**Access:** Admin
**Validation:** Name and description required; name must be unique and a valid UserRole value
**Process:** Check for duplicate, create and save
**Response:** Created role

**Controller Implementation:**
```typescript
export const createRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    // Guard — role name must not already exist
    const existing = await Role.findOne({ name });
    if (existing) {
      return next(errorHandler(409, "Role with this name already exists"));
    }

    // Create role
    const role = await Role.create({ name, description });

    // Return created role
    res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateRole()`
**Purpose:** Update a role by ID
**Access:** Admin
**Validation:** Role must exist
**Process:** Apply description/isActive updates and save
**Response:** Updated role

**Controller Implementation:**
```typescript
export const updateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { description, isActive } = req.body;

    // Find role
    const role = await Role.findById(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Apply updates
    if (description !== undefined) {
      role.description = description;
    }
    if (isActive !== undefined) {
      role.isActive = isActive;
    }

    // Save and return
    await role.save();
    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: { role },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `deleteRole()`
**Purpose:** Delete a role by ID
**Access:** Admin
**Validation:** Role must exist
**Process:** Delete record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete role
    const role = await Role.findByIdAndDelete(req.params.roleId);

    // Guard — role must exist
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Role deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Role Routes

### Base Path: `/api/roles`

```typescript
GET    /                // Get all roles (admin, manager)
GET    /:roleId         // Get single role (admin, manager)
POST   /                // Create role (admin)
PUT    /:roleId         // Update role (admin)
DELETE /:roleId         // Delete role (admin)
```

### Router Implementation

**File: `src/routes/roleRoutes.ts`**

```typescript
import express from "express";
import {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/roleController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Get all roles
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *         description: Results per page (default 10)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name or description
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllRoles);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   get:
 *     summary: Get role by ID
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     responses:
 *       200:
 *         description: Role retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Role not found
 */
router.get("/:roleId", authenticateToken, authorizeRoles(["admin", "manager"]), getRoleById);

/**
 * @swagger
 * /api/roles:
 *   post:
 *     summary: Create a new role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, description]
 *             properties:
 *               name:
 *                 type: string
 *                 enum: [bartender, cashier, store_keeper, manager, admin, accountant]
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Role created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Role already exists
 */
router.post("/", authenticateToken, authorizeRoles(["admin"]), createRole);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   put:
 *     summary: Update role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Role not found
 */
router.put("/:roleId", authenticateToken, authorizeRoles(["admin"]), updateRole);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   delete:
 *     summary: Delete role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     responses:
 *       200:
 *         description: Role deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Role not found
 */
router.delete("/:roleId", authenticateToken, authorizeRoles(["admin"]), deleteRole);

export default router;
```

### Route Details

#### `GET /api/roles`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<term>`, `status=active|inactive`
**Response:**
```json
{
  "success": true,
  "data": {
    "roles": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "admin",
        "description": "Full system access across all branches",
        "isActive": true,
        "createdAt": "2026-07-27T08:00:00.000Z",
        "updatedAt": "2026-07-27T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalRoles": 6,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/roles/:roleId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "admin",
      "description": "Full system access across all branches",
      "isActive": true,
      "createdAt": "2026-07-27T08:00:00.000Z",
      "updatedAt": "2026-07-27T08:00:00.000Z"
    }
  }
}
```

#### `POST /api/roles`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "name": "bartender",
  "description": "Opens and manages sale tabs at the bar"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Role created successfully",
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "bartender",
      "description": "Opens and manages sale tabs at the bar",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

#### `PUT /api/roles/:roleId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "description": "Opens and manages sale tabs at the bar counter",
  "isActive": false
}
```
**Response:**
```json
{
  "success": true,
  "message": "Role updated successfully",
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "bartender",
      "description": "Opens and manages sale tabs at the bar counter",
      "isActive": false,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:30:00.000Z"
    }
  }
}
```

#### `DELETE /api/roles/:roleId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Role deleted"
}
```

---

## 🔐 Middleware

### `authenticateToken`
**Purpose:** Verify JWT and load the user onto `req.user`. Returns 401 if token is missing, invalid, or user is inactive.
**Usage:**
```typescript
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllRoles);
```

### `authorizeRoles(allowedRoles)`
**Purpose:** Check that `req.user.role` matches at least one of the `allowedRoles`. Returns 403 if not matched.
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["admin"]), createRole);
```

---

## 📝 API Examples

### Get All Roles
```bash
curl -X GET "http://localhost:3500/api/roles?page=1&limit=10&status=active" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "data": {
    "roles": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "admin",
        "description": "Full system access across all branches",
        "isActive": true,
        "createdAt": "2026-07-27T08:00:00.000Z",
        "updatedAt": "2026-07-27T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalRoles": 6,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Get Role by ID
```bash
curl -X GET http://localhost:3500/api/roles/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "admin",
      "description": "Full system access across all branches",
      "isActive": true,
      "createdAt": "2026-07-27T08:00:00.000Z",
      "updatedAt": "2026-07-27T08:00:00.000Z"
    }
  }
}
```

### Create Role
```bash
curl -X POST http://localhost:3500/api/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "name": "bartender",
    "description": "Opens and manages sale tabs at the bar"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Role created successfully",
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "bartender",
      "description": "Opens and manages sale tabs at the bar",
      "isActive": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### Update Role
```bash
curl -X PUT http://localhost:3500/api/roles/64f1a2b3c4d5e6f7a8b9c0d2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "description": "Opens and manages sale tabs at the bar counter",
    "isActive": false
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Role updated successfully",
  "data": {
    "role": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "bartender",
      "description": "Opens and manages sale tabs at the bar counter",
      "isActive": false,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:30:00.000Z"
    }
  }
}
```

### Delete Role
```bash
curl -X DELETE http://localhost:3500/api/roles/64f1a2b3c4d5e6f7a8b9c0d2 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "message": "Role deleted"
}
```

---

## 🛡️ Security Features

- **RBAC:** Read access (`GET`) requires `admin` or `manager`. Write/delete requires `admin` only.
- **Least Privilege:** Destructive actions (delete) and create are limited to `admin`.
- **Duplicate Guard:** `createRole` checks for an existing role with the same name before inserting.

---

## 🚨 Error Handling

Common responses:
```json
{
  "success": false,
  "message": "..."
}
```

| Status | Scenario |
|--------|----------|
| 400 | Missing name or description |
| 401 | Missing or invalid JWT |
| 403 | Authenticated but wrong role |
| 404 | Role not found |
| 409 | Role name already exists |

---

## 📊 Database Indexes

```typescript
roleSchema.index({ name: 1 });
roleSchema.index({ isActive: 1 });
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
