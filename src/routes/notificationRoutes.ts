import express from "express";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: List the authenticated user's notifications
 *     tags: [Notifications]
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
 *         name: isRead
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticateToken, getMyNotifications);

/**
 * @swagger
 * /api/notifications/unread-count:
 *   get:
 *     summary: Count the authenticated user's unread notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/unread-count", authenticateToken, getUnreadCount);

/**
 * @swagger
 * /api/notifications/{notificationId}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 */
router.patch("/:notificationId/read", authenticateToken, markAsRead);

/**
 * @swagger
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all of the authenticated user's unread notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         description: Unauthorized
 */
router.patch("/read-all", authenticateToken, markAllAsRead);

export default router;
