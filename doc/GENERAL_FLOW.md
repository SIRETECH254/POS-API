# Club POS — General Overview

This document explains how the Club POS system works in plain language. No technical knowledge is needed to understand it. It is written for club owners, managers, investors, and anyone who wants to understand what the system does and why it was built this way.

---

## What Is the Club POS?

The Club POS is a Point of Sale system built specifically for how clubs and bars operate. Most POS systems are designed for restaurants or retail shops. This one is designed around **how a club actually runs** — bartenders opening tabs, customers running a bill all night, paying at the end, and managers keeping track of every cent.

Everything in the system connects back to one central idea: **the Sale Tab**. A tab is the running bill for a customer or group. Everything else — stock, payments, receipts, reports — exists to support that tab.

---

## The People Who Use the System

**Bartender** — Opens tabs, adds drinks, handles payments at the bar. This is the person using the system most throughout the night.

**Cashier** — Handles payments only. Does not manage the menu or stock.

**Store Keeper** — Manages stock, receives deliveries, and tracks inventory. Does not handle sales.

**Manager** — Oversees the branch. Can see all tabs, approve adjustments, review variances, and access reports.

**Administrator** — Has full access to the entire system including all branches, settings, and user accounts.

**Accountant** — Read-only access to financial records and reports.

---

## How a Typical Night Runs

1. A **bartender clocks in** at the start of their shift and declares their opening cash float.
2. A customer arrives. The bartender **opens a tab** for them.
3. As the customer orders, the bartender **adds drinks to the tab**.
4. If the customer wants to hold their tab (step out, take a break), the bartender **puts it on hold**.
5. Later, the customer is ready to pay. The bartender **closes the tab** and takes payment — cash, M-Pesa, card, or a combination.
6. A **receipt is generated** automatically.
7. At the end of the night, the bartender **closes their shift**, declares their closing cash, and the system shows whether the numbers match.
8. The manager **reviews the shift summary** and investigates any discrepancy.

This is the core loop. Everything else supports it.

---

## The System Sections

### Login & Access

Before anyone can use the system, they must log in. Staff have two ways to log in:

- **Full login** — Email or phone number plus a password. Used when first arriving for a shift.
- **PIN login** — A short 4–6 digit PIN for quick access during a busy shift. Faster and designed for the bar environment.

Each person only sees what their role allows. A bartender cannot access financial reports. A store keeper cannot process payments. Access is controlled automatically based on who is logged in.

If someone is inactive for too long, the system logs them out automatically for security.

---

### Dashboard

When someone logs in, they land on a dashboard that shows them what they need to see for their role.

**Bartender Dashboard** shows:
- All currently open tabs at their bar
- Total sales so far today
- Any items that are running low in stock
- Any M-Pesa payments still waiting to be confirmed

**Manager Dashboard** shows:
- Revenue for the day
- Estimated profit
- Total stock value
- Best-selling products
- Open tabs across the branch
- Which staff members are currently logged in

The dashboard gives a live picture of what is happening at the club right now.

---

### Sales (The Heart of the System)

This is where bartenders spend most of their time. Every sale in the system flows through a **Sale Tab**.

**Opening a Tab**
When a customer or group arrives, the bartender opens a tab. The system assigns it an automatic number — for example, `MAIN-TAB-000001`. The branch name is part of the number so tabs from different locations are always identifiable.

**Adding Items**
The bartender selects drinks from the menu and adds them to the tab. Quantities can be adjusted. If a customer changes their mind, an item can be removed or cancelled individually without affecting the rest of the tab.

**Holding a Tab**
If a customer is not ready to pay but has stopped ordering, the bartender can hold the tab and free up their attention for other customers. The tab stays open and can be resumed at any time.

**Merging Tabs**
If two groups of customers decide to sit together and pay as one, the bartender can merge their tabs into a single bill.

**Splitting a Bill**
If a group wants to pay separately, the bill can be split — each person pays only for what they ordered.

**Cancelling a Tab**
If a customer leaves without paying (or a mistake was made), a tab can be cancelled. A reason must be recorded, and this is logged for the manager to review.

**Closing a Tab**
When the customer is ready to pay, the bartender closes the tab and moves it to the payment stage.

---

### Payments

Once a tab is closed, it is ready for payment. The system supports several payment methods and they can be combined in a single transaction.

**Cash**
The bartender enters the amount received. The system calculates the change automatically and signals the cash drawer to open.

**M-Pesa**
The customer receives a payment prompt on their phone (STK Push). Once they enter their PIN, the system receives confirmation automatically. If the first attempt fails, the bartender can retry. Only a manager can reverse an M-Pesa payment.

**Card**
The customer pays using a card terminal. The bartender can also enter card details manually if needed.

**Mixed Payment**
A customer can pay part in cash and part by M-Pesa in the same transaction. For example, KES 500 cash and KES 800 M-Pesa for a KES 1,300 bill.

