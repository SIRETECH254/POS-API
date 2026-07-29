import express from "express";
import {
  getAllSkus,
  getSkuById,
  createSku,
  updateSku,
  deleteSku,
  getLowStockSkus,
  searchByBarcode,
  setBranchStockLevel,
} from "../controllers/skuController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/skus:
 *   get:
 *     summary: Get all SKUs
 *     tags: [SKUs]
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
 *           enum: [active, inactive, discontinued]
 *     responses:
 *       200:
 *         description: SKUs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", authenticateToken, authorizeRoles(["manager", "admin"]), getAllSkus);

/**
 * @swagger
 * /api/skus/low-stock:
 *   get:
 *     summary: Get low stock SKUs for a branch
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branch
 *         required: true
 *         schema:
 *           type: string
 *         description: Branch ID to check stock against
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
 *         description: Low stock SKUs retrieved successfully
 *       400:
 *         description: Branch ID is required
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/low-stock",
  authenticateToken,
  authorizeRoles(["manager", "admin", "store_keeper"]),
  getLowStockSkus
);

/**
 * @swagger
 * /api/skus/barcode/{code}:
 *   get:
 *     summary: Search SKU by barcode
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Barcode value to search for
 *     responses:
 *       200:
 *         description: SKU found
 *       404:
 *         description: No SKU found with this barcode
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/barcode/:code",
  authenticateToken,
  authorizeRoles(["bartender", "cashier", "manager", "admin"]),
  searchByBarcode
);

/**
 * @swagger
 * /api/skus/{skuId}:
 *   get:
 *     summary: Get SKU by ID
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: skuId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SKU retrieved successfully
 *       404:
 *         description: SKU not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:skuId", authenticateToken, authorizeRoles(["manager", "admin"]), getSkuById);

/**
 * @swagger
 * /api/skus/{productId}:
 *   post:
 *     summary: Create a SKU for a product
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
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
 *               - skuCode
 *               - unit
 *               - buyingPrice
 *               - sellingPrice
 *             properties:
 *               skuCode:
 *                 type: string
 *               barcode:
 *                 type: string
 *               unit:
 *                 type: string
 *                 enum: [bottle, shot, pack, plate, crate, unit]
 *               buyingPrice:
 *                 type: number
 *               sellingPrice:
 *                 type: number
 *               supplier:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive, discontinued]
 *     responses:
 *       201:
 *         description: SKU created successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Product not found
 *       409:
 *         description: SKU code or barcode already exists
 */
router.post("/:productId", authenticateToken, authorizeRoles(["manager", "admin"]), createSku);

/**
 * @swagger
 * /api/skus/{productId}/skus/{skuId}:
 *   put:
 *     summary: Update a SKU
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: skuId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skuCode:
 *                 type: string
 *               barcode:
 *                 type: string
 *               unit:
 *                 type: string
 *                 enum: [bottle, shot, pack, plate, crate, unit]
 *               buyingPrice:
 *                 type: number
 *               sellingPrice:
 *                 type: number
 *               supplier:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive, discontinued]
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: SKU updated successfully
 *       404:
 *         description: SKU not found on this product
 *       409:
 *         description: SKU code or barcode already exists
 */
router.put(
  "/:productId/skus/:skuId",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  updateSku
);

/**
 * @swagger
 * /api/skus/{productId}/skus/{skuId}:
 *   delete:
 *     summary: Delete a SKU
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: skuId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SKU deleted successfully
 *       404:
 *         description: SKU not found on this product
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.delete(
  "/:productId/skus/:skuId",
  authenticateToken,
  authorizeRoles(["admin"]),
  deleteSku
);

/**
 * @swagger
 * /api/skus/{productId}/skus/{skuId}/branch-stock:
 *   patch:
 *     summary: Set or correct branch stock level for a SKU
 *     tags: [SKUs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: skuId
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
 *               - branch
 *               - currentStock
 *               - minimumStock
 *             properties:
 *               branch:
 *                 type: string
 *               currentStock:
 *                 type: number
 *               minimumStock:
 *                 type: number
 *     responses:
 *       200:
 *         description: Branch stock level updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: SKU not found on this product
 */
router.patch(
  "/:productId/skus/:skuId/branch-stock",
  authenticateToken,
  authorizeRoles(["manager", "admin"]),
  setBranchStockLevel
);

export default router;
