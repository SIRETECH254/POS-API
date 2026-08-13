import express from "express";
import { getBartenderDashboard, getManagerDashboard } from "../controllers/dashboardController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const BARTENDER_DASHBOARD_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const MANAGER_DASHBOARD_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/dashboard/bartender:
 *   get:
 *     summary: Front-of-house dashboard — open tabs, today's sales, low stock, pending mpesa
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard retrieved successfully
 *       400:
 *         description: Caller has no branch assigned
 *       401:
 *         description: Unauthorized
 */
router.get("/bartender", authenticateToken, authorizeRoles(BARTENDER_DASHBOARD_ROLES), getBartenderDashboard);

/**
 * @swagger
 * /api/dashboard/manager:
 *   get:
 *     summary: Management dashboard — revenue, profit, stock value, best sellers, open tabs, staff online
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Admin only — scope to one branch; omit for a consolidated view across all branches. Ignored for managers, who always see their own branch.
 *     responses:
 *       200:
 *         description: Dashboard retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 */
router.get("/manager", authenticateToken, authorizeRoles(MANAGER_DASHBOARD_ROLES), getManagerDashboard);

export default router;
