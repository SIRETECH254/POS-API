# 🗂️ POS API - User Management Documentation

## 📋 Table of Contents
- [User Management Overview](#user-management-overview)
- [User Model](#-user-model)
- [User Controller](#-user-controller)
- [User Routes](#-user-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## User Management Overview

User Management covers all staff accounts in the Club POS system. Each staff member is assigned a **Role** (e.g. bartender, manager, admin) and a **Branch**. The module exposes two distinct surfaces:

- **Self-service routes** (`/profile`, `/change-password`, `/set-pin`, `/profile/avatar`) — available to any authenticated user to manage their own account.
- **Staff management routes** (`POST /`, `GET /`, `GET /:userId`, `PUT /:userId`, `PATCH /:userId/status`) — restricted to admin and manager roles for creating and administering staff accounts.

Authentication is JWT-based (full login via `POST /api/auth/login`) or PIN-based (fast shift login via `POST /api/auth/pin-login`). Sensitive fields (`password`, `pin`, `resetPasswordToken`) are stored hashed and excluded from all query results by default via Mongoose `select: false`.

---

## 👤 User Model

### Schema Definition
```typescript
interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;           // unique, lowercase
  phone: string;           // unique
  password: string;        // select: false, bcrypt hashed
  pin: string;             // select: false, bcrypt hashed, 4-6 digits
  role: Types.ObjectId | IRole;
  branch: Types.ObjectId | IBranch;
  status: boolean;         // true = active, false = suspended
  avatar: string;          // Cloudinary URL
  avatarPublicId: string;  // Cloudinary public_id for deletion
  lastLoginAt: Date;
  currentShift: Types.ObjectId;
  resetPasswordToken: string;   // select: false
  resetPasswordExpiry: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/User.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { IUser } from "../type";

const userSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:     { type: String, required: true, unique: true, trim: true },
    password:  { type: String, required: true, select: false },
    pin:       { type: String, select: false },
    role:      { type: Schema.Types.ObjectId, ref: "Role", required: true },
    branch:    { type: Schema.Types.ObjectId, ref: "Branch" },
    status:    { type: Boolean, default: true },
    avatar:           { type: String },
    avatarPublicId:   { type: String },
    lastLoginAt:      { type: Date },
    currentShift:     { type: Schema.Types.ObjectId, ref: "Shift" },
    resetPasswordToken:  { type: String, select: false },
    resetPasswordExpiry: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ branch: 1 });

const User = mongoose.model<IUser>("User", userSchema);
export default User;
```

### Validation Rules
```typescript
firstName:          { required: true, trim: true }
lastName:           { required: true, trim: true }
email:              { required: true, unique: true, lowercase: true }
phone:              { required: true, unique: true }
password:           { required: true, select: false }
pin:                { select: false }
role:               { required: true, ref: "Role" }
branch:             { ref: "Branch" }
status:             { default: true }
resetPasswordToken: { select: false }
```

---

## 🎮 User Controller

**File:** `src/controllers/userController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { errorHandler } from "../middleware/errorHandler";
import User from "../models/User";
import Role from "../models/Role";
import Branch from "../models/Branch";
import { deleteFromCloudinary } from "../config/cloudinary";
```

### Functions Overview

---

#### `createStaff()`
**Purpose:** Admin/Manager creates a new staff account
**Access:** Admin, Manager
**Validation:** All required fields must be present; email and phone must be unique; role and branch must exist
**Process:** Validate uniqueness, verify role/branch exist, hash password, create user, populate role and branch
**Response:** Created staff member

**Controller Implementation:**
```typescript
export const createStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { firstName, lastName, email, phone, password, roleId, branchId } = req.body;

    // Guard — required fields
    if (!firstName) {
      return next(errorHandler(400, "First name is required"));
    }
    if (!lastName) {
      return next(errorHandler(400, "Last name is required"));
    }
    if (!email) {
      return next(errorHandler(400, "Email is required"));
    }
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }
    if (!password) {
      return next(errorHandler(400, "Password is required"));
    }
    if (!roleId) {
      return next(errorHandler(400, "Role is required"));
    }
    if (!branchId) {
      return next(errorHandler(400, "Branch is required"));
    }

    // Guard — email uniqueness
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return next(errorHandler(409, "Email already in use"));
    }

    // Guard — phone uniqueness
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return next(errorHandler(409, "Phone number already in use"));
    }

    // Guard — role must exist
    const role = await Role.findById(roleId);
    if (!role) {
      return next(errorHandler(404, "Role not found"));
    }

    // Guard — branch must exist
    const branch = await Branch.findById(branchId);
    if (!branch) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Create staff account
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: roleId,
      branch: branchId,
      status: true,
    });

    // Populate role and branch for response
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return created staff
    res.status(201).json({
      success: true,
      message: "Staff account created successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllStaff()`
**Purpose:** List staff members with filtering, branch scoping, and pagination
**Access:** Admin, Manager
**Validation:** None required
**Process:** Filter by branch, search, and status; paginate; populate role and branch
**Response:** Staff list and pagination

**Controller Implementation:**
```typescript
export const getAllStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, search, status, branch } = req.query;

    // Build filter query
    const query: any = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName:  { $regex: search, $options: "i" } },
        { email:     { $regex: search, $options: "i" } },
        { phone:     { $regex: search, $options: "i" } },
      ];
    }

    if (status === "active") {
      query.status = true;
    }
    if (status === "inactive") {
      query.status = false;
    }

    if (branch) {
      query.branch = branch;
    }

    // Paginate options
    const options = {
      page:  parseInt(page  as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch staff and total count
    const staff = await User.find(query)
      .populate("role")
      .populate("branch")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);

    const total      = await User.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        staff,
        pagination: {
          currentPage: options.page,
          totalPages,
          totalStaff: total,
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

#### `getStaff()`
**Purpose:** Fetch a single staff member by ID
**Access:** Admin, Manager
**Validation:** User must exist
**Process:** Find user by userId param, populate role and branch, return
**Response:** Staff member details

**Controller Implementation:**
```typescript
export const getStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find staff by ID with populated references
    const user = await User.findById(req.params.userId).populate("role").populate("branch");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Return staff member
    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateStaff()`
**Purpose:** Admin/Manager updates a staff member's details
**Access:** Admin, Manager
**Validation:** User must exist; phone must remain unique if changed; role and branch must exist if changed
**Process:** Find user, validate uniqueness and references, apply updates, save, return
**Response:** Updated staff member

**Controller Implementation:**
```typescript
export const updateStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract updatable fields — email excluded for security
    const { firstName, lastName, phone, roleId, branchId } = req.body;

    // Find staff by ID
    const user = await User.findById(req.params.userId);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Guard — phone uniqueness if changing
    if (phone !== undefined && phone !== user.phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return next(errorHandler(409, "Phone number already in use"));
      }
    }

    // Guard — role must exist if changing
    if (roleId !== undefined) {
      const role = await Role.findById(roleId);
      if (!role) {
        return next(errorHandler(404, "Role not found"));
      }
    }

    // Guard — branch must exist if changing
    if (branchId !== undefined) {
      const branch = await Branch.findById(branchId);
      if (!branch) {
        return next(errorHandler(404, "Branch not found"));
      }
    }

    // Apply updates
    if (firstName !== undefined) {
      user.firstName = firstName;
    }
    if (lastName !== undefined) {
      user.lastName = lastName;
    }
    if (phone !== undefined) {
      user.phone = phone;
    }
    if (roleId !== undefined) {
      user.role = roleId;
    }
    if (branchId !== undefined) {
      user.branch = branchId;
    }

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated staff
    res.status(200).json({
      success: true,
      message: "Staff member updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `setUserStatus()`
**Purpose:** Admin toggles a staff member's active/suspended status
**Access:** Admin
**Validation:** User must exist; admin cannot change their own status
**Process:** Toggle the boolean status field and save
**Response:** Updated user with new status

**Controller Implementation:**
```typescript
export const setUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find staff by ID
    const user = await User.findById(req.params.userId);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "Staff member not found"));
    }

    // Guard — cannot change own status
    if (user._id.toString() === req.user?._id.toString()) {
      return next(errorHandler(400, "You cannot change your own account status"));
    }

    // Toggle status
    user.status = !user.status;

    // Save
    await user.save();

    // Return updated status
    res.status(200).json({
      success: true,
      message: `User status set to ${user.status ? "active" : "suspended"}`,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getProfile()`
**Purpose:** Authenticated user retrieves their own profile
**Access:** Any authenticated user
**Validation:** User must exist
**Process:** Fetch user by req.user._id, populate role and branch
**Response:** Full user profile (no sensitive fields)

**Controller Implementation:**
```typescript
export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Fetch authenticated user's profile
    const user = await User.findById(req.user?._id).populate("role").populate("branch");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Return profile
    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateProfile()`
**Purpose:** Authenticated user updates their own profile
**Access:** Any authenticated user
**Validation:** User must exist; phone must remain unique if changed; email and role updates are blocked
**Process:** Apply permitted field updates (firstName, lastName, phone only) and save
**Response:** Updated user profile

**Controller Implementation:**
```typescript
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract only permitted fields — email and role deliberately excluded
    const { firstName, lastName, phone } = req.body;

    // Find authenticated user
    const user = await User.findById(req.user?._id);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Guard — phone uniqueness if changing
    if (phone !== undefined && phone !== user.phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return next(errorHandler(409, "Phone number already in use"));
      }
    }

    // Apply permitted updates
    if (firstName !== undefined) {
      user.firstName = firstName;
    }
    if (lastName !== undefined) {
      user.lastName = lastName;
    }
    if (phone !== undefined) {
      user.phone = phone;
    }

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated profile
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `changePassword()`
**Purpose:** Authenticated user changes their own password
**Access:** Any authenticated user
**Validation:** currentPassword and newPassword required; currentPassword must match stored hash; new password must differ
**Process:** Explicitly select password field, verify current password with bcrypt, hash new password, save
**Response:** Success confirmation

**Controller Implementation:**
```typescript
export const changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { currentPassword, newPassword } = req.body;

    // Guard — required fields
    if (!currentPassword) {
      return next(errorHandler(400, "Current password is required"));
    }
    if (!newPassword) {
      return next(errorHandler(400, "New password is required"));
    }

    // Fetch user with password field
    const user = await User.findById(req.user?._id).select("+password");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Guard — current password must match
    const isMatch = bcrypt.compareSync(currentPassword, user.password);
    if (!isMatch) {
      return next(errorHandler(401, "Current password is incorrect"));
    }

    // Guard — new password must differ from current
    const isSame = bcrypt.compareSync(newPassword, user.password);
    if (isSame) {
      return next(errorHandler(400, "New password must be different from current password"));
    }

    // Hash and save new password
    user.password = bcrypt.hashSync(newPassword, 10);
    await user.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `setPin()`
**Purpose:** Authenticated user sets or updates their 4-6 digit PIN for PIN-based shift login
**Access:** Any authenticated user
**Validation:** pin required; must be 4-6 numeric digits
**Process:** Explicitly select pin field, validate format, hash with bcrypt, save
**Response:** Success confirmation

**Controller Implementation:**
```typescript
export const setPin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract PIN from body
    const { pin } = req.body;

    // Guard — PIN required
    if (!pin) {
      return next(errorHandler(400, "PIN is required"));
    }

    // Guard — PIN must be 4-6 numeric digits
    const pinString = pin.toString();
    if (!/^\d{4,6}$/.test(pinString)) {
      return next(errorHandler(400, "PIN must be 4 to 6 numeric digits"));
    }

    // Fetch user with pin field
    const user = await User.findById(req.user?._id).select("+pin");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Hash and save PIN
    user.pin = bcrypt.hashSync(pinString, 10);
    await user.save();

    // Return success
    res.status(200).json({
      success: true,
      message: "PIN set successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateAvatar()`
**Purpose:** Authenticated user uploads or replaces their avatar image
**Access:** Any authenticated user
**Validation:** File must be present; user must exist
**Process:** Delete old avatar from Cloudinary if exists, set new avatar URL and public ID from multer result, save
**Response:** Updated user with new avatar URL

**Controller Implementation:**
```typescript
export const updateAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Guard — file must be present
    if (!req.file) {
      return next(errorHandler(400, "Avatar image is required"));
    }

    // Find authenticated user
    const user = await User.findById(req.user?._id);

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Delete old avatar from Cloudinary if it exists
    if (user.avatarPublicId) {
      try {
        await deleteFromCloudinary(user.avatarPublicId);
      } catch (deleteError) {
        console.error("Failed to delete previous avatar:", deleteError);
      }
    }

    // Set new avatar from multer-cloudinary result
    user.avatar = req.file.path;
    user.avatarPublicId = req.file.filename;

    // Save and populate
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Return updated user
    res.status(200).json({
      success: true,
      message: "Avatar updated successfully",
      data: { user },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ User Routes

### Base Path: `/api/users`

```typescript
GET    /profile                    // Get own profile (any authenticated user)
PUT    /profile                    // Update own profile (any authenticated user)
PUT    /profile/avatar             // Upload/replace avatar (any authenticated user)
PUT    /change-password            // Change own password (any authenticated user)
PUT    /set-pin                    // Set/update PIN (any authenticated user)
POST   /                           // Create staff account (admin, manager)
GET    /                           // List all staff (admin, manager)
GET    /:userId                    // Get staff by ID (admin, manager)
PUT    /:userId                    // Update staff (admin, manager)
PATCH  /:userId/status             // Toggle staff status (admin only)
```

### Router Implementation

**File: `src/routes/userRoutes.ts`**

```typescript
import express from "express";
import {
  createStaff, getAllStaff, getStaff, updateStaff, setUserStatus,
  getProfile, updateProfile, changePassword, setPin, updateAvatar,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { uploadUserAvatar } from "../config/cloudinary";

const router = express.Router();

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get authenticated user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/profile", authenticateToken, getProfile);

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update authenticated user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               phone:     { type: string }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       409:
 *         description: Phone number already in use
 */
router.put("/profile", authenticateToken, updateProfile);

/**
 * @swagger
 * /api/users/profile/avatar:
 *   put:
 *     summary: Upload or replace profile avatar
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar updated successfully
 *       400:
 *         description: Avatar image is required
 */
router.put("/profile/avatar", authenticateToken, uploadUserAvatar.single("avatar"), updateAvatar);

/**
 * @swagger
 * /api/users/change-password:
 *   put:
 *     summary: Change authenticated user's password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword:     { type: string }
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Current password is incorrect
 */
router.put("/change-password", authenticateToken, changePassword);

/**
 * @swagger
 * /api/users/set-pin:
 *   put:
 *     summary: Set or update 4-6 digit PIN for shift login
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin]
 *             properties:
 *               pin:
 *                 type: string
 *                 description: 4 to 6 numeric digits
 *     responses:
 *       200:
 *         description: PIN set successfully
 *       400:
 *         description: PIN missing or invalid format
 */
router.put("/set-pin", authenticateToken, setPin);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new staff account
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, email, phone, password, roleId, branchId]
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               email:     { type: string, format: email }
 *               phone:     { type: string }
 *               password:  { type: string }
 *               roleId:    { type: string }
 *               branchId:  { type: string }
 *     responses:
 *       201:
 *         description: Staff account created successfully
 *       409:
 *         description: Email or phone already in use
 */
router.post("/", authenticateToken, authorizeRoles(["admin", "manager"]), createStaff);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all staff with filtering and pagination
 *     tags: [Users]
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
 *         description: Staff retrieved successfully
 */
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllStaff);

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get a staff member by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Staff member retrieved successfully
 *       404:
 *         description: Staff member not found
 */
router.get("/:userId", authenticateToken, authorizeRoles(["admin", "manager"]), getStaff);

/**
 * @swagger
 * /api/users/{userId}:
 *   put:
 *     summary: Update a staff member
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               phone:     { type: string }
 *               roleId:    { type: string }
 *               branchId:  { type: string }
 *     responses:
 *       200:
 *         description: Staff member updated successfully
 *       404:
 *         description: Staff member, Role, or Branch not found
 */
router.put("/:userId", authenticateToken, authorizeRoles(["admin", "manager"]), updateStaff);

/**
 * @swagger
 * /api/users/{userId}/status:
 *   patch:
 *     summary: Toggle staff member's active/suspended status
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User status updated
 *       400:
 *         description: Cannot change own status
 *       404:
 *         description: Staff member not found
 */
router.patch("/:userId/status", authenticateToken, authorizeRoles(["admin"]), setUserStatus);

export default router;
```

### Route Details

#### `GET /api/users/profile`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@bar.com",
      "phone": "+254700000001",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane.jpg",
      "avatarPublicId": "pos-api/avatars/jane",
      "lastLoginAt": "2026-07-27T08:00:00.000Z",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN",
        "isMain": true
      },
      "createdAt": "2026-07-01T10:00:00.000Z",
      "updatedAt": "2026-07-27T08:00:00.000Z"
    }
  }
}
```

#### `PUT /api/users/profile`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+254700000002"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@bar.com",
      "phone": "+254700000002",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane.jpg",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T09:00:00.000Z"
    }
  }
}
```

#### `PUT /api/users/profile/avatar`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
**Body:** form-data field `avatar` (image file, max 2 MB)
**Response:**
```json
{
  "success": true,
  "message": "Avatar updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@bar.com",
      "phone": "+254700000001",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane_new.jpg",
      "avatarPublicId": "pos-api/avatars/jane_new",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T09:15:00.000Z"
    }
  }
}
```

#### `PUT /api/users/change-password`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "currentPassword": "oldpass123",
  "newPassword": "newpass456"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

#### `PUT /api/users/set-pin`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "pin": "1234"
}
```
**Response:**
```json
{
  "success": true,
  "message": "PIN set successfully"
}
```

