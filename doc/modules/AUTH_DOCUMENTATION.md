# 🗂️ POS API - Authentication System Documentation

## 📋 Table of Contents
- [Authentication Overview](#authentication-overview)
- [User Model](#-user-model)
- [Authentication Controller](#-authentication-controller)
- [Authentication Routes](#-authentication-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Authentication Overview

The POS API uses JWT (JSON Web Tokens) for authentication with role-based access control (RBAC). All users are staff members managed by administrators. The system supports two login modes: full password login and a fast PIN login for shift start.

### Authentication Flow
1. **Login / PIN Login** → Verify credentials; issue access + refresh token pair
2. **Token Validation** → `authenticateToken` middleware verifies JWT on protected routes
3. **Role Authorization** → `authorizeRoles` checks the user's single populated role
4. **Protected Routes** → Access granted based on role name

### User Roles
- `admin` — Full system access across all branches
- `manager` — Branch-level management and reporting
- `cashier` — Handles payments and tab checkout
- `bartender` — Opens and manages sale tabs
- `store_keeper` — Manages inventory and stock movements
- `accountant` — Read-only access to financial reports

---

## 👤 User Model

### Schema Definition

**File: `src/models/User.ts`**

```typescript
interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;       // select: false
  pin?: string;           // select: false, hashed 4-6 digit PIN
  role: Types.ObjectId | IRole;
  branch?: Types.ObjectId | IBranch; // optional — admins may have no branch
  status: boolean;        // true = active, false = suspended
  avatar?: string;
  avatarPublicId?: string;
  lastLoginAt?: Date;
  currentShift?: Types.ObjectId;    // ref: Shift
  resetPasswordToken?: string;      // select: false
  resetPasswordExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Validation Rules
```
firstName:            { required: true }
lastName:             { required: true }
email:                { required: true, unique: true }
phone:                { required: true, unique: true }
password:             { required: true, select: false }
pin:                  { optional, select: false }
role:                 { required: true, ref: 'Role' }
branch:               { optional, ref: 'Branch' }
status:               { default: true }
resetPasswordToken:   { optional, select: false }
```

---

## 🎮 Authentication Controller

**File: `src/controllers/authController.ts`**

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { errorHandler } from "../middleware/errorHandler";
import User from "../models/User";
import { generateTokens } from "../utils/authHelpers";
import { sendPasswordResetNotification } from "../services/internal/notificationService";
```

### Functions Overview

#### `login()`
**Purpose:** Authenticate staff with email/phone + password and issue tokens
**Access:** Public
**Validation:** Password required; email or phone required; user exists; password matches; account active
**Process:** Find user by email or phone; verify password; update lastLoginAt; populate role/branch; issue tokens
**Response:** User profile + accessToken + refreshToken

**Controller Implementation:**
```typescript
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, phone, password } = req.body;

    // Guard — password required
    if (!password) {
      return next(errorHandler(400, "Password is required"));
    }

    // Guard — email or phone required
    if (!email && !phone) {
      return next(errorHandler(400, "Email or phone is required"));
    }

    // Find user by email or phone
    const query = email ? { email: email.toLowerCase() } : { phone };
    const user = await User.findOne(query).select("+password");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(401, email ? "Email does not exist" : "Phone does not exist"));
    }

    // Guard — password must match
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return next(errorHandler(401, "Invalid password"));
    }

    // Guard — account must be active
    if (!user.status) {
      return next(errorHandler(403, "Account is suspended. Please contact support."));
    }

    // Update last login and populate role and branch
    user.lastLoginAt = new Date();
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Issue token pair and return
    const { accessToken, refreshToken } = generateTokens(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
          role: user.role,
          branch: user.branch,
          status: user.status,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error: any) {
    next(errorHandler(500, "Server error during login"));
  }
};
```

#### `pinLogin()`
**Purpose:** Fast PIN-based authentication for shift start, scoped to the user's branch
**Access:** Public
**Validation:** Phone required; PIN required; user exists; user has PIN configured; PIN matches; account active
**Process:** Find user by phone; verify PIN with bcrypt; update lastLoginAt; populate role/branch; issue tokens
**Response:** User profile + accessToken + refreshToken

**Controller Implementation:**
```typescript
export const pinLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phone, pin } = req.body;

    // Guard — phone required
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }

    // Guard — PIN required
    if (!pin) {
      return next(errorHandler(400, "PIN is required"));
    }

    // Find user by phone with PIN field
    const user = await User.findOne({ phone }).select("+pin");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(401, "Phone does not exist"));
    }

    // Guard — user must have a PIN configured
    if (!user.pin) {
      return next(errorHandler(400, "No PIN set for this account. Please set a PIN first."));
    }

    // Guard — PIN must match
    const isPinValid = bcrypt.compareSync(pin.toString(), user.pin);
    if (!isPinValid) {
      return next(errorHandler(401, "Invalid PIN"));
    }

    // Guard — account must be active
    if (!user.status) {
      return next(errorHandler(403, "Account is suspended. Please contact support."));
    }

    // Update last login and populate role and branch
    user.lastLoginAt = new Date();
    await user.save();
    await user.populate([{ path: "role" }, { path: "branch" }]);

    // Issue token pair and return
    const { accessToken, refreshToken } = generateTokens(user);

    res.status(200).json({
      success: true,
      message: "PIN login successful",
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
          role: user.role,
          branch: user.branch,
          status: user.status,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error: any) {
    next(errorHandler(500, "Server error during PIN login"));
  }
};
```

#### `logout()`
**Purpose:** Log out the authenticated user
**Access:** Authenticated
**Validation:** None
**Process:** Return success response
**Response:** Success confirmation

**Controller Implementation:**
```typescript
export const logout = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `forgotPassword()`
**Purpose:** Send password reset link via email and SMS
**Access:** Public
**Validation:** Email required; user must exist
**Process:** Generate 32-byte hex reset token with 15-minute expiry; persist token fields; send notifications
**Response:** Success confirmation

**Controller Implementation:**
```typescript
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract email from body
    const { email } = req.body;

    // Guard — email required
    if (!email) {
      return next(errorHandler(400, "Email is required"));
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "No user found with this email"));
    }

    // Generate reset token and set 15-minute expiry
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetExpiry;
    await user.save();

    // Send reset notification via email and SMS
    await sendPasswordResetNotification(
      user.email,
      user.phone,
      resetToken,
      `${user.firstName} ${user.lastName}`
    );

    res.status(200).json({
      success: true,
      message: "Password reset instructions sent to your email and phone",
    });
  } catch (error: any) {
    next(errorHandler(500, "Server error during password reset request"));
  }
};
```

#### `resetPassword()`
**Purpose:** Reset password using a valid reset token
**Access:** Public
**Validation:** Token param and newPassword body required; token must exist; token must not be expired
**Process:** Find user by reset token; verify expiry; hash new password; clear reset fields; save
**Response:** Success confirmation

**Controller Implementation:**
```typescript
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    // Guard — token required
    if (!token) {
      return next(errorHandler(400, "Token is required"));
    }

    // Guard — new password required
    if (!newPassword) {
      return next(errorHandler(400, "New password is required"));
    }

    // Find user by reset token
    const user = await User.findOne({ resetPasswordToken: token }).select(
      "+password +resetPasswordToken +resetPasswordExpiry"
    );

    // Guard — token must be valid
    if (!user) {
      return next(errorHandler(400, "Invalid reset token"));
    }

    // Guard — token must not be expired
    if (user.resetPasswordExpiry && user.resetPasswordExpiry < new Date()) {
      return next(errorHandler(400, "Reset token has expired"));
    }

    // Hash new password and clear reset fields
    user.password = bcrypt.hashSync(newPassword, 12);
    user.set("resetPasswordToken", undefined);
    user.set("resetPasswordExpiry", undefined);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error: any) {
    next(errorHandler(500, "Server error during password reset"));
  }
};
```

#### `refreshToken()`
**Purpose:** Issue a new access + refresh token pair using a valid refresh token
**Access:** Public
**Validation:** Refresh token required; token must be valid (signed with REFRESH_TOKEN_SECRET); user must exist and be active
**Process:** Verify token signature; reload user; generate new pair
**Response:** New accessToken + refreshToken

**Controller Implementation:**
```typescript
export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract refresh token from body
    const { refreshToken: token } = req.body;

    // Guard — refresh token required
    if (!token) {
      return next(errorHandler(400, "Refresh token is required"));
    }

    // Verify token signature — throws if invalid or expired
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET as string) as { userId: string };
    } catch {
      return next(errorHandler(403, "Invalid refresh token"));
    }

    // Find user and populate role
    const user = await User.findById(decoded.userId).populate("role");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(403, "User not found"));
    }

    // Guard — account must be active
    if (!user.status) {
      return next(errorHandler(403, "Account is suspended"));
    }

    // Issue new token pair and return
    const tokens = generateTokens(user);

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: tokens,
    });
  } catch (error: any) {
    next(error);
  }
};
```

#### `getMe()`
**Purpose:** Return the authenticated user's full profile
**Access:** Authenticated
**Validation:** User must exist
**Process:** Fetch user with populated role and branch; exclude sensitive fields
**Response:** User profile

**Controller Implementation:**
```typescript
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Fetch user with populated role and branch
    const user = await User.findById(req.user?._id)
      .populate("role")
      .populate("branch")
      .select("-password -pin -resetPasswordToken");

    // Guard — user must exist
    if (!user) {
      return next(errorHandler(404, "User not found"));
    }

    // Return user profile
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
          role: user.role,
          branch: user.branch,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Authentication Routes

