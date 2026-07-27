import express from "express";
import {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/roleController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Get all roles
 *     tags: [Roles]
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
 *         description: Search by name or description
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", authenticateToken, authorizeRoles(["admin", "manager"]), getAllRoles);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   get:
 *     summary: Get role by ID
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     responses:
 *       200:
 *         description: Role retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Role not found
 */
router.get("/:roleId", authenticateToken, authorizeRoles(["admin", "manager"]), getRoleById);

/**
 * @swagger
 * /api/roles:
 *   post:
 *     summary: Create a new role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, description]
 *             properties:
 *               name:
 *                 type: string
 *                 enum: [bartender, cashier, store_keeper, manager, admin, accountant]
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Role created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Role already exists
 */
router.post("/", authenticateToken, authorizeRoles(["admin"]), createRole);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   put:
 *     summary: Update role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Role not found
 */
router.put("/:roleId", authenticateToken, authorizeRoles(["admin"]), updateRole);

/**
 * @swagger
 * /api/roles/{roleId}:
 *   delete:
 *     summary: Delete role
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: Role document ID
 *     responses:
 *       200:
 *         description: Role deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Role not found
 */
router.delete("/:roleId", authenticateToken, authorizeRoles(["admin"]), deleteRole);

export default router;