Once payment is confirmed and the full amount is covered, the tab is automatically marked as completed and a receipt is generated.

---

### Products

Managers set up the products that appear on the menu. Each product has:

- Name and category (e.g., Tusker — Beer)
- Description and image
- Status (active, inactive, or discontinued)

Pricing and stock tracking live separately under SKUs (see below), because the same product can be sold in different forms — for example, a bottle of Tusker is different from a crate of Tusker. Each has its own price, barcode, and stock level.

---

### Categories

Products are grouped into categories so they are easy to find during a busy shift.

Examples: Beer, Wine, Whisky, Vodka, Soft Drinks, Cocktails, Food.

Categories are managed by the admin or manager and apply across all branches.

---

### Inventory

Inventory tracks every bottle, crate, or unit in the club.

**Purchases (Receiving Stock)**
When a supplier delivers goods, the store keeper records the delivery — what was received, the quantity, the purchase price, and the supplier invoice number. The moment goods are marked as received, the stock levels update automatically.

**Stock Movements**
Every time a unit moves — sold at the bar, received from a supplier, damaged, adjusted, or transferred — the system records it. This creates a complete history of where every item came from and where it went.

**Stock Adjustments**
If a bottle is broken, expired, or goes missing, the store keeper records an adjustment. A reason must be provided. Large negative adjustments require manager approval.

**Stock Count (Stock-Take)**
Once a month (or whenever needed), staff physically count everything in the store. The system shows what it expects to find. Staff record what they actually find. Any difference is flagged, reviewed, and corrected.

**Branch Transfers**
If one branch has surplus stock and another is running low, stock can be transferred between branches. Both branches' records update automatically.

---

### Suppliers

Every product comes from a supplier. The system keeps a record of each supplier including their contact details, which products they supply, and which branches they deliver to.

The system also tracks the supplier's financial history — all invoices, total purchases, and any outstanding balance owed to them.

---

### Customers (Optional)

Most club customers are walk-ins with no account. The system is designed around this and does not require a customer to be registered to make a sale.

However, the system supports optional customer records for:
- VIP clients
- Corporate accounts
- Regular customers on a loyalty programme
- Credit accounts (pay later arrangements)

This can be enabled or expanded later without rebuilding anything else.

---

### Staff

The system keeps a record of all employees. Each staff member has a profile with their name, phone number, role, and login credentials. Their account can be activated or suspended by a manager or administrator.

Staff are tied to a home branch, so their activity — tabs, sales, shifts — is always recorded against the correct location.

---

### Roles & Permissions

Every staff member is assigned a role. The role determines exactly what they can and cannot do.

| Role | Can Do |
|---|---|
| Bartender | Open tabs, sell, take payments, view products |
| Cashier | Take payments only |
| Store Keeper | Manage inventory, receive stock |
| Manager | Everything within their branch |
| Administrator | Everything across all branches |
| Accountant | View financial records only |

No one can access parts of the system outside their role. This protects the business from mistakes and misuse.

---

### Purchase Management

When a supplier delivers goods to the club, the system handles the process:

1. A purchase order is created (what was ordered and from whom).
2. When the delivery arrives, the store keeper confirms the goods received.
3. Stock levels update automatically for the receiving branch.
4. The supplier's ledger updates — what was paid and what is still owed.

This is the only way stock officially enters the system, which means every unit can be traced back to a delivery.

---

### Expenses

Not every payment the club makes is for stock. There are many other costs — rent, electricity, water, the DJ, security, cleaning, fuel, repairs, and marketing.

These expenses are recorded in the system. Without them, the profit reports would show more money than the club actually made. Recording expenses gives an accurate picture of the true cost of running the business.

Each expense is recorded with the amount, category, payment method, and an optional photo of the receipt.

---

### Reports

Reports give management the information they need to make good decisions. The system produces several types.

**Sales Reports** — Total sales by day, week, month, or year.

**Product Reports** — Which products sell the most, which sell slowly, and which have never been sold.

**Payment Reports** — Breakdown of revenue by payment method (cash, M-Pesa, card).

**Inventory Reports** — Current stock levels, low stock warnings, total stock value, damaged items, expired goods.

**Profit Reports** — Revenue minus cost of goods minus expenses equals net profit. This is the real financial health of the club.

**Employee Reports** — Sales per bartender, cancelled tabs, discounts given, and shift summaries.

**Supplier Reports** — Purchase history, outstanding balances, and invoices per supplier.

All reports can be filtered by branch. Administrators can also see a combined view across all branches.

---

### Receipts

Every completed sale automatically generates a receipt. The system supports:

- Printed receipts (thermal printer at the bar)
- PDF receipts (saved digitally)
- Reprint — if a customer needs a duplicate
- Refund receipts — if a payment is reversed

Email receipts (sending directly to the customer) are planned for a future update.

---

### Notifications

