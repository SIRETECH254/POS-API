import express from "express";
import { getAuditLogs, getEntityHistory } from "../controllers/auditController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const AUDIT_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/audit-logs:
 *   get:
 *     summary: List audit log entries
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *       - in: query
 *         name: user
 *         schema:
 *           type: string
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [SKU, Tab, Payment, User]
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [PRICE_CHANGE, TAB_CANCELLED, PAYMENT_REVERSED, ROLE_CHANGED]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 */
router.get("/", authenticateToken, authorizeRoles(AUDIT_ROLES), getAuditLogs);

/**
 * @swagger
 * /api/audit-logs/entity/{entityType}/{entityId}:
 *   get:
 *     summary: List the audit history for a single entity
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [SKU, Tab, Payment, User]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Entity audit history retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 */
router.get("/entity/:entityType/:entityId", authenticateToken, authorizeRoles(AUDIT_ROLES), getEntityHistory);

export default router;
