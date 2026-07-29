import express from "express";
import {
  startShift,
  endShift,
  getActiveShifts,
  getShiftHistory,
  getShift,
  reviewVariance,
} from "../controllers/shiftController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/shifts/start:
 *   post:
 *     summary: Start a new shift
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - openingFloat
 *             properties:
 *               openingFloat:
 *                 type: number
 *                 description: Opening cash float amount
 *     responses:
 *       201:
 *         description: Shift started successfully
 *       400:
 *         description: Missing openingFloat or no branch assigned
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Active shift already exists
 */
router.post(
  "/start",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  startShift
);

/**
 * @swagger
 * /api/shifts/active:
 *   get:
 *     summary: Get all active (open) shifts
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch ID
 *     responses:
 *       200:
 *         description: Active shifts retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/active",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  getActiveShifts
);

/**
 * @swagger
 * /api/shifts:
 *   get:
 *     summary: Get shift history with pagination
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *       - in: query
 *         name: staff
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, closed]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Shift history retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  getShiftHistory
);

/**
 * @swagger
 * /api/shifts/{shiftId}:
 *   get:
 *     summary: Get a shift by ID
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shiftId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shift retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Shift not found
 */
router.get(
  "/:shiftId",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  getShift
);

/**
 * @swagger
 * /api/shifts/{shiftId}/end:
 *   patch:
 *     summary: End an open shift
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shiftId
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
 *               - actualCash
 *             properties:
 *               actualCash:
 *                 type: number
 *                 description: Physically counted cash at shift close
 *     responses:
 *       200:
 *         description: Shift ended successfully
 *       400:
 *         description: Missing actualCash or shift already closed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorised to close this shift
 *       404:
 *         description: Shift not found
 */
router.patch(
  "/:shiftId/end",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "store_keeper", "manager", "admin", "accountant"]),
  endShift
);

/**
 * @swagger
 * /api/shifts/{shiftId}/review-variance:
 *   patch:
 *     summary: Review and sign off on a shift cash variance
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shiftId
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
 *               - varianceNotes
 *             properties:
 *               varianceNotes:
 *                 type: string
 *                 description: Manager explanation of the cash variance
 *     responses:
 *       200:
 *         description: Variance reviewed successfully
 *       400:
 *         description: Missing varianceNotes or shift is not closed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Shift not found
 *       409:
 *         description: Variance already reviewed
 */
router.patch(
  "/:shiftId/review-variance",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  reviewVariance
);

export default router;
