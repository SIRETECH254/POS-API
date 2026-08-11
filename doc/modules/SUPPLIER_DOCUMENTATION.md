# 🗂️ POS API - Supplier Management Documentation

## 📋 Table of Contents
- [Supplier Management Overview](#supplier-management-overview)
- [Supplier Model](#-supplier-model)
- [Supplier Controller](#-supplier-controller)
- [Supplier Routes](#-supplier-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Supplier Management Overview

Supplier Management handles all supplier records used across the Club POS system. Suppliers are linked to SKUs they supply and to the branches they deliver to. Each supplier tracks an `outstandingBalance` derived from unpaid Purchase records. The `address` field references a saved `Address` document (which in turn references a `Location`), allowing full geographic data to be attached to a supplier without duplicating it.

Only managers and admins can create, update, and list suppliers. Deletion is restricted to admins. The `getSupplierHistory` endpoint returns a supplier's purchase invoice history and outstanding balance — it is fully wired up once the Purchase module is implemented.

---

## 👤 Supplier Model

### Schema Definition
```typescript
interface ISupplier extends Document {
  companyName: string;
  contactPerson: string;
  phone: string;
  email?: string;
  address?: Types.ObjectId | IAddress;
  skusSupplied: Types.ObjectId[];
  branches: Types.ObjectId[];
  outstandingBalance: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Supplier.ts`**

```typescript
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

supplierSchema.index({ companyName: 1 });
supplierSchema.index({ phone: 1 });
supplierSchema.index({ email: 1 }, { sparse: true });
supplierSchema.index({ isActive: 1 });
supplierSchema.index({ branches: 1 });

const Supplier = mongoose.model<ISupplier>("Supplier", supplierSchema);
export default Supplier;
```

### Validation Rules
```typescript
companyName:        { required: true, unique: true, trim: true }
contactPerson:      { required: true, trim: true }
phone:              { required: true, unique: true, trim: true }
email:              { optional, unique sparse, lowercase, trim: true }
address:            { optional, ObjectId ref: 'Address' }
skusSupplied:       { default: [], ObjectId[] ref: 'Sku' }
branches:           { default: [], ObjectId[] ref: 'Branch' }
outstandingBalance: { default: 0 }
isActive:           { default: true }
```

---

## 🎮 Supplier Controller

**File:** `src/controllers/supplierController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Supplier from "../models/Supplier";
import Purchase from "../models/Purchase";
```

### Functions Overview

#### `getAllSuppliers()`
**Purpose:** List all suppliers with filtering and pagination
**Access:** Manager, Admin
**Validation:** None required
**Process:** Filter by search/status/branch, populate address and branches, paginate, return results
**Response:** Supplier list and pagination

**Controller Implementation:**
```typescript
export const getAllSuppliers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status, branch } = req.query;

    // Build filter query
    const query: any = {};
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPerson: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "active") {
      query.isActive = true;
    }
    if (status === "inactive") {
      query.isActive = false;
    }
    if (branch) {
      query.branches = branch;
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch suppliers and total count
    const suppliers = await Supplier.find(query)
      .populate("address")
      .populate("branches", "name code")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Supplier.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        suppliers,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalSuppliers: total,
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

#### `getSupplierById()`
**Purpose:** Fetch a single supplier record by ID
**Access:** Manager, Admin
**Validation:** Supplier must exist
**Process:** Find supplier by ID with populated address, branches, and SKUs; return
**Response:** Supplier details

**Controller Implementation:**
```typescript
export const getSupplierById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find supplier by ID
    const supplier = await Supplier.findById(req.params.supplierId)
      .populate("address")
      .populate("branches", "name code")
      .populate("skusSupplied", "skuCode barcode unit sellingPrice");

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Return supplier
    res.status(200).json({
      success: true,
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `createSupplier()`
**Purpose:** Create a new supplier record
**Access:** Manager, Admin
**Validation:** Required fields present; companyName, phone, and email must be unique
**Process:** Run uniqueness checks, create and save supplier
**Response:** Created supplier

**Controller Implementation:**
```typescript
export const createSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { companyName, contactPerson, phone, email, address, branches } = req.body;

    // Guard — companyName required
    if (!companyName) {
      return next(errorHandler(400, "Company name is required"));
    }

    // Guard — contactPerson required
    if (!contactPerson) {
      return next(errorHandler(400, "Contact person is required"));
    }

    // Guard — phone required
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }

    // Guard — companyName must be unique
    const existingCompany = await Supplier.findOne({ companyName: { $regex: `^${companyName}$`, $options: "i" } });
    if (existingCompany) {
      return next(errorHandler(409, "Supplier with this company name already exists"));
    }

    // Guard — phone must be unique
    const existingPhone = await Supplier.findOne({ phone });
    if (existingPhone) {
      return next(errorHandler(409, "Supplier with this phone number already exists"));
    }

    // Guard — email must be unique if provided
    if (email) {
      const existingEmail = await Supplier.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return next(errorHandler(409, "Supplier with this email already exists"));
      }
    }

    // Create supplier
    const supplier = await Supplier.create({
      companyName,
      contactPerson,
      phone,
      email,
      address,
      branches: branches || [],
    });

    // Return created supplier
    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateSupplier()`
**Purpose:** Update a supplier by ID
**Access:** Manager, Admin
**Validation:** Supplier must exist; updated companyName, phone, and email must not conflict with another supplier
**Process:** Run conflict checks per changed field, apply updates, save
**Response:** Updated supplier

**Controller Implementation:**
```typescript
export const updateSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { companyName, contactPerson, phone, email, address, branches, isActive } = req.body;

    // Find supplier
    const supplier = await Supplier.findById(req.params.supplierId);

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Guard — updated companyName must not belong to another supplier
    if (companyName && companyName !== supplier.companyName) {
      const conflict = await Supplier.findOne({
        companyName: { $regex: `^${companyName}$`, $options: "i" },
        _id: { $ne: supplier._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this company name already exists"));
      }
      supplier.companyName = companyName;
    }

    // Guard — updated phone must not belong to another supplier
    if (phone && phone !== supplier.phone) {
      const conflict = await Supplier.findOne({ phone, _id: { $ne: supplier._id } });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this phone number already exists"));
      }
      supplier.phone = phone;
    }

    // Guard — updated email must not belong to another supplier
    if (email && email.toLowerCase() !== supplier.email) {
      const conflict = await Supplier.findOne({
        email: email.toLowerCase(),
        _id: { $ne: supplier._id },
      });
      if (conflict) {
        return next(errorHandler(409, "Supplier with this email already exists"));
      }
      supplier.email = email;
    }

    // Apply remaining updates
    if (contactPerson !== undefined) {
      supplier.contactPerson = contactPerson;
    }
    if (address !== undefined) {
      supplier.address = address;
    }
    if (branches !== undefined) {
      supplier.branches = branches;
    }
    if (isActive !== undefined) {
      supplier.isActive = isActive;
    }

    // Save and return
    await supplier.save();
    res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data: { supplier },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `deleteSupplier()`
**Purpose:** Delete a supplier by ID
**Access:** Admin
**Validation:** Supplier must exist
**Process:** Find and delete record
**Response:** Success message

**Controller Implementation:**
```typescript
export const deleteSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete supplier
    const supplier = await Supplier.findByIdAndDelete(req.params.supplierId);

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Supplier deleted",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getSupplierHistory()`
**Purpose:** Fetch purchase history and outstanding balance for a supplier
**Access:** Manager, Admin
**Validation:** Supplier must exist
**Process:** Find supplier, query purchase records (paginated), return summary
**Response:** Supplier details, outstanding balance, and purchase history

> **Note:** `outstandingBalance` is still a raw stored field on `Supplier` — it is not recalculated here from the purchase history, since supplier payment recording is deferred to a future Invoice module (see `doc/modules/PURCHASE_DOCUMENTATION.md`). The `purchases` array itself is real, sourced from the `Purchase` collection.

**Controller Implementation:**
```typescript
export const getSupplierHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10 } = req.query;

    // Find supplier by ID
    const supplier = await Supplier.findById(req.params.supplierId)
      .populate("address")
      .populate("branches", "name code");

    // Guard — supplier must exist
    if (!supplier) {
      return next(errorHandler(404, "Supplier not found"));
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch purchase history for this supplier
    const purchases = await Purchase.find({ supplier: supplier._id })
      .populate("branch", "name code")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Purchase.countDocuments({ supplier: supplier._id });
    const totalPages = Math.ceil(total / options.limit);

    // Return supplier history
    res.status(200).json({
      success: true,
      data: {
        supplier,
        outstandingBalance: supplier.outstandingBalance,
        purchases,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalPurchases: total,
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

## 🛣️ Supplier Routes

### Base Path: `/api/suppliers`

```typescript
GET    /                        // Get all suppliers (manager, admin)
GET    /:supplierId             // Get single supplier (manager, admin)
POST   /                        // Create supplier (manager, admin)
PUT    /:supplierId             // Update supplier (manager, admin)
DELETE /:supplierId             // Delete supplier (admin)
GET    /:supplierId/history     // Supplier purchase history (manager, admin)
```

### Router Implementation

**File: `src/routes/supplierRoutes.ts`**

```typescript
import express from "express";
import {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierHistory,
} from "../controllers/supplierController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllSuppliers);
router.get("/:supplierId", authenticateToken, authorizeRoles(["manager", "admin"]), getSupplierById);
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createSupplier);
router.put("/:supplierId", authenticateToken, authorizeRoles(["manager", "admin"]), updateSupplier);
router.delete("/:supplierId", authenticateToken, authorizeRoles(["admin"]), deleteSupplier);
router.get("/:supplierId/history", authenticateToken, authorizeRoles(["manager", "admin"]), getSupplierHistory);

export default router;
```

### Route Details

#### `GET /api/suppliers`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=<text>`, `status=active|inactive`, `branch=<branchId>`
**Response:**
```json
{
  "success": true,
  "data": {
    "suppliers": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "companyName": "Kenya Breweries Ltd",
        "contactPerson": "James Mwangi",
        "phone": "+254700000001",
        "email": "sales@kbl.co.ke",
        "address": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
          "name": "Nairobi Office",
          "isDefault": true
        },
        "branches": [
          {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
            "name": "Main Branch",
            "code": "MAIN"
          }
        ],
        "skusSupplied": [],
        "outstandingBalance": 0,
        "isActive": true,
        "createdAt": "2026-07-29T10:00:00.000Z",
        "updatedAt": "2026-07-29T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalSuppliers": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/suppliers/:supplierId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "supplier": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "companyName": "Kenya Breweries Ltd",
      "contactPerson": "James Mwangi",
      "phone": "+254700000001",
      "email": "sales@kbl.co.ke",
      "address": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "Nairobi Office",
        "location": {
          "name": "Nairobi",
          "formattedAddress": "Nairobi, Kenya"
        }
      },
      "branches": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        }
      ],
      "skusSupplied": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
          "skuCode": "TUSK-BTL",
          "barcode": "6001007019206",
          "unit": "bottle",
          "sellingPrice": 250
        }
      ],
      "outstandingBalance": 15000,
      "isActive": true,
      "createdAt": "2026-07-29T10:00:00.000Z",
      "updatedAt": "2026-07-29T10:00:00.000Z"
    }
  }
}
```

#### `POST /api/suppliers`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "companyName": "Kenya Breweries Ltd",
  "contactPerson": "James Mwangi",
  "phone": "+254700000001",
  "email": "sales@kbl.co.ke",
  "address": "64f1a2b3c4d5e6f7a8b9c0d2",
  "branches": [
    "64f1a2b3c4d5e6f7a8b9c0d3"
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Supplier created successfully",
  "data": {
    "supplier": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "companyName": "Kenya Breweries Ltd",
      "contactPerson": "James Mwangi",
      "phone": "+254700000001",
      "email": "sales@kbl.co.ke",
      "address": "64f1a2b3c4d5e6f7a8b9c0d2",
      "branches": [
        "64f1a2b3c4d5e6f7a8b9c0d3"
      ],
      "skusSupplied": [],
      "outstandingBalance": 0,
      "isActive": true,
      "createdAt": "2026-07-29T10:00:00.000Z",
      "updatedAt": "2026-07-29T10:00:00.000Z"
    }
  }
}
```

#### `PUT /api/suppliers/:supplierId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "contactPerson": "Alice Kamau",
  "email": "alice@kbl.co.ke",
  "isActive": true
}
```
**Response:**
```json
{
  "success": true,
  "message": "Supplier updated successfully",
  "data": {
    "supplier": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "companyName": "Kenya Breweries Ltd",
      "contactPerson": "Alice Kamau",
      "phone": "+254700000001",
      "email": "alice@kbl.co.ke",
      "outstandingBalance": 0,
      "isActive": true,
      "createdAt": "2026-07-29T10:00:00.000Z",
      "updatedAt": "2026-07-29T11:30:00.000Z"
    }
  }
}
```

#### `DELETE /api/suppliers/:supplierId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Supplier deleted"
}
```

#### `GET /api/suppliers/:supplierId/history`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`
**Response:**
```json
{
  "success": true,
  "data": {
    "supplier": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "companyName": "Kenya Breweries Ltd",
      "contactPerson": "James Mwangi",
      "phone": "+254700000001",
      "outstandingBalance": 15000,
      "isActive": true
    },
    "outstandingBalance": 15000,
    "purchases": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0f1",
        "purchaseNumber": "MAIN-PO-2026-0001",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "totalAmount": 4800,
        "amountPaid": 0,
        "paymentStatus": "unpaid",
        "status": "received",
        "createdAt": "2026-08-11T09:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalPurchases": 1,
      "hasNextPage": false,
      "hasPrevPage": false
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
router.get("/", authenticateToken, getAllSuppliers);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllSuppliers);
```

---

## 📝 API Examples

### Get All Suppliers
```bash
curl -X GET "http://localhost:3500/api/suppliers?page=1&limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```

### Get All Suppliers for a Branch
```bash
curl -X GET "http://localhost:3500/api/suppliers?branch=64f1a2b3c4d5e6f7a8b9c0d3" \
  -H "Authorization: Bearer <token>"
```

### Get Supplier by ID
```bash
curl -X GET http://localhost:3500/api/suppliers/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Authorization: Bearer <token>"
```

### Create Supplier
```bash
curl -X POST http://localhost:3500/api/suppliers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "companyName": "Kenya Breweries Ltd",
    "contactPerson": "James Mwangi",
    "phone": "+254700000001",
    "email": "sales@kbl.co.ke",
    "address": "64f1a2b3c4d5e6f7a8b9c0d2",
    "branches": ["64f1a2b3c4d5e6f7a8b9c0d3"]
  }'
```

### Update Supplier
```bash
curl -X PUT http://localhost:3500/api/suppliers/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "contactPerson": "Alice Kamau",
    "isActive": false
  }'
```

### Delete Supplier
```bash
curl -X DELETE http://localhost:3500/api/suppliers/64f1a2b3c4d5e6f7a8b9c0d1 \
  -H "Authorization: Bearer <token>"
```

### Get Supplier History
```bash
curl -X GET "http://localhost:3500/api/suppliers/64f1a2b3c4d5e6f7a8b9c0d1/history?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. List, read, create, and update require `manager` or `admin`. Delete is restricted to `admin` only.
- **Uniqueness enforcement:** `companyName`, `phone`, and `email` are checked case-insensitively in the controller before write — not just at the schema level — to return clear 409 responses.
- **Sparse email index:** Email is optional but when present must be globally unique. The sparse index avoids false conflicts on null/undefined values.
- **Self-exclusion on update:** Conflict checks for `companyName`, `phone`, and `email` exclude the current document (`$ne: supplier._id`) so a supplier can be saved with unchanged values.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Missing required field (`companyName`, `contactPerson`, `phone`) |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. bartender attempting delete) |
| `404` | Supplier not found by ID |
| `409` | Duplicate `companyName`, `phone`, or `email` |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Supplier with this company name already exists"
}
```

---

## 📊 Database Indexes

```typescript
supplierSchema.index({ companyName: 1 });          // fast name lookup and uniqueness
supplierSchema.index({ phone: 1 });                // fast phone lookup and uniqueness
supplierSchema.index({ email: 1 }, { sparse: true }); // unique email, skip nulls
supplierSchema.index({ isActive: 1 });             // filter active/inactive suppliers
supplierSchema.index({ branches: 1 });             // filter suppliers by branch
```

---

**Last Updated:** 2026-07-29
**Version:** 1.0.0
**Maintainer:** POS API Development Team
