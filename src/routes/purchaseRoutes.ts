import express from "express";
import {
  createPurchaseOrder,
  receiveGoods,
  getAllPurchases,
  getPurchaseById,
} from "../controllers/purchaseController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/purchases:
 *   get:
 *     summary: Get all purchase orders
 *     tags: [Purchases]
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
 *         name: supplier
 *         schema:
 *           type: string
 *         description: Filter by supplier ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ordered, received, cancelled]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by purchase number
 *     responses:
 *       200:
 *         description: Purchase orders retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllPurchases
);

/**
 * @swagger
 * /api/purchases/{purchaseId}:
 *   get:
 *     summary: Get purchase order by ID
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Purchase order retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Purchase order not found
 */
router.get(
  "/:purchaseId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getPurchaseById
);

/**
 * @swagger
 * /api/purchases:
 *   post:
 *     summary: Create a new purchase order
 *     tags: [Purchases]
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
 *               - supplier
 *               - items
 *             properties:
 *               branch:
 *                 type: string
 *               supplier:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - product
 *                     - sku
 *                     - quantity
 *                     - purchasePrice
 *                   properties:
 *                     product:
 *                       type: string
 *                     sku:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     purchasePrice:
 *                       type: number
 *     responses:
 *       201:
 *         description: Purchase order created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch, supplier, product, or SKU not found
 */
router.post(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  createPurchaseOrder
);

/**
 * @swagger
 * /api/purchases/{purchaseId}/receive:
 *   patch:
 *     summary: Receive goods for a purchase order
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Goods received successfully
 *       400:
 *         description: Stock not initialized for a branch/SKU pairing, or insufficient stock
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Purchase order not found
 *       409:
 *         description: Purchase order already received or cancelled
 */
router.patch(
  "/:purchaseId/receive",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  receiveGoods
);

export default router;
