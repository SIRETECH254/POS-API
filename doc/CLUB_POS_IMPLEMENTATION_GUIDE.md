# Club POS — Backend Implementation Guide

A procedural, dependency-ordered build plan. Each phase only depends on
phases before it — follow the order and you will never be blocked waiting
on a model, route, or seed data that "should have" existed already.

**Stack:** Node.js + Express + TypeScript + MongoDB (Mongoose) + Socket.io + JWT

---

## Why order matters here

This system has a real dependency chain, not just a list of features:

```
Branch  →  Auth/Roles/Users  →  Shift  →  Category/Product/SKU  →  Supplier
   →  Purchase/Inventory  →  Tab (Sales)  →  Payment  →  Receipt
   →  Expense  →  Reports/Analytics  →  Notifications  →  Audit  →  Settings
```

Reasons this order is non-negotiable, straight from the domain model:

- **Every transactional document carries a `branch` reference** (`Tab`,
  `Shift`, `Purchase`, `Expense`, `StockMovement`...). If `Branch` doesn't
  exist yet, nothing else can be created or even schema-validated correctly.

- **A bartender cannot open a Tab without an active Shift** (`requireActiveShift`
  middleware) — so Shift must work before Sales.

- **A Tab line item references a `SKU`, not a `Product`** — so Product and
  SKU must exist, and SKU needs `Supplier` as its default/primary supplier
  reference before you can safely create one.

- **Stock only ever enters the system through a received `Purchase`**, which
  writes a `StockMovement` and updates `SKU.stockByBranch`. So Inventory
  logic must exist before Tabs can safely sell anything.

- **Payments, Receipts, Reports, Analytics, and Profit are all derived from
  completed Tabs.** They are read/aggregation layers — build them last, once
  there's real data flowing through the Tab lifecycle to report on.

- **Audit Logging and Settings wrap other modules** rather than depending on
  business data, so they're safe to bolt on last (or in parallel once
  Branch + Auth exist).

---

## Phase 0 — Project Scaffolding

Do this once, before any domain code.

1. `npm init`, install core + dev dependencies (see package list in your
   backend doc — express, mongoose, mongoose-paginate-v2, joi, socket.io,
   jsonwebtoken, bcryptjs, dotenv, cors, etc.)

2. Add `tsconfig.json`.

3. Create the folder skeleton: `src/{config,models,controllers,routes,
   middleware,services/internal,services/external,utils,jobs,types}`.

