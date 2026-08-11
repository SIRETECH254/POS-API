# 🗂️ POS API - Tab Management Documentation

## 📋 Table of Contents
- [Tab Management Overview](#tab-management-overview)
- [Tab Model](#-tab-model)
- [Tab Controller](#-tab-controller)
- [Tab Routes](#-tab-routes)
- [Middleware](#-middleware)
- [API Examples](#-api-examples)
- [Security Features](#-security-features)
- [Error Handling](#-error-handling)
- [Database Indexes](#-database-indexes)

---

## Tab Management Overview

The Tab is the core business entity of the Club POS — every sale flows through a Tab's lifecycle: `draft → open → (items added) → held/awaiting_payment → paid → completed → cancelled → archived`. A bartender opens a Tab against their branch and active shift, adds line items as drinks/food are served, then closes it out for payment. Item `name`/`unitPrice` are snapshotted onto the line item at add-time so a later product price change never rewrites a historical Tab. Totals (`subtotal`, `discountTotal`, `grandTotal`, `balanceDue`) are recalculated automatically in a pre-save hook whenever `items` changes — none of them are ever accepted directly from the request body.

**Scope notes for this pass:**
- **Tab completion is payment-gated and not reachable through any route yet.** The Payment module (STK Push, cash, card, mixed payment) has not been built. `tabService.completeTab()` exists as an exported, ready-to-call function — it deducts stock for every active item via `stockMovementService.recordStockMovement()` (`type: "sold"`) and closes the tab out — but no controller/route calls it in this codebase yet. `closeTab()` → `awaiting_payment` is the practical terminal state reachable through the REST API today. The future Payment module is expected to call `completeTab()` once `amountPaid >= grandTotal`.
- **Real-time Socket.io events (`tab:opened`/`tab:updated`/`tab:closed`) are planned but not wired.** They require branch/role Socket.io rooms (e.g. `branch:<branchId>:role:bartender`) that don't exist yet in `src/index.ts` — only per-user rooms (`user_{userId}`) exist today.
- **No `AuditLog` write on `cancelTab`.** The planning documentation calls for cancellations to be logged to an `AuditLog` collection, but no `AuditLog` model exists in this codebase yet — this module does not invent one.
- **`taxTotal` defaults to `0`.** No `Settings` model exists yet to hold a per-branch `taxRate`, so the pre-save totals hook leaves `taxTotal` at `0` until a Settings module is built.
- **SKU is embedded, not a standalone collection.** Tab line items reference `{ product: ObjectId ref Product, sku: ObjectId }`, where `sku` is the `_id` of a subdocument inside `Product.skus` — the same pattern already used by `Purchase`/`StockMovement` items.

---

## 👤 Tab Model

### Schema Definition
```typescript
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
  holdReason?: string;
  cancelReason?: string;
  closedBy?: Types.ObjectId | IUser;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Model Implementation

**File: `src/models/Tab.ts`**

```typescript
import mongoose, { Schema } from "mongoose";
import { ITab, ITabItem } from "../type";

const tabItemSchema = new Schema<ITabItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  sku: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ["active", "cancelled"],
    default: "active",
  },
  addedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const tabSchema = new Schema<ITab>(
  {
    tabNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    table: {
      type: String,
      trim: true,
    },
    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    items: {
      type: [tabItemSchema],
      default: [],
    },
    mergedFrom: {
      type: [Schema.Types.ObjectId],
      ref: "Tab",
      default: [],
    },
    splitInto: {
      type: [Schema.Types.ObjectId],
      ref: "Tab",
      default: [],
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["draft", "open", "held", "awaiting_payment", "paid", "completed", "cancelled", "archived"],
      default: "open",
    },
    holdReason: {
      type: String,
      trim: true,
    },
    cancelReason: {
      type: String,
      trim: true,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    closedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Recalculate totals from active items whenever items change.
// Item.subtotal stays net (quantity*unitPrice - discount) for line display;
// Tab-level subtotal is the gross pre-discount sum so discountTotal remains meaningful.
tabSchema.pre("save", function (next) {
  if (this.isModified("items")) {
    let grossSubtotal = 0;
    let discountTotal = 0;

    for (const item of this.items) {
      if (item.status === "active") {
        grossSubtotal += item.quantity * item.unitPrice;
        discountTotal += item.discount;
      }
    }

    this.subtotal = grossSubtotal;
    this.discountTotal = discountTotal;
    this.grandTotal = grossSubtotal - discountTotal + this.taxTotal;
    this.balanceDue = this.grandTotal - this.amountPaid;
  }

  next();
});

tabSchema.index({ branch: 1 });
tabSchema.index({ status: 1 });
tabSchema.index({ shift: 1 });

const Tab = mongoose.model<ITab>("Tab", tabSchema);
export default Tab;
```

### Validation Rules
```typescript
tabNumber:     { required: true, unique: true, trim: true, auto-generated e.g. MAIN-TAB-000001 }
branch:        { required: true, ObjectId ref: 'Branch' }
table:         { optional, trim }
openedBy:      { required: true, ObjectId ref: 'User' }
shift:         { required: true, ObjectId ref: 'Shift' — the staff member's active shift at creation time }
items:         { default: [], each: { product: required ref Product, sku: required (no ref, embedded subdoc), name: required snapshot, unitPrice: required min 0 snapshot, quantity: required min 1, discount: default 0 min 0, subtotal: required min 0, status: default 'active', addedBy: required ref User, addedAt: default now } }
mergedFrom:    { default: [], ObjectId[] ref: 'Tab' — populated by mergeTabs on the target }
splitInto:     { default: [], ObjectId[] ref: 'Tab' — populated by splitBill on the original }
subtotal:      { default: 0, min: 0 — derived, gross pre-discount sum of active items }
discountTotal: { default: 0, min: 0 — derived, sum of active item discounts }
taxTotal:      { default: 0, min: 0 — always 0 until a Settings/taxRate module exists }
grandTotal:    { default: 0, min: 0 — derived, subtotal - discountTotal + taxTotal }
amountPaid:    { default: 0, min: 0 — not yet written to by any endpoint (Payment module not built) }
balanceDue:    { default: 0 — derived, grandTotal - amountPaid }
status:        { default: 'open', enum: ['draft','open','held','awaiting_payment','paid','completed','cancelled','archived'] }
holdReason:    { optional, trim — required in the request body to hold a tab }
cancelReason:  { optional, trim — required in the request body to cancel a tab }
closedBy:      { optional, ObjectId ref: 'User' — set by tabService.completeTab (not yet wired to a route) }
closedAt:      { optional, Date — set by tabService.completeTab (not yet wired to a route) }
```

---

## 🎮 Tab Controller

**File:** `src/controllers/tabController.ts`

### Required Imports
```typescript
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import Tab from "../models/Tab";
import Branch from "../models/Branch";
import Product from "../models/Product";
import Shift from "../models/Shift";
import { IRole } from "../type";
import { generateTabNumber } from "../utils/numberGenerators";
import { mergeTabs as mergeTabsService, splitBill as splitBillService } from "../services/internal/tabService";
```

### Functions Overview

#### `createTab()`
**Purpose:** Open a new sale tab at the requesting staff member's branch
**Access:** Bartender, Manager, Admin
**Validation:** Staff must be assigned to a branch; requires an active shift (enforced by `requireActiveShift`)
**Process:** Generate tab number, create tab in `"open"` status, increment `shift.salesSummary.tabsOpened`
**Response:** Created tab

**Controller Implementation:**
```typescript
export const createTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { table } = req.body;

    // Guard — staff must be assigned to a branch
    if (!req.user?.branch) {
      return next(errorHandler(400, "You are not assigned to a branch"));
    }

    // Guard — branch must exist
    const branchDoc = await Branch.findById(req.user.branch);
    if (!branchDoc) {
      return next(errorHandler(404, "Branch not found"));
    }

    // Generate tab number
    const tabNumber = await generateTabNumber(branchDoc.code, String(branchDoc._id));

    // Create tab
    const tab = await Tab.create({
      tabNumber,
      branch: branchDoc._id,
      table,
      openedBy: req.user._id,
      shift: req.user.currentShift,
      status: "open",
    });

    // Increment shift tabsOpened counter
    await Shift.findByIdAndUpdate(req.user.currentShift, {
      $inc: { "salesSummary.tabsOpened": 1 },
    });

    // Return created tab
    res.status(201).json({
      success: true,
      message: "Tab opened successfully",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getOpenTabs()`
**Purpose:** List tabs currently open or held at the requesting branch
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch and `status in [open, held]`
**Response:** List of open/held tabs

**Controller Implementation:**
```typescript
export const getOpenTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Resolve branch scope
    const branch = resolveBranchFilter(req);

    // Build filter query
    const query: any = { status: { $in: ["open", "held"] } };
    if (branch) {
      query.branch = branch;
    }

    // Fetch open/held tabs
    const tabs = await Tab.find(query)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .sort({ createdAt: "desc" });

    // Return tabs
    res.status(200).json({
      success: true,
      data: { tabs },
    });
  } catch (error: any) {
    next(error);
  }
};
```

> **Note:** `resolveBranchFilter(req)` is a small local helper (top of `tabController.ts`, not exported) shared by `getOpenTabs` and `getAllTabs`: it lets `admin`/`accountant` pass an explicit `?branch=` query param for a cross-branch view, and otherwise scopes every other role to `req.user.branch`. This is the ad-hoc equivalent of the documented-but-unbuilt `requireBranchAccess` middleware, matching how `purchaseController` already scopes list queries.

---

#### `getTab()`
**Purpose:** Fetch a single tab with full details
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** Tab must exist
**Process:** Find tab by ID and return with populated refs
**Response:** Tab details

**Controller Implementation:**
```typescript
export const getTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab by ID
    const tab = await Tab.findById(req.params.tabId)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .populate("closedBy", "firstName lastName")
      .populate("items.product", "name");

    // Guard — tab must exist
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Return tab
    res.status(200).json({
      success: true,
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `addItem()`
**Purpose:** Add a product/SKU line item to an open or held tab
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and be open/held; product and SKU must exist
**Process:** Snapshot name/price from the SKU, push item, save (recalculates totals)
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const addItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { product, sku, quantity, discount = 0 } = req.body;

    // Guard — required fields
    if (!product) {
      return next(errorHandler(400, "Product is required"));
    }
    if (!sku) {
      return next(errorHandler(400, "SKU is required"));
    }
    if (!quantity || quantity < 1) {
      return next(errorHandler(400, "Quantity must be at least 1"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be added to an open or held tab"));
    }

    // Guard — product must exist
    const productDoc = await Product.findById(product);
    if (!productDoc) {
      return next(errorHandler(404, "Product not found"));
    }

    // Guard — SKU must exist on the product
    const skuDoc = productDoc.skus.id(sku);
    if (!skuDoc) {
      return next(errorHandler(404, "SKU not found on product"));
    }

    // Snapshot name/price and compute line subtotal
    const subtotal = quantity * skuDoc.sellingPrice - discount;

    // Push item onto tab
    tab.items.push({
      product: productDoc._id,
      sku: skuDoc._id,
      name: productDoc.name,
      unitPrice: skuDoc.sellingPrice,
      quantity,
      discount,
      subtotal,
      status: "active",
      addedBy: req.user?._id,
      addedAt: new Date(),
    } as any);

    // Save tab (totals recalculated in pre-save hook)
    await tab.save();

    // Return updated tab
    res.status(201).json({
      success: true,
      message: "Item added to tab",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `updateItemQuantity()`
**Purpose:** Change the quantity of an active line item on a tab
**Access:** Bartender, Manager, Admin
**Validation:** Tab and item must exist; item must be active; quantity must be at least 1
**Process:** Update quantity and recompute the line subtotal, save
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const updateItemQuantity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { quantity } = req.body;

    // Guard — quantity required
    if (!quantity || quantity < 1) {
      return next(errorHandler(400, "Quantity must be at least 1"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be updated on an open or held tab"));
    }

    // Find item
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Guard — item must be active
    if (item.status !== "active") {
      return next(errorHandler(409, "Cancelled items cannot be updated"));
    }

    // Update quantity and recompute subtotal
    item.quantity = quantity;
    item.subtotal = quantity * item.unitPrice - item.discount;

    // Save tab (totals recalculated in pre-save hook)
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item quantity updated",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `removeItem()`
**Purpose:** Delete a line item from an open or held tab
**Access:** Bartender, Manager, Admin
**Validation:** Tab and item must exist
**Process:** Remove the item subdocument, save
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const removeItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be removed from an open or held tab"));
    }

    // Guard — item must exist
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Remove item and save (totals recalculated in pre-save hook)
    tab.items.pull(req.params.itemId as string);
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item removed from tab",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `cancelItem()`
**Purpose:** Mark a single line item as cancelled without deleting it
**Access:** Bartender, Manager, Admin
**Validation:** Tab and item must exist; item must be active
**Process:** Set item status to cancelled, save
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const cancelItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Items can only be cancelled on an open or held tab"));
    }

    // Find item
    const item = tab.items.id(req.params.itemId as string);
    if (!item) {
      return next(errorHandler(404, "Item not found on tab"));
    }

    // Guard — item must currently be active
    if (item.status !== "active") {
      return next(errorHandler(409, "Item is already cancelled"));
    }

    // Cancel item and save (totals recalculated in pre-save hook)
    item.status = "cancelled";
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Item cancelled",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `holdTab()`
**Purpose:** Put an open tab on hold
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and be open; `holdReason` is required
**Process:** Set status to held with the given reason
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const holdTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { holdReason } = req.body;

    // Guard — hold reason required
    if (!holdReason) {
      return next(errorHandler(400, "Hold reason is required"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must currently be open
    if (tab.status !== "open") {
      return next(errorHandler(409, "Only an open tab can be held"));
    }

    // Put tab on hold
    tab.status = "held";
    tab.holdReason = holdReason;
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab put on hold",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `resumeTab()`
**Purpose:** Resume a held tab back to open
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and be held
**Process:** Set status back to open, clear hold reason
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const resumeTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must currently be held
    if (tab.status !== "held") {
      return next(errorHandler(409, "Only a held tab can be resumed"));
    }

    // Resume tab
    tab.status = "open";
    tab.holdReason = undefined;
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab resumed",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `mergeTabs()`
**Purpose:** Merge one or more tabs into a single target tab on the same branch
**Access:** Bartender, Manager, Admin
**Validation:** At least two tab IDs required; all tabs must share a branch and be open/held
**Process:** Delegates to `tabService.mergeTabs` — appends active items into the target, cancels sources
**Response:** Merged target tab

**Controller Implementation:**
```typescript
export const mergeTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { tabIds } = req.body;

    // Guard — at least two tabs required
    if (!tabIds || !Array.isArray(tabIds) || tabIds.length < 2) {
      return next(errorHandler(400, "At least two tab IDs are required to merge"));
    }

    // Merge tabs via service
    const target = await mergeTabsService(tabIds, req.user?._id as any);

    // Return merged tab
    res.status(200).json({
      success: true,
      message: "Tabs merged successfully",
      data: { tab: target },
    });
  } catch (error: any) {
    next(error);
  }
};
```

> **Merge semantics:** `tabIds[0]` is the merge target; the rest are sources. Active items from each source are appended onto the target's `items` array (`target.mergedFrom` records the source IDs), and each source tab is set to `status: "cancelled"` with `cancelReason: "Merged into <target tabNumber>"`. All tabs must belong to the same branch and be `open`/`held`, or the whole operation fails with `400`/`409`.

---

#### `splitBill()`
**Purpose:** Split a tab's active items into multiple new tabs
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and be open/held; groups must exactly partition the active items
**Process:** Delegates to `tabService.splitBill` — creates new tabs per group, cancels the original
**Response:** Newly created tabs

**Controller Implementation:**
```typescript
export const splitBill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { groups } = req.body;

    // Guard — at least two groups required
    if (!groups || !Array.isArray(groups) || groups.length < 2) {
      return next(errorHandler(400, "At least two item groups are required to split a bill"));
    }

    // Split bill via service
    const newTabs = await splitBillService(req.params.tabId as string, groups, req.user?._id as any);

    // Return new tabs
    res.status(201).json({
      success: true,
      message: "Bill split successfully",
      data: { tabs: newTabs },
    });
  } catch (error: any) {
    next(error);
  }
};
```

> **Split semantics:** `groups` is an array of item-ID arrays that must cover every active item on the tab exactly once (no leftover item, no duplicate, no overlap) — otherwise `400`. One new tab is created per group, inheriting the original's `branch`/`shift`/`table`/`openedBy` and a freshly generated `tabNumber`. The original tab's items are all marked `cancelled`, its `splitInto` is set to the new tab IDs, and its own `status` becomes `cancelled` with `cancelReason: "Split into N tabs"`.

---

#### `cancelTab()`
**Purpose:** Cancel a tab before payment
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and not already be completed/cancelled/archived; `cancelReason` required
**Process:** Set status to cancelled, increment `shift.salesSummary.tabsCancelled`
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const cancelTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract fields from body
    const { cancelReason } = req.body;

    // Guard — cancel reason required
    if (!cancelReason) {
      return next(errorHandler(400, "Cancel reason is required"));
    }

    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must not already be completed, cancelled, or archived
    if (tab.status === "completed" || tab.status === "cancelled" || tab.status === "archived") {
      return next(errorHandler(409, "Tab cannot be cancelled in its current status"));
    }

    // Cancel tab
    tab.status = "cancelled";
    tab.cancelReason = cancelReason;
    await tab.save();

    // Increment shift tabsCancelled counter
    await Shift.findByIdAndUpdate(tab.shift, {
      $inc: { "salesSummary.tabsCancelled": 1 },
    });

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab cancelled",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `closeTab()`
**Purpose:** Close an open/held tab out for payment
**Access:** Bartender, Manager, Admin
**Validation:** Tab must exist and be open/held
**Process:** Set status to `awaiting_payment`
**Response:** Updated tab

**Controller Implementation:**
```typescript
export const closeTab = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Find tab
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return next(errorHandler(404, "Tab not found"));
    }

    // Guard — tab must be open or held
    if (tab.status !== "open" && tab.status !== "held") {
      return next(errorHandler(409, "Only an open or held tab can be closed"));
    }

    // Move tab to awaiting payment
    tab.status = "awaiting_payment";
    await tab.save();

    // Return updated tab
    res.status(200).json({
      success: true,
      message: "Tab closed, awaiting payment",
      data: { tab },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

#### `getAllTabs()`
**Purpose:** List tab history with filtering and pagination
**Access:** Bartender, Cashier, Manager, Admin, Accountant
**Validation:** None required
**Process:** Filter by branch/status/search, paginate, return results
**Response:** Tab list and pagination

**Controller Implementation:**
```typescript
export const getAllTabs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Extract query parameters
    const { page = 1, limit = 10, status, search } = req.query;

    // Resolve branch scope
    const branch = resolveBranchFilter(req);

    // Build filter query
    const query: any = {};
    if (branch) {
      query.branch = branch;
    }
    if (status) {
      query.status = status;
    }
    if (search) {
      query.tabNumber = { $regex: search, $options: "i" };
    }

    // Paginate options
    const options = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 10,
    };

    // Fetch tabs and total count
    const tabs = await Tab.find(query)
      .populate("branch", "name code")
      .populate("openedBy", "firstName lastName")
      .sort({ createdAt: "desc" })
      .limit(options.limit)
      .skip((options.page - 1) * options.limit);
    const total = await Tab.countDocuments(query);
    const totalPages = Math.ceil(total / options.limit);

    // Return response with pagination
    res.status(200).json({
      success: true,
      data: {
        tabs,
        pagination: {
          currentPage: options.page,
          totalPages: totalPages,
          totalTabs: total,
          hasNextPage: options.page < totalPages,
          hasPrevPage: options.page > 1,
        },
      },
    });
  } catch (error: any) {
    next(error);
  }
};
```

---

## 🛣️ Tab Routes

### Base Path: `/api/tabs`

```typescript
POST   /                              // Open a new tab (bartender, manager, admin)
GET    /open                          // List open/held tabs (bartender, cashier, manager, admin, accountant)
GET    /:tabId                        // Get single tab (bartender, cashier, manager, admin, accountant)
POST   /:tabId/items                  // Add item (bartender, manager, admin)
PATCH  /:tabId/items/:itemId          // Update item quantity (bartender, manager, admin)
DELETE /:tabId/items/:itemId          // Remove item (bartender, manager, admin)
PATCH  /:tabId/items/:itemId/cancel   // Cancel item (bartender, manager, admin)
PATCH  /:tabId/hold                   // Hold tab (bartender, manager, admin)
PATCH  /:tabId/resume                 // Resume tab (bartender, manager, admin)
POST   /merge                         // Merge tabs, same branch only (bartender, manager, admin)
POST   /:tabId/split                  // Split bill (bartender, manager, admin)
PATCH  /:tabId/cancel                 // Cancel tab (bartender, manager, admin)
PATCH  /:tabId/close                  // Close tab -> awaiting_payment (bartender, manager, admin)
GET    /                              // Tab history, paginated (bartender, cashier, manager, admin, accountant)
```

### Router Implementation

**File: `src/routes/tabRoutes.ts`**

```typescript
import express from "express";
import {
  createTab,
  getOpenTabs,
  getTab,
  addItem,
  updateItemQuantity,
  removeItem,
  cancelItem,
  holdTab,
  resumeTab,
  mergeTabs,
  splitBill,
  cancelTab,
  closeTab,
  getAllTabs,
} from "../controllers/tabController";
import { authenticateToken, authorizeRoles } from "../middleware/auth";
import { requireActiveShift } from "../middleware/requireActiveShift";
import { UserRole } from "../type";

const router = express.Router();

const MUTATE_ROLES: UserRole[] = ["bartender", "manager", "admin"];
const READ_ROLES: UserRole[] = ["bartender", "cashier", "manager", "admin", "accountant"];

router.post("/", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, createTab);
router.get("/open", authenticateToken, authorizeRoles(READ_ROLES), getOpenTabs);
router.get("/:tabId", authenticateToken, authorizeRoles(READ_ROLES), getTab);
router.post("/:tabId/items", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, addItem);
router.patch("/:tabId/items/:itemId", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, updateItemQuantity);
router.delete("/:tabId/items/:itemId", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, removeItem);
router.patch("/:tabId/items/:itemId/cancel", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, cancelItem);
router.patch("/:tabId/hold", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, holdTab);
router.patch("/:tabId/resume", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, resumeTab);
router.post("/merge", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, mergeTabs);
router.post("/:tabId/split", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, splitBill);
router.patch("/:tabId/cancel", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, cancelTab);
router.patch("/:tabId/close", authenticateToken, authorizeRoles(MUTATE_ROLES), requireActiveShift, closeTab);
router.get("/", authenticateToken, authorizeRoles(READ_ROLES), getAllTabs);

export default router;
```

### Route Details

#### `POST /api/tabs`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "table": "Table 4"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Tab opened successfully",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "branch": "64f1a2b3c4d5e6f7a8b9c0d3",
      "table": "Table 4",
      "openedBy": "64f1a2b3c4d5e6f7a8b9c0d7",
      "shift": "64f1a2b3c4d5e6f7a8b9c0e2",
      "items": [],
      "mergedFrom": [],
      "splitInto": [],
      "subtotal": 0,
      "discountTotal": 0,
      "taxTotal": 0,
      "grandTotal": 0,
      "amountPaid": 0,
      "balanceDue": 0,
      "status": "open",
      "createdAt": "2026-08-11T18:00:00.000Z",
      "updatedAt": "2026-08-11T18:00:00.000Z"
    }
  }
}
```

#### `GET /api/tabs/open`
**Headers:** `Authorization: Bearer <token>`
**Query:** `branch=<branchId>` (admin/accountant only)
**Response:**
```json
{
  "success": true,
  "data": {
    "tabs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
        "tabNumber": "MAIN-TAB-000001",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "openedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
          "firstName": "James",
          "lastName": "Otieno"
        },
        "status": "open",
        "grandTotal": 1200,
        "balanceDue": 1200,
        "createdAt": "2026-08-11T18:00:00.000Z"
      }
    ]
  }
}
```

#### `GET /api/tabs/:tabId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "branch": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
        "name": "Main Branch",
        "code": "MAIN"
      },
      "table": "Table 4",
      "openedBy": {
        "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
        "firstName": "James",
        "lastName": "Otieno"
      },
      "shift": "64f1a2b3c4d5e6f7a8b9c0e2",
      "items": [
        {
          "_id": "64f1a2b3c4d5e6f7a8b9c1b1",
          "product": {
            "_id": "64f1a2b3c4d5e6f7a8b9c0d5",
            "name": "Tusker Lager"
          },
          "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
          "name": "Tusker Lager",
          "unitPrice": 300,
          "quantity": 4,
          "discount": 0,
          "subtotal": 1200,
          "status": "active",
          "addedAt": "2026-08-11T18:05:00.000Z"
        }
      ],
      "mergedFrom": [],
      "splitInto": [],
      "subtotal": 1200,
      "discountTotal": 0,
      "taxTotal": 0,
      "grandTotal": 1200,
      "amountPaid": 0,
      "balanceDue": 1200,
      "status": "open",
      "createdAt": "2026-08-11T18:00:00.000Z",
      "updatedAt": "2026-08-11T18:05:00.000Z"
    }
  }
}
```

#### `POST /api/tabs/:tabId/items`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "product": "64f1a2b3c4d5e6f7a8b9c0d5",
  "sku": "64f1a2b3c4d5e6f7a8b9c0d6",
  "quantity": 4,
  "discount": 0
}
```
**Response:**
```json
{
  "success": true,
  "message": "Item added to tab",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "status": "open",
      "subtotal": 1200,
      "discountTotal": 0,
      "grandTotal": 1200,
      "balanceDue": 1200,
      "updatedAt": "2026-08-11T18:05:00.000Z"
    }
  }
}
```

#### `PATCH /api/tabs/:tabId/items/:itemId`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "quantity": 6
}
```
**Response:**
```json
{
  "success": true,
  "message": "Item quantity updated",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "subtotal": 1800,
      "grandTotal": 1800,
      "balanceDue": 1800,
      "updatedAt": "2026-08-11T18:10:00.000Z"
    }
  }
}
```

#### `DELETE /api/tabs/:tabId/items/:itemId`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Item removed from tab",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "subtotal": 0,
      "grandTotal": 0,
      "balanceDue": 0,
      "updatedAt": "2026-08-11T18:12:00.000Z"
    }
  }
}
```

#### `PATCH /api/tabs/:tabId/items/:itemId/cancel`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Item cancelled",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "subtotal": 0,
      "grandTotal": 0,
      "balanceDue": 0,
      "updatedAt": "2026-08-11T18:13:00.000Z"
    }
  }
}
```

#### `PATCH /api/tabs/:tabId/hold`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "holdReason": "Customer stepped out to their car"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Tab put on hold",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "status": "held",
      "holdReason": "Customer stepped out to their car",
      "updatedAt": "2026-08-11T18:15:00.000Z"
    }
  }
}
```

#### `PATCH /api/tabs/:tabId/resume`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Tab resumed",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "status": "open",
      "updatedAt": "2026-08-11T18:20:00.000Z"
    }
  }
}
```

#### `POST /api/tabs/merge`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "tabIds": [
    "64f1a2b3c4d5e6f7a8b9c1a1",
    "64f1a2b3c4d5e6f7a8b9c1a2"
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Tabs merged successfully",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "mergedFrom": [
        "64f1a2b3c4d5e6f7a8b9c1a2"
      ],
      "subtotal": 2400,
      "grandTotal": 2400,
      "balanceDue": 2400,
      "updatedAt": "2026-08-11T18:25:00.000Z"
    }
  }
}
```

#### `POST /api/tabs/:tabId/split`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "groups": [
    ["64f1a2b3c4d5e6f7a8b9c1b1"],
    ["64f1a2b3c4d5e6f7a8b9c1b2"]
  ]
}
```
**Response:**
```json
{
  "success": true,
  "message": "Bill split successfully",
  "data": {
    "tabs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c1c1",
        "tabNumber": "MAIN-TAB-000002",
        "status": "open",
        "grandTotal": 1200
      },
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c1c2",
        "tabNumber": "MAIN-TAB-000003",
        "status": "open",
        "grandTotal": 1200
      }
    ]
  }
}
```

#### `PATCH /api/tabs/:tabId/cancel`
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
**Body:**
```json
{
  "cancelReason": "Customer walked out without paying"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Tab cancelled",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "status": "cancelled",
      "cancelReason": "Customer walked out without paying",
      "updatedAt": "2026-08-11T18:30:00.000Z"
    }
  }
}
```

#### `PATCH /api/tabs/:tabId/close`
**Headers:** `Authorization: Bearer <token>`
**Response:**
```json
{
  "success": true,
  "message": "Tab closed, awaiting payment",
  "data": {
    "tab": {
      "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
      "tabNumber": "MAIN-TAB-000001",
      "status": "awaiting_payment",
      "grandTotal": 1200,
      "balanceDue": 1200,
      "updatedAt": "2026-08-11T18:35:00.000Z"
    }
  }
}
```

#### `GET /api/tabs`
**Headers:** `Authorization: Bearer <token>`
**Query:** `page=1`, `limit=10`, `status=completed`, `search=<tabNumber>`, `branch=<branchId>` (admin/accountant only)
**Response:**
```json
{
  "success": true,
  "data": {
    "tabs": [
      {
        "_id": "64f1a2b3c4d5e6f7a8b9c1a1",
        "tabNumber": "MAIN-TAB-000001",
        "branch": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d3",
          "name": "Main Branch",
          "code": "MAIN"
        },
        "openedBy": {
          "_id": "64f1a2b3c4d5e6f7a8b9c0d7",
          "firstName": "James",
          "lastName": "Otieno"
        },
        "status": "awaiting_payment",
        "grandTotal": 1200,
        "createdAt": "2026-08-11T18:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalTabs": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

## 🔐 Middleware

### Authentication Middleware

#### `authenticateToken`
**Purpose:** Verify JWT token and load user with roles
**Usage:**
```typescript
router.get("/", authenticateToken, getAllTabs);
```

#### `authorizeRoles(allowedRoles)`
**Purpose:** Check if user has any of the allowed roles
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["bartender", "manager", "admin"]), createTab);
```

#### `requireActiveShift`
**Purpose:** Block Tab mutation routes when the requesting user has no `open` Shift
**Usage:**
```typescript
router.post("/", authenticateToken, authorizeRoles(["bartender", "manager", "admin"]), requireActiveShift, createTab);
```
Applied to every mutating Tab route (`POST`/`PATCH`/`DELETE`) — read routes (`GET`) skip it, since viewing tab history doesn't require the viewer to currently be on shift.

---

## 📝 API Examples

### Open a Tab
```bash
curl -X POST http://localhost:3500/api/tabs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "table": "Table 4" }'
```

### Add an Item
```bash
curl -X POST http://localhost:3500/api/tabs/64f1a2b3c4d5e6f7a8b9c1a1/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "product": "64f1a2b3c4d5e6f7a8b9c0d5", "sku": "64f1a2b3c4d5e6f7a8b9c0d6", "quantity": 4 }'
```

### Hold and Resume a Tab
```bash
curl -X PATCH http://localhost:3500/api/tabs/64f1a2b3c4d5e6f7a8b9c1a1/hold \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "holdReason": "Customer stepped out to their car" }'

curl -X PATCH http://localhost:3500/api/tabs/64f1a2b3c4d5e6f7a8b9c1a1/resume \
  -H "Authorization: Bearer <token>"
```

### Merge Two Tabs
```bash
curl -X POST http://localhost:3500/api/tabs/merge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "tabIds": ["64f1a2b3c4d5e6f7a8b9c1a1", "64f1a2b3c4d5e6f7a8b9c1a2"] }'
```

### Split a Bill
```bash
curl -X POST http://localhost:3500/api/tabs/64f1a2b3c4d5e6f7a8b9c1a1/split \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "groups": [["64f1a2b3c4d5e6f7a8b9c1b1"], ["64f1a2b3c4d5e6f7a8b9c1b2"]] }'
```

### Close a Tab for Payment
```bash
curl -X PATCH http://localhost:3500/api/tabs/64f1a2b3c4d5e6f7a8b9c1a1/close \
  -H "Authorization: Bearer <token>"
```

### Get Tab History
```bash
curl -X GET "http://localhost:3500/api/tabs?status=completed&page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

---

## 🛡️ Security Features

- **RBAC:** All routes require `authenticateToken`. Every mutating action (create, item edits, hold/resume, merge, split, cancel, close) is limited to `bartender`, `manager`, `admin` — `cashier` is deliberately excluded since the role notes describe cashier as "payments only, no menu editing," and `store_keeper` is inventory-only. Reading (`getOpenTabs`, `getTab`, `getAllTabs`) is additionally open to `cashier` and `accountant`.
- **Shift gating:** `requireActiveShift` blocks every mutating Tab route when the requesting user has no `open` Shift, preventing tabs from being opened or edited outside a tracked shift.
- **Branch scoping:** `createTab` always derives `branch` from the authenticated staff member (`req.user.branch`), never from the request body — a bartender cannot open a tab against a branch they aren't assigned to. `getOpenTabs`/`getAllTabs` scope to the same branch by default; only `admin`/`accountant` may override via `?branch=`.
- **Merge/split same-branch guard:** `tabService.mergeTabs` rejects the operation with `400` if any tab belongs to a different branch than the target; `tabService.splitBill` operates on a single tab so this doesn't apply, but new tabs it creates always inherit the original's branch.
- **Immutable item snapshots:** `name`/`unitPrice` are copied from the `Product`/SKU at `addItem` time and never re-read live — a later menu price change does not retroactively alter an open or historical tab.
- **Server-derived totals:** `subtotal`, `discountTotal`, `grandTotal`, and `balanceDue` are always recomputed in the model's pre-save hook from `items` — none of them can be set directly through any request body.

---

## 🚨 Error Handling

| Status Code | Scenario |
|---|---|
| `400` | Staff member has no assigned branch; missing `product`/`sku`/`quantity` on `addItem`; missing/invalid `quantity` on `updateItemQuantity`; missing `holdReason`/`cancelReason`; fewer than 2 `tabIds` on merge or fewer than 2 `groups` on split; split `groups` don't exactly partition the tab's active items; merged tabs on different branches |
| `401` | Missing or invalid JWT token |
| `403` | Insufficient role (e.g. cashier attempting to add an item); no active shift (`requireActiveShift`) |
| `404` | Branch, tab, item, product, or SKU not found |
| `409` | Item/tab mutation attempted while the tab isn't in a valid status for that action (e.g. adding an item to a `cancelled` tab, holding a tab that isn't `open`, cancelling a `completed` tab) |
| `500` | Unexpected server error |

**Error response shape:**
```json
{
  "success": false,
  "message": "Only an open or held tab can be closed"
}
```

---

## 📊 Database Indexes

```typescript
tabSchema.index({ branch: 1 });   // scope tabs to a branch
tabSchema.index({ status: 1 });   // filter open/held/history views
tabSchema.index({ shift: 1 });    // roll up a shift's tabs for salesSummary reconciliation
// tabNumber already has a unique index from { unique: true } in the schema definition
```

---

**Last Updated:** 2026-08-11
**Version:** 1.0.0
**Maintainer:** POS API Development Team
