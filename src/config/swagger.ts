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
