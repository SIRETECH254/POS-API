import express from "express";
import {
  startStockCount,
  submitStockCount,
  reconcileStockCount,
  getAllStockCounts,
  getStockCountById,
} from "../controllers/stockCountController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/stock-counts:
 *   get:
 *     summary: Get all stock counts
 *     tags: [StockCounts]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [in_progress, completed, reconciled]
 *     responses:
 *       200:
 *         description: Stock counts retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllStockCounts
);

/**
 * @swagger
 * /api/stock-counts/{stockCountId}:
 *   get:
 *     summary: Get stock count by ID
 *     tags: [StockCounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockCountId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock count retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Stock count not found
 */
router.get(
  "/:stockCountId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getStockCountById
);

/**
 * @swagger
 * /api/stock-counts:
 *   post:
 *     summary: Start a stock count
 *     tags: [StockCounts]
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
 *               - items
 *             properties:
 *               branch:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - product
 *                     - sku
 *                   properties:
 *                     product:
 *                       type: string
 *                     sku:
 *                       type: string
 *     responses:
 *       201:
 *         description: Stock count started successfully
 *       400:
 *         description: Validation error, or stock not initialized for a branch/SKU pairing
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch, product, or SKU not found
 */
router.post(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  startStockCount
);

/**
 * @swagger
 * /api/stock-counts/{stockCountId}/submit:
 *   patch:
 *     summary: Submit physically counted quantities for a stock count
 *     tags: [StockCounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockCountId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - sku
 *                     - actualQuantity
 *                   properties:
 *                     sku:
 *                       type: string
 *                     actualQuantity:
 *                       type: number
 *     responses:
 *       200:
 *         description: Stock count submitted successfully
 *       400:
 *         description: Validation error, or not all items covered
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Stock count not found
 *       409:
 *         description: Stock count is not in progress
 */
router.patch(
  "/:stockCountId/submit",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  submitStockCount
);

/**
 * @swagger
 * /api/stock-counts/{stockCountId}/reconcile:
 *   patch:
 *     summary: Reconcile a completed stock count, applying variances as stock adjustments
 *     tags: [StockCounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockCountId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock count reconciled successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Stock count not found
 *       409:
 *         description: Stock count must be completed before it can be reconciled
 */
router.patch(
  "/:stockCountId/reconcile",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  reconcileStockCount
);

export default router;
