import express from "express";
import {
  searchLocation,
  saveLocation,
  getLocationById,
} from "../controllers/locationController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/locations/search:
 *   get:
 *     summary: Search locations via Google Maps Text Search
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string }
 *         description: Text query to search for places
 *     responses:
 *       200:
 *         description: Location results retrieved successfully
 *       400:
 *         description: Query parameter is required or invalid
 *       500:
 *         description: Failed to fetch location data
 */
router.get("/search", searchLocation);

/**
 * @swagger
 * /api/locations:
 *   post:
 *     summary: Save a selected location to the database
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, formattedAddress, coordinates, regions]
 *             properties:
 *               placeId:
 *                 type: string
 *               name:
 *                 type: string
 *               formattedAddress:
 *                 type: string
 *               coordinates:
 *                 type: object
 *                 required: [lat, lng]
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               regions:
 *                 type: object
 *                 required: [country]
 *                 properties:
 *                   country: { type: string }
 *                   locality: { type: string }
 *                   sublocality: { type: string }
 *                   sublocality_level_1: { type: string }
 *                   administrative_area_level_1: { type: string }
 *                   plus_code: { type: string }
 *                   political: { type: string }
 *     responses:
 *       201:
 *         description: Location saved successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", authenticateToken, saveLocation);

/**
 * @swagger
 * /api/locations/{locationId}:
 *   get:
 *     summary: Get a saved location by ID
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *         description: Location document ID
 *     responses:
 *       200:
 *         description: Location retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Location not found
 */
router.get("/:locationId", authenticateToken, getLocationById);

export default router;
