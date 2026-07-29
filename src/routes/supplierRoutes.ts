import express from "express";
import {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierHistory,
} from "../controllers/supplierController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/suppliers:
 *   get:
 *     summary: Get all suppliers
 *     tags: [Suppliers]
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by company name, contact person, phone, or email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch ID
 *     responses:
 *       200:
 *         description: Suppliers retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllSuppliers);

/**
 * @swagger
 * /api/suppliers/{supplierId}:
 *   get:
 *     summary: Get supplier by ID
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Supplier not found
 */
router.get("/:supplierId", authenticateToken, authorizeRoles(["manager", "admin"]), getSupplierById);

/**
 * @swagger
 * /api/suppliers:
 *   post:
 *     summary: Create a new supplier
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - companyName
 *               - contactPerson
 *               - phone
 *             properties:
 *               companyName:
 *                 type: string
 *               contactPerson:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *                 description: Address document ObjectId
 *               branches:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of Branch ObjectIds
 *     responses:
 *       201:
 *         description: Supplier created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Conflict — company name, phone, or email already exists
 */
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createSupplier);

/**
 * @swagger
 * /api/suppliers/{supplierId}:
 *   put:
 *     summary: Update a supplier
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               companyName:
 *                 type: string
 *               contactPerson:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               branches:
 *                 type: array
 *                 items:
 *                   type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Supplier updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Supplier not found
 *       409:
 *         description: Conflict — company name, phone, or email already in use
 */
router.put("/:supplierId", authenticateToken, authorizeRoles(["manager", "admin"]), updateSupplier);

/**
 * @swagger
 * /api/suppliers/{supplierId}:
 *   delete:
 *     summary: Delete a supplier
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Supplier not found
 */
router.delete("/:supplierId", authenticateToken, authorizeRoles(["admin"]), deleteSupplier);

/**
 * @swagger
 * /api/suppliers/{supplierId}/history:
 *   get:
 *     summary: Get supplier purchase history and outstanding balance
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
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
 *     responses:
 *       200:
 *         description: Supplier history retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Supplier not found
 */
router.get("/:supplierId/history", authenticateToken, authorizeRoles(["manager", "admin"]), getSupplierHistory);

export default router;
