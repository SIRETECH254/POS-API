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

// Supplier
export interface ISupplier extends Document {
  companyName: string;
  contactPerson: string;
  phone: string;
  email?: string;
  address?: Types.ObjectId | IAddress;
  skusSupplied: Types.ObjectId[];
  branches: Types.ObjectId[];
  outstandingBalance: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// StockMovement
export type StockMovementType =
  | "purchased"
  | "sold"
  | "adjusted"
  | "returned"
  | "damaged"
  | "transferred_out"
  | "transferred_in";

export type StockMovementRefType = "Purchase" | "Tab" | "StockAdjustment" | "Transfer";

export interface IStockMovementReference {
  refType?: StockMovementRefType;
  refId?: Types.ObjectId;
}

export interface IStockMovement extends Document {
  branch: Types.ObjectId | IBranch;
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  reference?: IStockMovementReference;
  reason?: string;
  performedBy: Types.ObjectId | IUser;
  createdAt: Date;
}

// Purchase
export type PurchaseStatus = "ordered" | "received" | "cancelled";
export type PurchasePaymentStatus = "unpaid" | "partial" | "paid";

export interface IPurchaseItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantity: number;
  purchasePrice: number;
  subtotal: number;
}

export interface IPurchase extends Document {
  purchaseNumber: string;
  branch: Types.ObjectId | IBranch;
  supplier: Types.ObjectId | ISupplier;
  items: IPurchaseItem[];
  totalAmount: number;
  amountPaid: number;
  paymentStatus: PurchasePaymentStatus;
  status: PurchaseStatus;
  createdBy: Types.ObjectId | IUser;
  receivedBy?: Types.ObjectId | IUser;
  receivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// StockAdjustment
export type StockAdjustmentReason = "breakage" | "theft" | "expired" | "count_correction" | "other";

export interface IStockAdjustment extends Document {
  branch: Types.ObjectId | IBranch;
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantityChange: number;
  reason: StockAdjustmentReason;
  notes?: string;
  adjustedBy: Types.ObjectId | IUser;
  approvedBy?: Types.ObjectId | IUser;
  appliedAt?: Date;
  stockCount?: Types.ObjectId | IStockCount;
  createdAt: Date;
}

// StockCount
export type StockCountStatus = "in_progress" | "completed" | "reconciled";

export interface IStockCountItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  expectedQuantity: number;
  actualQuantity: number;
  variance: number;
}

export interface IStockCount extends Document {
  branch: Types.ObjectId | IBranch;
  countNumber: string;
  items: IStockCountItem[];
  status: StockCountStatus;
  countedBy: Types.ObjectId | IUser;
  reviewedBy?: Types.ObjectId | IUser;
  createdAt: Date;
  completedAt?: Date;
}

// Transfer
export type TransferStatus = "pending" | "in_transit" | "received" | "cancelled";

export interface ITransferItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  quantity: number;
}

export interface ITransfer extends Document {
  transferNumber: string;
  fromBranch: Types.ObjectId | IBranch;
  toBranch: Types.ObjectId | IBranch;
  items: ITransferItem[];
  status: TransferStatus;
  createdBy: Types.ObjectId | IUser;
  sentBy?: Types.ObjectId | IUser;
  receivedBy?: Types.ObjectId | IUser;
  createdAt: Date;
  receivedAt?: Date;
}

// Tab
export type TabStatus =
  | "draft"
  | "open"
  | "held"
  | "awaiting_payment"
  | "paid"
  | "completed"
  | "cancelled"
  | "archived";

export type TabItemStatus = "active" | "cancelled";

export interface ITabItem {
  product: Types.ObjectId | IProduct;
  sku: Types.ObjectId;
  name: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  subtotal: number;
  status: TabItemStatus;
  addedBy: Types.ObjectId | IUser;
  addedAt: Date;
}

export interface ITab extends Document {
  tabNumber: string;
  branch: Types.ObjectId | IBranch;
  table?: string;
  openedBy: Types.ObjectId | IUser;
  shift: Types.ObjectId | IShift;
  items: Types.DocumentArray<ITabItem & Document>;
  mergedFrom: Types.ObjectId[];
  splitInto: Types.ObjectId[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  status: TabStatus;
  holdReason?: string | undefined;
  cancelReason?: string;
  closedBy?: Types.ObjectId | IUser;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
