# POS API - `src/index.ts` Documentation

## Table of Contents
- [Overview](#overview)
- [Core Dependencies and Imports](#core-dependencies-and-imports)
- [Application Setup (Express & Core Middleware)](#application-setup-express--core-middleware)
  - [CORS Configuration](#cors-configuration)
  - [Body Parsing](#body-parsing)
- [Database Connection](#database-connection)
- [Static File Serving](#static-file-serving)
- [Health Checks & Debug Endpoints](#health-checks--debug-endpoints)
- [Swagger Documentation Setup](#swagger-documentation-setup)
- [Route Registrations](#route-registrations)
- [Real-time Features (Socket.io)](#real-time-features-socketio)
- [Global Error Handling](#global-error-handling)
- [Server Start-up](#server-start-up)
- [Key Environment Variables](#key-environment-variables)

---

## Overview

`src/index.ts` is the main entry point for the POS API application. It is responsible for setting up the Express server, configuring middleware, establishing the database connection, registering all API routes, initializing real-time communication (Socket.io), and starting the server. This file essentially orchestrates all the different components of the backend.

---

## Core Dependencies and Imports

The file begins by importing essential modules from various parts of the project, laying the foundation for the application's functionality.

```typescript
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import "dotenv/config"; // Loads environment variables
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import swaggerConfig from "./config/swagger.js";
```

---

## Application Setup (Express & Core Middleware)

The Express application is initialized, and core middleware are configured to handle cross-origin requests, parse request bodies, and manage basic server settings.

```typescript
const app = express();
const PORT = process.env.PORT || 3500;
```

### CORS Configuration

CORS (Cross-Origin Resource Sharing) is configured to allow requests only from a predefined list of origins, enhancing security by preventing unauthorized domains from accessing the API.

```typescript
const allowedOrigins: string[] = [
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:8083",
  "http://localhost:8084",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:3500",
  "https://pos-api.onrender.com"
];

// Add CALLBACK_URL if it exists
if (process.env.CALLBACK_URL) {
  allowedOrigins.push(process.env.CALLBACK_URL);
}

// CORS middleware configuration
app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors()); // Enable pre-flight across all routes
```

### Body Parsing

Middleware to parse incoming request bodies into a usable format (JSON and URL-encoded).

```typescript
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
```

---

## Database Connection

The application connects to a MongoDB database using Mongoose. The connection URI is fetched from environment variables.

```typescript
// DB CONNECTION
mongoose
  .connect(process.env.MONGO_URI as string)
  .then(() => console.log("DB CONNECTED"))
  .catch((err: Error) => console.log("DB Connection Error:", err.message));
```

---

## Static File Serving

Configures Express to serve static files from the `uploads` directory under the `/uploads` URL path.

```typescript
// Static file serving for uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
```

---

## Health Checks & Debug Endpoints

Two utility endpoints are provided for monitoring and troubleshooting:

- `/api/health`: A simple endpoint to check if the API server is operational.
- `/api/debug/cors`: An endpoint to inspect CORS configuration and incoming request origins, useful for debugging CORS-related issues.

```typescript
// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "OK",
    message: "POS API Server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0"
  });
});

// CORS debug endpoint (helpful for troubleshooting)
app.get("/api/debug/cors", (req, res) => {
  res.json({
    allowedOrigins,
    requestOrigin: req.get("origin") || "No origin header",
    corsEnabled: true,
    environmentVariable: process.env.CORS_ORIGIN ? "Set" : "Not Set",
    timestamp: new Date().toISOString()
  });
});
```

---

## Swagger Documentation Setup

Integrates Swagger UI to serve interactive API documentation, accessible at `/api/docs`.

```typescript
// Swagger Documentation
app.use(
  "/api/docs",
  swaggerConfig.swaggerUi.serve,
  swaggerConfig.swaggerUi.setup(swaggerConfig.specs, swaggerConfig.options)
);
```

---

## Route Registrations

All modular API routes (defined in `src/routes/*.ts` files) are registered with the Express application under their respective base paths.

*(Currently empty. Routes will be registered here as modules are implemented.)*

```typescript
// Example: app.use("/api/auth", authRoutes);
```

---

## Main API Endpoint

A welcome endpoint is provided at the root API path to provide basic information about the API.

```typescript
// Main API endpoint
app.get("/api", (_req, res) => {
  res.json({
    message: "Welcome to POS API",
    version: "1.0.0",
    documentation: "/api/docs",
    endpoints: {
      health: "/api/health"
    }
  });
});
```

---

## Real-time Features (Socket.io)

Socket.io is integrated to enable real-time, bidirectional communication between clients and the server.

```typescript
// Socket.io setup for real-time features
// Create HTTP server that wraps the Express app
const server = createServer(app);

// Attach Socket.io to the HTTP server
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

// Store socket connections
const socketConnections = new Map<string, string>();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Listen for user authentication to map socket to user
  socket.on("authenticate", (userId: string) => {
    socketConnections.set(userId, socket.id);
    socket.join(`user_${userId}`);
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  socket.on("disconnect", () => {
    // Remove from connections
    for (const [key, value] of socketConnections.entries()) {
      if (value === socket.id) {
        socketConnections.delete(key);
        break;
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

app.set("io", io); // Make Socket.io instance accessible via app.get('io')
app.set("socketConnections", socketConnections); // Store active socket connections
```

---

## Global Error Handling

A comprehensive global error handling middleware is implemented to catch and process any errors that occur during request processing.

```typescript
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl
  });
});

// Global error handler (catches errors passed via next(err))
app.use(
  (
    err: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err.stack);

    const statusCode = err.statusCode ?? 500;
    const message = err.message || "Internal Server Error";

    res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === "development" && {
        error: err.message,
        stack: err.stack
      })
    });
  }
);
```

---

## Server Start-up

The HTTP server (which wraps the Express app) is started on the configured port.

```typescript
// Start server
server.listen(PORT, () => {
  console.log(`POS API Server running on http://localhost:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`CORS Origins: ${allowedOrigins.join(", ")}`);
  console.log("Socket.io enabled for real-time features");
});
```

---

## Key Environment Variables

`src/index.ts` relies on several environment variables for its operation:

- `PORT`: The port number on which the server will listen (defaults to 3500).
- `MONGO_URI`: The connection string for the MongoDB database.
- `NODE_ENV`: The current environment (e.g., `development`, `production`); affects error logging.
- `CALLBACK_URL`: (Optional) Additional origin allowed for CORS.
- `API_BASE_URL`: (Optional) Base URL used in Swagger server definition for production.

---

**Last Updated:** July 2026
**Version:** 1.0.0
**Maintainer:** POS API Development Team
