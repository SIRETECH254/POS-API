import express from "express";
import {
  createStaff,
  getAllStaff,
  getStaff,
  updateStaff,
  setUserStatus,
  getProfile,
  updateProfile,
  changePassword,
  setPin,
  updateAvatar,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { uploadUserAvatar } from "../config/cloudinary";

const router = express.Router();

// ── Self-service routes (static paths declared before /:userId) ─────────────

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
 *       404:
 *         description: User not found
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
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
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
 *       401:
 *         description: Unauthorized
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
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error or same password
 *       401:
 *         description: Current password is incorrect
 */
router.put("/change-password", authenticateToken, changePassword);

/**
 * @swagger
 * /api/users/set-pin:
 *   put:
 *     summary: Set or update the authenticated user's PIN for PIN-based login
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
 *       401:
 *         description: Unauthorized
 */
router.put("/set-pin", authenticateToken, setPin);

// ── Staff management routes (admin/manager) ─────────────────────────────────

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
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 *               roleId:
 *                 type: string
 *               branchId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Staff account created successfully
 *       400:
 *         description: Missing required field
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Role or Branch not found
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
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Results per page (default 10)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by firstName, lastName, email, or phone
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch ID
 *     responses:
 *       200:
 *         description: Staff retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staff member retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
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
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               roleId:
 *                 type: string
 *               branchId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Staff member updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Staff member, Role, or Branch not found
 *       409:
 *         description: Phone number already in use
 */
router.put("/:userId", authenticateToken, authorizeRoles(["admin", "manager"]), updateStaff);

/**
 * @swagger
 * /api/users/{userId}/status:
 *   patch:
 *     summary: Toggle a staff member's active/suspended status
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User status updated
 *       400:
 *         description: Cannot change own status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Staff member not found
 */
router.patch("/:userId/status", authenticateToken, authorizeRoles(["admin"]), setUserStatus);

export default router;
