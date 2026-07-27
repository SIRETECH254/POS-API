# 🔐 POS API - Authentication System Documentation

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

### Security Features
- **Two login modes** — Password login and PIN login (4-6 digit fast login)
- **Password Reset** — Crypto token-based reset flow, 15-minute expiry
- **Refresh Tokens** — Separate refresh secret (`REFRESH_TOKEN_SECRET`), 7-day lifetime
- **Account Status** — Single `status` boolean controls login access
- **Branch Scoping** — Branch field is optional; admins without a branch have cross-branch access

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

### Database Indexes
```typescript
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ branch: 1 });
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
**Validation:**
- Password is required
- Email or phone is required
- User exists (specific: "Email does not exist" / "Phone does not exist")
- Password matches (specific: "Invalid password")
- Account is active (`status: true`)

**Controller Implementation:**
```typescript
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, phone, password } = req.body;

    if (!password) {
      return next(errorHandler(400, "Password is required"));
    }

    if (!email && !phone) {
      return next(errorHandler(400, "Email or phone is required"));
    }

    const query = email ? { email: email.toLowerCase() } : { phone };
    const user = await User.findOne(query).select("+password");

    if (!user) {
      return next(errorHandler(401, email ? "Email does not exist" : "Phone does not exist"));
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);

    if (!isPasswordValid) {
      return next(errorHandler(401, "Invalid password"));
    }

    if (!user.status) {
      return next(errorHandler(403, "Account is suspended. Please contact support."));
    }

    user.lastLoginAt = new Date();
    await user.save();

    await user.populate([{ path: "role" }, { path: "branch" }]);

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
    console.error("Login error:", error);
    next(errorHandler(500, "Server error during login"));
  }
};
```

#### `pinLogin()`
**Purpose:** Fast PIN-based authentication for shift start, scoped to the user's branch
**Access:** Public
**Validation:**
- Phone is required
- PIN is required
- User exists
- User has a PIN configured
- PIN matches
- Account is active

**Controller Implementation:**
```typescript
export const pinLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phone, pin } = req.body;

    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }

    if (!pin) {
      return next(errorHandler(400, "PIN is required"));
    }

    const user = await User.findOne({ phone }).select("+pin");

    if (!user) {
      return next(errorHandler(401, "Phone does not exist"));
    }

    if (!user.pin) {
      return next(errorHandler(400, "No PIN set for this account. Please set a PIN first."));
    }

    const isPinValid = bcrypt.compareSync(pin.toString(), user.pin);

    if (!isPinValid) {
      return next(errorHandler(401, "Invalid PIN"));
    }

    if (!user.status) {
      return next(errorHandler(403, "Account is suspended. Please contact support."));
    }

    user.lastLoginAt = new Date();
    await user.save();

    await user.populate([{ path: "role" }, { path: "branch" }]);

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
    console.error("PIN login error:", error);
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

#### `forgotPassword()`
**Purpose:** Send password reset link via email and SMS
**Access:** Public
**Validation:**
- Email is required
- User must exist
**Process:**
- Generate 32-byte hex reset token with 15-minute expiry
- Persist token fields
- Send notifications via email and SMS

**Controller Implementation:**
```typescript
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(errorHandler(400, "Email is required"));
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return next(errorHandler(404, "No user found with this email"));
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetExpiry;
    await user.save();

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
    console.error("Forgot password error:", error);
    next(errorHandler(500, "Server error during password reset request"));
  }
};
```

#### `resetPassword(token, newPassword)`
**Purpose:** Reset password using a valid reset token
**Access:** Public
**Validation:**
- Token param and newPassword body are required
- Token must exist in database ("Invalid reset token")
- Token must not be expired ("Reset token has expired") — valid for 15 minutes

**Controller Implementation:**
```typescript
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!token) {
      return next(errorHandler(400, "Token is required"));
    }

    if (!newPassword) {
      return next(errorHandler(400, "New password is required"));
    }

    const user = await User.findOne({ resetPasswordToken: token }).select("+password +resetPasswordToken +resetPasswordExpiry");

    if (!user) {
      return next(errorHandler(400, "Invalid reset token"));
    }

    if (user.resetPasswordExpiry && user.resetPasswordExpiry < new Date()) {
      return next(errorHandler(400, "Reset token has expired"));
    }

    user.password = bcrypt.hashSync(newPassword, 12);
    user.set("resetPasswordToken", undefined);
    user.set("resetPasswordExpiry", undefined);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    next(errorHandler(500, "Server error during password reset"));
  }
};
```

#### `refreshToken(refreshToken)`
**Purpose:** Issue a new access + refresh token pair
**Access:** Public
**Validation:**
- Refresh token required
- Token must be valid (signed with `REFRESH_TOKEN_SECRET`)
- User must exist and have `status: true`
**Process:** Verify token; reload user; generate new pair
**Response:** New accessToken + refreshToken

#### `getMe()`
**Purpose:** Return the authenticated user's profile
**Access:** Authenticated
**Validation:** User must exist
**Process:** Load user with populated role and branch
**Response:** User profile

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