#### `POST /api/users`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "firstName": "John",
  "lastName": "Mwangi",
  "email": "john@bar.com",
  "phone": "+254700000003",
  "password": "secure123",
  "roleId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "branchId": "64f1a2b3c4d5e6f7a8b9c0d3"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Staff account created successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

#### `GET /api/users`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `search=john`, `status=active`, `branch=64f1a2b3c4d5e6f7a8b9c0d3`
**Response:**
```json
{
  "success": true,
  "data": {
    "staff": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
        "firstName": "John",
        "lastName": "Mwangi",
        "email": "john@bar.com",
        "phone": "+254700000003",
        "status": true,
        "avatar": null,
        "role": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
          "name": "bartender",
          "displayName": "Bartender"
        },
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "createdAt": "2026-07-27T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 2,
      "totalStaff": 15,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

#### `GET /api/users/:userId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

#### `PUT /api/users/:userId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "firstName": "Updated",
  "phone": "+254700000099",
  "roleId": "64f1a2b3c4d5e6f7a8b9c0d5"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Staff member updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "Updated",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000099",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
        "name": "cashier",
        "displayName": "Cashier"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T11:00:00.000Z"
    }
  }
}
```

#### `PATCH /api/users/:userId/status`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "User status set to suspended",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": false,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T11:30:00.000Z"
    }
  }
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT from the `Authorization: Bearer <token>` header and load the authenticated user (with role populated) onto `req.user`. Returns 401 if token is missing, invalid, or expired.
**Usage:**
```typescript
router.get("/profile", authenticateToken, getProfile);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check that `req.user.role.name` is in the `allowedRoles` array. Returns 403 if the user's role is not permitted for the route.
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["admin", "manager"]), createStaff);
```

#### `uploadUserAvatar`
**Purpose:** Multer middleware backed by Cloudinary storage. Accepts a single image file (JPEG, PNG, GIF, WebP) up to 2 MB. Uploads to `pos-api/avatars` during the middleware phase — `req.file.path` will contain the Cloudinary URL and `req.file.filename` will contain the public ID.
**Usage:**
```typescript
router.put("/profile/avatar", authenticateToken, uploadUserAvatar.single("avatar"), updateAvatar);
```

---

## 📝 API Examples

### Get Profile
```bash
curl -X GET http://localhost:3500/api/users/profile \
  -H "Authorization: Bearer <token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@bar.com",
      "phone": "+254700000001",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane.jpg",
      "avatarPublicId": "pos-api/avatars/jane",
      "lastLoginAt": "2026-07-27T08:00:00.000Z",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN",
        "isMain": true
      },
      "createdAt": "2026-07-01T10:00:00.000Z",
      "updatedAt": "2026-07-27T08:00:00.000Z"
    }
  }
}
```

### Update Profile
```bash
curl -X PUT http://localhost:3500/api/users/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "firstName": "Janet", "phone": "+254700000099" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Janet",
      "lastName": "Doe",
      "email": "jane@bar.com",
      "phone": "+254700000099",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane.jpg",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T09:00:00.000Z"
    }
  }
}
```

### Upload Avatar
```bash
curl -X PUT http://localhost:3500/api/users/profile/avatar \
  -H "Authorization: Bearer <token>" \
  -F "avatar=@/path/to/photo.jpg"
