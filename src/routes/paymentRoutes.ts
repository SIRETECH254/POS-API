import express from "express";
import {
  payCash,
  initiateMpesaPayment,
  mpesaCallback,
  retryMpesaPayment,
  reversePayment,
  getPayment,
  getTabPayments,
  getMpesaPaymentStatus,
} from "../controllers/paymentController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];
const REVERSE_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/payments/cash:
 *   post:
 *     summary: Record a cash payment against a tab
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tabId
 *               - cashReceived
 *             properties:
 *               tabId:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Defaults to the tab's current balance due
 *               cashReceived:
 *                 type: number
 *     responses:
 *       201:
 *         description: Cash payment recorded
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not awaiting payment
 */
router.post("/cash", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, payCash);

/**
 * @swagger
 * /api/payments/mpesa/initiate:
 *   post:
 *     summary: Initiate an M-Pesa STK push payment against a tab
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tabId
 *               - phone
 *             properties:
 *               tabId:
 *                 type: string
 *               phone:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Defaults to the tab's current balance due
 *     responses:
 *       202:
 *         description: M-Pesa STK push initiated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not awaiting payment
 */
router.post(
  "/mpesa/initiate",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  initiateMpesaPayment
);

/**
 * @swagger
 * /api/payments/mpesa/callback:
 *   post:
 *     summary: Daraja STK push webhook (public — called directly by Safaricom)
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Always acknowledged with ResultCode 0
 */
router.post("/mpesa/callback", mpesaCallback);

/**
 * @swagger
 * /api/payments/mpesa/{paymentId}/retry:
 *   post:
 *     summary: Retry a failed M-Pesa payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: M-Pesa payment retried
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 *       404:
 *         description: Payment or tab not found
 *       409:
 *         description: Payment is not a failed mpesa payment, or tab is not awaiting payment
 */
router.post(
  "/mpesa/:paymentId/retry",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  retryMpesaPayment
);

/**
 * @swagger
 * /api/payments/{paymentId}/reverse:
 *   patch:
 *     summary: Reverse a completed payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
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
 *               - reversedReason
 *             properties:
 *               reversedReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment reversed
 *       400:
 *         description: reversedReason is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payment, tab, or shift not found
 *       409:
 *         description: Payment is not completed, tab is already completed, or shift is closed
 */
router.patch("/:paymentId/reverse", authenticateToken, authorizeRoles(REVERSE_ROLES), reversePayment);

/**
 * @swagger
 * /api/payments/tab/{tabId}:
 *   get:
 *     summary: List all payments recorded against a tab
 *     tags: [Payments]
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
 *         description: Tab payments retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 */
router.get("/tab/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTabPayments);

/**
 * @swagger
 * /api/payments/mpesa-status/{checkoutRequestId}:
 *   get:
 *     summary: Reconcile a pending M-Pesa payment's status against Daraja
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: checkoutRequestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found for this checkout request
 *       502:
 *         description: Failed to query Daraja API
 */
router.get("/mpesa-status/:checkoutRequestId", authenticateToken, authorizeRoles(READ_ROLES), getMpesaPaymentStatus);

/**
 * @swagger
 * /api/payments/{paymentId}:
 *   get:
 *     summary: Get a payment by ID
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found
 */
router.get("/:paymentId", authenticateToken, authorizeRoles(READ_ROLES), getPayment);

export default router;
