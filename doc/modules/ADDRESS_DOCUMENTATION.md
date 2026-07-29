# 🗂️ POS API - Address Management Documentation

## 📋 Table of Contents
- [Address Management Overview](#address-management-overview)
- [Address Model](#-address-model)
- [Address Controller](#-address-controller)
- [Address Routes](#-address-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Address Management Overview

Address Management allows users to store and manage their delivery locations. Each address has a custom label (e.g. "Home", "Office") and references a saved Location document which holds the full geographic data (coordinates, formatted address, regions). Users can set one address as their default. The pre-save hook on the model ensures only one default exists per user at any time.

---

## 👤 Address Model

### Schema Definition
```typescript
interface IAddress extends Document {
  userId: Types.ObjectId;
  name: string;
  location: Types.ObjectId | ILocation;
  details?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Address.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IAddress } from "../type";

const addressSchema = new Schema<IAddress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    details: {
      type: String,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Ensure only one default address per user
addressSchema.pre("save", async function (next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await (this.constructor as any).updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

const Address = mongoose.model<IAddress>("Address", addressSchema);
export default Address;
```

### Validation Rules
```typescript
userId:   { required: true, ref: "User" }
name:     { required: true, trim: true }
location: { required: true, ref: "Location" }
```

---

## 🎮 Address Controller

**File:** `src/controllers/addressController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Address from "../models/Address";
import Location from "../models/Location";
```

### Functions Overview

#### `getUserAddresses()`
**Purpose:** List all addresses for the authenticated user with pagination  
**Access:** Authenticated  
**Validation:** None required  
**Process:** Filter by `userId`, populate `location`, sort by `isDefault` then `createdAt`, paginate.  
**Response:** Address list and pagination.

**Controller Implementation:**
```typescript
export const getUserAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search } = req.query;

    // Build filter query scoped to authenticated user
    const query: any = { userId: req.user?._id };
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }];
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch addresses and total count
    const addresses = await Address.find(query)
      .populate("location")
      .sort({ isDefault: -1, createdAt: -1 })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Address.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        addresses,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalAddresses: total,
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

#### `getAddressById()`
**Purpose:** Fetch a single address record for the authenticated user  
**Access:** Authenticated  
**Validation:** Address must exist and belong to the requesting user  
**Process:** Find address by ID scoped to `userId`, populate `location`, return.  
**Response:** Address details.

**Controller Implementation:**
```typescript
export const getAddressById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find address by ID scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    }).populate("location");

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Return address
    res.status(200).json({
      success: true,
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `createAddress()`
**Purpose:** Create a new address for the authenticated user  
**Access:** Authenticated  
**Validation:** `name` and `locationId` are required; location must exist in DB  
**Process:** Verify location exists, create address linked to Location document.  
**Response:** Created address with populated location.

**Controller Implementation:**
```typescript
export const createAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, locationId, details, isDefault } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — locationId required
    if (!locationId) {
      return next(errorHandler(400, "Location ID is required"));
    }

    // Verify location exists
    const locationDoc = await Location.findById(locationId);
    if (!locationDoc) {
      return next(errorHandler(404, "Location not found"));
    }

    // Create address
    const address = new Address({
      userId: req.user?._id,
      name: name.trim(),
      location: locationId,
      details: details ?? undefined,
      isDefault: isDefault ?? false,
    });

    await address.save();

    // Populate location and return
    await address.populate("location");
    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `updateAddress()`
**Purpose:** Update an address belonging to the authenticated user  
**Access:** Authenticated  
**Validation:** Address must exist and belong to the requesting user; location must exist if `locationId` provided  
**Process:** Apply field updates and save.  
**Response:** Updated address with populated location.

**Controller Implementation:**
```typescript
export const updateAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { name, locationId, details, isDefault } = req.body;

    // Find address scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Verify location exists if locationId provided
    if (locationId) {
      const locationDoc = await Location.findById(locationId);
      if (!locationDoc) {
        return next(errorHandler(404, "Location not found"));
      }
      address.location = locationId;
    }

    // Apply updates
    if (name !== undefined) {
      address.name = name.trim();
    }
    if (details !== undefined) {
      address.details = details;
    }
    if (isDefault !== undefined) {
      address.isDefault = isDefault;
    }

    // Save and return
    await address.save();
    await address.populate("location");
    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `deleteAddress()`
**Purpose:** Remove an address belonging to the authenticated user  
**Access:** Authenticated  
**Validation:** Address must exist and belong to the requesting user  
**Process:** Find and delete the address record.  
**Response:** Success message.

**Controller Implementation:**
```typescript
export const deleteAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find and delete address scoped to authenticated user
    const address = await Address.findOneAndDelete({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Return success
    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `setDefaultAddress()`
**Purpose:** Mark an existing address as the user's default delivery address  
**Access:** Authenticated  
**Validation:** Address must exist and belong to the requesting user  
**Process:** Set `isDefault` true — pre-save hook unsets previous default.  
**Response:** Updated address with populated location.

**Controller Implementation:**
```typescript
export const setDefaultAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find address scoped to authenticated user
    const address = await Address.findOne({
      _id: req.params.addressId,
      userId: req.user?._id,
    });

    // Guard — address must exist and belong to user
    if (!address) {
      return next(errorHandler(404, "Address not found"));
    }

    // Set as default and trigger pre-save hook
    address.isDefault = true;
    await address.save();
    await address.populate("location");

    // Return updated address
    res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      data: { address },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Address Routes

### Base Path: `/api/addresses`

```typescript
GET    /                     // Get user addresses (authenticated)
GET    /:addressId           // Get address by ID (authenticated)
POST   /                     // Create address (authenticated)
PUT    /:addressId           // Update address (authenticated)
DELETE /:addressId           // Delete address (authenticated)
PATCH  /:addressId/default   // Set default address (authenticated)
```

### Router Implementation

**File: `src/routes/addressRoutes.ts`**

```typescript
import express from "express";
import {
  getUserAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../controllers/addressController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/addresses:
 *   get:
 *     summary: Get all addresses for the authenticated user
 *     tags: [Addresses]
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
 *         description: Search by address name
 *     responses:
 *       200:
 *         description: Addresses retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticateToken, getUserAddresses);

/**
 * @swagger
 * /api/addresses/{addressId}:
 *   get:
 *     summary: Get a single address by ID
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *         description: Address document ID
 *     responses:
 *       200:
 *         description: Address retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Address not found
 */
router.get("/:addressId", authenticateToken, getAddressById);

/**
 * @swagger
 * /api/addresses:
 *   post:
 *     summary: Create a new address for the authenticated user
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, locationId]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Label for the address (e.g. Home, Office)
 *               locationId:
 *                 type: string
 *                 description: ID of a saved Location document
 *               details:
 *                 type: string
 *                 description: Optional notes (e.g. Near gate B)
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Address created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Location not found
 */
router.post("/", authenticateToken, createAddress);

/**
 * @swagger
 * /api/addresses/{addressId}:
 *   put:
 *     summary: Update an address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
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
 *               locationId:
 *                 type: string
 *               details:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Address updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Address not found
 */
router.put("/:addressId", authenticateToken, updateAddress);

/**
 * @swagger
 * /api/addresses/{addressId}:
 *   delete:
 *     summary: Delete an address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Address deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Address not found
 */
router.delete("/:addressId", authenticateToken, deleteAddress);

/**
 * @swagger
 * /api/addresses/{addressId}/default:
 *   patch:
 *     summary: Set an address as the default
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Default address updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Address not found
 */
router.patch("/:addressId/default", authenticateToken, setDefaultAddress);

export default router;
```

### Route Details

#### `GET /api/addresses`
**Headers:** `Authorization: Bearer <token>`  
**Query:** `page=1`, `limit=10`, `search=Home`  
**Response:**
```json
{
  "success": true,
  "data": {
    "addresses": [
      {
        "_id": "6638b2c3d4e5f6g7h8i9j0k1",
        "userId": "65e26b1c09b068c201383801",
        "name": "Home",
        "location": {
          "_id": "7749c3d4e5f6g7h8i9j0k1l2",
          "name": "Nairobi",
          "formattedAddress": "Nairobi, Kenya",
          "coordinates": {
            "lat": -1.2920659,
            "lng": 36.8219462
          },
          "regions": {
            "country": "Kenya"
          }
        },
        "details": "Near gate B",
        "isDefault": true,
        "createdAt": "2026-07-27T10:00:00.000Z",
        "updatedAt": "2026-07-27T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAddresses": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/addresses/:addressId`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Home",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya",
        "coordinates": {
          "lat": -1.2920659,
          "lng": 36.8219462
        },
        "regions": {
          "country": "Kenya"
        }
      },
      "details": "Near gate B",
      "isDefault": true
    }
  }
}
```

#### `POST /api/addresses`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`  
**Body:**
```json
{
  "name": "Home",
  "locationId": "7749c3d4e5f6g7h8i9j0k1l2",
  "details": "Near gate B",
  "isDefault": true
}
```
**Response:**
```json
{
  "success": true,
  "message": "Address created successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Home",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya"
      },
      "details": "Near gate B",
      "isDefault": true
    }
  }
}
```

