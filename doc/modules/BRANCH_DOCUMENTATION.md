# 🗂️ POS API - Branch Management Documentation

## 📋 Table of Contents
- [Branch Management Overview](#branch-management-overview)
- [Branch Model](#-branch-model)
- [Branch Controller](#-branch-controller)
- [Branch Routes](#-branch-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)
- [Seed Script](#-seed-script)

---

## Branch Management Overview

Branch Management covers the physical locations (bars, clubs, restaurants) that operate under the POS system. Every user is assigned to a branch; every sale tab, shift, and inventory movement is scoped to a branch. One branch is designated `isMain: true` — this is the headquarters record and cannot be deleted. The branch `address` field references an Address document which in turn references a Location, providing full geographic data.

Run `npm run seed:branch` to create the default "Main Branch" record.

---

## 👤 Branch Model

### Schema Definition
```typescript
interface IBranch extends Document {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: Types.ObjectId | IAddress;
  isMain: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Branch.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IBranch } from "../type";

const branchSchema = new Schema<IBranch>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    address: {
      type: Schema.Types.ObjectId,
      ref: "Address",
    },
    isMain: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Branch = mongoose.model<IBranch>("Branch", branchSchema);
export default Branch;
```

### Validation Rules
```typescript
name:    { required: true, unique: true, trim: true }
address: { ref: "Address" }
isMain:  { default: false }
isActive:{ default: true }
```

---

## 🎮 Branch Controller

**File:** `src/controllers/branchController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Branch from "../models/Branch";
import Address from "../models/Address";
```

### Functions Overview

#### `getAllBranches()`
**Purpose:** List all branches with filtering and pagination  
**Access:** Admin, Manager  
**Validation:** None required  
**Process:** Filter by search/status, sort main branch first, paginate, return results.  
**Response:** Branch list and pagination.

**Controller Implementation:**
```typescript
export const getAllBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
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

    // Fetch branches and total count
    const branches = await Branch.find(query)
      .populate({ path: "address", populate: { path: "location" } })
      .sort({ isMain: -1, createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Branch.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        branches,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalBranches: total,
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

#### `getBranchById()`
**Purpose:** Fetch a single branch record  
**Access:** Admin, Manager  
**Validation:** Branch must exist  
**Process:** Find branch by ID, populate address with location, return.  
**Response:** Branch details.

**Controller Implementation:**
```typescript
export const getBranchById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find branch by ID
    const branch = await Branch.findById(req.params.branchId)
      .populate({ path: "address", populate: { path: "location" } });

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Return branch
    res.status(200).json({
      success: true,
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createBranch()`
**Purpose:** Create a new branch record  
**Access:** Admin  
**Validation:** `name` is required; `name` must be unique; `addressId` must exist if provided  
**Process:** Create and save branch.  
**Response:** Created branch.

**Controller Implementation:**
```typescript
export const createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, code, phone, email, addressId, isMain, isActive } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Branch name is required"));
    }

    // Guard — branch name must be unique
    const existing = await Branch.findOne({ name });
    if (existing) {
      return next(errorHandler(409, "Branch with this name already exists"));
    }

    // Verify address exists if provided
    if (addressId) {
      const addressDoc = await Address.findById(addressId);
      if (!addressDoc) {
        return next(errorHandler(404, "Address not found"));
      }
    }

    // Create branch
    const branch = await Branch.create({
      name,
      code,
      phone,
      email,
      address: addressId,
      isMain: isMain ?? false,
      isActive: isActive ?? true,
    });

    // Return created branch
    res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateBranch()`
**Purpose:** Update a branch by ID  
**Access:** Admin  
**Validation:** Branch must exist; name must remain unique if changed; address must exist if `addressId` provided  
**Process:** Apply field updates and save.  
**Response:** Updated branch with populated address.

**Controller Implementation:**
```typescript
export const updateBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, code, phone, email, addressId, isMain, isActive } = req.body;

    // Find branch
    const branch = await Branch.findById(req.params.branchId);

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — if name is changing, check uniqueness
    if (name !== undefined && name !== branch.name) {
      const existing = await Branch.findOne({ name });
      if (existing) {
        return next(errorHandler(409, "Branch with this name already exists"));
      }
    }

    // Verify address exists if provided
    if (addressId) {
      const addressDoc = await Address.findById(addressId);
      if (!addressDoc) {
        return next(errorHandler(404, "Address not found"));
      }
    }

    // Apply updates
    if (name !== undefined) {
      branch.name = name;
    }
    if (code !== undefined) {
      branch.code = code;
    }
    if (phone !== undefined) {
      branch.phone = phone;
    }
    if (email !== undefined) {
      branch.email = email;
    }
    if (addressId !== undefined) {
      branch.address = addressId;
    }
    if (isMain !== undefined) {
      branch.isMain = isMain;
    }
    if (isActive !== undefined) {
      branch.isActive = isActive;
    }

    // Save and return
    await branch.save();
    await branch.populate({ path: "address", populate: { path: "location" } });
    res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      data: { branch },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `deleteBranch()`
**Purpose:** Delete a branch by ID  
**Access:** Admin  
**Validation:** Branch must exist; main branch cannot be deleted  
**Process:** Guard `isMain` then delete record.  
**Response:** Success message.

**Controller Implementation:**
```typescript
export const deleteBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find branch
    const branch = await Branch.findById(req.params.branchId);

    // Guard — branch must exist
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Guard — main branch cannot be deleted
    if (branch.isMain) {
      return next(errorHandler(400, "Main branch cannot be deleted"));
    }

    // Delete branch
    await branch.deleteOne();

    // Return success
    res.status(200).json({
      success: true,
      message: "Branch deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Branch Routes

### Base Path: `/api/branches`

```typescript
GET    /             // Get all branches (admin, manager)
GET    /:branchId    // Get branch by ID (admin, manager)
POST   /             // Create branch (admin)
PUT    /:branchId    // Update branch (admin)
DELETE /:branchId    // Delete branch (admin)
```

### Router Implementation

**File: `src/routes/branchRoutes.ts`**

```typescript
import express from "express";
import {
  getAllBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../controllers/branchController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllBranches);
router.get("/:branchId", authenticateToken, authorizeRoles(["admin", "manager"]), getBranchById);
router.post("/", authenticateToken, authorizeRoles(["admin"]), createBranch);
router.put("/:branchId", authenticateToken, authorizeRoles(["admin"]), updateBranch);
router.delete("/:branchId", authenticateToken, authorizeRoles(["admin"]), deleteBranch);

export default router;
```

### Route Details

#### `GET /api/branches`
**Headers:** `Authorization: Bearer <token>`  
**Query:** `page=1`, `limit=10`, `search=Main`, `status=active|inactive`  
**Response:**
```json
{
  "success": true,
  "data": {
    "branches": [
      {
        "_id": "6638b2c3d4e5f6g7h8i9j0k1",
        "name": "Main Branch",
        "isMain": true,
        "isActive": true,
        "address": {
          "_id": "7749c3d4e5f6g7h8i9j0k1l2",
          "name": "Headquarters",
          "location": {
            "_id": "8850d4e5f6g7h8i9j0k1l2m3",
            "name": "Nairobi",
            "formattedAddress": "Nairobi, Kenya"
          }
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalBranches": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/branches/:branchId`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "data": {
    "branch": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "name": "Main Branch",
      "code": "MBR",
      "phone": "+254700000000",
      "email": "main@pos.com",
      "isMain": true,
      "isActive": true,
      "address": { "_id": "7749c3d4e5f6g7h8i9j0k1l2", "name": "Headquarters" }
    }
  }
}
```

#### `POST /api/branches`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`  
**Body:**
```json
{
  "name": "Westlands Branch",
  "code": "WBR",
  "phone": "+254711111111",
  "email": "westlands@pos.com",
  "addressId": "7749c3d4e5f6g7h8i9j0k1l2",
  "isActive": true
}
```
**Response:**
```json
{
  "success": true,
  "message": "Branch created successfully",
  "data": {
    "branch": {
      "_id": "9961e5f6g7h8i9j0k1l2m3n4",
      "name": "Westlands Branch",
      "code": "WBR",
      "isMain": false,
      "isActive": true
    }
  }
}
```

#### `PUT /api/branches/:branchId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`  
**Body:**
```json
{
  "phone": "+254722222222",
  "isActive": false
}
```
**Response:**
```json
{
  "success": true,
  "message": "Branch updated successfully",
  "data": {
    "branch": {
      "_id": "9961e5f6g7h8i9j0k1l2m3n4",
      "name": "Westlands Branch",
      "phone": "+254722222222",
      "isActive": false
    }
  }
}
```

#### `DELETE /api/branches/:branchId`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "message": "Branch deleted"
}
```

---

## 🔐 Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user  
**Usage:** Applied to all branch routes.

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles  
**Usage:**
- Read operations: `authorizeRoles(["admin", "manager"])`
- Write operations: `authorizeRoles(["admin"])`

---

## 📝 API Examples

### Get All Branches
```bash
curl -X GET "http://localhost:3500/api/branches?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```

### Get Branch by ID
```bash
curl -X GET http://localhost:3500/api/branches/6638b2c3d4e5f6g7h8i9j0k1 \
  -H "Authorization: Bearer <token>"
```

### Create Branch
```bash
curl -X POST http://localhost:3500/api/branches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Westlands Branch",
    "code": "WBR",
    "phone": "+254711111111",
    "addressId": "7749c3d4e5f6g7h8i9j0k1l2"
  }'
```

### Update Branch
```bash
curl -X PUT http://localhost:3500/api/branches/9961e5f6g7h8i9j0k1l2m3n4 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "phone": "+254722222222",
    "isActive": false
  }'
```

### Delete Branch
```bash
curl -X DELETE http://localhost:3500/api/branches/9961e5f6g7h8i9j0k1l2m3n4 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require authentication. Write operations are restricted to `admin`.
- **Least Privilege:** Read access extended to `manager` for operational visibility.
- **Main Branch Protection:** The `isMain` branch cannot be deleted — enforced at the controller level before `deleteOne()` executes.

---

## 🚨 Error Handling

Common responses:
```json
{ "success": false, "message": "Branch name is required" }
{ "success": false, "message": "Branch with this name already exists" }
{ "success": false, "message": "Address not found" }
{ "success": false, "message": "Branch not found" }
{ "success": false, "message": "Main branch cannot be deleted" }
```

- `400 Bad Request`: Missing required fields or attempting to delete main branch.
- `404 Not Found`: Branch or Address not found.
- `409 Conflict`: Branch name already exists.
- `500 Internal Server Error`: Unexpected server-side error.

---

## 📊 Database Indexes

```typescript
branchSchema.index({ name: 1 });
branchSchema.index({ isActive: 1 });
branchSchema.index({ isMain: 1 });
branchSchema.index({ address: 1 });
```

---

## 🌱 Seed Script

**File: `src/scripts/seedBranch.ts`**

Creates the "Main Branch" record using upsert — safe to run multiple times.

```bash
npm run seed:branch
```

```typescript
await Branch.updateOne(
  { name: "Main Branch" },
  {
    $setOnInsert: {
      name: "Main Branch",
      isMain: true,
      isActive: true,
    },
  },
  { upsert: true }
);
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
