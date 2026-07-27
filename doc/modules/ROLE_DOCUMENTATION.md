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

Role Management covers the six fixed roles in the POS system. Roles are seeded via `npm run seed:roles` and are referenced by the User model to drive RBAC across every module. All users authenticate via JWT and are assigned one or more roles.

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
**Validation:** None
**Process:** Filter by search/status, paginate, return roles
**Response:** Role list and pagination

#### `getRoleById()`
**Purpose:** Fetch a single role by ID
**Access:** Admin, Manager
**Validation:** Role must exist
**Process:** Find role by ID and return
**Response:** Role details

#### `createRole()`
**Purpose:** Create a new role
**Access:** Admin
**Validation:** name and description required; name must be unique and a valid UserRole value
**Process:** Check for duplicate, create and save
**Response:** Created role

#### `updateRole()`
**Purpose:** Update a role by ID
**Access:** Admin
**Validation:** Role must exist
**Process:** Apply description/isActive updates and save
**Response:** Updated role

#### `deleteRole()`
**Purpose:** Delete a role by ID
**Access:** Admin
**Validation:** Role must exist
**Process:** Delete record
**Response:** Success message

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
import { getAllRoles, getRoleById, createRole, updateRole, deleteRole } from "../controllers/roleController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllRoles);
router.get("/:roleId", authenticateToken, authorizeRoles(["admin", "manager"]), getRoleById);
router.post("/", authenticateToken, authorizeRoles(["admin"]), createRole);
router.put("/:roleId", authenticateToken, authorizeRoles(["admin"]), updateRole);
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
      { "_id": "...", "name": "admin", "description": "Full system access across all branches", "isActive": true }
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
    "role": { "_id": "...", "name": "admin", "description": "Full system access across all branches", "isActive": true }
  }
}
```

#### `POST /api/roles`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{ "name": "admin", "description": "Full system access across all branches" }
```
**Response:**
```json
{
  "success": true,
  "message": "Role created successfully",
  "data": { "role": { "_id": "...", "name": "admin", "description": "..." } }
}
```

#### `PUT /api/roles/:roleId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{ "description": "Updated description", "isActive": false }
```
**Response:**
```json
{
  "success": true,
  "message": "Role updated successfully",
  "data": { "role": { "_id": "...", "name": "admin", "isActive": false } }
}
```

#### `DELETE /api/roles/:roleId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{ "success": true, "message": "Role deleted" }
```

---

## 🔐 Middleware

### `authenticateToken`
Verifies JWT and loads the user onto `req.user`. Returns 401 if token is missing, invalid, or user is inactive.

### `authorizeRoles(allowedRoles)`
Checks that `req.user.roles` contains at least one of the `allowedRoles`. Returns 403 if not matched.

---

## 📝 API Examples

### Get All Roles
```bash
curl -X GET "http://localhost:3500/api/roles?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```

### Get Role by ID
```bash
curl -X GET http://localhost:3500/api/roles/<roleId> \
  -H "Authorization: Bearer <token>"
```

### Create Role
```bash
curl -X POST http://localhost:3500/api/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "name": "admin", "description": "Full system access across all branches" }'
```

### Update Role
```bash
curl -X PUT http://localhost:3500/api/roles/<roleId> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "description": "Updated description", "isActive": false }'
```

### Delete Role
```bash
curl -X DELETE http://localhost:3500/api/roles/<roleId> \
  -H "Authorization: Bearer <token>"
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
{ "success": false, "message": "..." }
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
