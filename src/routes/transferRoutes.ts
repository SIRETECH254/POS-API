import express from "express";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  getAllTransfers,
  getTransferById,
} from "../controllers/transferController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/transfers:
 *   get:
 *     summary: Get all transfers
 *     tags: [Transfers]
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
 *         name: fromBranch
 *         schema:
 *           type: string
 *       - in: query
 *         name: toBranch
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_transit, received, cancelled]
 *     responses:
 *       200:
 *         description: Transfers retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getAllTransfers
);

/**
 * @swagger
 * /api/transfers/{transferId}:
 *   get:
 *     summary: Get transfer by ID
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transferId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transfer retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transfer not found
 */
router.get(
  "/:transferId",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin", "accountant"]),
  getTransferById
);

/**
 * @swagger
 * /api/transfers:
 *   post:
 *     summary: Create a branch-to-branch stock transfer
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromBranch
 *               - toBranch
 *               - items
 *             properties:
 *               fromBranch:
 *                 type: string
 *               toBranch:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - product
 *                     - sku
 *                     - quantity
 *                   properties:
 *                     product:
 *                       type: string
 *                     sku:
 *                       type: string
 *                     quantity:
 *                       type: number
 *     responses:
 *       201:
 *         description: Transfer created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch, product, or SKU not found
 */
router.post(
  "/",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  createTransfer
);

/**
 * @swagger
 * /api/transfers/{transferId}/dispatch:
 *   patch:
 *     summary: Dispatch a pending transfer, decrementing stock at the source branch
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transferId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transfer dispatched successfully
 *       400:
 *         description: Stock not initialized for a branch/SKU pairing, or insufficient stock
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transfer not found
 *       409:
 *         description: Transfer is not pending
 */
router.patch(
  "/:transferId/dispatch",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  dispatchTransfer
);

/**
 * @swagger
 * /api/transfers/{transferId}/receive:
 *   patch:
 *     summary: Receive an in-transit transfer, incrementing stock at the destination branch
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transferId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transfer received successfully
 *       400:
 *         description: Stock not initialized for the destination branch/SKU pairing
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transfer not found
 *       409:
 *         description: Transfer is not in transit
 */
router.patch(
  "/:transferId/receive",
  authenticateToken,
  authorizeRoles(["store_keeper", "manager", "admin"]),
  receiveTransfer
);

export default router;
