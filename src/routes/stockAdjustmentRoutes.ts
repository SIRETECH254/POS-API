import express from "express";
import {
  createStockAdjustment,
  approveStockAdjustment,
  getAllStockAdjustments,
  getStockAdjustmentById,
} from "../controllers/stockAdjustmentController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/stock-adjustments:
 *   get:
 *     summary: Get all stock adjustments
 *     tags: [StockAdjustments]
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
 *         name: sku
 *         schema:
 *           type: string
 *       - in: query
 *         name: reason
 *         schema:
 *           type: string
 *           enum: [breakage, theft, expired, count_correction, other]
 *       - in: query
 *         name: pending
 *         schema:
 *           type: boolean
 *         description: When true, only return adjustments not yet applied
 *     responses:
 *       200:
 *         description: Stock adjustments retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllStockAdjustments
);

/**
 * @swagger
 * /api/stock-adjustments/{stockAdjustmentId}:
 *   get:
 *     summary: Get stock adjustment by ID
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockAdjustmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock adjustment retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Stock adjustment not found
 */
router.get(
  "/:stockAdjustmentId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getStockAdjustmentById
);

/**
 * @swagger
 * /api/stock-adjustments:
 *   post:
 *     summary: Create a stock adjustment
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branch
 *               - product
 *               - sku
 *               - quantityChange
 *               - reason
 *             properties:
 *               branch:
 *                 type: string
 *               product:
 *                 type: string
 *               sku:
 *                 type: string
 *               quantityChange:
 *                 type: number
 *                 description: Negative for breakage/theft/loss, positive for corrections
 *               reason:
 *                 type: string
 *                 enum: [breakage, theft, expired, count_correction, other]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Stock adjustment created (applied immediately if positive, pending approval if negative)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product or SKU not found
 */
router.post(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  createStockAdjustment
);

/**
 * @swagger
 * /api/stock-adjustments/{stockAdjustmentId}/approve:
 *   patch:
 *     summary: Approve a pending negative stock adjustment
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockAdjustmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock adjustment approved and applied successfully
 *       400:
 *         description: Stock not initialized for this branch/SKU, or insufficient stock
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Stock adjustment not found
 *       409:
 *         description: Adjustment does not require approval, or already applied
 */
router.patch(
  "/:stockAdjustmentId/approve",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  approveStockAdjustment
);

export default router;
