# POS API - Error Handling Middleware Documentation

## Table of Contents
- [Error Handling Overview](#error-handling-overview)
- [Implementation Details](#implementation-details)
- [Usage in Controllers and Services](#usage-in-controllers-and-services)
- [Global Error Handling Middleware](#global-error-handling-middleware)
- [Error Response Structure](#error-response-structure)
- [Best Practices](#best-practices)
- [API Examples](#api-examples)

---

## Error Handling Overview

Robust error handling is crucial for any API to provide consistent and informative feedback to clients while preventing unexpected server crashes. In the POS API, a centralized error handling strategy is implemented using a custom error builder function and a global Express error middleware. This approach ensures:

-   **Standardized Error Responses:** All errors return a consistent JSON format.
-   **Categorized Errors:** Errors are assigned appropriate HTTP status codes.
-   **Developer-Friendly Debugging:** Detailed error information (stack traces) is available in development environments but hidden in production for security.

---

## Implementation Details

The core of the custom error handling is the `errorHandler` function defined in `src/middleware/errorHandler.ts`. This function creates and returns a standard JavaScript `Error` object with a `statusCode` property attached, which is later used by the global error handler to set the HTTP response status.

**File: `src/middleware/errorHandler.ts`**

```typescript
export const errorHandler = (statusCode: number, message: string): Error => {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
};
```

---

## Usage in Controllers and Services

Controllers and service functions use the `errorHandler` function to create and propagate errors. In Express routes, these errors are passed to the `next()` function, which forwards them to the global error handling middleware.

**Example: Usage in a `productController.ts`**
When a product is not found in the database:
```typescript
import { errorHandler } from "../middleware/errorHandler";

// Inside a route handler:
const product = await Product.findById(id);
if (!product) {
  return next(errorHandler(404, "Product not found"));
}
```

---

## Global Error Handling Middleware

All errors passed to `next()` in Express routes are caught by the global error handling middleware defined in `src/index.ts`. This middleware is registered after all routes.

**File: `src/index.ts` - Global Error Handler Snippet**

```typescript
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
```

This middleware:
1.  Logs the error stack to the console (`console.error`).
2.  Determines the HTTP `statusCode` from the error object's `statusCode` property (if set), otherwise defaults to `500 Internal Server Error`.
3.  Extracts the `message` from the error object, or defaults to "Internal Server Error".
4.  Sends a JSON response with `success: false` and the error `message`.
5.  In `development` mode (`process.env.NODE_ENV === "development"`), it additionally includes the full `error` message and `stack` trace for easier debugging.

---

## Error Response Structure

All error responses from the API adhere to the following JSON structure:

```json
{
  "success": false,
  "message": "A human-readable error message",
  "error": "Detailed error message (only in development)",
  "stack": "Stack trace (only in development)"
}
```

---

## Best Practices

-   Always use `return next(errorHandler(statusCode, message));` in controllers to forward errors, ensuring the global handler catches them.
-   In service functions, `throw errorHandler(statusCode, message);` can be used, but ensure these are caught by `try-catch` blocks in the calling controller and passed to `next()`.
-   Avoid sending sensitive information in error messages, especially in production. The global error handler already strips stack traces in production.

---

## API Examples

**Example: Product Not Found**

Request (e.g., to `GET /api/products/:id` with a non-existent ID):
```bash
curl -X GET http://localhost:3500/api/products/000000000000000000000000 \
  -H "Authorization: Bearer <token>"
```

Response (HTTP Status: `404 Not Found`):
```json
{
  "success": false,
  "message": "Product not found"
}
```
*(In development, this response would also include `error` and `stack` fields.)*

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
