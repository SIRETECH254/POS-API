import express from "express";
import {
  createTab,
  getOpenTabs,
  getTab,
  addItem,
  updateItemQuantity,
  removeItem,
  cancelItem,
  holdTab,
  resumeTab,
  mergeTabs,
  splitBill,
  cancelTab,
  closeTab,
  getAllTabs,
} from "../controllers/tabController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];

/**
 * @swagger
 * /api/tabs:
 *   post:
 *     summary: Open a new tab at the requesting staff member's branch
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               table:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tab opened successfully
 *       400:
 *         description: Staff member is not assigned to a branch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: No active shift
 */
router.post("/", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, createTab);

/**
 * @swagger
 * /api/tabs/open:
 *   get:
 *     summary: List tabs currently open or held at the branch
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Admin/Accountant only — view another branch
 *     responses:
 *       200:
 *         description: Open tabs retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/open", authenticateToken, authorizeRoles(READ_ROLES), getOpenTabs);

/**
 * @swagger
 * /api/tabs/{tabId}:
 *   get:
 *     summary: Get a tab by ID
 *     tags: [Tabs]
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
 *         description: Tab retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 */
router.get("/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTab);

/**
 * @swagger
 * /api/tabs/{tabId}/items:
 *   post:
 *     summary: Add a product/SKU line item to a tab
 *     tags: [Tabs]
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
 *               - product
 *               - sku
 *               - quantity
 *             properties:
 *               product:
 *                 type: string
 *               sku:
 *                 type: string
 *               quantity:
 *                 type: number
 *               discount:
 *                 type: number
 *     responses:
 *       201:
 *         description: Item added to tab
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab, product, or SKU not found
 *       409:
 *         description: Tab is not open or held
 */
router.post("/:tabId/items", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, addItem);

/**
 * @swagger
 * /api/tabs/{tabId}/items/{itemId}:
 *   patch:
 *     summary: Update the quantity of a tab line item
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
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
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: number
 *     responses:
 *       200:
 *         description: Item quantity updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab or item not found
 *       409:
 *         description: Tab is not open/held, or item is cancelled
 */
router.patch(
  "/:tabId/items/:itemId",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  updateItemQuantity
);

/**
 * @swagger
 * /api/tabs/{tabId}/items/{itemId}:
 *   delete:
 *     summary: Remove a line item from a tab
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item removed from tab
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab or item not found
 *       409:
 *         description: Tab is not open or held
 */
router.delete(
  "/:tabId/items/:itemId",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  removeItem
);

/**
 * @swagger
 * /api/tabs/{tabId}/items/{itemId}/cancel:
 *   patch:
 *     summary: Cancel a single line item on a tab
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item cancelled
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab or item not found
 *       409:
 *         description: Tab is not open/held, or item already cancelled
 */
router.patch(
  "/:tabId/items/:itemId/cancel",
  authenticateToken,
  authorizeRoles(MUTATE_ROLES),
  requireActiveShift,
  cancelItem
);

/**
 * @swagger
 * /api/tabs/{tabId}/hold:
 *   patch:
 *     summary: Put an open tab on hold
 *     tags: [Tabs]
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
 *               - holdReason
 *             properties:
 *               holdReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tab put on hold
 *       400:
 *         description: Hold reason is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not open
 */
router.patch("/:tabId/hold", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, holdTab);

/**
 * @swagger
 * /api/tabs/{tabId}/resume:
 *   patch:
 *     summary: Resume a held tab back to open
 *     tags: [Tabs]
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
 *         description: Tab resumed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not held
 */
router.patch("/:tabId/resume", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, resumeTab);

/**
 * @swagger
 * /api/tabs/merge:
 *   post:
 *     summary: Merge tabs into a single target tab (same branch only)
 *     tags: [Tabs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tabIds
 *             properties:
 *               tabIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: First ID is the merge target; remaining IDs are merged into it
 *     responses:
 *       200:
 *         description: Tabs merged successfully
 *       400:
 *         description: At least two tab IDs are required, or tabs are on different branches
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: One or more tabs not found
 *       409:
 *         description: A tab is not open or held
 */
router.post("/merge", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, mergeTabs);

/**
 * @swagger
 * /api/tabs/{tabId}/split:
 *   post:
 *     summary: Split a tab's items into multiple new tabs
 *     tags: [Tabs]
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
 *               - groups
 *             properties:
 *               groups:
 *                 type: array
 *                 items:
 *                   type: array
 *                   items:
 *                     type: string
 *                 description: Each inner array is a list of item IDs for one new tab; must exactly partition the tab's active items
 *     responses:
 *       201:
 *         description: Bill split successfully
 *       400:
 *         description: Groups must exactly partition the tab's active items
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not open or held
 */
router.post("/:tabId/split", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, splitBill);

/**
 * @swagger
 * /api/tabs/{tabId}/cancel:
 *   patch:
 *     summary: Cancel a tab before payment
 *     tags: [Tabs]
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
 *               - cancelReason
 *             properties:
 *               cancelReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tab cancelled
 *       400:
 *         description: Cancel reason is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab cannot be cancelled in its current status
 */
router.patch("/:tabId/cancel", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, cancelTab);

/**
 * @swagger
 * /api/tabs/{tabId}/close:
 *   patch:
 *     summary: Close a tab out for payment
 *     tags: [Tabs]
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
 *         description: Tab closed, awaiting payment
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tab not found
 *       409:
 *         description: Tab is not open or held
 */
router.patch("/:tabId/close", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, closeTab);

/**
 * @swagger
 * /api/tabs:
 *   get:
 *     summary: Get tab history with filtering and pagination
 *     tags: [Tabs]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, open, held, awaiting_payment, paid, completed, cancelled, archived]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by tab number
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Admin/Accountant only — view another branch
 *     responses:
 *       200:
 *         description: Tabs retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticateToken, authorizeRoles(READ_ROLES), getAllTabs);

export default router;
