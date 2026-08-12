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
  folder: string = "pos-api/general",
  resourceType: "auto" | "raw" = "auto"
): Promise<{ url: string; public_id: string; format: string; size: number }> => {
  try {
    const uploadOptions =
      resourceType === "raw"
        ? { folder, resource_type: "raw" as const }
        : {
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
