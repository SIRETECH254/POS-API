import express from "express";
import {
  getAllVariants,
  getVariantById,
  createVariant,
  updateVariant,
  deleteVariant,
  addOption,
  updateOption,
  removeOption,
} from "../controllers/variantController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/variants:
 *   get:
 *     summary: Get all variants
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *         description: Results per page (default 10)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by variant name
 *     responses:
 *       200:
 *         description: Variants retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllVariants);

/**
 * @swagger
 * /api/variants/{variantId}:
 *   get:
 *     summary: Get variant by ID
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *     responses:
 *       200:
 *         description: Variant retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Variant not found
 */
router.get("/:variantId", authenticateToken, authorizeRoles(["manager", "admin"]), getVariantById);

/**
 * @swagger
 * /api/variants:
 *   post:
 *     summary: Create a new variant
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Size
 *               sortOrder:
 *                 type: integer
 *                 example: 0
 *               options:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     value:
 *                       type: string
 *                       example: 250ml
 *                     sortOrder:
 *                       type: integer
 *                       example: 0
 *     responses:
 *       201:
 *         description: Variant created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Variant name already exists
 */
router.post("/", authenticateToken, authorizeRoles(["manager", "admin"]), createVariant);

/**
 * @swagger
 * /api/variants/{variantId}:
 *   put:
 *     summary: Update variant name or sortOrder
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Variant updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Variant not found
 *       409:
 *         description: Variant name already exists
 */
router.put("/:variantId", authenticateToken, authorizeRoles(["manager", "admin"]), updateVariant);

/**
 * @swagger
 * /api/variants/{variantId}:
 *   delete:
 *     summary: Delete a variant and all its options
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *     responses:
 *       200:
 *         description: Variant deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Variant not found
 */
router.delete("/:variantId", authenticateToken, authorizeRoles(["admin"]), deleteVariant);

/**
 * @swagger
 * /api/variants/{variantId}/options:
 *   post:
 *     summary: Add a new option to a variant
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 type: string
 *                 example: 1L
 *               sortOrder:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: Option added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Variant not found
 *       409:
 *         description: Option value already exists on this variant
 */
router.post("/:variantId/options", authenticateToken, authorizeRoles(["manager", "admin"]), addOption);

/**
 * @swagger
 * /api/variants/{variantId}/options/{optionId}:
 *   put:
 *     summary: Update an option on a variant
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *       - in: path
 *         name: optionId
 *         required: true
 *         schema: { type: string }
 *         description: Option subdocument ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Option updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Variant or option not found
 *       409:
 *         description: Option value already exists on this variant
 */
router.put("/:variantId/options/:optionId", authenticateToken, authorizeRoles(["manager", "admin"]), updateOption);

/**
 * @swagger
 * /api/variants/{variantId}/options/{optionId}:
 *   delete:
 *     summary: Remove an option from a variant
 *     tags: [Variants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: variantId
 *         required: true
 *         schema: { type: string }
 *         description: Variant document ID
 *       - in: path
 *         name: optionId
 *         required: true
 *         schema: { type: string }
 *         description: Option subdocument ID
 *     responses:
 *       200:
 *         description: Option removed successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Variant or option not found
 */
router.delete("/:variantId/options/:optionId", authenticateToken, authorizeRoles(["admin"]), removeOption);

export default router;