```
**Response:**
```json
{
  "success": true,
  "message": "Avatar updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@bar.com",
      "phone": "+254700000001",
      "status": true,
      "avatar": "https://res.cloudinary.com/demo/image/upload/pos-api/avatars/jane_new.jpg",
      "avatarPublicId": "pos-api/avatars/jane_new",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T09:15:00.000Z"
    }
  }
}
```

### Change Password
```bash
curl -X PUT http://localhost:3500/api/users/change-password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "currentPassword": "oldpass", "newPassword": "newpass123" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

### Set PIN
```bash
curl -X PUT http://localhost:3500/api/users/set-pin \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "pin": "5678" }'
```
**Response:**
```json
{
  "success": true,
  "message": "PIN set successfully"
}
```

### Create Staff
```bash
curl -X POST http://localhost:3500/api/users \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Ali",
    "lastName": "Hassan",
    "email": "ali@bar.com",
    "phone": "+254700000010",
    "password": "pass1234",
    "roleId": "<roleId>",
    "branchId": "<branchId>"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Staff account created successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d6",
      "firstName": "Ali",
      "lastName": "Hassan",
      "email": "ali@bar.com",
      "phone": "+254700000010",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### List Staff
```bash
curl -X GET "http://localhost:3500/api/users?page=1&limit=10&status=active&branch=64f1a2b3c4d5e6f7a8b9c0d3" \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "staff": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
        "firstName": "John",
        "lastName": "Mwangi",
        "email": "john@bar.com",
        "phone": "+254700000003",
        "status": true,
        "avatar": null,
        "role": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
          "name": "bartender",
          "displayName": "Bartender"
        },
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "createdAt": "2026-07-27T10:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalStaff": 5,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

