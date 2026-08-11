import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import swaggerConfig from "./config/swagger";
import authRoutes from "./routes/authRoutes";
import roleRoutes from "./routes/roleRoutes";
import locationRoutes from "./routes/locationRoutes";
import addressRoutes from "./routes/addressRoutes";
import branchRoutes from "./routes/branchRoutes";
import userRoutes from "./routes/userRoutes";
import shiftRoutes from "./routes/shiftRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import variantRoutes from "./routes/variantRoutes";
import productRoutes from "./routes/productRoutes";
import skuRoutes from "./routes/skuRoutes";
import supplierRoutes from "./routes/supplierRoutes";
import stockMovementRoutes from "./routes/stockMovementRoutes";
import purchaseRoutes from "./routes/purchaseRoutes";
import stockAdjustmentRoutes from "./routes/stockAdjustmentRoutes";
import stockCountRoutes from "./routes/stockCountRoutes";
import transferRoutes from "./routes/transferRoutes";

const app = express();
const PORT = process.env.PORT || 3500;

// CORS Configuration with explicit origins
const allowedOrigins: string[] = [
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:8083",
  "http://localhost:8084",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:3500",
  "https://pos-api-9cb5.onrender.com"
];

if (process.env.CALLBACK_URL) {
  allowedOrigins.push(process.env.CALLBACK_URL);
}

app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
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

app.options(/.*/, cors() as any); // Enable pre-flight across all routes

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// DB CONNECTION
mongoose
  .connect(process.env.MONGO_URI as string)
  .then(() => console.log("DB CONNECTED"))
  .catch((err: Error) => console.log("DB Connection Error:", err.message));

// Static file serving for uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

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

// CORS debug endpoint
app.get("/api/debug/cors", (req, res) => {
  res.json({
    allowedOrigins,
    requestOrigin: req.get("origin") || "No origin header",
    corsEnabled: true,
    environmentVariable: process.env.CORS_ORIGIN ? "Set" : "Not Set",
    timestamp: new Date().toISOString()
  });
});

// Swagger Documentation
app.use(
  "/api/docs",
  swaggerConfig.swaggerUi.serve,
  swaggerConfig.swaggerUi.setup(swaggerConfig.specs, swaggerConfig.options)
);

// Route registrations
app.use("/api/auth", authRoutes);

app.use("/api/roles", roleRoutes);

app.use("/api/locations", locationRoutes);

app.use("/api/addresses", addressRoutes);

app.use("/api/branches", branchRoutes);

app.use("/api/users", userRoutes);

app.use("/api/shifts", shiftRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/variants", variantRoutes);

app.use("/api/products", productRoutes);

app.use("/api/skus", skuRoutes);

app.use("/api/suppliers", supplierRoutes);

app.use("/api/stock-movements", stockMovementRoutes);

app.use("/api/purchases", purchaseRoutes);

app.use("/api/stock-adjustments", stockAdjustmentRoutes);

app.use("/api/stock-counts", stockCountRoutes);

app.use("/api/transfers", transferRoutes);

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

// Socket.io setup for real-time features
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

const socketConnections = new Map<string, string>();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("authenticate", (userId: string) => {
    socketConnections.set(userId, socket.id);
    socket.join(`user_${userId}`);
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  socket.on("disconnect", () => {
    for (const [key, value] of socketConnections.entries()) {
      if (value === socket.id) {
        socketConnections.delete(key);
        break;
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

app.set("io", io);
app.set("socketConnections", socketConnections);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl
  });
});

// Global error handler
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

// Start server
server.listen(PORT, () => {
  console.log(`POS API Server running on http://localhost:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`CORS Origins: ${allowedOrigins.join(", ")}`);
  console.log("Socket.io enabled for real-time features");
});

export default app;
