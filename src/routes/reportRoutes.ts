import express from "express";
import {
  getSalesReport,
  getProductReport,
  getPaymentReport,
  getInventoryReport,
  getProfitReport,
  getEmployeeReport,
  getSupplierReport,
} from "../controllers/reportController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const REPORT_ROLES: UserRole[] = ["manager", "admin", "accountant"];

/**
 * @swagger
 * /api/reports/sales:
 *   get:
 *     summary: Sales report for a range
 *     tags: [Reports]
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
 *         description: Sales report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/sales", authenticateToken, authorizeRoles(REPORT_ROLES), getSalesReport);

/**
 * @swagger
 * /api/reports/products:
 *   get:
 *     summary: Product report — best sellers, slow movers, never sold
 *     tags: [Reports]
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
 *         description: Product report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/products", authenticateToken, authorizeRoles(REPORT_ROLES), getProductReport);

/**
 * @swagger
 * /api/reports/payments:
 *   get:
 *     summary: Payment report — breakdown by method and status
 *     tags: [Reports]
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
 *         description: Payment report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/payments", authenticateToken, authorizeRoles(REPORT_ROLES), getPaymentReport);

/**
 * @swagger
 * /api/reports/inventory:
 *   get:
 *     summary: Inventory report — stock levels and stock value
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/inventory", authenticateToken, authorizeRoles(REPORT_ROLES), getInventoryReport);

/**
 * @swagger
 * /api/reports/profit:
 *   get:
 *     summary: Profit report — Net Profit = Revenue - Cost of Goods - Expenses
 *     tags: [Reports]
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
 *         description: Profit report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/profit", authenticateToken, authorizeRoles(REPORT_ROLES), getProfitReport);

/**
 * @swagger
 * /api/reports/employees:
 *   get:
 *     summary: Employee report — sales, cancellations, discounts, shift performance
 *     tags: [Reports]
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
 *         description: Employee report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/employees", authenticateToken, authorizeRoles(REPORT_ROLES), getEmployeeReport);

/**
 * @swagger
 * /api/reports/suppliers:
 *   get:
 *     summary: Supplier report — purchase spend per supplier
 *     tags: [Reports]
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
 *         description: Supplier report retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/suppliers", authenticateToken, authorizeRoles(REPORT_ROLES), getSupplierReport);

export default router;