### Base Path: `/api/auth`

```typescript
POST   /login                    // Staff login (email/phone + password)
POST   /pin-login                // Fast PIN login for shift start
POST   /logout                   // Logout (authenticated)
POST   /forgot-password          // Request password reset
POST   /reset-password/:token    // Reset password with token
POST   /refresh-token            // Refresh token pair
GET    /me                       // Get current user profile (authenticated)
```

### Router Implementation

**File: `src/routes/authRoutes.ts`**

```typescript
import express from "express";
import {
  login,
  pinLogin,
  logout,
  forgotPassword,
  resetPassword,
  refreshToken,
  getMe,
} from "../controllers/authController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Staff login with email/phone and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account suspended
 */
router.post("/login", login);

/**
 * @swagger
 * /api/auth/pin-login:
 *   post:
 *     summary: Fast PIN login for shift start
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, pin]
 *             properties:
 *               phone:
 *                 type: string
 *               pin:
 *                 type: string
 *     responses:
 *       200:
 *         description: PIN login successful
 *       401:
 *         description: Invalid PIN or phone
 *       403:
 *         description: Account suspended
 */
router.post("/pin-login", pinLogin);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 */
router.post("/logout", authenticateToken, logout);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset via email and SMS
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset instructions sent
 *       404:
 *         description: User not found
 */
router.post("/forgot-password", forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password/{token}:
 *   post:
 *     summary: Reset password with a valid reset token
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post("/reset-password/:token", resetPassword);

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Issue a new token pair using a refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       403:
 *         description: Invalid refresh token
 */
router.post("/refresh-token", refreshToken);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get("/me", authenticateToken, getMe);

export default router;
```