#### `PUT /api/addresses/:addressId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`  
**Body:**
```json
{
  "name": "Office",
  "details": "3rd floor, Room 301"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Address updated successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "name": "Office",
      "details": "3rd floor, Room 301",
      "isDefault": false
    }
  }
}
```

#### `DELETE /api/addresses/:addressId`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "message": "Address deleted successfully"
}
```

#### `PATCH /api/addresses/:addressId/default`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "message": "Default address updated successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "name": "Office",
      "isDefault": true
    }
  }
}
```

---

## 🔐 Middleware

### `authenticateToken`
**Purpose:** Verify JWT token and load user. Returns 401 if token is missing or invalid.
**Usage:**
```typescript
router.get("/", authenticateToken, getUserAddresses);
```
All address routes are scoped to the authenticated user via `userId: req.user?._id` — no user can access another user's addresses.

---

## 📝 API Examples

### Get User Addresses
```bash
curl -X GET "http://localhost:3500/api/addresses?page=1&limit=10&search=Home" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "data": {
    "addresses": [
      {
        "_id": "6638b2c3d4e5f6g7h8i9j0k1",
        "userId": "65e26b1c09b068c201383801",
        "name": "Home",
        "location": {
          "_id": "7749c3d4e5f6g7h8i9j0k1l2",
          "name": "Nairobi",
          "formattedAddress": "Nairobi, Kenya",
          "coordinates": {
            "lat": -1.2920659,
            "lng": 36.8219462
          },
          "regions": {
            "country": "Kenya"
          }
        },
        "details": "Near gate B",
        "isDefault": true,
        "createdAt": "2026-07-27T10:00:00.000Z",
        "updatedAt": "2026-07-27T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalAddresses": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Get Address by ID
```bash
curl -X GET http://localhost:3500/api/addresses/6638b2c3d4e5f6g7h8i9j0k1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Home",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya",
        "coordinates": {
          "lat": -1.2920659,
          "lng": 36.8219462
        },
        "regions": {
          "country": "Kenya"
        }
      },
      "details": "Near gate B",
      "isDefault": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### Create Address