**File: `src/routes/authRoutes.ts`**

### Route Details

#### `POST /api/auth/login`
**Body:**
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": { "_id": "...", "name": "bartender", "description": "Opens and manages sale tabs" },
      "branch": { "_id": "...", "name": "Main Branch" },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
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
**Response (200 OK):**
```json
{
  "success": true,
  "message": "PIN login successful",
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "role": { "_id": "...", "name": "bartender" },
      "branch": { "_id": "...", "name": "Main Branch" },
      "status": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### `POST /api/auth/logout`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{ "success": true, "message": "Logged out successfully" }
```

#### `POST /api/auth/forgot-password`
**Body:**
```json
{ "email": "john@example.com" }
```
**Response (200 OK):**
```json
{ "success": true, "message": "Password reset instructions sent to your email and phone" }
```

#### `POST /api/auth/reset-password/:token`
**Body:**
```json
{ "newPassword": "newSecurePassword456" }
```
**Response (200 OK):**
```json
{ "success": true, "message": "Password reset successfully" }
```

#### `POST /api/auth/refresh-token`
**Body:**
```json
{ "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### `GET /api/auth/me`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "650af1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+254712345678",
      "avatar": null,
      "role": { "_id": "...", "name": "manager", "description": "Branch-level management" },
      "branch": { "_id": "...", "name": "Main Branch" },
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
**Purpose:** Verify JWT and load user (with populated role) onto `req.user`
**Checks:** Token present; token valid; `user.status === true`

```typescript
router.get("/me", authenticateToken, getMe);
```

### `authorizeRoles(allowedRoles)`
**Purpose:** Restrict a route to one or more roles by checking `(req.user.role as IRole).name`

```typescript
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllStaff);
```

---

## 🔑 Auth Helpers

**File: `src/utils/authHelpers.ts`**

### `generateTokens(user)`
Returns `{ accessToken, refreshToken }`.

| Token | Secret | Expiry | Payload |
|---|---|---|---|
| Access | `JWT_SECRET` | `JWT_EXPIRES_IN` (default `15m`) | `{ userId, branchId }` |
| Refresh | `REFRESH_TOKEN_SECRET` | `7d` | `{ userId }` |

---

## 📧 Email Service

**File: `src/services/external/emailService.ts`**

Uses **SendGrid** (`@sendgrid/mail`). Initialized with `SMTP_PASS` env var.
If unconfigured, sends are skipped with a warning (no crash).

| Function | Description |
|---|---|
| `sendPasswordResetEmail(email, resetToken, name)` | Sends password reset link |
| `sendGenericEmail(email, subject, message)` | Generic email for notifications |

---

## 📱 SMS Service

**File: `src/services/external/smsService.ts`**

Uses **Africa's Talking**. Initialized with `AFRICAS_TALKING_API_KEY` + `AFRICAS_TALKING_USERNAME`.
If unconfigured, sends are skipped with a warning (no crash).

| Function | Description |
|---|---|
| `sendPasswordResetSMS(phone, resetToken, name)` | Sends password reset link via SMS |
| `sendGenericSMS(phone, message)` | Generic SMS |

Phone numbers are auto-formatted to Kenyan international format (`+254...`).

---

## 📝 API Examples

### Login with Email
```bash
curl -X POST http://localhost:3500/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "john@example.com", "password": "securePassword123" }'
```

### Login with Phone
```bash
curl -X POST http://localhost:3500/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "phone": "+254712345678", "password": "securePassword123" }'
```

### PIN Login
```bash
curl -X POST http://localhost:3500/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{ "phone": "+254712345678", "pin": "1234" }'
```

### Get Current Profile
```bash
curl -X GET http://localhost:3500/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

### Forgot Password
```bash
curl -X POST http://localhost:3500/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "john@example.com" }'
```

### Reset Password
```bash
curl -X POST http://localhost:3500/api/auth/reset-password/a1b2c3d4e5f6... \
  -H "Content-Type: application/json" \
  -d '{ "newPassword": "newSecurePassword456" }'
```

---

## 🛡️ Security Features

### Password Security
- **Hashing:** bcryptjs with 12 salt rounds
- **Hidden by Default:** `select: false` on password and pin fields
- **Password Reset:** Crypto token, 15-minute expiry

### JWT Security
- **Access Token:** `JWT_SECRET`, short-lived (`JWT_EXPIRES_IN`, default `15m`)
- **Refresh Token:** `REFRESH_TOKEN_SECRET`, 7-day lifetime

### Account Control
- `status: true` — active; `status: false` — suspended (blocks all logins)
- Only administrators/managers can toggle `status` (via User management routes)

---

## 🚨 Error Handling

```json
{ "success": false, "message": "..." }
```

Common errors:
- `400` — Missing required field or invalid input
- `401` — Invalid credentials or expired token
- `403` — Account suspended or insufficient permissions
- `404` — User not found
- `500` — Internal server error

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