### Route Details

#### `POST /api/auth/login`
**Body:**
```json
{
  "email": "john.doe@posapi.com",
  "password": "securePassword123"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "bartender",
        "description": "Opens and manages sale tabs"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.abc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }
}
```

#### `POST /api/auth/pin-login`
**Body:**
```json
{
  "phone": "+254712345678",
  "pin": "1234"
}
```
**Response:**
```json
{
  "success": true,
  "message": "PIN login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "bartender",
        "description": "Opens and manages sale tabs"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.abc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }
}
```

#### `POST /api/auth/logout`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### `POST /api/auth/forgot-password`
**Body:**
```json
{
  "email": "john.doe@posapi.com"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Password reset instructions sent to your email and phone"
}
```

#### `POST /api/auth/reset-password/:token`
**Body:**
```json
{
  "newPassword": "newSecurePassword456"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

#### `POST /api/auth/refresh-token`
**Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.newAbc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.newXyz789"
  }
}
```

#### `GET /api/auth/me`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": "https://res.cloudinary.com/demo/image/upload/v1690000000/pos-api/avatars/john_doe.jpg",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "manager",
        "description": "Branch-level management and reporting"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true,
      "lastLoginAt": "2026-07-27T10:30:00.000Z",
      "createdAt": "2026-07-01T08:00:00.000Z"
    }
  }
}
```

---

## 🔐 Middleware

**File: `src/middleware/auth.ts`**

### `authenticateToken`
**Purpose:** Verify JWT and load user (with populated role) onto `req.user`. Returns 401 if token is missing, invalid, or user is inactive.
**Usage:**
```typescript
router.get("/me", authenticateToken, getMe);
```

### `authorizeRoles(allowedRoles)`
**Purpose:** Restrict a route to one or more roles by checking `(req.user.role as IRole).name`. Returns 403 if the user's role is not in the allowed list.
**Usage:**
```typescript
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllStaff);
```

---

## 📝 API Examples

### Login with Email
```bash
curl -X POST http://localhost:3500/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@posapi.com",
    "password": "securePassword123"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "bartender",
        "description": "Opens and manages sale tabs"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.abc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }
}
```

### Login with Phone
```bash
curl -X POST http://localhost:3500/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+254712345678",
    "password": "securePassword123"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "bartender",
        "description": "Opens and manages sale tabs"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.abc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }
}
```

### PIN Login
```bash
curl -X POST http://localhost:3500/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+254712345678",
    "pin": "1234"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "PIN login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "bartender",
        "description": "Opens and manages sale tabs"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.abc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }
}
```

### Logout
```bash
curl -X POST http://localhost:3500/api/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### Get Current Profile
```bash
curl -X GET http://localhost:3500/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@posapi.com",
      "phone": "+254712345678",
      "avatar": "https://res.cloudinary.com/demo/image/upload/v1690000000/pos-api/avatars/john_doe.jpg",
      "role": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "manager",
        "description": "Branch-level management and reporting"
      },
      "branch": {
        "_id": "65e26b1c09b068c201383801",
        "name": "Main Branch"
      },
      "status": true,
      "lastLoginAt": "2026-07-27T10:30:00.000Z",
      "createdAt": "2026-07-01T08:00:00.000Z"
    }
  }
}
```

