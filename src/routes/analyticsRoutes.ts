import express from "express";
import {
  getSalesTrend,
  getProfitTrend,
  getPeakHours,
  getTopProducts,
  getPaymentDistribution,
  getInventoryValueTrend,
  getBranchComparison,
} from "../controllers/analyticsController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const ANALYTICS_ROLES: UserRole[] = ["manager", "admin", "accountant"];

/**
 * @swagger
 * /api/analytics/sales-trend:
 *   get:
 *     summary: Daily-bucketed sales trend
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
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
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sales trend retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/sales-trend", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getSalesTrend);

/**
 * @swagger
 * /api/analytics/profit-trend:
 *   get:
 *     summary: Daily-bucketed profit trend
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
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
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profit trend retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/profit-trend", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getProfitTrend);

/**
 * @swagger
 * /api/analytics/peak-hours:
 *   get:
 *     summary: Tab volume and revenue by hour of day
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [today, yesterday, weekly, monthly, yearly]
 *           default: today
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Peak hours retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/peak-hours", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getPeakHours);

/**
 * @swagger
 * /api/analytics/top-products:
 *   get:
 *     summary: Ranked best-selling products
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [today, yesterday, weekly, monthly, yearly]
 *           default: today
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Top products retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/top-products", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getTopProducts);

/**
 * @swagger
 * /api/analytics/payment-distribution:
 *   get:
 *     summary: Share of revenue by payment method
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [today, yesterday, weekly, monthly, yearly]
 *           default: today
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment distribution retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/payment-distribution", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getPaymentDistribution);

/**
 * @swagger
 * /api/analytics/inventory-value:
 *   get:
 *     summary: Daily inventory value movement trend
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
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
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory value trend retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/inventory-value", authenticateToken, authorizeRoles(ANALYTICS_ROLES), getInventoryValueTrend);

/**
 * @swagger
 * /api/analytics/branch-comparison:
 *   get:
 *     summary: Side-by-side branch performance comparison
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [today, yesterday, weekly, monthly, yearly]
 *           default: today
 *     responses:
 *       200:
 *         description: Branch comparison retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 */
router.get("/branch-comparison", authenticateToken, authorizeRoles(["admin"]), getBranchComparison);

export default router;
