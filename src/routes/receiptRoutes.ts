import express from "express";
import {
  getTabReceipts,
  getReceipt,
  printReceipt,
  reprintReceipt,
  generateRefundReceipt,
} from "../controllers/receiptController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];
const REFUND_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/receipts/tab/{tabId}:
 *   get:
 *     summary: List all receipts issued for a tab
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
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
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [sale, refund, reprint]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Regex search on receiptNumber
 *     responses:
 *       200:
 *         description: Tab receipts retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 */
router.get("/tab/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTabReceipts);

/**
 * @swagger
 * /api/receipts/tab/{tabId}/print:
 *   post:
 *     summary: Mark a tab's sale receipt as printed
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Receipt marked as printed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: No receipt found for this tab
 */
router.post("/tab/:tabId/print", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, printReceipt);

/**
 * @swagger
 * /api/receipts/tab/{tabId}/reprint:
 *   post:
 *     summary: Issue a new receipt record reusing the tab's original sale receipt PDF
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Receipt reprinted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: No receipt found for this tab
 */
router.post(
  "/tab/:tabId/reprint",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  reprintReceipt
);

/**
 * @swagger
 * /api/receipts/tab/{tabId}/refund:
 *   post:
 *     summary: Generate a refund receipt for a tab
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
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
 *               - amount
 *               - reason
 *             properties:
 *               amount:
 *                 type: number
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Refund receipt generated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: Tab not found
 */
router.post(
  "/tab/:tabId/refund",
  authenticateToken,
  authorizeRoles(REFUND_ROLES),
  requireActiveShift,
  generateRefundReceipt
);

/**
 * @swagger
 * /api/receipts/{receiptId}:
 *   get:
 *     summary: Get a receipt by ID
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: receiptId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Receipt retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Receipt not found
 */
router.get("/:receiptId", authenticateToken, authorizeRoles(READ_ROLES), getReceipt);

export default router;