```bash
curl -X POST http://localhost:3500/api/addresses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "name": "Home",
    "locationId": "7749c3d4e5f6g7h8i9j0k1l2",
    "details": "Near gate B",
    "isDefault": true
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Address created successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Home",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya"
      },
      "details": "Near gate B",
      "isDefault": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### Update Address
```bash
curl -X PUT http://localhost:3500/api/addresses/6638b2c3d4e5f6g7h8i9j0k1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "name": "Office",
    "details": "3rd floor, Room 301"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Address updated successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Office",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya"
      },
      "details": "3rd floor, Room 301",
      "isDefault": false,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:30:00.000Z"
    }
  }
}
```

### Delete Address
```bash
curl -X DELETE http://localhost:3500/api/addresses/6638b2c3d4e5f6g7h8i9j0k1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "message": "Address deleted successfully"
}
```

### Set Default Address
```bash
curl -X PATCH http://localhost:3500/api/addresses/6638b2c3d4e5f6g7h8i9j0k1/default \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "message": "Default address updated successfully",
  "data": {
    "address": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "userId": "65e26b1c09b068c201383801",
      "name": "Office",
      "location": {
        "_id": "7749c3d4e5f6g7h8i9j0k1l2",
        "name": "Nairobi",
        "formattedAddress": "Nairobi, Kenya"
      },
      "details": "3rd floor, Room 301",
      "isDefault": true,
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:30:00.000Z"
    }
  }
}
```

---

## 🛡️ Security Features

- **Authentication:** All address endpoints require a valid JWT token.
- **Access Control:** Users can only access, update, or delete their own addresses — all queries are scoped to `userId: req.user?._id`.
- **Integrity:** The pre-save hook ensures only one default address exists per user at any time.

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
| 400 | Missing name or locationId |
| 401 | Missing or invalid JWT |
| 404 | Address not found (or does not belong to user); Location not found |
| 500 | Internal server error |

---

## 📊 Database Indexes

```typescript
addressSchema.index({ userId: 1 });
addressSchema.index({ userId: 1, isDefault: 1 });
addressSchema.index({ location: 1 });
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