4. Set up `.env` with `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `PORT`, `CORS_ORIGIN`.

5. `config/db.ts` — Mongo connection.

6. `src/index.ts` — bare Express app + Socket.io bootstrap + health check
   route (`GET /api/health`). Confirm it boots before writing a single model.

7. `middleware/errorHandler.ts` and `middleware/validate.ts` (Joi wrapper) —
   every controller from Phase 2 onward will use these, so write them now.

**Checkpoint:** server starts, `/api/health` returns 200, MongoDB connects.

---

## Phase 1 — Branch (the root of everything)

Nothing else can be built safely until this exists, because every other
collection scopes itself to a branch.

1. Model: `Branch` (`name`, `code`, `address`, `phone`, `isMainBranch`,
   `isActive`).

2. Controller: `branchController.ts` — `createBranch`, `getAllBranches`,
   `getBranch`, `updateBranch`, `deactivateBranch`, `getBranchSummary`.

3. Routes: `/api/branches`.

4. `utils/numberGenerators.ts` — start this now. Every branch-prefixed
   sequence (`TAB-`, `PAY-`, `PO-`, `SHIFT-`, `SC-`, `TRF-`) depends on
   `Branch.code`, so build the generator utility here even though you won't
   use most of it until later phases.

5. Seed script: `npm run seed:branch` — creates the first (main) branch.
   **Run this before anything else touches the database.**

**Checkpoint:** you can create a branch via API, and `seed:branch` produces
a working `MAIN` branch you'll reference for the rest of local development.

---

## Phase 2 — Auth, Roles, Users

Depends on: Branch (every `User` has a home `branch`).

1. Model: `Role` (`name`, `permissions[]`, `isSystemRole`).

2. Seed script: `npm run seed:roles` — the 6 system roles (administrator,
   manager, bartender, cashier, store_keeper, accountant) with permission
   sets as described in your docs. Run this immediately after `seed:branch`.

3. Model: `User` — include `branch` ref, `password`/`pin` as
   `select: false`, `status` boolean, `currentShift` (leave null for now,
   wired up in Phase 3).

4. `middleware/auth.ts` — `authenticateToken`, `authorizeRoles(...roles)`,
   `requirePermission(permission)`.

5. `middleware/requireBranchAccess.ts` — build this now, it will gate
   almost every route from Phase 4 onward.

6. Controller: `authController.ts` — `login`, `pinLogin`, `logout`,
   `forgotPassword`, `resetPassword`, `refreshToken`, `getMe`.

7. Controller: `userController.ts` — staff CRUD, `setUserStatus`, profile,
   `changePassword`, `setPin`.

8. Controller: `roleController.ts` — CRUD, blocked delete for system roles.

9. Routes: `/api/auth`, `/api/users`, `/api/roles`.

10. Create your first real administrator user against the seeded `MAIN`
    branch — you'll use this account for the rest of the build.

**Checkpoint:** you can log in, get a JWT, hit a protected route, and role
+ branch scoping middleware correctly rejects cross-branch/unauthorized
requests. **Do not proceed until this works** — every subsequent phase's
routes sit behind this middleware.

---

## Phase 3 — Shift

Depends on: Branch, Auth/User.
Required by: Tabs (Phase 6) — a Tab cannot be created without an open Shift.

1. Model: `Shift` (`branch`, `staff`, `openingFloat`, `closingCash`,
   `salesSummary`, `status`, timestamps, `varianceReviewedBy`).

2. `middleware/requireActiveShift.ts` — checks the requesting user has an
   `open` Shift at their branch. Build and unit-test this in isolation now;
   it gates Tab creation later.

3. `services/internal/shiftReconciliationService.ts` — expected-vs-actual
   cash calculation logic, called on `endShift`.

4. Controller: `shiftController.ts` — `startShift`, `endShift`,
   `getActiveShifts`, `getShiftHistory`, `getShift`, `reviewVariance`.

5. Routes: `/api/shifts`.

6. Wire `User.currentShift` to update on `startShift`/`endShift`.

**Checkpoint:** a staff user can start a shift, and `requireActiveShift`
correctly blocks a downstream action (test it against a stub route or
wait until Phase 6 — either way, verify the middleware logic here).

---

## Phase 4 — Catalog: Category → Product → SKU → Supplier

Depends on: Branch, Auth. Independent of Shift.
Required by: Purchases, Inventory, Tabs (all reference `SKU`).

Build in this internal order — each sub-step depends on the one above it:

1. **Category** (`categoryController.ts`) — shared across branches, no
   dependencies beyond auth. CRUD + routes `/api/categories`.

2. **Supplier** (`supplierController.ts`) — needs to exist before SKU
   because `SKU.supplier` references it. CRUD + `getSupplierHistory` +
   routes `/api/suppliers`. (`outstandingBalance` and history will be
   empty/zero until Phase 5 — that's expected.)

3. **Product** (`productController.ts`) — catalog entry only (name,
   category, image, description). References `Category`. CRUD + image
   upload (`Cloudinary` config from Phase 0 needed here) + routes
   `/api/products`.

4. **SKU** (`skuController.ts`) — the entity everything transactional
   actually points to. References `Product` and `Supplier`.
   - `createSku`, `getAllSkus`, `getSku`, `updateSku`, `deleteSku`
   - `getLowStockSkus` (scoped to branch)
   - `searchByBarcode` (scoped to branch)
   - `setBranchStockLevel` — needed to *initialize* `stockByBranch` for a
     branch/SKU pair before any real purchase happens; use this to seed
     starting stock for test data.
   - Routes: `/api/skus`.

**Checkpoint:** you can create a category, a supplier, a product, and at
least one SKU under that product with a `stockByBranch` entry for `MAIN`.
This is your first end-to-end catalog record — verify barcode and
low-stock lookups are branch-scoped correctly.

---

## Phase 5 — Purchases & Inventory (how stock enters the system)

Depends on: Branch, Auth, Shift (for audit trail attribution), Supplier, SKU.
Required by: Tabs — you need real, non-zero stock before sales can deduct
anything meaningfully.

This is the phase to get right before touching Sales — inventory
correctness is the foundation everything downstream (reports, profit,
audit) relies on.

1. Model: `StockMovement` (immutable ledger) — build this model **first**,
   before `Purchase`, because Purchase's `receiveGoods` action needs to
   write to it.

2. `services/internal/inventoryService.ts` — the single entry point for
   *all* branch-scoped stock changes. Every other module must go through
   this service to touch `SKU.stockByBranch` — never edit that field
   directly from a controller.

3. Model + Controller: `Purchase` — `createPurchaseOrder`, `receiveGoods`
   (writes `StockMovement type: 'purchased'`, increments
   `stockByBranch.currentStock` via `inventoryService`, updates
   `Supplier.outstandingBalance`), `getAllPurchases`, `getPurchase`,
   `recordSupplierPayment`. Routes: `/api/purchases`.

4. Model + Controller: `StockAdjustment` — breakages/theft/corrections,
   manager approval required for negative adjustments. Routes under
   `/api/inventory/adjustments`.

5. Model + Controller: `StockCount` — monthly stock-take, `startStockCount`
   → `submitStockCount` → `reconcileStockCount` (reconciliation generates
   `StockAdjustment` + `StockMovement` entries automatically). Routes undero
   `/api/inventory/stock-counts`.

6. Model + Controller: `Transfer` — branch-to-branch. `createTransfer` →
   `dispatchTransfer` (writes `transferred_out`) → `receiveTransfer`
   (writes `transferred_in`). Only relevant if you have >1 active branch;
   otherwise stub the routes and revisit when branch 2 goes live.

7. `inventoryController.ts` — `getStockMovements` (filterable ledger view).
   Routes: `/api/inventory`.

**Checkpoint:** create a purchase order, mark it received, and confirm
`SKU.stockByBranch.currentStock` increments correctly and a
`StockMovement` record exists. Run a stock adjustment and a stock count
reconciliation end-to-end. **Do not start Phase 6 until stock is
demonstrably flowing correctly** — Tabs will silently produce bad data
otherwise.

---

## Phase 6 — Tabs (Sales) — the core entity

Depends on: Branch, Auth, **active Shift**, SKU with real stock.

This is the heart of the system — build it carefully and test each Tab
lifecycle transition individually before moving on.

1. Model: `Tab` — implement the full lifecycle enum:
   `draft → open → held/awaiting_payment → paid → completed → cancelled → archived`.
   Include `mergedFrom`/`splitInto` arrays, item snapshots (`name`,
   `unitPrice` captured at add-time, not looked up live).

2. `services/internal/tabService.ts` — totals recalculation (pre-save
   hook trigger), merge/split logic, lifecycle transition guards.

3. Controller: `tabController.ts`, gated by `requireActiveShift`:
   - `createTab` (requires open shift, branch from staff's session)
   - `addItem`, `updateItemQuantity`, `removeItem`, `cancelItem`
   - `holdTab`, `resumeTab`
   - `mergeTabs` — same-branch only
   - `splitBill` — same-branch only
   - `cancelTab` — requires `cancelReason`, writes to `AuditLog` (stub
     this call now; wire the real `auditLogger` middleware in Phase 10 —
     or pull Phase 10's `AuditLog` model forward if you'd rather have
     logging live from day one on this sensitive action)
   - `closeTab` — moves to `awaiting_payment`
   - `getOpenTabs`, `getTab`, `getTabHistory`

4. Routes: `/api/tabs`.

5. **Critical rule to implement exactly as specified:** inventory is only
   deducted (`StockMovement type: 'sold'`, via `inventoryService`) when a
   Tab reaches `completed` — never when items are merely added. Held or
   cancelled tabs must not reserve or deduct stock.

6. Socket.io: wire `tab:opened` / `tab:updated` / `tab:closed` events to
   `branch:<branchId>:role:bartender` and `...:role:manager` rooms now,
   since this is the highest-frequency real-time event in the system.

**Checkpoint:** full lifecycle test — open a tab under an active shift,
add items (confirm no stock deduction yet), hold/resume it, close it to
`awaiting_payment`. Stock should still be untouched at this point — it
only moves once Payment (Phase 7) confirms the Tab as `completed`.

---

## Phase 7 — Payments

Depends on: Tab (awaiting_payment state), Shift.

1. Model: `Payment` — `method`, `status`, method-specific sub-objects
   (`mpesa`, `card`), `reversedBy`/`reversedReason`.

2. `services/external/darajaService.ts` — M-Pesa STK Push + callback
   signature verification.

3. `services/external/cardTerminalService.ts` — abstraction over
   terminal/manual card entry.

4. Controller: `paymentController.ts`:
   - `payCash` — receive amount, calculate change, drawer-open signal
   - `payCard`
   - `recordMixedPayment` — multiple payment lines against one tab
   - `initiateMpesaPayment` → creates `Payment` as `pending`
   - `mpesaCallback` (public webhook) → flips to `completed`/`failed`,
     and **this is what should trigger the Tab's `awaiting_payment →
     completed` transition** once `amountPaid >= grandTotal` — this is
     the point where `inventoryService` finally deducts stock
   - `retryMpesaPayment`
   - `reverseMpesaPayment` — manager only, logged to audit

5. Routes: `/api/payments`.

6. Socket.io: `payment:mpesa:pending` / `payment:mpesa:confirmed` /
   `payment:mpesa:failed` to `shift:<shiftId>` room.

**Checkpoint:** close out a Tab with cash, with a single M-Pesa payment,
and with a mixed cash+M-Pesa payment. Confirm the Tab flips to
`completed` only when fully paid, and that stock deduction from Phase 6's
rule fires exactly once, at that transition.

---

## Phase 8 — Receipts

Depends on: completed Tab, Payment.

1. Model: `Receipt`.

2. `utils/generateReceiptPDF.ts` (pdfkit).

3. `services/external/printerService.ts` (ESC-POS/thermal — optional if
   you're starting with PDF/email only).

4. Controller: `receiptController.ts` — `generateReceipt`, `printReceipt`,
   `reprintReceipt`, `generateRefundReceipt`, `emailReceipt`.

5. Routes: `/api/receipts`.

**Checkpoint:** generate and download/print a receipt PDF for a completed
Tab; reprint works without duplicating the receipt record incorrectly.

---

## Phase 9 — Expenses

Depends on: Branch, Auth. Independent of Tab/Payment, but logically comes
after Sales since it feeds Profit Reports alongside sales data.

1. Model: `Expense` — category enum, `approvedBy`, `recordedBy`.

2. Controller: `expenseController.ts` — CRUD + `approveExpense`.

3. Routes: `/api/expenses`.

**Checkpoint:** record and approve an expense; confirm it's scoped to a
branch correctly.

---

## Phase 10 — Reports & Analytics

Depends on: everything above — this phase reads and aggregates data from
Tabs, Payments, StockMovements, Purchases, Expenses, and Shifts. Building
it earlier just means aggregating over empty collections.

1. Controller: `reportController.ts`:
   - `getSalesReport(range)` (today/yesterday/weekly/monthly/yearly)
   - `getProductReport` (best sellers/slow movers/never sold)
   - `getPaymentReport`
   - `getInventoryReport`
   - `getProfitReport` (revenue − cost of goods − expenses)
   - `getEmployeeReport` (sales per bartender, cancelled tabs, discounts,
     shift reports)
   - `getSupplierReport`
   - All accept optional `branch` filter; admins can request a
     consolidated multi-branch view.

2. Routes: `/api/reports`.

3. Controller: `analyticsController.ts` — sales trend, profit trend, peak
   hours, top products, payment distribution, inventory value trend,
   `getBranchComparison` (admin only).

4. Routes: `/api/analytics`.

**Checkpoint:** run each report against your test data from Phases 6–9
and sanity-check the numbers by hand for at least one full day of
simulated activity.

---

## Phase 11 — Notifications

Depends on: Branch, Auth, and the events it announces (low stock, shift
start/end, M-Pesa failures, payment success) — so it's naturally last of
the "business logic" phases, though the Socket.io wiring for individual
events (Phases 6–7) can technically happen earlier if you prefer building
real-time feedback as you go.

1. Model: `Notification`.

2. `services/internal/notificationService.ts`.

3. `jobs/lowStockSweep.ts`, `jobs/dailySummary.ts` (node-cron, per branch).

4. Controller: `notificationController.ts` — `getMyNotifications`,
   `getUnreadCount`, `markAsRead`, `markAllAsRead`, cron-triggered
   `sendLowStockAlert`, `sendDailySummary`.

5. Routes: `/api/notifications`.

**Checkpoint:** trigger a low-stock condition manually and confirm both
the Socket.io push and the persisted `Notification` record appear.

---

## Phase 12 — Audit Logs

Can technically be built in parallel with Phase 2 onward (it only needs
Branch + Auth), but it's listed last because it's a **wrapper** around
sensitive actions in other modules rather than a standalone feature. If
you want tamper-evidence from day one, pull the `AuditLog` model and
`auditLogger` middleware forward to right after Phase 2 and attach it as
you build each sensitive action (price edits, tab cancellations, payment
reversals, role changes).

1. Model: `AuditLog` — `before`/`after` snapshots, never editable/deletable.

2. `middleware/auditLogger.ts` — wraps sensitive writes.

3. Controller: `auditController.ts` — `getAuditLogs` (manager/admin only,
   filterable), `getEntityHistory(entityType, entityId)`.

4. Routes: `/api/audit-logs`.

5. Retroactively attach `auditLogger` to: price edits, tab cancellations,
   payment reversals, role assignment, stock adjustments.

**Checkpoint:** trigger a price change and a payment reversal, confirm
both produce correct before/after `AuditLog` entries.

---

## Phase 13 — Settings & Dashboards (polish layer)

Last because dashboards are just read-aggregations over everything else,
and Settings only needs to exist once you have real per-branch
configuration to store (tax rate, printer, receipt footer).

1. Model: `Settings` (one document per branch) — create at branch setup
   time going forward; backfill one for `MAIN` now if you haven't already.

2. Controller: `settingsController.ts` — `getSettings`, `updateSettings`,
   `updatePrinterConfig`, `updateReceiptLayout`.

3. Routes: `/api/settings`.

4. Controller: `dashboardController.ts` — `getBartenderDashboard` (open
   tabs, today's sales, low stock, pending M-Pesa), `getManagerDashboard`
   (revenue, profit, stock value, best sellers, open tabs, staff online).
   These are read-only aggregations pulling from Tab, Payment, SKU,
   Shift, and User — build last since they depend on all of them.

5. Routes: `/api/dashboard`.

6. `config/swagger.ts` + `/api/docs` — document the full API surface now
   that it's stable.

**Checkpoint:** both dashboards render correctly against a full day of
simulated bar activity, and per-branch settings (tax rate, currency)
correctly affect Tab totals and receipts.

---

## Quick-reference build order

| # | Phase | Hard dependency |
|---|-------|------------------|
| 0 | Scaffolding | — |
| 1 | Branch | Phase 0 |
| 2 | Auth / Roles / Users | Branch |
| 3 | Shift | Auth, Branch |
| 4 | Category → Product → SKU → Supplier | Auth, Branch |
| 5 | Purchases & Inventory | SKU, Supplier, Shift |
| 6 | Tabs (Sales) | Active Shift, SKU with stock |
| 7 | Payments | Tab |
| 8 | Receipts | Completed Tab, Payment |
| 9 | Expenses | Branch, Auth |
| 10 | Reports & Analytics | Tabs, Payments, Purchases, Expenses |
| 11 | Notifications | Events from Phases 5–7 |
| 12 | Audit Logs | Branch, Auth (parallelizable earlier) |
| 13 | Settings & Dashboards | Everything |

**Golden rule while building:** if a controller you're writing needs to
reference a model or service that doesn't exist yet, that's a signal
you're out of order — go back one phase.