The system sends automatic alerts so the right people always know what is happening.

| Notification | Who Receives It |
|---|---|
| Item is running low in stock | Manager, Store Keeper |
| A shift has started or ended | Manager |
| An M-Pesa payment failed | Bartender on shift |
| A payment was confirmed | Bartender on shift |
| Daily sales summary | Manager |

Notifications appear in real time on the screen and are saved in a notification history so nothing is missed.

---

### Audit Logs

Every important action in the system is recorded permanently. This cannot be turned off and the records cannot be edited or deleted.

Examples of what is logged:
- A price was changed (by who, from what to what, at what time)
- A tab was cancelled (by who, reason given)
- A payment was reversed (by who, why)
- A stock adjustment was made (by who, how much, reason)

This protects the business. If money goes missing or a mistake is made, the audit log shows exactly what happened and who did it.

---

### Settings

Administrators and managers can configure the system to match how the club operates.

Settings include:
- Business name, address, and phone number
- Tax rate applied to sales
- Receipt footer message
- Payment methods that are enabled (cash, M-Pesa, card)
- Printer type and connection
- Currency
- Low stock threshold
- Theme and display preferences

Each branch has its own settings, so a second location can have a different tax rate, printer, or receipt layout without affecting the first.

---

### Shift Management

This is one of the most important features for a club and one that many systems overlook.

At the start of a shift, the bartender declares how much cash is in the till (the opening float). During the shift, they process sales. At the end of the shift, they count the cash in the till and report the amount.

The system then calculates:

| | Amount |
|---|---|
| Opening float | KES 5,000 |
| Cash sales during shift | KES 48,000 |
| Expected closing cash | KES 53,000 |
| Actual cash counted | KES 52,500 |
| Variance | − KES 500 |

If the numbers do not match, the manager is notified and must investigate. The variance and the manager's notes are recorded permanently.

No tab can be opened without an active shift. This means there is always a clear record of who was responsible for what happened at the bar during a given period.

---

### Analytics

Analytics goes beyond reports by showing trends and patterns over time.

**Sales Trend** — Is revenue growing or declining week over week?

**Profit Trend** — Is the club becoming more or less profitable over time?

**Peak Hours** — What time of day or night is the busiest? (Useful for scheduling staff.)

**Top Products** — Which items drive the most revenue?

**Payment Distribution** — What percentage of customers pay by cash, M-Pesa, or card?

**Inventory Value Trend** — Is the value of stock held going up or down?

**Branch Comparison** — For clubs with multiple locations, side-by-side performance across branches. (Administrator only.)

---

## How Everything Connects

The diagram below shows how the different parts of the system relate to each other.

```
              Suppliers
                  │
                  ▼
        Purchase Management
                  │
                  ▼
             Inventory
                  │
                  ▼
              Products
                  │
                  ▼
           SALE TAB (CORE)
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
  Payments    Stock Update  Receipts
     │                         │
     └────────────┬────────────┘
                  ▼
            Sales Records
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
     Reports  Analytics   Profit
```

Everything connects back to the Sale Tab:

- **Products** exist so tabs can contain items.
- **Inventory** tracks what is available to sell.
- **Payments** settle the tab.
- **Receipts** are produced when the tab is completed.
- **Stock** is reduced when a tab completes.
- **Reports** summarise completed tabs.
- **Profit** is calculated from completed tabs.
- **Audit logs** record any changes made to tabs.

---

## The Sale Tab Lifecycle

A tab moves through clear stages from the moment it is opened to the moment it is archived.

```
Draft
  │
  ▼
Open  ◄──────────────────────┐
  │                          │
  ▼                       (resume)
Items Added               (hold)
  │                          │
  ▼                        Held
Awaiting Payment
  │
  ├── Cash
  ├── M-Pesa
  └── Card (or any combination)
  │
  ▼
Payment Confirmed
  │
  ▼
Completed
  │
  ▼
Archived
(available for reports and reprints)

Open ──► Cancelled
(if the customer leaves or a mistake is made — reason required)
```

This lifecycle is the foundation of the entire system. Everything else either supports a tab reaching Completed or makes sense of what happened after it did.

---

## Why It Was Built This Way

Most POS systems are built around a generic "sale" concept. This system is built around the reality of running a club:

- Customers run tabs all night, not single transactions.
- Bartenders need speed, not complicated menus.
- Managers need to know if money is missing before the night is over.
- Stock must be traceable from the moment it arrives to the moment it is sold.
- Multiple branches need to be managed from one place without getting their records mixed up.
- Every action must be logged because accountability matters in a cash-heavy environment.

The system is designed to grow. If the club adds a new branch, a VIP programme, kitchen orders, or table reservations later, those features can be added without rebuilding anything. The core — the Sale Tab — stays the same.

---

**Version:** 1.0
**Audience:** Club owners, managers, investors, and non-technical stakeholders
**Last Updated:** July 2026
