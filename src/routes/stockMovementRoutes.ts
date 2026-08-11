import express from "express";
import { getAllStockMovements, getStockMovementById } from "../controllers/stockMovementController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/stock-movements:
 *   get:
 *     summary: Get all stock movements
 *     tags: [StockMovements]
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
 *         description: Filter by branch ID
 *       - in: query
 *         name: product
 *         schema:
 *           type: string
 *         description: Filter by product ID
 *       - in: query
 *         name: sku
 *         schema:
 *           type: string
 *         description: Filter by SKU subdocument ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [purchased, sold, adjusted, returned, damaged, transferred_out, transferred_in]
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Stock movements retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllStockMovements
);

/**
 * @swagger
 * /api/stock-movements/{stockMovementId}:
 *   get:
 *     summary: Get stock movement by ID
 *     tags: [StockMovements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockMovementId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock movement retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Stock movement not found
 */
router.get(
  "/:stockMovementId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getStockMovementById
);

export default router;
