import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { errorHandler } from "../middleware/errorHandler";
import User from "../models/User";
import { generateTokens } from "../utils/authHelpers";
import { sendPasswordResetNotification } from "../services/internal/notificationService";

/**
 * Login
 * Purpose: Authenticate staff with email/phone + password and issue tokens
 * Access: Public
 * Validation: Password required; email or phone required; user must exist and be active
 * Process: Verify password; check status; update last login; populate role and branch; issue tokens
 * Response: User data + accessToken + refreshToken
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract credentials from body
    const { email, phone, password } = req.body;

    // Guard — password is required
    if (!password) {
      return next(errorHandler(400, "Password is required"));
    }

    // Guard — email or phone is required
    if (!email && !phone) {
      return next(errorHandler(400, "Email or phone is required"));
    }

    // Find user by email or phone and select password
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
    next(error);
  }
};

/**
 * Pin Login
 * Purpose: Fast PIN-based authentication for shift start, scoped to the user's branch
 * Access: Public
 * Validation: Phone required; PIN required; user must exist, have a PIN set, and be active
 * Process: Verify PIN with bcrypt; check status; update last login; populate role and branch; issue tokens
 * Response: User data + accessToken + refreshToken
 */
export const pinLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract phone and PIN from body
    const { phone, pin } = req.body;

    // Guard — phone is required
    if (!phone) {
      return next(errorHandler(400, "Phone is required"));
    }

    // Guard — PIN is required
    if (!pin) {
      return next(errorHandler(400, "PIN is required"));
    }

    // Find user by phone and select PIN field
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
    next(error);
  }
};

/**
 * Logout
 * Purpose: Log out the authenticated user
 * Access: Authenticated
 * Validation: None
 * Process: Return success response
 * Response: Success confirmation
 */
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

/**
 * Forgot Password
 * Purpose: Send a password reset link via email and SMS
 * Access: Public
 * Validation: Email required; user must exist
 * Process: Generate crypto reset token with 15-minute expiry; persist; send notifications
 * Response: Success confirmation
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract email from body
    const { email } = req.body;

    // Guard — email is required
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
    next(error);
  }
};

/**
 * Reset Password
 * Purpose: Reset password using a valid reset token
 * Access: Public
 * Validation: Token param required; newPassword body required; token must be valid and not expired
 * Process: Hash new password; clear reset token fields
 * Response: Success confirmation
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract token from params and newPassword from body
    const { token } = req.params;
    const { newPassword } = req.body;

    // Guard — token is required
    if (!token) {
      return next(errorHandler(400, "Token is required"));
    }

    // Guard — new password is required
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
    next(error);
  }
};

/**
 * Refresh Token
 * Purpose: Issue a new access and refresh token pair using a valid refresh token
 * Access: Public
 * Validation: Refresh token required; token must be valid; user must exist and be active
 * Process: Verify token signature; reload user; issue new pair
 * Response: New accessToken + refreshToken
 */
export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract refresh token from body
    const { refreshToken: token } = req.body;

    // Guard — refresh token is required
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

/**
 * Get Me
 * Purpose: Return the authenticated user's full profile
 * Access: Authenticated
 * Validation: User must exist
 * Process: Fetch user with populated role and branch; exclude sensitive fields
 * Response: User profile
 */
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
