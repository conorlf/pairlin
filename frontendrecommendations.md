# Pairlin — Frontend Recommendations for Claude Code Agent

## Context for the Agent

This is the **consumer-facing portal** for Pairlin, a Chrome extension product that removes customs friction for EU shoppers buying from non-EU retailers. The backend (`/backend`) handles:

* IOSS detection (is the retailer VAT-registered in the EU?)
* HS tariff classification per basket item (AI + TARIC live rate lookup)
* Basket optimisation (split orders to stay under €150, or consolidate low-duty orders)
* Mollie payment/escrow (user pays us, we complete the retailer checkout via Playwright)
* Per-user email alias (`name.hash@orders.landedcost.io`) receives all courier/customs emails
* Automated customs payment when a charge arrives (within user's tolerance)
* Surplus refund via Mollie when actual charge < estimate

The portal reflects a **single consumer's orders**, not a B2B freight business. The current frontend was scaffolded for a generic logistics dashboard and has significant mismatches with the actual product. Fix these before the demo.

\---

\---

## 1\. AppShell.tsx — Nav Overhaul

**Current sidebar nav items:**

* Overview
* Live Shipments ← no route exists for this
* Duty Payments
* Audit Logs
* Settings

**Current top header nav:**

* Dashboard, Orders, Payments, Documents ← "Documents" has no backing route

**Current "New Declaration" button** — B2B freight concept, wrong product.

**Changes:**

Replace sidebar nav items with:

```
Overview          → /orders/overview    (keep, rename from Overview)
My Orders         → /orders/            (keep)
Customs Events    → /orders/duty-payments (rename page, see §5)
Settings          → /orders/settings    (keep)
```

Remove "Live Shipments" and the "New Declaration" CTA button from the sidebar entirely.

Top header nav: remove "Documents". Keep Dashboard, Orders, Payments.

\---

## 2\. Overview Page (`orders.overview.tsx`) — Minor Updates

The four stat cards (Active Shipments, Pending Duties, Customs Holds, Cleared This Month) are correct — keep them. The "Recent Shipments" table is fine.

**Add** to the Recent Shipments table:

* An **IOSS badge** column: show a green `IOSS ✓` or red `Non-IOSS` pill per order, sourced from `o.ioss\_protection` or a future field. For now render as a static pill based on `o.estimated\_duty > 0`.
* A **Split** indicator: if the order has a `split\_group\_id` (fetch from backend), show a small `Split ½` or `Split 2/2` label.

**Remove** the two bottom marketing cards ("Tax Optimization" and "Enable Automation"). Replace with a single **Extension Status** card:

```
\[Chrome Extension Active]
Watching retailers in real time — IOSS detection and tariff classification running.
\[Install Extension] or \[Extension installed ✓]
```

This is static UI; no backend call needed.

\---

## 3\. Orders List Page (`orders.index.tsx`) — Minor Updates

Already fetches live from backend — good. Keep as-is with these additions:

**Add** an IOSS status pill in the table alongside the existing Status column. Map `o.ioss\_protection === true` → green `IOSS Protected` badge, else nothing.

**Remove** the two bottom cards ("Tax Optimization" and "Enable Automation") — same as Overview, replace with the Extension Status card.

**Search placeholder**: change from "Search by Order ID, Retailer, or Container..." to "Search by Order ID or Retailer..."  (no containers — this is consumer parcels).

\---

## 4\. Duty Payments Page (`orders.duty-payments.tsx`) — Significant Rework

**Current:** Completely static hardcoded data. USD amounts. B2B invoice framing.

**Rename page heading** to: **"Customs Events"**

**Connect to real data:** The backend has a `customs\_events` table. Add a `backendApi.customs.list()` call (or extend the orders API to include customs events per order). Each row in `customs\_events` has:

* `order\_id` → link to `/orders/$id`
* `courier` (anpost / dhl / fedex)
* `charge\_amount` (EUR)
* `paid\_at` (null if not yet paid)
* `confirmation\_ref`
* `within\_tolerance` (boolean)
* `deadline`

**Replace the table columns** with:

|Order|Courier|Charge (€)|Deadline|Status|Action|
|-|-|-|-|-|-|
|#abc123|An Post|€18.50|Jun 10|Auto-paid ✓|View Receipt|
|#def456|DHL|€34.20|Jun 12|Pending|—|
|#ghi789|FedEx|€67.00|Jun 14|Needs Approval|Approve|

**Status logic:**

* `paid\_at` is set → "Auto-paid ✓" (green)
* `within\_tolerance = true`, `paid\_at` null → "Pending" (processing)
* `within\_tolerance = false` → "Needs Approval" (amber) — show an \[Approve] button that calls `PATCH /api/orders/:id/approve-customs`
* No customs event yet → "Awaiting customs" (grey)

**Remove:** all USD, invoice IDs (INV-xxxx), the static `PAYMENTS` constant.

**"View Receipt"** should link to `GET /api/orders/:order\_id/receipt` which returns a PDF.

\---

## 5\. Audit Logs Page (`orders.audit-logs.tsx`) — Full Replacement

**Current:** Static hardcoded B2B events referencing vessels, manifests, EORI numbers, declarations. Entirely wrong domain.

**Replace static `LOGS` constant** with a real feed sourced from the `emails` table events + `customs\_events`. For now render a mock that matches the actual event types the system produces:

```typescript
const LOGS = \[
  { time: "...", actor: "system", event: "Customs charge €18.50 detected — An Post — auto-paid within tolerance", type: "Payment" },
  { time: "...", actor: "system", event: "Surplus €3.20 refunded to original payment method via Mollie", type: "Refund" },
  { time: "...", actor: "system", event: "Shipping confirmation received from gymshark.com — tracking: JD012345678IE", type: "Shipping" },
  { time: "...", actor: "system", event: "Order confirmation received — retailer ref #GS-98234 — Gymshark", type: "Order" },
  { time: "...", actor: "system", event: "Retailer checkout completed via Playwright — alias email used", type: "Checkout" },
  { time: "...", actor: "user", event: "Excess tolerance updated to €20", type: "Settings" },
];
```

**Update event type badges** to match:

```typescript
const TYPE\_STYLES = {
  Payment:  "bg-\[#ECFDF5] text-\[#065F46]",   // green
  Refund:   "bg-primary-container text-primary-fixed",
  Shipping: "bg-secondary-container text-on-secondary-container",
  Order:    "bg-surface-container text-on-surface",
  Checkout: "bg-surface-container text-on-surface",
  Settings: "bg-surface-container-high text-on-surface-variant",
};
```

Remove: Clearance, Declaration, Compliance, Shipment (vessel) type badges.

\---

## 6\. Settings Page (`orders.settings.tsx`) — Significant Rework

**Current:** B2B fields — Company Name, EORI Number, generic toggles.

**Remove entirely:**

* "Company Name" field
* "EORI Number" field
* "EU documentation automation" toggle

**Replace company profile section** with **Account \& Delivery** section:

```
Name (first + last)     → used by Playwright to fill retailer checkout
Delivery Address        → street, city, postcode, country
                          (stored in users.delivery\_address jsonb)
```

**Replace the toggles** with these three (matching actual backend behaviour):

|Toggle|Default|Backend field|
|-|-|-|
|Email alerts for customs holds|ON|— (email always sent)|
|Auto-pay customs charges within my tolerance|ON|implicit — always auto-pays within tolerance|
|Forward retailer emails to my inbox|ON|— (always forwarded by postmark.ts)|

**Add a new section — Excess Tolerance:**

```
How much over our estimate are you willing to auto-pay?
\[Dropdown: €5 / €10 (default) / €20 / €50 / Custom]
```

This maps to `users.excess\_tolerance` and should call `PATCH /api/users/me` on change.

**Add a new section — Your Email Alias:**

```
Your LandedCost email alias:
  sarah.murphy.a7x92k@orders.landedcost.io   \[Copy]

All order confirmation, shipping, and customs emails from retailers
are delivered here. We handle them automatically and forward them on.
```

Fetch from `GET /api/users/me` → `platform\_email\_alias` field.

\---

## 7\. Order Detail Page (`orders.$id.tsx`) — Additions

The existing structure (timeline + customs breakdown) is correct. Add:

**HS Classification panel** — for each item in `items\_json`, show:

```
Women's leggings — nylon/elastane    6104.63.00    12%    confidence: 94%
Running trainers — rubber sole       6404.11.00    17%    confidence: 88%
```

Map over `order.items\_json` array. Each item has `hsCode`, `hsDescription`, `dutyRate`, `confidence`.

**IOSS Status banner** at the top of the detail view:

* If `ioss\_protection = true` → green banner: "IOSS Protected — VAT collected at checkout. Monitored by Pairlin."
* If `ioss\_protection = false` and `basket\_value\_eur < 150` → amber: "Non-IOSS retailer — duty applied at border."
* If `basket\_value\_eur >= 150` → blue: "Over €150 threshold — full customs duty and VAT applied."

**Split order indicator**: if `split\_group\_id` is set, show a banner:

```
Split order — Part 1 of 2
\[View sibling order →]
```

Link to the sibling using `/orders/$sibling\_id`.

\---

## 8\. What to Leave Alone

* `login.tsx` — keep as-is
* `\_\_root.tsx` — keep as-is
* `AppShell.tsx` layout structure — keep the two-panel layout, just update nav items and branding
* React Query setup, TanStack Router config — do not change
* Tailwind / Material Design token system — keep all colour tokens
* `src/lib/api/backend.ts` — keep existing API client, extend it with `customs.list()` and `users.me()`
* The name of the service "Pairlin"

\---

## Priority Order for Demo

1. **Settings** — excess tolerance dropdown + alias display (unique to Pairlin, demo-critical)
2. **Branding** — "Pairlin" everywhere
3. **Customs Events page** — replace static data with real `customs\_events` from backend
4. **Order detail** — add HS classification panel + IOSS banner
5. **Audit Logs** — replace B2B static events with consumer-relevant event types
6. **Overview / Orders list** — minor additions (IOSS badge, remove marketing cards)

