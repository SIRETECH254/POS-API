import express from "express";
import {
  createExpense,
  getAllExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  approveExpense,
} from "../controllers/expenseController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { uploadExpenseReceipt } from "../config/cloudinary";
import { UserRole } from "../type";

const router = express.Router();

const CREATE_ROLES: UserRole[] = ["store_keeper", "manager", "admin"];
const READ_ROLES: UserRole[] = ["store_keeper", "manager", "admin", "accountant"];
const APPROVE_ROLES: UserRole[] = ["manager", "admin"];

/**
 * @swagger
 * /api/expenses:
 *   post:
 *     summary: Record a new expense
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - branch
 *               - category
 *               - description
 *               - amount
 *               - paymentMethod
 *               - expenseDate
 *             properties:
 *               branch:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [rent, electricity, water, dj, security, cleaning, fuel, repairs, marketing, other]
 *               description:
 *                 type: string
 *               amount:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [cash, mpesa, bank]
 *               expenseDate:
 *                 type: string
 *                 format: date
 *               receipt:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Expense recorded successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", authenticateToken, authorizeRoles(CREATE_ROLES), uploadExpenseReceipt.single("receipt"), createExpense);

/**
 * @swagger
 * /api/expenses:
 *   get:
 *     summary: Get all expenses
 *     tags: [Expenses]
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
 *         name: category
 *         schema:
 *           type: string
 *           enum: [rent, electricity, water, dj, security, cleaning, fuel, repairs, marketing, other]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved]
 *       - in: query
 *         name: paymentMethod
 *         schema:
 *           type: string
 *           enum: [cash, mpesa, bank]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Regex search on description
 *     responses:
 *       200:
 *         description: Expenses retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticateToken, authorizeRoles(READ_ROLES), getAllExpenses);

/**
 * @swagger
 * /api/expenses/{expenseId}:
 *   get:
 *     summary: Get expense by ID
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Expense retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 */
router.get("/:expenseId", authenticateToken, authorizeRoles(READ_ROLES), getExpense);

/**
 * @swagger
 * /api/expenses/{expenseId}:
 *   put:
 *     summary: Update an expense
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [rent, electricity, water, dj, security, cleaning, fuel, repairs, marketing, other]
 *               description:
 *                 type: string
 *               amount:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [cash, mpesa, bank]
 *               expenseDate:
 *                 type: string
 *                 format: date
 *               receipt:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Expense updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 *       409:
 *         description: Approved expense cannot be updated
 */
router.put("/:expenseId", authenticateToken, authorizeRoles(CREATE_ROLES), uploadExpenseReceipt.single("receipt"), updateExpense);

/**
 * @swagger
 * /api/expenses/{expenseId}:
 *   delete:
 *     summary: Delete an expense
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Expense deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 *       409:
 *         description: Approved expense cannot be deleted
 */
router.delete("/:expenseId", authenticateToken, authorizeRoles(["admin"]), deleteExpense);

/**
 * @swagger
 * /api/expenses/{expenseId}/approve:
 *   patch:
 *     summary: Approve a pending expense
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Expense approved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 *       409:
 *         description: Only a pending expense can be approved
 */
router.patch("/:expenseId/approve", authenticateToken, authorizeRoles(APPROVE_ROLES), approveExpense);

export default router;
