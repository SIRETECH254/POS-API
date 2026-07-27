# 🔐 POS API - Authentication and Authorization Middleware Documentation

## 📋 Table of Contents
- [Auth Middleware Overview](#auth-middleware-overview)
- [Implementation Details](#implementation-details)
  - [authenticateToken](#authenticatetoken)
  - [authorizeRoles](#authorizeroles)
- [Usage in Routes](#usage-in-routes)
  - [Auth Routes](#auth-routes)
  - [User Routes](#user-routes)
  - [Admin Routes](#admin-routes)
- [Error Handling](#error-handling)

---

## Auth Middleware Overview

The middleware layer (`src/middleware/auth.ts`) is the primary security gate for the POS API. It handles JWT verification and Role-Based Access Control (RBAC) checks to ensure only authorized users can access specific resources.

---

## Implementation Details

### `authenticateToken`

Verifies the JWT and populates the user document on the request object.

**File: `src/middleware/auth.ts` — `authenticateToken`**
```typescript
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import User from "../models/User";
import { IUser, UserRole } from "../type";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({ success: false, message: "Access token required" });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "User unauthorized or inactive" });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
```

### `authorizeRoles`

Enforces role-based access control by checking if the user's roles include any of the allowed roles.

**File: `src/middleware/auth.ts` — `authorizeRoles`**
```typescript
export const authorizeRoles = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      res.status(403).json({ success: false, message: "Insufficient permissions for this action" });
      return;
    }

    next();
  };
};
```

---

## Usage in Routes

### Auth Routes (`src/routes/authRoutes.ts`)
```typescript
router.get("/me", authenticateToken, getMe);
router.post("/logout", authenticateToken, logout);
```

### User Routes (`src/routes/userRoutes.ts`)
```typescript
router.get("/profile", authenticateToken, getUserProfile);
router.put("/profile", authenticateToken, updateUserProfile);
```

### Admin Routes
```typescript
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllUsers);
router.put("/:userId/status", authenticateToken, authorizeRoles(["admin"]), updateUserStatus);
```

---

## Error Handling

Middleware uses standard HTTP status codes:
- `401 Unauthorized`: Missing, invalid, or expired token; user not found or inactive.
- `403 Forbidden`: User authenticated but lacks the required role.

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Status:** Active
