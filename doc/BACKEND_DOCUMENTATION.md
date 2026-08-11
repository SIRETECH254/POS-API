# 🍾 Club POS API — Backend Documentation

This documents the backend implementation for the Club POS, built around the **Sale Tab lifecycle** as the central entity, with **multi-branch support as a core capability from day one**.

## 📋 Table of Contents
- [Technology Stack](#technology-stack)
- [Required Packages](#required-packages)
- [Database Models](#database-models)
- [Controllers](#controllers)
- [Routes](#routes)
- [Architecture Overview](#architecture-overview)
- [Sale Tab Lifecycle](#sale-tab-lifecycle)
- [Real-time Events (Socket.io)](#real-time-events-socketio)
- [API Response Format](#api-response-format)

---

## 🛠️ Technology Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** MongoDB (Mongoose ODM)
- **Real-time:** Socket.io (open tabs, low stock alerts, shift dashboards, live payment confirmation) — scoped per branch
- **Auth:** JWT (access + refresh tokens), optional PIN login for fast bartender re-auth

---

## 📦 Required Packages

### Core Dependencies
```json
{
  "express": "^4.21.2",
  "mongoose": "^8.18.3",
  "mongoose-paginate-v2": "^1.9.1",
  "dotenv": "^17.2.3",
  "cors": "^2.8.5",
  "bcryptjs": "^3.0.2",
  "jsonwebtoken": "^9.0.2",
  "joi": "^18.0.1",
  "socket.io": "^4.8.1",
  "axios": "^1.12.2",
  "pdfkit": "^0.17.2",
  "stream-buffers": "^3.0.3",
  "multer": "^2.0.2",
  "cloudinary": "^1.41.3",
  "multer-storage-cloudinary": "^4.0.0",
  "nodemailer": "^7.0.6",
  "africastalking": "^0.7.7",
  "node-thermal-printer": "^4.4.4",
  "escpos": "^3.0.0-alpha.6",
  "escpos-usb": "^3.0.0-alpha.4",
  "swagger-jsdoc": "^6.2.8",
  "swagger-ui-express": "^5.0.1",
  "validator": "^13.15.15",
  "node-cron": "^3.0.3",
  "dayjs": "^1.11.13"
}
```

**Notes on the club-specific additions:**
- `node-thermal-printer` / `escpos` / `escpos-usb` — receipt printing to a physical thermal printer at the bar. Optional if you're only doing PDF/email receipts initially.
- `node-cron` — scheduled jobs: daily summary notifications, auto-flagging overdue shifts, low-stock sweeps (run per branch).
- `dayjs` — shift/report date range handling (today, weekly, monthly, yearly).

### Dev Dependencies
```json
{
  "typescript": "^5.9.2",
  "tsx": "^4.20.5",
  "nodemon": "^3.1.10",
  "@types/express": "^5.0.3",
  "@types/node": "^24.5.2",
  "@types/cors": "^2.8.19",
  "@types/bcryptjs": "^2.4.6",
  "@types/jsonwebtoken": "^9.0.10",
  "@types/multer": "^2.0.0",
  "@types/nodemailer": "^7.0.2",
  "@types/pdfkit": "^0.17.3",
  "@types/stream-buffers": "^3.0.8",
  "@types/swagger-jsdoc": "^6.0.4",
  "@types/swagger-ui-express": "^4.1.8",
  "@types/validator": "^13.15.15",
  "@types/node-cron": "^3.0.11"
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 🗄️ Database Models

### 1. User Model (Staff)
```typescript
interface IUser {
  _id: ObjectId;
  firstName: string;
  lastName: string;
  email: string; // unique, optional for bartenders using PIN only
  phone: string; // unique, used for shift login / PIN recovery
  password: string; // select: false, hashed
  pin: string; // select: false, hashed 4-6 digit PIN for fast login
  role: ObjectId; // ref: Role
  branch: ObjectId; // ref: Branch — the staff member's home branch
  status: boolean; // true = active, false = suspended/disabled
  avatar: string;
  lastLoginAt: Date;
  currentShift: ObjectId; // ref: Shift, null when not clocked in
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- Supports two login modes: `email/phone + password` (full login) and `PIN` (fast shift login).
- `currentShift` lets the app quickly resolve "who's logged in right now" for the Manager Dashboard.
- `status` replaces the old `employmentStatus` enum + separate `isActive` flag — a single boolean now controls whether the account can log in at all. `administrator`/`super_admin`-level roles are the only ones who can flip this.
- Administrators managing multiple branches can be granted access to more than one branch — see `UserBranchAccess` note under the Branch model if you want that later; for now `branch` is a single home branch per staff member, which matches "one bartender works one bar."

---

### 2. Role Model
```typescript
interface IRole {
  _id: ObjectId;
  name: 'administrator' | 'manager' | 'bartender' | 'cashier' | 'store_keeper' | 'accountant';
  displayName: string;
  permissions: string[]; // e.g. ['sell', 'view_products', 'edit_prices', 'delete_sales', 'manage_inventory']
  isSystemRole: boolean; // true for the 6 default roles, cannot be deleted
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** seeded on first run — Administrator gets `['*']` and implicit access across all branches, Manager gets everything except a few destructive/system actions within their own branch, Bartender gets sell + view, Store Keeper gets inventory only, Cashier is a restricted bartender variant (payments only, no menu editing), Accountant is read-only on financials.

---

### 3. Branch Model
```typescript
interface IBranch {
  _id: ObjectId;
  name: string;
  code: string; // short unique code, e.g. 'MAIN', 'WESTLANDS' — used as a prefix in document numbers
  address: string;
  phone: string;
  isMainBranch: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- Multi-branch is a first-class, present-day concern, not a future extension. Every transactional model below (`Tab`, `Shift`, `Purchase`, `Expense`, `StockMovement`, etc.) carries a `branch` reference so data, reports, and dashboards can always be scoped correctly.
- `code` feeds into document numbering so tabs/receipts/shifts are traceable to a branch at a glance, e.g. `MAIN-TAB-000001`.
- Product **catalog** (`Product`, `SKU`, `Category`) is shared across branches by default; **stock levels** are tracked per branch (see the `SKU` model below).

---

### 4. Category Model
```typescript
interface ICategory {
  _id: ObjectId;
  name: string; // Beer, Wine, Whisky, Vodka, Soft Drinks, Cocktails, Food...
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** shared across all branches — a category is a catalog concept, not a per-branch one.

---

### 5. Variant Model
```typescript
interface IOption {
  value: string;       // e.g. "250ml", "750ml", "1L", "Lime", "Original"
  isActive: boolean;
  sortOrder: number;
}

interface IVariant {
  _id: ObjectId;
  name: string;        // e.g. "Size", "Flavour", "Strength"
  options: IOption[];
  sortOrder: number;   // controls display order across all variants
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- Shared across all branches — a variant is a catalog concept, not a per-branch one. A "Size" variant (250ml / 750ml / 1L) can be attached to any SKU that comes in multiple sizes regardless of which branch stocks it.
- Options are embedded sub-documents. Each option can be individually deactivated (e.g. 250ml discontinued) without deleting the variant or touching other options.
- `sortOrder` on both the variant and each option controls display ordering in menus and dropdowns — lower values appear first.
- A SKU that has no variants (e.g. a single-size product) simply has no variant references; variants are optional at the SKU level.

---

### 6. Product Model
```typescript
interface IProduct {
  _id: ObjectId;
  name: string;
  category: ObjectId; // ref: Category
  variants: ObjectId[]; // ref: Variant
  description: string;
  image: string;
  status: 'active' | 'inactive' | 'discontinued';
  createdBy: ObjectId; // ref: User
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- `Product` is now the shared catalog entry only (name, category, image, description). All pricing, stock, barcode, and unit information moved to its own **SKU** model below, because the same product can have more than one sellable unit (e.g. Tusker sold as a single bottle vs. a crate) each with its own barcode, price, and stock level.

---

### 7. SKU Model
```typescript
interface ISku {
  _id: ObjectId;
  product: ObjectId; // ref: Product
  skuCode: string; // unique, e.g. TUSK-BTL, TUSK-CRATE
  barcode: string; // unique, sparse
  unit: 'bottle' | 'shot' | 'pack' | 'plate' | 'crate' | 'unit';
  buyingPrice: number;
  sellingPrice: number;
  supplier: ObjectId; // ref: Supplier, default/primary supplier for this SKU
  stockByBranch: Array<{
    branch: ObjectId; // ref: Branch
    currentStock: number; // denormalized, kept in sync via StockMovement
    minimumStock: number; // triggers low-stock alert for this branch
  }>;
  status: 'active' | 'inactive' | 'discontinued';
  createdBy: ObjectId; // ref: User
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- This is the entity the Sales, Inventory, and Purchases modules actually transact against — a `Tab` line item, a `StockMovement`, and a `Purchase` line item all reference a `SKU`, not a `Product` directly.
- `stockByBranch` is what makes multi-branch work at the catalog level: one SKU definition (price, barcode, unit) shared everywhere, but stock counted separately per branch. `currentStock` for a given branch is only ever changed through the Inventory module's stock-movement logic — never edited directly — so every change is auditable.
- `searchByBarcode` and low-stock checks operate on `SKU`, scoped to the requesting user's branch.

---

### 8. Supplier Model
```typescript
interface ISupplier {
  _id: ObjectId;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address?: ObjectId; // ref: Address — supplier physical address (optional)
  skusSupplied: ObjectId[]; // ref: SKU
  branches: ObjectId[]; // ref: Branch — which branches this supplier delivers to
  outstandingBalance: number; // recalculated from unpaid Purchases
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

---

### 9. Tab Model (Sale Tab — the core entity)
```typescript
interface ITab {
  _id: ObjectId;
  tabNumber: string; // auto-generated, branch-prefixed, e.g. MAIN-TAB-000001
  branch: ObjectId; // ref: Branch
  table: string; // optional, free-text seating/table reference
  openedBy: ObjectId; // ref: User (bartender)
  shift: ObjectId; // ref: Shift
  items: Array<{
    sku: ObjectId; // ref: SKU
    name: string; // snapshot at time of adding (price history integrity)
    unitPrice: number; // snapshot
    quantity: number;
    discount: number; // amount, per line
    subtotal: number; // quantity * unitPrice - discount
    status: 'active' | 'cancelled';
    addedBy: ObjectId; // ref: User
    addedAt: Date;
  }>;
  mergedFrom: ObjectId[]; // ref: Tab, tab IDs merged into this one
  splitInto: ObjectId[]; // ref: Tab, resulting tabs when this one was split
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  amountPaid: number; // running total across Payment records
  balanceDue: number;
  status: 'draft' | 'open' | 'held' | 'awaiting_payment' | 'paid' | 'completed' | 'cancelled' | 'archived';
  holdReason: string;
  cancelReason: string;
  closedBy: ObjectId; // ref: User
  closedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- Follows the agreed **Sale Tab lifecycle** (see [dedicated section](#sale-tab-lifecycle) below).
- No `Customer` reference — walk-in-only, as agreed. If you bring back loyalty/VIP tracking later, the field can be re-added without disrupting the rest of the model.
- Item price/name are snapshotted at add-time so a later price change doesn't rewrite history.
- Totals are recalculated in a pre-save hook whenever `items` changes.
- `mergedFrom` / `splitInto` preserve full traceability for Merge Tabs and Split Bill. A merge/split can only happen between tabs on the **same branch**.

---

### 10. Payment Model
```typescript
interface IPayment {
  _id: ObjectId;
  paymentNumber: string; // auto-generated, branch-prefixed, PAY-YYYY-0001
  tab: ObjectId; // ref: Tab
  branch: ObjectId; // ref: Branch
  shift: ObjectId; // ref: Shift
  method: 'cash' | 'mpesa' | 'card';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  cashReceived: number; // cash method only
  cashChange: number; // cash method only
  mpesa: {
    phone: string;
    checkoutRequestId: string;
    merchantRequestId: string;
    mpesaReceiptNumber: string;
    resultCode: number;
    resultDesc: string;
  };
  card: {
    terminalRef: string;
    last4: string;
    authCode: string;
  };
  reversedBy: ObjectId; // ref: User, manager only
  reversedReason: string;
  processedBy: ObjectId; // ref: User
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:**
- A single Tab can have **multiple Payment records** (Mixed Payment) — e.g. one `cash` + one `mpesa` record summing to the grand total.
- M-Pesa payments are created as `pending` on STK push, then flipped to `completed`/`failed` by the Daraja callback.
- Reversal is restricted to `manager`/`administrator` roles for that branch and is logged to Audit Logs.

---

### 11. Purchase Model (Goods Received)
```typescript
interface IPurchase {
  _id: ObjectId;
  purchaseNumber: string; // auto-generated, branch-prefixed, PO-YYYY-0001
  branch: ObjectId; // ref: Branch — receiving branch
  supplier: ObjectId; // ref: Supplier
  items: Array<{
    sku: ObjectId; // ref: SKU
    quantity: number;
    purchasePrice: number;
    subtotal: number;
  }>;
  totalAmount: number;
  amountPaid: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  status: 'ordered' | 'received' | 'cancelled';
  receivedBy: ObjectId; // ref: User
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** on `status: 'received'`, a `StockMovement` of type `purchased` is created per item and `SKU.stockByBranch[branch].currentStock` is incremented for the receiving branch — this is the only path stock enters the system. Tracking the supplier's actual invoice document (amount owed, due date, payment state, attached scan) and recording supplier payments against it are deferred to a future standalone Invoice module — not part of Purchase for now.

---

### 12. StockMovement Model (Immutable Ledger)
```typescript
interface IStockMovement {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  sku: ObjectId; // ref: SKU
  type: 'purchased' | 'sold' | 'adjusted' | 'returned' | 'damaged' | 'transferred_out' | 'transferred_in';
  quantity: number; // positive or negative depending on type
  balanceAfter: number; // stock snapshot for this branch after this movement
  reference: {
    refType: 'Purchase' | 'Tab' | 'StockAdjustment' | 'Transfer';
    refId: ObjectId;
  };
  reason: string;
  performedBy: ObjectId; // ref: User
  createdAt: Date;
}
```
**Notes:** every single unit change — a sale, a purchase, a breakage, a stock-take correction, a branch transfer — writes one of these, scoped to a branch. It is the audit trail behind `SKU.stockByBranch` and behind the Inventory Reports. Records are never edited or deleted.

---

### 13. StockAdjustment Model
```typescript
interface IStockAdjustment {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  sku: ObjectId; // ref: SKU
  quantityChange: number; // negative for breakages/loss, positive for corrections
  reason: 'breakage' | 'theft' | 'expired' | 'count_correction' | 'other';
  notes: string;
  adjustedBy: ObjectId; // ref: User
  approvedBy: ObjectId; // ref: User, manager approval for negative adjustments
  createdAt: Date;
}
```

---

### 14. StockCount Model (Monthly Stock-Take)
```typescript
interface IStockCount {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  countNumber: string; // branch-prefixed, SC-YYYY-0001
  items: Array<{
    sku: ObjectId; // ref: SKU
    expectedQuantity: number; // system stock at time of count, for this branch
    actualQuantity: number; // physically counted
    variance: number; // actual - expected
  }>;
  status: 'in_progress' | 'completed' | 'reconciled';
  countedBy: ObjectId; // ref: User
  reviewedBy: ObjectId; // ref: User (manager)
  createdAt: Date;
  completedAt: Date;
}
```
**Notes:** on `reconciled`, each variance line generates a `StockAdjustment` + `StockMovement` so the ledger stays the single source of truth.

---

### 15. Transfer Model (Branch-to-Branch Stock Transfer)
```typescript
interface ITransfer {
  _id: ObjectId;
  transferNumber: string; // TRF-YYYY-0001
  fromBranch: ObjectId; // ref: Branch
  toBranch: ObjectId; // ref: Branch
  items: Array<{ sku: ObjectId; quantity: number }>;
  status: 'pending' | 'in_transit' | 'received' | 'cancelled';
  sentBy: ObjectId; // ref: User
  receivedBy: ObjectId; // ref: User
  createdAt: Date;
  receivedAt: Date;
}
```
**Notes:** this is a fully active module now, not a placeholder. `sentBy` writes a `transferred_out` `StockMovement` against `fromBranch`; `receivedBy` writes a `transferred_in` `StockMovement` against `toBranch`, and both decrement/increment the respective `SKU.stockByBranch` entries.

---

### 16. Expense Model
```typescript
interface IExpense {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  category: 'rent' | 'electricity' | 'water' | 'dj' | 'security' | 'cleaning' | 'fuel' | 'repairs' | 'marketing' | 'other';
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'mpesa' | 'bank';
  receiptUrl: string; // Cloudinary, optional scanned receipt
  approvedBy: ObjectId; // ref: User, manager+
  recordedBy: ObjectId; // ref: User
  expenseDate: Date;
  createdAt: Date;
}
```
**Notes:** feeds directly into Profit Reports (`Net Profit = Revenue − Cost of Goods − Expenses`), reportable per branch or consolidated across branches.

---

### 17. Shift Model
```typescript
interface IShift {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  shiftNumber: string; // branch-prefixed, SHIFT-YYYY-0001
  staff: ObjectId; // ref: User
  openingFloat: number;
  closingCash: {
    expected: number; // openingFloat + cash sales - cash payouts
    actual: number; // physically counted at close
    variance: number; // actual - expected
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
  status: 'open' | 'closed';
  startedAt: Date;
  endedAt: Date;
  closedBy: ObjectId; // ref: User, self or manager
  varianceReviewedBy: ObjectId; // ref: User, manager — required when |variance| > threshold
  varianceNotes: string;
  createdAt: Date;
}
```
**Notes:** a bartender cannot open a Tab without an `open` Shift **at their branch** (enforced by `requireActiveShift` middleware). Closing a shift is what triggers the expected-vs-actual cash reconciliation.

---

### 18. AuditLog Model
```typescript
interface IAuditLog {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  user: ObjectId; // ref: User
  action: string; // e.g. 'PRICE_CHANGE', 'TAB_CANCELLED', 'PAYMENT_REVERSED', 'STOCK_ADJUSTED'
  entityType: string; // 'SKU', 'Tab', 'Payment', ...
  entityId: ObjectId;
  before: Record<string, any>; // relevant snapshot before the change
  after: Record<string, any>; // relevant snapshot after the change
  ipAddress: string;
  createdAt: Date;
}
```
**Notes:** written automatically by a mongoose post-hook / service wrapper on sensitive writes (price edits, cancellations, reversals, role changes, discounts). Never editable or deletable, even by administrators.

---

### 19. Notification Model
```typescript
interface INotification {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch, for branch-broadcast notifications
  recipient: ObjectId; // ref: User, or null for role/branch broadcast
  recipientRole: string; // alternative: broadcast to a role within a branch, e.g. 'manager'
  type: 'low_stock' | 'shift_started' | 'shift_closed' | 'mpesa_failed' | 'payment_success' | 'daily_summary';
  title: string;
  message: string;
  metadata: Record<string, any>;
  isRead: boolean;
  readAt: Date;
  createdAt: Date;
}
```
**Notes:** delivered in-app via Socket.io in real time (to a `branch:<branchId>` room), and mirrored here for the notification bell / history.

---

### 20. Receipt Model
```typescript
interface IReceipt {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch
  tab: ObjectId; // ref: Tab
  receiptNumber: string;
  type: 'sale' | 'refund' | 'reprint';
  pdfUrl: string; // Cloudinary
  printedAt: Date;
  printedBy: ObjectId; // ref: User
  createdAt: Date;
}
```

---

### 21. Settings Model (one document per branch)
```typescript
interface ISettings {
  _id: ObjectId;
  branch: ObjectId; // ref: Branch — settings are per-branch (printer, receipt layout, tax may differ by location)
  businessName: string; // can be shared/overridden per branch
  address: string;
  phone: string;
  taxRate: number; // percentage, applied at Tab close
  currency: string; // default 'KES'
  receiptFooterNote: string;
  paymentMethodsEnabled: Array<'cash' | 'mpesa' | 'card'>;
  printerConfig: { type: 'usb' | 'network'; target: string };
  lowStockThresholdDefault: number;
  theme: Record<string, any>;
  updatedBy: ObjectId;
  updatedAt: Date;
}
```
**Notes:** each `Branch` gets its own `Settings` document created at branch setup time, so a second location can run a different tax rate, printer, or receipt footer without touching the first.

---

### 22. Location Model
```typescript
interface ILocation {
  _id: ObjectId;
  placeId?: string;         // Google Places ID, optional (for dedup in future iterations)
  name: string;             // place name, e.g. "Nairobi"
  formattedAddress: string; // full formatted address from Google Places
  coordinates: { lat: number; lng: number };
  regions: {
    country: string;
    locality?: string;
    sublocality?: string;
    sublocality_level_1?: string;
    administrative_area_level_1?: string;
    plus_code?: string;
    political?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** Stores geographic data returned by Google Maps Text Search. Referenced by Address documents. The `GOOGLE_PLACE_API` env var is used (not `GOOGLE_PLACES_API_KEY`). See `doc/modules/LOCATION_DOCUMENTATION.md`.

---

### 23. Address Model
```typescript
interface IAddress {
  _id: ObjectId;
  userId: ObjectId;         // ref: User — owner of this address
  name: string;             // label, e.g. "Home", "Office"
  location: ObjectId;       // ref: Location — holds all geographic data
  details?: string;         // optional notes, e.g. "Near gate B"
  isDefault: boolean;       // only one default per user (enforced via pre-save hook)
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** Users can maintain multiple saved addresses. The `location` field is an ObjectId reference to the Location model — all coordinates and region data live on the Location document. The pre-save hook automatically unsets `isDefault` on all other addresses for the same user when a new default is set. See `doc/modules/ADDRESS_DOCUMENTATION.md`.

---

### 24. Branch Model *(implemented)*
```typescript
interface IBranch {
  _id: ObjectId;
  name: string;             // unique
  code?: string;            // short identifier, e.g. "MAIN", "WBR"
  phone?: string;
  email?: string;
  address?: ObjectId;       // ref: Address — branch physical address
  isMain: boolean;          // headquarters; cannot be deleted
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** The `address` field is an ObjectId ref to an Address document (which in turn references a Location). Run `npm run seed:branch` to create the "Main Branch" record. The main branch is protected from deletion at the controller level. See `doc/modules/BRANCH_DOCUMENTATION.md`.

---

### 26. Purchase Model *(implemented)*
```typescript
interface IPurchase {
  _id: ObjectId;
  purchaseNumber: string;   // auto-generated, branch-prefixed, e.g. "MAIN-PO-2026-0001"
  branch: ObjectId;         // ref: Branch — receiving branch
  supplier: ObjectId;       // ref: Supplier
  items: Array<{
    product: ObjectId;      // ref: Product
    sku: ObjectId;          // embedded SKU subdocument id on Product.skus — no separate Sku collection
    quantity: number;
    purchasePrice: number;
    subtotal: number;       // quantity * purchasePrice
  }>;
  totalAmount: number;
  amountPaid: number;       // present on the model but not yet written to by any endpoint
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  status: 'ordered' | 'received' | 'cancelled';
  createdBy: ObjectId;      // ref: User
  receivedBy?: ObjectId;    // ref: User
  receivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```
**Notes:** No `invoiceRef` field and no `recordSupplierPayment()` in this pass — both were deliberately deferred to a future standalone Invoice module rather than being bolted onto Purchase. `receiveGoods()` writes one `StockMovement` (`type: 'purchased'`) per item via the shared `stockMovementService.recordStockMovement()`, which requires each item's branch/SKU `stockByBranch` entry to already exist (via `SKU.setBranchStockLevel`) — it will reject goods receipt for an uninitialized pairing rather than silently creating one. See `doc/modules/PURCHASE_DOCUMENTATION.md`.

---

### 27. StockAdjustment Model *(implemented)*
```typescript
interface IStockAdjustment {
  _id: ObjectId;
  branch: ObjectId;         // ref: Branch
  product: ObjectId;        // ref: Product
  sku: ObjectId;             // embedded SKU subdocument id on Product.skus — no separate Sku collection
  quantityChange: number;   // signed — negative for breakage/theft/loss, positive for corrections
  reason: 'breakage' | 'theft' | 'expired' | 'count_correction' | 'other';
  notes?: string;            // required by the controller when reason is 'other'
  adjustedBy: ObjectId;      // ref: User
  approvedBy?: ObjectId;     // ref: User — set only for negative adjustments, at approval time
  appliedAt?: Date;          // set when the stock movement is actually written
  stockCount?: ObjectId;     // ref: StockCount — set when auto-generated during reconciliation
  createdAt: Date;
}
```
**Notes:** `product`, `appliedAt`, and `stockCount` are additions beyond the original target design (see `doc/modules/inventory/STOCKADJUSTMENT_DOCUMENTATION.md` for why). Positive `quantityChange` applies immediately via `stockMovementService.recordStockMovement()`; negative `quantityChange` is created pending and requires `approveStockAdjustment()` by a manager/admin.

---

### 28. StockCount Model *(implemented)*
```typescript
interface IStockCount {
  _id: ObjectId;
  branch: ObjectId;          // ref: Branch
  countNumber: string;       // branch-prefixed, e.g. "MAIN-SC-2026-0001"
  items: Array<{
    product: ObjectId;       // ref: Product
    sku: ObjectId;            // embedded SKU subdocument id
    expectedQuantity: number; // snapshotted system stock at start time
    actualQuantity: number;   // physically counted, set on submit
    variance: number;         // actual - expected
  }>;
  status: 'in_progress' | 'completed' | 'reconciled';
  countedBy: ObjectId;        // ref: User
  reviewedBy?: ObjectId;      // ref: User — set on reconcile
  createdAt: Date;
  completedAt?: Date;
}
```
**Notes:** `startStockCount()` snapshots `expectedQuantity`; `submitStockCount()` records `actualQuantity`/`variance`, no stock touched; `reconcileStockCount()` (manager/admin only) generates a pre-approved `StockAdjustment` + `StockMovement` per non-zero variance line. See `doc/modules/inventory/STOCKCOUNT_DOCUMENTATION.md`.

---

### 29. Transfer Model *(implemented)*
```typescript
interface ITransfer {
  _id: ObjectId;
  transferNumber: string;    // branch-prefixed, e.g. "MAIN-TRF-2026-0001"
  fromBranch: ObjectId;      // ref: Branch
  toBranch: ObjectId;        // ref: Branch
  items: Array<{
    product: ObjectId;       // ref: Product
    sku: ObjectId;            // embedded SKU subdocument id
    quantity: number;
  }>;
  status: 'pending' | 'in_transit' | 'received' | 'cancelled';
  createdBy: ObjectId;        // ref: User — addition beyond the original target design
  sentBy?: ObjectId;          // ref: User — set on dispatch
  receivedBy?: ObjectId;      // ref: User — set on receive
  createdAt: Date;
  receivedAt?: Date;
}
```
**Notes:** `dispatchTransfer()` writes a `transferred_out` `StockMovement` against `fromBranch`; `receiveTransfer()` writes a `transferred_in` `StockMovement` against `toBranch` — both via `stockMovementService.recordStockMovement()`. No `cancelTransfer()` endpoint exists yet, so `'cancelled'` isn't currently reachable. See `doc/modules/inventory/TRANSFER_DOCUMENTATION.md`.

---

## 🎮 Controllers

### 1. Auth Controller — `authController.ts`
- `login()` — email/phone + password
- `pinLogin()` — fast PIN login for shift start (scoped to the PIN owner's branch)
- `logout()`
- `forgotPassword()`
- `resetPassword()`
- `refreshToken()`
- `getMe()`

### 2. User Controller — `userController.ts`
- `createStaff()`
- `getAllStaff()`
- `getStaff()`
- `updateStaff()`
- `setUserStatus()` — toggle the boolean `status`
- `getProfile()`
- `updateProfile()`
- `changePassword()`
- `setPin()`

### 3. Role Controller — `roleController.ts`
- `createRole()`
- `getAllRoles()`
- `updateRole()`
- `deleteRole()` — blocked for system roles
- `getUsersByRole()`

### 4. Branch Controller — `branchController.ts`
- `createBranch()`
- `getAllBranches()`
- `getBranch()`
- `updateBranch()`
- `deactivateBranch()`
- `getBranchSummary()` — quick stats card (staff count, open tabs, today's revenue) for the branch switcher UI

### 5. Dashboard Controller — `dashboardController.ts`
- `getBartenderDashboard()` — open tabs, today's sales, low stock, pending M-Pesa (all scoped to the bartender's branch)
- `getManagerDashboard()` — revenue, profit, stock value, best sellers, open tabs, staff online, for the manager's branch (or a consolidated view across branches for admins)

### 6. Category Controller — `categoryController.ts`
- `createCategory()`
- `getAllCategories()`
- `getCategoryById()`
- `updateCategory()`
- `deleteCategory()`

### 7. Variant Controller — `variantController.ts`
- `createVariant()` — create a new variant with an initial set of options
- `getAllVariants()` — paginated list, filterable by search
- `getVariantById()` — fetch a single variant with all its options
- `updateVariant()` — update variant name or sortOrder
- `deleteVariant()` — remove variant entirely
- `addOption()` — append a new option to an existing variant
- `updateOption()` — update an option's value, sortOrder, or isActive
- `removeOption()` — delete a single option from a variant

### 8. Product Controller — `productController.ts`
- `createProduct()`
- `getAllProducts()`
- `getProduct()`
- `updateProduct()`
- `deleteProduct()`
- `uploadProductImage()`

### 9. SKU Controller — `skuController.ts`
- `createSku()`
- `getAllSkus()`
- `getSku()`
- `updateSku()`
- `deleteSku()`
- `getLowStockSkus()` — scoped to the requesting branch
- `searchByBarcode()` — scoped to the requesting branch
- `setBranchStockLevel()` — admin/manager utility to initialize or correct `stockByBranch` for a new branch/SKU pairing

### 10. Tab Controller — `tabController.ts`
- `createTab()` — opens a new tab at the bartender's branch, requires active shift
- `addItem()`
- `updateItemQuantity()`
- `removeItem()`
- `cancelItem()`
- `holdTab()`
- `resumeTab()`
- `mergeTabs()` — restricted to tabs on the same branch
- `splitBill()` — restricted to tabs on the same branch
- `cancelTab()`
- `closeTab()` — moves tab to `awaiting_payment`
- `getOpenTabs()`
- `getTab()`
- `getTabHistory()`

### 11. Payment Controller — `paymentController.ts`
- `payCash()` — receive amount, calculate change, open cash drawer signal
- `initiateMpesaPayment()` — STK Push
- `mpesaCallback()` — Daraja webhook, confirms/fails payment, auto-completes Tab when `amountPaid >= grandTotal`
- `retryMpesaPayment()`
- `reverseMpesaPayment()` — manager only
- `payCard()` — terminal integration or manual entry
- `recordMixedPayment()` — multiple payment lines against one tab
- `getPayment()`
- `getTabPayments()`

### 12. Supplier Controller — `supplierController.ts`
- `createSupplier()`
- `getAllSuppliers()`
- `getSupplier()`
- `updateSupplier()`
- `deleteSupplier()`
- `getSupplierHistory()` — invoices, purchases, outstanding balance

### 13. Purchase Controller — `purchaseController.ts`
- `createPurchaseOrder()`
- `receiveGoods()` — updates branch stock + supplier ledger
- `getAllPurchases()`
- `getPurchase()`
- `recordSupplierPayment()` — deferred alongside the future Invoice module; not built yet

### 14. Inventory Controller — `inventoryController.ts`
- `getStockMovements()` — filterable ledger view, scoped to branch
- `createStockAdjustment()`
- `approveStockAdjustment()`
- `startStockCount()`
- `submitStockCount()`
- `reconcileStockCount()`
- `createTransfer()` — between branches
- `dispatchTransfer()`
- `receiveTransfer()`

> **Implementation note:** this bundled controller was not built as-is. It was implemented as **four separate modules** instead, matching the rest of this codebase's one-model-per-file convention: `getStockMovements()` lives in its own `StockMovement` module (`stockMovementController.ts`, see `doc/modules/STOCKMOVEMENT_DOCUMENTATION.md`), and the remaining functions were split into `stockAdjustmentController.ts`, `stockCountController.ts`, and `transferController.ts` — see `doc/modules/inventory/`.

### 15. Expense Controller — `expenseController.ts`
- `createExpense()`
- `getAllExpenses()`
- `getExpense()`
- `updateExpense()`
- `deleteExpense()`
- `approveExpense()`

### 16. Shift Controller — `shiftController.ts`
- `startShift()` — records opening float, at the staff member's branch
- `endShift()` — computes expected vs actual cash, flags variance
- `getActiveShifts()`
- `getShiftHistory()`
- `getShift()`
- `reviewVariance()` — manager investigates and closes out a variance

### 17. Report Controller — `reportController.ts`
- `getSalesReport(range)`
- `getProductReport()` — best sellers / slow movers / never sold
- `getPaymentReport()`
- `getInventoryReport()`
- `getProfitReport()`
- `getEmployeeReport()` — sales per bartender, cancelled tabs, discounts, shift reports
- `getSupplierReport()`
- All accept an optional `branch` filter; admins can request a consolidated multi-branch view

### 18. Analytics Controller — `analyticsController.ts`
- `getSalesTrend()`
- `getProfitTrend()`
- `getPeakHours()`
- `getTopProducts()`
- `getPaymentDistribution()`
- `getInventoryValueTrend()`
- `getBranchComparison()` — side-by-side branch performance, admin only

### 19. Receipt Controller — `receiptController.ts`
- `generateReceipt()`
- `printReceipt()`
- `reprintReceipt()`
- `generateRefundReceipt()`
- `emailReceipt()` — digital receipt, future

### 20. Notification Controller — `notificationController.ts`
- `getMyNotifications()`
- `getUnreadCount()`
- `markAsRead()`
- `markAllAsRead()`
- `sendLowStockAlert()` — cron-triggered, per branch
- `sendDailySummary()` — cron-triggered, per branch

### 21. Audit Controller — `auditController.ts`
- `getAuditLogs()` — filterable by branch/user/entity/date, admin & manager only
- `getEntityHistory(entityType, entityId)`

### 22. Settings Controller — `settingsController.ts`
- `getSettings(branchId)`
- `updateSettings(branchId)`
- `updatePrinterConfig()`
- `updateReceiptLayout()`

### 23. Location Controller — `locationController.ts` *(implemented)*
- `searchLocation()` — proxy Google Maps Text Search (public)
- `saveLocation()` — persist a selected place to the database (authenticated)
- `getLocationById()` — fetch a saved location by ID (authenticated)

### 24. Address Controller — `addressController.ts` *(implemented)*
- `getUserAddresses()` — list authenticated user's addresses with pagination
- `getAddressById()` — fetch a single address (scoped to owner)
- `createAddress()` — create address linked to a Location document via `locationId`
- `updateAddress()` — partial update; accepts new `locationId`
- `deleteAddress()` — delete address (scoped to owner)
- `setDefaultAddress()` — mark address as default; pre-save hook unsets previous default

### 25. Branch Controller — `branchController.ts` *(implemented)*
- `getAllBranches()` — paginated, filterable list; main branch sorted first
- `getBranchById()` — fetch branch with populated address and location
- `createBranch()` — admin only; unique name guard; accepts `addressId`
- `updateBranch()` — admin only; unique name guard on change; verifies `addressId` if provided
- `deleteBranch()` — admin only; blocked when `isMain: true`

### 26. Purchase Controller — `purchaseController.ts` *(implemented)*
- `createPurchaseOrder()` — store_keeper/manager/admin; validates branch/supplier/items, resolves each item's product+SKU, computes subtotals/total, generates `purchaseNumber`
- `receiveGoods()` — store_keeper/manager/admin; guards `status === 'ordered'`; writes one `StockMovement` per item via `stockMovementService.recordStockMovement()`; marks `status: 'received'`
- `getAllPurchases()` — store_keeper/manager/admin/accountant; filterable by branch/supplier/status/search, paginated
- `getPurchaseById()` — store_keeper/manager/admin/accountant; populates branch, supplier, receivedBy, createdBy, and item products

### 27. StockAdjustment Controller — `stockAdjustmentController.ts` *(implemented)*
- `createStockAdjustment()` — store_keeper/manager/admin; positive `quantityChange` applies immediately, negative stays pending
- `approveStockAdjustment()` — manager/admin only; applies a pending negative adjustment
- `getAllStockAdjustments()` — store_keeper/manager/admin/accountant; filterable by branch/sku/reason/pending, paginated
- `getStockAdjustmentById()` — same access

### 28. StockCount Controller — `stockCountController.ts` *(implemented)*
- `startStockCount()` — store_keeper/manager/admin; snapshots `expectedQuantity` per item, generates `countNumber`
- `submitStockCount()` — store_keeper/manager/admin; records `actualQuantity`/`variance`, requires full item coverage
- `reconcileStockCount()` — manager/admin only; generates pre-approved `StockAdjustment` + `StockMovement` per non-zero variance
- `getAllStockCounts()` / `getStockCountById()` — store_keeper/manager/admin/accountant

### 29. Transfer Controller — `transferController.ts` *(implemented)*
- `createTransfer()` — store_keeper/manager/admin; validates both branches differ and exist, and each item's product+SKU
- `dispatchTransfer()` — store_keeper/manager/admin; writes `transferred_out` movement per item, marks `in_transit`
- `receiveTransfer()` — store_keeper/manager/admin; writes `transferred_in` movement per item, marks `received`
- `getAllTransfers()` / `getTransferById()` — store_keeper/manager/admin/accountant

---

## 🛣️ Routes

### Auth Routes
**Base:** `/api/auth`
```
POST   /login
POST   /pin-login
POST   /logout
POST   /forgot-password
POST   /reset-password/:token
POST   /refresh-token
GET    /me
```

### User (Staff) Routes
**Base:** `/api/users`
```
GET    /profile
PUT    /profile
PUT    /change-password
PUT    /set-pin
POST   /                          // create staff (manager/admin)
GET    /                          // list staff, scoped to branch (manager/admin)
GET    /:userId
PUT    /:userId
PATCH  /:userId/status            // toggle boolean status
```

### Role Routes
**Base:** `/api/roles`
```
POST   /                          // admin only
GET    /
GET    /:roleId
PUT    /:roleId                   // admin only
DELETE /:roleId                   // admin only, blocked for system roles
GET    /:roleId/users
```

### Branch Routes
**Base:** `/api/branches`
```
POST   /                          // admin only
GET    /
GET    /:branchId
PUT    /:branchId                 // admin only
PATCH  /:branchId/deactivate      // admin only
GET    /:branchId/summary
```

### Dashboard Routes
**Base:** `/api/dashboard`
```
GET    /bartender
GET    /manager
```

### Category Routes
**Base:** `/api/categories`
```
POST   /                          // manager/admin
GET    /
GET    /:categoryId
PUT    /:categoryId
DELETE /:categoryId
```

### Variant Routes
**Base:** `/api/variants`
```
POST   /                                         // manager/admin
GET    /
GET    /:variantId
PUT    /:variantId                               // manager/admin
DELETE /:variantId                               // admin only
POST   /:variantId/options                       // add option (manager/admin)
PUT    /:variantId/options/:optionId             // update option (manager/admin)
DELETE /:variantId/options/:optionId             // remove option (admin only)
```

### Product Routes
**Base:** `/api/products`
```
POST   /                          // manager/admin
GET    /
GET    /:productId
PUT    /:productId
DELETE /:productId                // admin only
POST   /:productId/image
```

### SKU Routes
**Base:** `/api/skus`
```
POST   /                          // manager/admin
GET    /                          // filterable by product, branch stock
GET    /low-stock                 // scoped to requesting branch
GET    /barcode/:code             // scoped to requesting branch
GET    /:skuId
PUT    /:skuId
DELETE /:skuId                    // admin only
PATCH  /:skuId/branch-stock       // set/correct stockByBranch entry
```

### Tab Routes (Sales)
**Base:** `/api/tabs`
```
POST   /                          // create tab (requires active shift, uses staff's branch)
GET    /open                      // open tabs for requesting branch
GET    /:tabId
POST   /:tabId/items               // add item
PATCH  /:tabId/items/:itemId       // update quantity
DELETE /:tabId/items/:itemId       // remove item
PATCH  /:tabId/items/:itemId/cancel
PATCH  /:tabId/hold
PATCH  /:tabId/resume
POST   /merge                      // { tabIds: [...] } — same branch only
POST   /:tabId/split                // { groups: [[itemIds], [itemIds]] }
PATCH  /:tabId/cancel
PATCH  /:tabId/close                // -> awaiting_payment
GET    /                           // history, filterable, scoped to branch
```

### Payment Routes
**Base:** `/api/payments`
```
POST   /cash                       // { tabId, amountReceived }
POST   /card                       // { tabId, amount, terminalRef? }
POST   /mixed                      // { tabId, lines: [{method, amount}] }
POST   /mpesa/initiate              // { tabId, phone, amount } -> STK push
POST   /mpesa/callback              // Daraja webhook, public
POST   /mpesa/:paymentId/retry
PATCH  /:paymentId/reverse          // manager only
GET    /tab/:tabId
GET    /:paymentId
GET    /mpesa-status/:checkoutRequestId
```

### Supplier Routes
**Base:** `/api/suppliers`
```
POST   /
GET    /
GET    /:supplierId
PUT    /:supplierId
DELETE /:supplierId
GET    /:supplierId/history
```

### Purchase Routes
**Base:** `/api/purchases`
```
POST   /                            // create purchase order for a branch
GET    /                            // scoped to branch
GET    /:purchaseId
PATCH  /:purchaseId/receive          // goods received -> updates branch stock + ledger
POST   /:purchaseId/payments          // record supplier payment
```

### Inventory Routes
**Base:** `/api/inventory`
```
GET    /movements                    // ledger, filterable by sku/date/type, scoped to branch
POST   /adjustments
PATCH  /adjustments/:id/approve       // manager
POST   /stock-counts
POST   /stock-counts/:id/submit
PATCH  /stock-counts/:id/reconcile
POST   /transfers                     // between branches
PATCH  /transfers/:id/dispatch
PATCH  /transfers/:id/receive
```
> **Implementation note:** not built as a single bundled `/api/inventory` router. `/movements` already exists as its own `/api/stock-movements` router; adjustments/stock-counts/transfers were implemented as their own routers at `/api/stock-adjustments`, `/api/stock-counts`, `/api/transfers` — see the `*(implemented)*` route sections below.

### Expense Routes
**Base:** `/api/expenses`
```
POST   /
GET    /
GET    /:expenseId
PUT    /:expenseId
DELETE /:expenseId
PATCH  /:expenseId/approve            // manager/admin
```

### Shift Routes
**Base:** `/api/shifts`
```
POST   /start                          // { openingFloat }
PATCH  /:shiftId/end                    // { actualCash }
GET    /active
GET    /
GET    /:shiftId
PATCH  /:shiftId/review-variance         // manager
```

### Report Routes
**Base:** `/api/reports`
```
GET    /sales?range=today|yesterday|weekly|monthly|yearly&branch=:branchId
GET    /products                        // best-sellers, slow movers, never sold
GET    /payments
GET    /inventory
GET    /profit
GET    /employees
GET    /suppliers
```

### Analytics Routes
**Base:** `/api/analytics`
```
GET    /sales-trend
GET    /profit-trend
GET    /peak-hours
GET    /top-products
GET    /payment-distribution
GET    /inventory-value
GET    /branch-comparison             // admin only
```

### Receipt Routes
**Base:** `/api/receipts`
```
GET    /tab/:tabId
POST   /tab/:tabId/print
POST   /tab/:tabId/reprint
POST   /tab/:tabId/refund
POST   /tab/:tabId/email
```

### Notification Routes
**Base:** `/api/notifications`
```
GET    /
GET    /unread-count
PATCH  /:notificationId/read
PATCH  /read-all
```

### Audit Routes
**Base:** `/api/audit-logs`
```
GET    /                              // manager/admin, filterable, scoped to branch
GET    /entity/:entityType/:entityId
```

### Settings Routes
**Base:** `/api/settings`
```
GET    /:branchId
PUT    /:branchId                      // admin/manager
```

### Location Routes *(implemented)*
**Base:** `/api/locations`
```
GET    /search                         // public — Google Maps proxy
POST   /                               // authenticated — save a location
GET    /:locationId                    // authenticated — fetch saved location
```

### Address Routes *(implemented)*
**Base:** `/api/addresses`
```
GET    /                               // authenticated — user's addresses (paginated)
GET    /:addressId                     // authenticated — address by ID
POST   /                               // authenticated — create (body: name, locationId)
PUT    /:addressId                     // authenticated — update
DELETE /:addressId                     // authenticated — delete
PATCH  /:addressId/default             // authenticated — set as default
```

### Branch Routes *(implemented)*
**Base:** `/api/branches`
```
GET    /                               // admin/manager — all branches (paginated)
GET    /:branchId                      // admin/manager — branch by ID
POST   /                               // admin — create (body: name, addressId?)
PUT    /:branchId                      // admin — update
DELETE /:branchId                      // admin — delete (blocked if isMain)
```

### Purchase Routes *(implemented)*
**Base:** `/api/purchases`
```
GET    /                               // store_keeper/manager/admin/accountant — list (paginated, filterable)
GET    /:purchaseId                    // store_keeper/manager/admin/accountant — purchase by ID
POST   /                               // store_keeper/manager/admin — create purchase order
PATCH  /:purchaseId/receive            // store_keeper/manager/admin — receive goods, increments stock
```

### StockAdjustment Routes *(implemented)*
**Base:** `/api/stock-adjustments`
```
GET    /                               // store_keeper/manager/admin/accountant — list (paginated, filterable)
GET    /:stockAdjustmentId             // store_keeper/manager/admin/accountant — adjustment by ID
POST   /                               // store_keeper/manager/admin — create adjustment
PATCH  /:stockAdjustmentId/approve     // manager/admin — approve pending negative adjustment
```

### StockCount Routes *(implemented)*
**Base:** `/api/stock-counts`
```
GET    /                               // store_keeper/manager/admin/accountant — list (paginated, filterable)
GET    /:stockCountId                  // store_keeper/manager/admin/accountant — stock count by ID
POST   /                               // store_keeper/manager/admin — start stock count
PATCH  /:stockCountId/submit           // store_keeper/manager/admin — submit counted quantities
PATCH  /:stockCountId/reconcile        // manager/admin — reconcile, applies variance adjustments
```

### Transfer Routes *(implemented)*
**Base:** `/api/transfers`
```
GET    /                               // store_keeper/manager/admin/accountant — list (paginated, filterable)
GET    /:transferId                    // store_keeper/manager/admin/accountant — transfer by ID
POST   /                               // store_keeper/manager/admin — create transfer
PATCH  /:transferId/dispatch           // store_keeper/manager/admin — dispatch, decrements source stock
PATCH  /:transferId/receive            // store_keeper/manager/admin — receive, increments destination stock
```

### Utility Routes
```
GET    /api                            // API root info
GET    /api/health                     // Health check
GET    /api/docs                       // Swagger UI
```

---

## 🏗️ Architecture Overview

### Folder Structure
```
club-pos-api/
├── src/
│   ├── config/
│   │   ├── db.ts                    # Mongo connection
│   │   ├── cloudinary.ts
│   │   ├── socket.ts                # Socket.io init + room/event helpers (branch-scoped rooms)
│   │   └── swagger.ts
│   ├── models/
│   │   ├── User.ts
│   │   ├── Role.ts
│   │   ├── Branch.ts
│   │   ├── Category.ts
│   │   ├── Variant.ts
│   │   ├── Product.ts
│   │   ├── Sku.ts
│   │   ├── Supplier.ts
│   │   ├── Tab.ts
│   │   ├── Payment.ts
│   │   ├── Purchase.ts
│   │   ├── StockMovement.ts
│   │   ├── StockAdjustment.ts
│   │   ├── StockCount.ts
│   │   ├── Transfer.ts
│   │   ├── Expense.ts
│   │   ├── Shift.ts
│   │   ├── AuditLog.ts
│   │   ├── Notification.ts
│   │   ├── Receipt.ts
│   │   └── Settings.ts
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── userController.ts
│   │   ├── roleController.ts
│   │   ├── branchController.ts
│   │   ├── dashboardController.ts
│   │   ├── categoryController.ts
│   │   ├── variantController.ts
│   │   ├── productController.ts
│   │   ├── skuController.ts
│   │   ├── tabController.ts
│   │   ├── paymentController.ts
│   │   ├── supplierController.ts
│   │   ├── purchaseController.ts
│   │   ├── inventoryController.ts
│   │   ├── expenseController.ts
│   │   ├── shiftController.ts
│   │   ├── reportController.ts
│   │   ├── analyticsController.ts
│   │   ├── receiptController.ts
│   │   ├── notificationController.ts
│   │   ├── auditController.ts
│   │   └── settingsController.ts
│   ├── routes/
│   │   ├── authRoutes.ts
│   │   ├── userRoutes.ts
│   │   ├── roleRoutes.ts
│   │   ├── branchRoutes.ts
│   │   ├── dashboardRoutes.ts
│   │   ├── categoryRoutes.ts
│   │   ├── variantRoutes.ts
│   │   ├── productRoutes.ts
│   │   ├── skuRoutes.ts
│   │   ├── tabRoutes.ts
│   │   ├── paymentRoutes.ts
│   │   ├── supplierRoutes.ts
│   │   ├── purchaseRoutes.ts
│   │   ├── inventoryRoutes.ts
│   │   ├── expenseRoutes.ts
│   │   ├── shiftRoutes.ts
│   │   ├── reportRoutes.ts
│   │   ├── analyticsRoutes.ts
│   │   ├── receiptRoutes.ts
│   │   ├── notificationRoutes.ts
│   │   ├── auditRoutes.ts
│   │   └── settingsRoutes.ts
│   ├── middleware/
│   │   ├── auth.ts                  # authenticateToken, authorizeRoles, requirePermission
│   │   ├── requireActiveShift.ts    # blocks tab creation without an open shift
│   │   ├── requireBranchAccess.ts   # scopes/blocks requests to the user's branch (admins can override via query param)
│   │   ├── auditLogger.ts           # wraps sensitive writes, writes AuditLog entries
│   │   ├── errorHandler.ts
│   │   └── validate.ts              # Joi schema validation wrapper
│   ├── services/
│   │   ├── internal/
│   │   │   ├── tabService.ts           # totals calc, merge/split logic
│   │   │   ├── inventoryService.ts     # single entry point for all branch-scoped stock changes
│   │   │   ├── shiftReconciliationService.ts
│   │   │   └── notificationService.ts
│   │   └── external/
│   │       ├── darajaService.ts        # M-Pesa STK Push + callback verification
│   │       ├── cardTerminalService.ts  # abstracts terminal/manual card entry
│   │       ├── printerService.ts       # thermal printer / ESC-POS
│   │       ├── smsService.ts           # Africa's Talking
│   │       └── emailService.ts         # Nodemailer, digital receipts
│   ├── utils/
│   │   ├── generateReceiptPDF.ts
│   │   ├── numberGenerators.ts         # branch-prefixed TAB-, PAY-, PO-, SHIFT- sequence generators
│   │   └── index.ts                    # JWT helpers
│   ├── jobs/
│   │   ├── lowStockSweep.ts            # node-cron, periodic, per branch
│   │   └── dailySummary.ts             # node-cron, end of day, per branch
│   ├── types/
│   └── index.ts                        # App entry point, Express + Socket.io bootstrap
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
```

### Middleware

#### Authentication & Authorization
- `authenticateToken` — verifies JWT, loads user + role + permissions + branch
- `authorizeRoles(...roles)` — restricts a route to specific roles (e.g. `manager`, `administrator`)
- `requirePermission(permission)` — fine-grained check against `Role.permissions` (e.g. `edit_prices`, `delete_sales`)
- `requireActiveShift` — blocks Tab creation/item-add if the bartender has no `open` Shift at their branch
- `requireBranchAccess` — ensures a user can only read/write data belonging to their own branch; administrators can pass an explicit `branch` query param to view another branch or a consolidated view
- `optionalAuth` — for any public-facing endpoints

#### Audit Logging
- `auditLogger(entityType, action)` — attached to sensitive routes (price edits, tab cancellation, payment reversal, role assignment); diffs the before/after state and writes to `AuditLog`

#### File Upload
- Handled via `config/cloudinary.ts`
- **Product images:** 2MB limit
- **Expense receipts:** 5MB limit, images + PDF

#### Real-time (Socket.io)
- Initialized in `src/index.ts` via `config/socket.ts`
- Rooms: `branch:<branchId>`, `shift:<shiftId>`, `branch:<branchId>:role:manager`, `branch:<branchId>:role:bartender`
- Used for open-tab live updates, low-stock pushes, M-Pesa payment confirmation, and the live Manager Dashboard — all scoped per branch so one location's bartender never sees another's tabs

---

## 🔄 Sale Tab Lifecycle

The entire Sales module is built around this state machine — everything else (inventory reduction, payments, receipts, reports, profit) hangs off a Tab reaching `completed`. Every Tab belongs to exactly one branch.

```
draft → open → (items added) → awaiting_payment
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                      cash            mpesa            card
                        │               │               │
                        └───────────────┼───────────────┘
                                        ▼
                                  payment confirmed
                                        │
                                        ▼
                                   completed
                                        │
                                        ▼
                              archived (reports/reprints)

    open ──hold──> held ──resume──> open
    open ──cancel──> cancelled  (no payment, no stock reservation to reverse)
```

**Rules enforced in `tabService.ts`:**
- Inventory is only deducted (via `StockMovement type: 'sold'`, against the SKU's `stockByBranch` entry for the tab's branch) when a Tab transitions to `completed`, not when items are merely added — this keeps held/cancelled tabs from falsely reserving stock.
- `awaiting_payment → completed` only fires once `amountPaid >= grandTotal` across all linked Payment records (supports Mixed Payment).
- Cancelling a Tab after items were added requires a `cancelReason` and is written to `AuditLog`.
- Merge and Split always produce new/updated Tab documents rather than mutating history in place, and are only permitted between tabs on the same branch.

---

## 📡 Real-time Events (Socket.io)

| Event | Emitted to | Trigger |
|---|---|---|
| `tab:opened` / `tab:updated` / `tab:closed` | `branch:<branchId>:role:bartender`, `branch:<branchId>:role:manager` | Any Tab mutation |
| `payment:mpesa:pending` | `shift:<shiftId>` | STK Push sent |
| `payment:mpesa:confirmed` / `payment:mpesa:failed` | `shift:<shiftId>` | Daraja callback received |
| `stock:low` | `branch:<branchId>:role:manager`, `branch:<branchId>:role:store_keeper` | SKU crosses `minimumStock` for that branch |
| `shift:started` / `shift:ended` | `branch:<branchId>:role:manager` | Shift open/close |
| `shift:variance:flagged` | `branch:<branchId>:role:manager` | \|variance\| exceeds threshold on shift close |
| `notification:new` | specific user or branch/role room | Any Notification created |

---

## 📝 API Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information"
}
```

### Status Codes
- `200` OK · `201` Created · `400` Bad Request · `401` Unauthorized · `403` Forbidden (e.g. wrong-branch access) · `404` Not Found · `409` Conflict (e.g. closing a Tab with balance due) · `500` Internal Server Error

---

## 🔐 Environment Variables

```env
# ===== App/Runtime =====
NODE_ENV=
PORT=
APP_NAME=
TIMEZONE=
LOG_LEVEL=

# ===== URLs/CORS =====
API_BASE_URL=
FRONTEND_URL=
ADMIN_URL=
CORS_ORIGIN=

# ===== Database =====
MONGO_URI=

# ===== Auth & Security =====
JWT_SECRET=
JWT_EXPIRES_IN=
REFRESH_TOKEN_SECRET=
COOKIE_SECRET=
OTP_EXP_MINUTES=
RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX=

# ===== OAuth/Social =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_PLACE_API=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=

# ===== Email (SMTP) =====
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ===== SMS =====
SMS_PROVIDER=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
AT_API_KEY=
AT_USERNAME=

# ===== Payments =====
PAYSTACK_PUBLIC_KEY=
PAYSTACK_SECRET_KEY=
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORT_CODE=
MPESA_PASSKEY=
MPESA_ENV=
CALLBACK_URL=

# ===== Storage/CDN =====
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ===== External Services =====
REDIS_URL=

# ===== Notifications/Monitoring =====
SENTRY_DSN=
GA_MEASUREMENT_ID=
MIXPANEL_TOKEN=

# ===== Location/Maps =====
LOCATIONIQ_TOKEN=

# ===== Currency & Business Config =====
DEFAULT_CURRENCY=
ENABLE_SCHEDULING=
SCHEDULING_FEE=
DELIVERY_FEE_PER_KM=
ALLOW_PREORDERS=
MAX_UPLOAD_SIZE=

# ===== Firebase =====
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_DATABASE_URL=
```

---

## 🚀 Getting Started

```bash
cd club-pos-api
npm install
npm run seed:roles      # seeds the 6 default roles
npm run seed:branch     # creates the first (main) branch + its Settings document
mongod                  # ensure MongoDB is running
npm run dev              # tsx watch src/index.ts (or nodemon + tsx)
```

### Build for Production
```bash
npm run build            # tsc -> dist/
npm start                 # node dist/index.js
```

---

**Version:** 0.2.0 — added SKU model, multi-branch as a core concept, removed Customer module, simplified User status field
**Note:** This documentation defines the target backend structure for the Club POS. Implementation should proceed module-by-module, starting with Branch → Auth → Shift → Products/SKU/Inventory → Tabs → Payments, since Branch scoping and the Sale Tab lifecycle are the two things everything else depends on.
