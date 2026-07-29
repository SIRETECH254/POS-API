import { Document, Types } from "mongoose";

// Role
export type UserRole =
  | "bartender"
  | "cashier"
  | "store_keeper"
  | "manager"
  | "admin"
  | "accountant";

export interface IRole extends Document {
  name: UserRole;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// User
export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  pin?: string;
  role: Types.ObjectId | IRole;
  branch?: Types.ObjectId | IBranch;
  status: boolean;
  avatar?: string;
  avatarPublicId?: string;
  lastLoginAt?: Date;
  currentShift?: Types.ObjectId;
  resetPasswordToken?: string;
  resetPasswordExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Location
export interface ILocationRegions {
  country: string;
  locality?: string;
  sublocality?: string;
  sublocality_level_1?: string;
  administrative_area_level_1?: string;
  plus_code?: string;
  political?: string;
}

export interface ILocation extends Document {
  placeId?: string;
  name: string;
  formattedAddress: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  regions: ILocationRegions;
  createdAt: Date;
  updatedAt: Date;
}

// Address
export interface IAddress extends Document {
  userId: Types.ObjectId;
  name: string;
  location: Types.ObjectId | ILocation;
  details?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Branch
export interface IBranch extends Document {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: Types.ObjectId | IAddress;
  isMain: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Category
export interface ICategory extends Document {
  name: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Variant
export interface IOption {
  _id: Types.ObjectId;
  value: string;
  isActive: boolean;
  sortOrder: number;
}

export interface IVariant extends Document {
  name: string;
  options: Types.DocumentArray<IOption & Document>;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// Product
export type ProductStatus = "active" | "inactive" | "discontinued";
export type SkuUnit = "bottle" | "shot" | "pack" | "plate" | "crate" | "unit";

export interface ISKUAttribute {
  variantId: Types.ObjectId;
  optionId: Types.ObjectId;
}

export interface IStockByBranch {
  branch: Types.ObjectId | IBranch;
  currentStock: number;
  minimumStock: number;
}

export interface ISKU extends Document {
  attributes: ISKUAttribute[];
  skuCode: string;
  barcode?: string;
  unit: SkuUnit;
  buyingPrice: number;
  sellingPrice: number;
  supplier?: Types.ObjectId;
  stockByBranch: Types.DocumentArray<IStockByBranch & Document>;
  status: ProductStatus;
  isActive: boolean;
  createdBy: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProduct extends Document {
  name: string;
  category: Types.ObjectId | ICategory;
  variants: Types.ObjectId[] | IVariant[];
  description: string;
  image?: string;
  imagePublicId?: string;
  status: ProductStatus;
  createdBy: Types.ObjectId | IUser;
  skus: Types.DocumentArray<ISKU>;
  createdAt: Date;
  updatedAt: Date;
}

// Shift
export type ShiftStatus = "open" | "closed";

export interface IShift extends Document {
  branch: Types.ObjectId | IBranch;
  shiftNumber: string;
  staff: Types.ObjectId | IUser;
  openingFloat: number;
  closingCash: {
    expected: number;
    actual: number;
    variance: number;
  };
  salesSummary: {
    totalSales: number;
    cashSales: number;
    mpesaSales: number;
    cardSales: number;
    tabsOpened: number;
    tabsCancelled: number;
    discountsGiven: number;
  };
  status: ShiftStatus;
  startedAt: Date;
  endedAt?: Date;
  closedBy?: Types.ObjectId | IUser;
  varianceReviewedBy?: Types.ObjectId | IUser;
  varianceNotes?: string;
  createdAt: Date;
}
