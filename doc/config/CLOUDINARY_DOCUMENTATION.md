# 🖼️ POS API - Cloudinary Documentation

## 📋 Table of Contents
- [Cloudinary Overview](#cloudinary-overview)
- [Configuration](#configuration)
- [Usage in Controllers](#usage-in-controllers)
- [Usage in Services/Helpers](#usage-in-serviceshelpers)
- [Security Considerations](#security-considerations)
- [Error Handling](#error-handling)
- [API Examples](#api-examples)

---

## Cloudinary Overview

Cloudinary is a cloud-based service that provides an end-to-end solution for all image and file needs, from upload to storage, administration, manipulation, and delivery. In the POS API, Cloudinary is used for:

- Storing user avatar images.
- Storing product images.
- Storing expense receipt files (images and PDFs).
- Providing optimized and secure delivery of all media assets.

Any module that involves images, files, or attachments must go through Cloudinary — files are never stored locally.

---

## Configuration

Cloudinary is configured in `src/config/cloudinary.ts`. This file initializes the Cloudinary SDK and exports pre-built multer middleware instances and helper functions for use in controllers and routes.

**File: `src/config/cloudinary.ts`**

```typescript
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer, { FileFilterCallback } from "multer";
import type { Request } from "express";
import { errorHandler } from "../middleware/errorHandler";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});

const createStorage = (
  folder: string,
  allowedFormats: string[] = ["jpg", "jpeg", "png", "gif", "webp"]
): CloudinaryStorage => {
  return new CloudinaryStorage({
    cloudinary,
    params: {
      folder,
      allowed_formats: allowedFormats,
      transformation: [
        { width: 1000, height: 1000, crop: "limit" },
        { quality: "auto" },
        { fetch_format: "auto" },
      ],
    } as any,
  });
};

// User avatar — 2 MB, images only
export const uploadUserAvatar = multer({
  storage: createStorage("pos-api/avatars"),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req: Request, file: any, cb: FileFilterCallback) => {
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(null, false);
  },
});

// Product image — 2 MB, images only
export const uploadProductImage = multer({
  storage: createStorage("pos-api/products"),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req: Request, file: any, cb: FileFilterCallback) => {
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(null, false);
  },
});

// Expense receipt — 5 MB, images + PDF
export const uploadExpenseReceipt = multer({
  storage: createStorage("pos-api/expense-receipts", ["jpg", "jpeg", "png", "pdf"]),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: any, cb: FileFilterCallback) => {
    file.mimetype.startsWith("image/") || file.mimetype === "application/pdf"
      ? cb(null, true)
      : cb(null, false);
  },
});

export const uploadToCloudinary = async (
  file: any,
  folder: string = "pos-api/general"
): Promise<{ url: string; public_id: string; format: string; size: number }> => {
  try {
    const uploadOptions = {
      folder,
      resource_type: "auto" as const,
      transformation: [
        { width: 1000, height: 1000, crop: "limit" },
        { quality: "auto" },
        { fetch_format: "auto" },
      ],
    };
    let result;
    if (file.path) {
      result = await cloudinary.uploader.upload(file.path, uploadOptions);
    } else if (file.buffer) {
      result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(uploadOptions, (err, res) => {
          err ? reject(err) : resolve(res);
        });
        stream.end(file.buffer);
      });
    } else if (typeof file === "string") {
      result = await cloudinary.uploader.upload(file, uploadOptions);
    } else {
      throw errorHandler(400, "Invalid file format. Expected file path, buffer, or string.");
    }
    return {
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      size: result.bytes,
    };
  } catch (error: any) {
    throw errorHandler(500, `Upload failed: ${error.message}`);
  }
};

export const deleteFromCloudinary = async (publicId: string): Promise<any> => {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error: any) {
    throw errorHandler(500, `Delete failed: ${error.message}`);
  }
};

export default cloudinary;
```

### Required Environment Variables

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Multer Middleware Summary

| Export | Folder | Size limit | Accepted types |
|---|---|---|---|
| `uploadUserAvatar` | `pos-api/avatars` | 2 MB | Images |
| `uploadProductImage` | `pos-api/products` | 2 MB | Images |
| `uploadExpenseReceipt` | `pos-api/expense-receipts` | 5 MB | Images + PDF |

---

## Usage in Controllers

Multer middleware is applied at the **route level**, not in the controller. The controller then calls `uploadToCloudinary` and `deleteFromCloudinary` using the file attached to `req.file`.

**Example: `productController.ts` — Uploading/Updating a Product Image**

```typescript
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary";

/**
 * Upload product image
 * Purpose: Upload or replace the image for a product
 * Access: Admin/Manager
 * Validation: Product must exist
 * Process: Upload new image to Cloudinary, delete old one if present, save URL and public_id
 * Response: Updated product
 */
export const uploadProductImageController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find product
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return next(errorHandler(404, "Product not found"));
    }

    // Upload new image
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, "pos-api/products");

      // Delete old image if one exists
      if (product.imagePublicId) {
        try {
          await deleteFromCloudinary(product.imagePublicId);
        } catch (deleteError) {
          console.error("Failed to delete previous product image:", deleteError);
        }
      }

      product.image = uploadResult.url;
      product.imagePublicId = uploadResult.public_id;
    }

    await product.save();
    res.status(200).json({
      success: true,
      message: "Product image updated successfully",
      data: { product },
    });
  } catch (error: any) {
    next(error);
  }
};
```

**Route registration (where middleware is applied):**

```typescript
import { uploadProductImage } from "../config/cloudinary";

router.post(
  "/:productId/image",
  authenticateToken,
  authorizeRoles(["admin", "manager"]),
  uploadProductImage.single("image"),
  uploadProductImageController
);
```

---

## Usage in Services/Helpers

Two helper functions exported from `src/config/cloudinary.ts` are used directly in controllers:

### `uploadToCloudinary(file, folder)`

Uploads a file to Cloudinary. Accepts a file path, a buffer, or a base64 string.

```typescript
const result = await uploadToCloudinary(req.file, "pos-api/products");
// result: { url, public_id, format, size }
```

### `deleteFromCloudinary(publicId)`

Deletes an asset from Cloudinary using its `public_id`. Always call this before replacing an existing asset to avoid orphaned files.

```typescript
await deleteFromCloudinary(product.imagePublicId);
```

---

## Security Considerations

- `CLOUDINARY_API_SECRET` must be kept in `.env` and never committed to version control.
- Access control is enforced at the route level via `authenticateToken` and `authorizeRoles` — Cloudinary operations only run for authorized users.
- Always delete the old asset before uploading a replacement to avoid orphaned files in Cloudinary storage.
- Store both the asset `url` and `public_id` on every model that has an uploaded file — the `public_id` is required to delete later.

---

## Error Handling

Both `uploadToCloudinary` and `deleteFromCloudinary` throw errors using `errorHandler`, which are caught by the global error middleware in `src/index.ts`.

```json
{
  "success": false,
  "message": "Upload failed: ..."
}
```

Deletion errors inside controllers are caught locally with `try/catch` and logged — they do not abort the main operation.

---

## API Examples

### Upload Product Image

```bash
curl -X POST http://localhost:3500/api/products/<productId>/image \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: multipart/form-data" \
  -F "image=@/path/to/image.jpg"
```

**Response:**
```json
{
  "success": true,
  "message": "Product image updated successfully",
  "data": {
    "product": {
      "id": "...",
      "name": "Tusker Lager",
      "image": "https://res.cloudinary.com/your_cloud/image/upload/pos-api/products/..."
    }
  }
}
```

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team