### Forgot Password
```bash
curl -X POST http://localhost:3500/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@posapi.com"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Password reset instructions sent to your email and phone"
}
```

### Reset Password
```bash
curl -X POST http://localhost:3500/api/auth/reset-password/a1b2c3d4e5f6789012345678901234567890abcd \
  -H "Content-Type: application/json" \
  -d '{
    "newPassword": "newSecurePassword456"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

### Refresh Token
```bash
curl -X POST http://localhost:3500/api/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.xyz789"
  }'
```
**Response:**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.newAbc123",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTBhZjEyMzQ1Njc4OTBhYmNkZWYxMjMifQ.newXyz789"
  }
}
```

---

## 🛡️ Security Features

- **Password Hashing:** bcryptjs with 12 salt rounds — `bcrypt.hashSync(newPassword, 12)`
- **Hidden Fields:** `select: false` on `password`, `pin`, and `resetPasswordToken` — never returned by default
- **PIN Login:** 4-6 digit PIN hashed with bcrypt; separate from password; used for fast shift start
- **Password Reset:** 32-byte crypto token with 15-minute expiry; persisted to DB; cleared on use
- **Access Token:** Signed with `JWT_SECRET`, short-lived (`JWT_EXPIRES_IN`, default `15m`)
- **Refresh Token:** Signed with `REFRESH_TOKEN_SECRET`, 7-day lifetime
- **Account Status:** `status: false` blocks all logins at both password and PIN check points
- **Branch Scoping:** `branch` field is optional — admins without a branch have cross-branch access

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
| 400 | Missing required field, no PIN set, invalid or expired reset token |
| 401 | Invalid password, invalid PIN, email/phone does not exist |
| 403 | Account suspended, invalid or missing refresh token |
| 404 | User not found (reset-password flow) |
| 500 | Internal server error |

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
