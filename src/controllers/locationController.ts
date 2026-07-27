import type { Request, Response, NextFunction } from "express";
import { Client } from "@googlemaps/google-maps-services-js";
import { errorHandler } from "../middleware/errorHandler";
import Location from "../models/Location";

const googleMapsClient = new Client({});

/**
 * Search locations
 * Purpose: Proxy Google Maps Text Search API and return place results
 * Access: Public
 * Validation: query parameter must be a non-empty string
 * Process: Call Google Maps textSearch, return results array
 * Response: Array of Google Places results
 */
export const searchLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameter
    const { query } = req.query;

    // Guard — query is required
    if (!query) {
      return next(errorHandler(400, "Query parameter is required"));
    }

    // Guard — query must be a string
    if (typeof query !== "string") {
      return next(errorHandler(400, "Query parameter must be a string"));
    }

    // Call Google Maps Text Search API
    const response = await googleMapsClient.textSearch({
      params: {
        query,
        key: process.env.GOOGLE_PLACE_API as string,
      },
      timeout: 5000,
    });

    // Return results
    res.status(200).json({
      success: true,
      data: {
        results: response.data.results,
      },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Save location
 * Purpose: Persist a selected place to the database for future reference
 * Access: Authenticated
 * Validation: name, formattedAddress, coordinates, regions.country are required
 * Process: Create and save location document
 * Response: Created location
 */
export const saveLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { placeId, name, formattedAddress, coordinates, regions } = req.body;

    // Guard — name required
    if (!name) {
      return next(errorHandler(400, "Name is required"));
    }

    // Guard — formattedAddress required
    if (!formattedAddress) {
      return next(errorHandler(400, "Formatted address is required"));
    }

    // Guard — coordinates required
    if (!coordinates) {
      return next(errorHandler(400, "Coordinates are required"));
    }

    // Guard — coordinates.lat required
    if (coordinates.lat === undefined || coordinates.lat === null) {
      return next(errorHandler(400, "Coordinates lat is required"));
    }

    // Guard — coordinates.lng required
    if (coordinates.lng === undefined || coordinates.lng === null) {
      return next(errorHandler(400, "Coordinates lng is required"));
    }

    // Guard — regions required
    if (!regions) {
      return next(errorHandler(400, "Regions are required"));
    }

    // Guard — regions.country required
    if (!regions.country) {
      return next(errorHandler(400, "Regions country is required"));
    }

    // Create location
    const location = await Location.create({
      placeId,
      name,
      formattedAddress,
      coordinates: {
        lat: parseFloat(coordinates.lat),
        lng: parseFloat(coordinates.lng),
      },
      regions,
    });

    // Return created location
    res.status(201).json({
      success: true,
      message: "Location saved successfully",
      data: { location },
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get location by ID
 * Purpose: Fetch a single saved location record
 * Access: Authenticated
 * Validation: Location must exist
 * Process: Find location by ID and return
 * Response: Location details
 */
export const getLocationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find location by ID
    const location = await Location.findById(req.params.locationId);

    // Guard — location must exist
    if (!location) {
      return next(errorHandler(404, "Location not found"));
    }

    // Return location
    res.status(200).json({
      success: true,
      data: { location },
    });
  } catch (error: any) {
    next(error);
  }
};
