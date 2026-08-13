import express from "express";
import {
  getSettings,
  updateSettings,
  updatePrinterConfig,
  updateReceiptLayout,
} from "../controllers/settingsController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { UserRole } from "../type";

const router = express.Router();

const SETTINGS_WRITE_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/settings/{branchId}:
 *   get:
 *     summary: Get a branch's settings (created on first access if none exist)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch not found
 */
router.get("/:branchId", authenticateToken, getSettings);

/**
 * @swagger
 * /api/settings/{branchId}:
 *   put:
 *     summary: Update a branch's general settings
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               businessName:
 *                 type: string
 *               address:
 *                 type: string
 *               phone:
 *                 type: string
 *               taxRate:
 *                 type: number
 *               currency:
 *                 type: string
 *               paymentMethodsEnabled:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [cash, mpesa, card]
 *               lowStockThresholdDefault:
 *                 type: number
 *               theme:
 *                 type: object
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 *       404:
 *         description: Branch not found
 */
router.put("/:branchId", authenticateToken, authorizeRoles(SETTINGS_WRITE_ROLES), updateSettings);

/**
 * @swagger
 * /api/settings/{branchId}/printer:
 *   patch:
 *     summary: Update a branch's printer configuration
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
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
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [usb, network]
 *               target:
 *                 type: string
 *     responses:
 *       200:
 *         description: Printer config updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 *       404:
 *         description: Branch not found
 */
router.patch("/:branchId/printer", authenticateToken, authorizeRoles(SETTINGS_WRITE_ROLES), updatePrinterConfig);

/**
 * @swagger
 * /api/settings/{branchId}/receipt-layout:
 *   patch:
 *     summary: Update a branch's receipt footer note
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
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
 *               - receiptFooterNote
 *             properties:
 *               receiptFooterNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Receipt layout updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient role
 *       404:
 *         description: Branch not found
 */
router.patch(
  "/:branchId/receipt-layout",
  authenticateToken,
  authorizeRoles(SETTINGS_WRITE_ROLES),
  updateReceiptLayout
);

export default router;