### Get Staff by ID
```bash
curl -X GET http://localhost:3500/api/users/64f1a2b3c4d5e6f7a8b9c0d4 \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

### Update Staff
```bash
curl -X PUT http://localhost:3500/api/users/64f1a2b3c4d5e6f7a8b9c0d4 \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "roleId": "64f1a2b3c4d5e6f7a8b9c0d5", "branchId": "64f1a2b3c4d5e6f7a8b9c0d3" }'
```
**Response:**
```json
{
  "success": true,
  "message": "Staff member updated successfully",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": true,
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
        "name": "cashier",
        "displayName": "Cashier"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T11:00:00.000Z"
    }
  }
}
```

### Toggle Status
```bash
curl -X PATCH http://localhost:3500/api/users/64f1a2b3c4d5e6f7a8b9c0d4/status \
  -H "Authorization: Bearer <admin-token>"
```
**Response:**
```json
{
  "success": true,
  "message": "User status set to suspended",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "firstName": "John",
      "lastName": "Mwangi",
      "email": "john@bar.com",
      "phone": "+254700000003",
      "status": false,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
        "name": "bartender",
        "displayName": "Bartender"
      },
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "updatedAt": "2026-07-27T11:30:00.000Z"
    }
  }
}
```

---

## 🛡️ Security Features

- **Password hashing:** bcrypt with 10 salt rounds on creation and every password change.
- **PIN hashing:** bcrypt with 10 salt rounds; 4-6 numeric digits enforced before hashing.
- **`select: false`:** `password`, `pin`, and `resetPasswordToken` are never returned in any query unless explicitly selected with `.select("+field")`.
- **Email locked:** `updateProfile` and `updateStaff` do not accept `email` changes — email is set once at creation and cannot be changed via the API.
- **Role update scoping:** Only admin/manager can change another user's role via `updateStaff`. A user cannot escalate their own role via `updateProfile`.
- **Self-suspend guard:** `setUserStatus` rejects requests where the caller targets their own account, preventing admin lock-out.
- **Avatar cleanup:** Old Cloudinary asset is deleted before the new one is stored. Deletion failures are caught and logged — they do not abort the upload.
- **RBAC:** All routes are protected by `authenticateToken`. Staff management routes additionally require `admin` or `manager` roles. Status toggle is restricted to `admin` only.

---

## 🚨 Error Handling

Common error response shape:
```json
{
  "success": false,
  "message": "Error description"
}
```

| Status | Scenario |
|--------|----------|
| 400 | Missing required field; PIN format invalid (not 4-6 digits); new password same as current; attempt to self-suspend |
| 401 | Missing or invalid JWT token; current password mismatch |
| 403 | Authenticated but insufficient role (e.g. bartender calling `POST /api/users`) |
| 404 | User / Role / Branch not found by ID |
| 409 | Email already in use; phone number already in use |
| 500 | Database error or unexpected server failure |

---

## 📊 Database Indexes

```typescript
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ branch: 1 });
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
