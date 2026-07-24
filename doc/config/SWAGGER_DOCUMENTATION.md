# POS API - Swagger Documentation

## Table of Contents
- [Swagger Overview](#swagger-overview)
- [Implemented Modules (Swagger Documented)](#implemented-modules-swagger-documented)
- [Setup and Configuration](#setup-and-configuration)
- [Documenting Endpoints (JSDoc)](#documenting-endpoints-jsdoc)
- [Viewing the Documentation](#viewing-the-documentation)
- [Swagger UI Features](#swagger-ui-features)
- [Troubleshooting](#troubleshooting)
- [Adding New Modules](#adding-new-modules)

---

## Swagger Overview

This document explains how the POS API uses Swagger (OpenAPI) to automatically generate interactive API documentation. The documentation is generated from JSDoc comments within the route files and a central configuration file.

**Key Benefits:**
- **Interactive UI:** Provides a user-friendly interface to visualize and interact with the API's resources.
- **Auto-generated:** Documentation is kept up-to-date with code changes by parsing JSDoc comments.
- **Testable Endpoints:** Allows direct testing of API endpoints from the browser.
- **Standardized:** Follows the OpenAPI 3.0 specification, making it easily consumable by other tools.

---

## Implemented Modules (Swagger Documented)

Modules and their respective endpoints will be documented here as they are implemented in the codebase. Each module will include a brief overview, base path, and illustrative JSDoc snippets.

*(Currently empty. Modules will be added as implementation progresses.)*

---

## Setup and Configuration

Swagger documentation is configured in `src/config/swagger.ts`. This file defines the basic API information, server details, security schemes, and the paths where Swagger-JSdoc should look for API definitions.

**File: `src/config/swagger.ts`**
```typescript
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "POS API",
      version: "1.0.0",
      description: "POS API server for managing point-of-sale operations",
      contact: { name: "POS API Support", email: "support@pos-api.com" },
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" }
    },
    servers: [
      {
        url:
          process.env.NODE_ENV === "production"
            ? process.env.API_BASE_URL || "https://api.pos-api.com"
            : `http://localhost:${process.env.PORT || 3500}`,
        description:
          process.env.NODE_ENV === "production"
            ? "Production server"
            : "Development server"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Bearer token in the format: Bearer <token>"
        }
      }
    },
    tags: []
  },
  apis: ["./src/routes/*.ts"]
};

const specs = swaggerJsdoc(options);

const swaggerConfig = {
  swaggerUi,
  specs,
  options: {
    explorer: true,
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "POS API Documentation"
  }
};

export default swaggerConfig;
```

The `apis` array is crucial as it tells `swagger-jsdoc` which files to parse for JSDoc comments containing OpenAPI definitions. For this project, all route definitions are expected to be in `src/routes/*.ts`.

---

## Documenting Endpoints (JSDoc)

API endpoints are documented using JSDoc comments directly above their route definitions in the `src/routes` directory. These comments follow the OpenAPI 3.0 specification and are parsed by `swagger-jsdoc` to build the API documentation.

### General Structure

```typescript
/**
 * @swagger
 * /api/your-path:
 *   method:
 *     summary: A short summary of the endpoint's purpose.
 *     tags: [YourTag]
 *     description: |
 *       A more detailed description of the endpoint.
 *       Use markdown for rich text.
 *     security:
 *       - bearerAuth: [] # If authentication is required
 *     parameters: # Path, query, or header parameters
 *       - in: path
 *         name: paramName
 *         schema:
 *           type: string
 *         required: true
 *         description: Description of the path parameter.
 *       - in: query
 *         name: queryParam
 *         schema:
 *           type: integer
 *           format: int64
 *         description: Description of the query parameter.
 *     requestBody: # For POST, PUT, PATCH requests
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               field1:
 *                 type: string
 *                 description: Description of field1.
 *               field2:
 *                 type: integer
 *             example:
 *               field1: "value"
 *               field2: 123
 *     responses:
 *       "200":
 *         description: Success response description.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *             example:
 *               message: "Operation successful"
 *               data: {}
 *       "400":
 *         description: Bad request.
 *       "401":
 *         description: Unauthorized.
 *       "403":
 *         description: Forbidden.
 *       "404":
 *         description: Not Found.
 *       "500":
 *         description: Server error.
 */
router.method("/api/your-path", middleware, controllerFunction);
```

### Key JSDoc Keywords

- `@swagger`: Marks the beginning of a Swagger/OpenAPI definition block.
- `summary`: A brief summary of the operation.
- `tags`: Used to group related operations in the UI. Must correspond to a tag defined in `src/config/swagger.ts`.
- `description`: A more detailed explanation. Can use Markdown.
- `security`: Defines authentication requirements. `bearerAuth: []` refers to the scheme defined in `swagger.ts`.
- `parameters`: Defines path, query, header, or cookie parameters.
  - `in`: Location of the parameter (`path`, `query`, `header`, `cookie`).
  - `name`: Name of the parameter.
  - `schema`: Data type of the parameter.
  - `required`: Boolean indicating if the parameter is mandatory.
- `requestBody`: Describes the payload for requests that send data (POST, PUT, PATCH).
  - `content`: Specifies media types (e.g., `application/json`, `multipart/form-data`).
  - `schema`: Defines the structure of the request body.
  - `example`: An example of the request body.
- `responses`: Describes possible responses for the operation, indexed by HTTP status code.
  - `description`: Explanation of the response.
  - `content`: Specifies media types of the response body.
  - `schema`: Defines the structure of the response body.
  - `example`: An example of the response body.

### Example: Documenting a `POST` Request

Consider a `POST /api/products` route from `src/routes/productRoutes.ts`:

```typescript
/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - category
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock:
 *                 type: integer
 *     responses:
 *       "201":
 *         description: Product created successfully.
 *       "400":
 *         description: Bad request due to invalid input.
 */
router.post("/", authenticateToken, authorizeRoles(["admin"]), createProduct);
```

---

## Viewing the Documentation

To view the generated Swagger documentation:

1. **Ensure the API server is running.**
   ```bash
   npm run dev
   ```
2. **Open your web browser** and navigate to:
   ```
   http://localhost:3500/api/docs
   ```

---

## Swagger UI Features

- **Endpoint List:** All documented API endpoints are listed and grouped by tags.
- **Expand/Collapse:** Click on an endpoint to expand its details, including parameters, request body, and responses.
- **"Try it out" Button:** For each endpoint, you can click "Try it out" to send a request directly from the UI.
  - Fill in the parameters and request body.
  - If a `bearerAuth` security scheme is defined, you can click the "Authorize" button at the top right, enter your JWT token, and it will be included in subsequent requests.
  - Click "Execute" to send the request and see the response directly in the UI.
- **Schemas:** Data models (schemas) are displayed at the bottom of the page, defining the structure of request and response bodies.

---

## Troubleshooting

- **"No operations defined in spec!"**:
  - Ensure your API server is running.
  - Verify that `src/config/swagger.ts`'s `apis` array correctly points to your route files (e.g., `./src/routes/*.ts`).
  - Check that your JSDoc comments are correctly formatted and are placed directly above the `router.method(...)` calls.
  - Make sure `swagger-jsdoc` and `swagger-ui-express` are installed in your `package.json`.
- **Routes not appearing/outdated**:
  - Restart your API server after making changes to JSDoc comments or `swagger.ts`.
  - Clear your browser cache if necessary.
- **Authentication issues ("Unauthorized")**:
  - Ensure you have provided a valid JWT token in the "Authorize" dialog.
  - Verify that your `authenticateToken` middleware is correctly applied to protected routes.

---

## Adding New Modules

When adding a new module with new routes (e.g., `productRoutes.ts` for Product Management), follow these steps to integrate it into the Swagger documentation:

1. **Create the Route File:** Add your new route definitions in `src/routes/yourNewModuleRoutes.ts`.
2. **Update `swagger.ts` (Optional but Recommended):**
   - Add a new tag to the `tags` array in `src/config/swagger.ts` for your new module (e.g., `{ name: "Products", description: "Product management operations" }`).
   - Ensure your route file is covered by the `apis` array (e.g., `./src/routes/*.ts` already covers all `.ts` files in the `routes` directory).
3. **Document Endpoints:** Add detailed JSDoc comments, following the structure outlined above, directly above each route definition in `src/routes/yourNewModuleRoutes.ts`.
4. **Restart Server:** Restart your API server (`npm run dev`) to regenerate the Swagger documentation.
5. **Verify:** Visit `http://localhost:3500/api/docs` to confirm your new module and its endpoints appear correctly.

---

**Last Updated:** July 2026
**Version:** 1.0.0
**Maintainer:** POS API Development Team
