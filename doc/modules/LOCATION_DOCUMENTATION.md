# 🗂️ POS API - Location Management Documentation

## 📋 Table of Contents
- [Location Management Overview](#location-management-overview)
- [Location Model](#-location-model)
- [Location Controller](#-location-controller)
- [Location Routes](#-location-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Location Management Overview

Location Management allows the system to search for places using the Google Maps Text Search API and persist selected locations to the database. Saved locations are referenced by the Address module, keeping geographic data (coordinates, regions) in one place and allowing it to be reused across multiple addresses.

---

## 👤 Location Model

### Schema Definition
```typescript
interface ILocationRegions {
  country: string;
  locality?: string;
  sublocality?: string;
  sublocality_level_1?: string;
  administrative_area_level_1?: string;
  plus_code?: string;
  political?: string;
}

interface ILocation extends Document {
  placeId?: string;
  name: string;
  formattedAddress: string;
  coordinates: { lat: number; lng: number };
  regions: ILocationRegions;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Location.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { ILocation } from "../type";

const locationSchema = new Schema<ILocation>(
  {
    placeId: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    formattedAddress: {
      type: String,
      required: true,
      trim: true,
    },
    coordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    regions: {
      country: { type: String, required: true, trim: true },
      locality: { type: String, trim: true },
      sublocality: { type: String, trim: true },
      sublocality_level_1: { type: String, trim: true },
      administrative_area_level_1: { type: String, trim: true },
      plus_code: { type: String, trim: true },
      political: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

const Location = mongoose.model<ILocation>("Location", locationSchema);
export default Location;
```

### Validation Rules
```typescript
name:             { required: true, trim: true }
formattedAddress: { required: true, trim: true }
coordinates.lat:  { required: true }
coordinates.lng:  { required: true }
regions.country:  { required: true }
```

---

## 🎮 Location Controller

**File:** `src/controllers/locationController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { Client } from "@googlemaps/google-maps-services-js";
import { errorHandler } from "../middleware/errorHandler";
import Location from "../models/Location";
```

### Functions Overview

#### `searchLocation()`
**Purpose:** Proxy Google Maps Text Search API and return place results  
**Access:** Public  
**Validation:** `query` parameter must be a non-empty string  
**Process:**
1. Extract `query` from request query parameters.
2. Call Google Maps `textSearch` using `GOOGLE_PLACE_API` from environment variables.
3. Return results array.

**Controller Implementation:**
```typescript
const googleMapsClient = new Client({});

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
```

#### `saveLocation()`
**Purpose:** Persist a selected place to the database for future reference  
**Access:** Authenticated  
**Validation:** `name`, `formattedAddress`, `coordinates`, `regions.country` are required  
**Process:**
1. Extract fields from request body.
2. Validate each required field independently.
3. Create and save location document.
4. Return created location.

**Controller Implementation:**
```typescript
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
```

#### `getLocationById()`
**Purpose:** Fetch a single saved location record  
**Access:** Authenticated  
**Validation:** Location must exist  
**Process:** Find location by ID and return.

**Controller Implementation:**
```typescript
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
```

---

## 🛣️ Location Routes

### Base Path: `/api/locations`

```typescript
GET    /search              // Search Google Maps (public)
POST   /                    // Save a location (authenticated)
GET    /:locationId         // Get location by ID (authenticated)
```

### Router Implementation

**File: `src/routes/locationRoutes.ts`**

```typescript
import express from "express";
import {
  searchLocation,
  saveLocation,
  getLocationById,
} from "../controllers/locationController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

router.get("/search", searchLocation);
router.post("/", authenticateToken, saveLocation);
router.get("/:locationId", authenticateToken, getLocationById);

export default router;
```

### Route Details

#### `GET /api/locations/search`
**Query Parameters:** `query` (required)  
**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "name": "Nairobi",
        "formatted_address": "Nairobi, Kenya",
        "geometry": {
          "location": { "lat": -1.2920659, "lng": 36.8219462 }
        },
        "place_id": "ChIJ77p_JpE_LxARtIuN-k9sR5I",
        "types": ["locality", "political"]
      }
    ]
  }
}
```

#### `POST /api/locations`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`  
**Body:**
```json
{
  "placeId": "ChIJ77p_JpE_LxARtIuN-k9sR5I",
  "name": "Nairobi",
  "formattedAddress": "Nairobi, Kenya",
  "coordinates": { "lat": -1.2920659, "lng": 36.8219462 },
  "regions": {
    "country": "Kenya",
    "locality": "Nairobi",
    "political": "political"
  }
}
```
**Response:**
```json
{
  "success": true,
  "message": "Location saved successfully",
  "data": {
    "location": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "placeId": "ChIJ77p_JpE_LxARtIuN-k9sR5I",
      "name": "Nairobi",
      "formattedAddress": "Nairobi, Kenya",
      "coordinates": { "lat": -1.2920659, "lng": 36.8219462 },
      "regions": { "country": "Kenya", "locality": "Nairobi" },
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  }
}
```

#### `GET /api/locations/:locationId`
**Headers:** `Authorization: Bearer <token>`  
**Response:**
```json
{
  "success": true,
  "data": {
    "location": {
      "_id": "6638b2c3d4e5f6g7h8i9j0k1",
      "name": "Nairobi",
      "formattedAddress": "Nairobi, Kenya",
      "coordinates": { "lat": -1.2920659, "lng": 36.8219462 },
      "regions": { "country": "Kenya" }
    }
  }
}
```

---

## 🔐 Middleware

#### Public Access
`GET /search` requires no authentication — allows location searching during registration or address creation.

#### `authenticateToken`
**Purpose:** Verify JWT token and load user  
**Usage:** Applied to `POST /` and `GET /:locationId`

---

## 📝 API Examples

### Search Location
```bash
curl -X GET "http://localhost:3500/api/locations/search?query=Nairobi"
```

### Save Location
```bash
curl -X POST http://localhost:3500/api/locations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "placeId": "ChIJ77p_JpE_LxARtIuN-k9sR5I",
    "name": "Nairobi",
    "formattedAddress": "Nairobi, Kenya",
    "coordinates": { "lat": -1.2920659, "lng": 36.8219462 },
    "regions": { "country": "Kenya", "locality": "Nairobi" }
  }'
```

### Get Location by ID
```bash
curl -X GET http://localhost:3500/api/locations/6638b2c3d4e5f6g7h8i9j0k1 \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **Environment Protection:** `GOOGLE_PLACE_API` key is never exposed to the client; stored in environment variables.
- **Query Validation:** Search queries are validated to ensure they are present and are strings.
- **Authentication:** Save and fetch endpoints require a valid JWT token.

---

## 🚨 Error Handling

Common responses:
```json
{ "success": false, "message": "Query parameter is required" }
{ "success": false, "message": "Query parameter must be a string" }
{ "success": false, "message": "Name is required" }
{ "success": false, "message": "Formatted address is required" }
{ "success": false, "message": "Coordinates are required" }
{ "success": false, "message": "Coordinates lat is required" }
{ "success": false, "message": "Coordinates lng is required" }
{ "success": false, "message": "Regions are required" }
{ "success": false, "message": "Regions country is required" }
{ "success": false, "message": "Location not found" }
```

---

## 📊 Database Indexes

```typescript
locationSchema.index({ placeId: 1 });
locationSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });
locationSchema.index({ "regions.country": 1 });
locationSchema.index({ name: "text", formattedAddress: "text" });
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
