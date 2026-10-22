# BOKPOINTS: Product Requirements Document (PRD)

Version 0.2 (draft), updated with the product owner's decisions on expiry, offline awarding, app formats and billing. Product owner and product manager: A. Prepared with Claude. Status: planning, no build started.

## 1. Summary

BOKPOINTS is a loyalty platform that gives small and medium-sized businesses (SMEs) the same retention tools that large chains have: points, rewards, discounts and customer alerts. Customers earn points when a cashier scans them at purchase, and they see their balance for every participating store in one place.

The product has three surfaces: a customer dashboard, a store dashboard and an admin panel. Stores pay a monthly subscription. Customers use the product for free. The first market is Finland / EU.

## 2. Problem and opportunity

Big chains win repeat customers through loyalty programs, targeted offers and notifications. Small businesses lack the budget and technology to do the same, so they lose returning customers to chains that reward them.

Customers feel this too. Many favor stores that give rewards over independent shops that do not, even when they would prefer the independent shop.

Opportunity: give SMEs a ready-made loyalty and marketing tool at a monthly price they can afford, and give customers one wallet that collects rewards across the local shops they already use.

## 3. Vision and positioning

BOKPOINTS is a B2B2C product.

- Business customer (pays): the SME, which gets a loyalty program and a marketing channel to its existing customers.
- End user (free): the shopper, who earns and tracks points across stores.

The store dashboard is the product being sold. The customer app is what makes it sticky, because shoppers return to the stores where they hold points.

## 4. Users and roles

A customer has one global account (identified by a verified email address, with duplicates prevented). Stores link customers to their store; they do not own separate accounts for them.

## 5. Business model

- Revenue: monthly subscription paid by each store.
- Customers: free.
- Failed payments: reminder to the owner at day 7, store paused at day 14 (campaigns, rewards and rules locked, awarding continues), store suspended at day 30 (awarding blocked). Customers keep access to their balances throughout.
- Pricing details: not decided yet (see open questions). Candidates include flat tiers by feature set, or tiers by number of active customers.

| Role | Who | Main needs |
| --- | --- | --- |
| Admin | The software owner (A, initially the only admin) | Onboard stores, manage accounts, handle support, monitor the platform and billing |
| Store owner | SME owner or manager | Set up the points program, manage products and offers, view and manage customers, send alerts, manage staff and subscription |
| Store staff / cashier | Employee at the till | Identify a customer quickly, enter the purchase amount, award points, redeem rewards |
| Customer | Shopper | One account, see points per store, see available rewards and offers, receive relevant alerts |

Cost items to plan for: physical NFC cards (who pays for them), email delivery, app store accounts and fees, and payment processing for subscriptions. SMS may come later; its fees are normally billed to the sender.

## 6. Goals and non-goals

### Goals

1. Let a cashier award points to a customer in a few seconds at the till.
2. Give customers a single view of their points at every participating store.
3. Give stores tools to manage customers, rewards, discounted products and customer alerts without technical skills.
4. Give the admin full control to onboard and support stores.
5. Design the system so that new identification methods (NFC card, wallet passes) and POS integrations can be added without rewriting the core.
6. Each store owns its earning rules and discounts. The platform administrator sets only technical safety limits (typos, ceilings) and can suspend a store or switch off a campaign in a fraud case; they do not edit a store's rules (D-115).
7. Build what pilot stores ask for. Small stores use two or three rule types, so no generic rule engine is built before seeing which ones they use (D-125).

### Non-goals (for now)

- A universal points currency usable across stores. Points are per store.
- Transferring or gifting points, and gift cards (planned for a later phase).
- Acting as a payment instrument or processing customer payments.
- A marketplace or online shop for customers to buy from stores.
- Native POS integrations in the MVP.
- A generic rule engine, product-level rules or product discounts before pilot stores ask for them and item data exists (parked; see "The Way Forward", section 3).
- POS integration, automatic terminal discounts, opt-in campaigns, refunds and voids, signed rotating QR codes, device credentials for terminals, NFC card reading, wallet passes and card-linked payments. Each waits for its trigger.

## 7. Success metrics

Targets will be set after a pilot baseline. The pilot is two or three stores for about four weeks (D-125), one of them ideally with branches.

Pilot measures: awards per day, repeat customers, which rules the stores actually set up, scan time at the till, and the issues they raise.

| Area | Metric |
| --- | --- |
| Store adoption | Stores onboarded; stores active weekly; monthly store churn |
| Usage | Share of transactions where a customer is scanned (scan rate); points awarded per store per week |
| Customer engagement | Customers enrolled per store; returning customers (repeat visits per customer per month) |
| Points health | Points earned, redeemed and expired per store |
| Marketing value | Alerts sent; alert open rate; redemptions or visits following an alert |
| Speed | Time for a cashier to complete a scan-and-award (target: seconds, to be measured) |
| Reliability | Share of awards made offline; share of offline awards rejected at sync |
| Revenue | Monthly recurring revenue; average revenue per store |

## 8. Scope and phases

The MVP, v1.1 and v2 scope below is confirmed. NFC card, wallet passes and POS integration are suggested placements for the newer ideas.

Everything outside this table sits in the parking lot until its trigger is met (see "BOKPOINTS The Way Forward.md", section 3): POS integration and a quote-and-commit API for terminals, product catalog and product-level rules and discounts, automatic discounts applied by the terminal, opt-in campaigns, signed rotating QR codes, device credentials for terminals and cameras, refunds and voids, NFC card reading and wallet passes, spend accumulated over time, and card-linked payments.

| Phase | Scope |
| --- | --- |
| MVP | Admin onboards stores. Stores add staff and create their own earning rules: points per euro, a fixed number of points per purchase, a threshold bonus (spend at least X, earn Y bonus points) and optionally a bonus for every Nth visit (D-115, D-116). The rule the admin creates at onboarding is only a starting template the owner edits. Cashier scans the customer's QR code from the customer app and enters the purchase amount, online or offline, with offline awards synced later. Any countertop 2D scanner that types like a keyboard works: it types the member code and presses Enter, with no integration needed. Checkout is quote then confirm: the quote shows the points to earn and any basket threshold discount to apply, the customer pays, and points are awarded when the cashier confirms payment and enters the amount actually paid (D-123). The one MVP discount is a basket threshold discount, applied by the store's own till (D-116). Points are awarded per store and expire 3 months after they are earned. Customer apps on the Apple App Store, Google Play and web, with per-store balances. Cashiers can register customers by email. Basic store customer list with manual point adjustments (never below zero; no reversals). Email verification and in-app notices. Monthly subscription billing for stores. Built on a credential model and an API so later features need no rewrite. |
| v1.1 | Redemption and rewards catalog. Discounted products in the store shop, product and category rules, buy-X-get-Y. Store-to-customer alerts and campaigns, with push notifications. Physical NFC loyalty card (tap or scan). |
| v2 | Gifting or transferring points. Gift cards. Restock, last-stock and seasonal sale alerts (such as Black Friday). Apple and Google Wallet passes, including NFC tap where approved. First POS integrations. SMS as an extra channel. Store-level expiry settings. Possible universal points (needs separate review). |

## 9. Product requirements overview

This section states what each surface must do. Detailed flows, rules and data are in the FRD.

### 9.1 Customer dashboard

- Sign up and sign in with one account, verified by email. Available on the Apple App Store, Google Play and the web.
- Personal QR code for identification at the till, which also works offline.
- See points balance per store and the history of points earned, redeemed and expired, with a notice for points about to expire.
- The checkout moment: the customer is identified by QR code, the cashier's screen shows the discount that applies, the customer pays, and the points arrive once payment is confirmed.
- See, in plain language, how points are earned at each store.
- See rewards and offers from stores where the customer has points (v1.1).
- Manage notification and marketing preferences.
- Later: alerts about sales, gifting or transferring points, gift cards.

### 9.2 Store dashboard

- Manage the store profile, staff accounts with role permissions, and cashier devices.
- Create, edit, pause and delete the store's own earning rules, with a simulator that shows the points for a sample purchase before the rule is activated (D-115). The platform admin cannot edit them.
- The single basket-threshold discount is store-owned too: spend at least X, get a fixed amount or percent off, shown in the quote and applied by the cashier (D-116).
- Points expire 3 months after they are earned, for every store.
- Cashier view, installable on a phone or tablet: identify the customer (app QR code, or a countertop scanner that types the code and presses Enter), show the quote — points to earn and any discount to apply — take payment, confirm the amount actually paid and award points, online or offline. A successful read gives a short sound and visual (FR-CHK-6). Redeeming points comes in v1.1.
- Customer list with balances and history; manual point adjustments with a reason, never below zero. There are no reversals.
- Review awards that were rejected when an offline device synced.
- Add and manage products, and put products on discount (v1.1).
- Create rewards and campaigns, and send alerts to enrolled customers (v1.1).
- View the store's audit log: who changed what and why, newest first.
- View basic reports: customers, points issued and redeemed, visits.
- View and manage the subscription and billing.

### 9.3 Admin panel

- Onboard, edit, suspend and offboard stores. A store's first points rule is an optional starting template; the owner then edits it (D-115).
- The admin has no edit right over a store's earning rules or discounts. The only technical overrides are suspending a store and switching off a campaign in a fraud case (D-115, D-116).
- View and manage store accounts, staff and subscriptions.
- Support tools: look up a customer or store, view audit logs, correct errors, apply fraud clawbacks (the only way a balance can go below zero).
- Platform-wide monitoring and basic analytics.

### 9.4 Cross-cutting requirements

- Credential model: a customer can have several credentials (app QR code, NFC card, later wallet passes). All of them resolve to the same customer ID.
- API-first: the "award points" action is an API call used by the cashier screen today and by POS integrations later.
- Offline-capable awarding: the cashier device can check the QR code without a connection. Awards are queued on the device and synced later, and the server validates them at sync.
- Points lifecycle: points expire 3 months after they are earned. There are no reversals, and a balance never goes below zero except through an admin fraud clawback.
- Audit log: every points change records who, when, which store and why.
- Fraud controls: only staff can award points, awards use the entered purchase amount, offline awards are limited and checked at sync, and unusual activity can be limited or flagged.
- Localization: Finnish and English at launch (proposed), euro currency, Finnish VAT on invoices. Other EU languages later.
- Security: secure authentication, role-based permissions, encrypted data in transit and at rest, and encrypted offline data on cashier devices.
- Accessibility and mobile-first: cashier and customer screens work well on phones and tablets.

## 10. Key decisions made

| Decision | Choice |
| --- | --- |
| Business model | B2B2C; stores pay monthly, customers free |
| Points model | Per-store points in a single customer wallet |
| Points expiry | Points expire 3 months after the day they are earned |
| Reversals | No reversals; no negative balances except an admin-only fraud clawback |
| Identification | Cashier scans the customer, not the other way around |
| Earning | Points calculated from the purchase amount entered by the store |
| Offline use | Awarding works online and offline; QR checked on the device, awards synced later |
| POS | POS integration must be possible; API-first design; manual entry in MVP |
| Credentials | QR code in the app; physical NFC card; wallet passes later |
| Customer app | Apple App Store, Google Play and web |
| Failed payments | Reminder at day 7, store paused at day 14, suspended at day 30 |
| Messages | Email verification and in-app notices at launch; SMS later |
| Market | Finland / EU |
| Earning rules | Belong to each store; the platform sets only technical limits (D-115) |
| MVP rule set | Purchase-based rules plus one basket threshold discount applied by the cashier; everything else waits for its trigger (D-116) |
| Engine input | A basket of item lines; a store without item data sends one line for the whole purchase (D-117) |
| Sale record | Every award belongs to a sale record (D-118) |
| Discounts at checkout | Quote first, confirm after payment (D-123) |
| Corrections | Manual adjustments in the MVP; sale-based refunds wait for POS integration (D-124) |
| Staff invitations | An invitation never alters an existing account (D-119) |
| Customer sign-in | A verified email is required before an account is created or claimed (D-120) |
| Pilot | Two or three stores, about four weeks, before any parked item is built (D-125) |
| Pricing | Tiers by active customers, definition proposed (D-126) |
| Team | One person covers product, design, frontend, backend and testing |

## 11. Identification and POS strategy

1. MVP: QR code in the customer app, identified at the cashier screen. Two ways to read it: a phone or tablet camera, or any countertop 2D scanner that types the code like a keyboard (the screen plays a short sound and visual on a successful read). Amount entered by hand. The code can be checked offline.
2. v1.1: physical NFC card that holds only an opaque ID (never a balance), with cryptographic protection to prevent cloning. Cashiers need an NFC-capable device or reader.
3. v2: Apple and Google Wallet passes. A pass that works by tapping on Apple devices depends on Apple's NFC entitlement, which Apple grants at its discretion, and on terminals that support Apple's Value Added Services protocol. A wallet pass showing a QR code is a simpler first step.
4. POS integrations: exposed through the same API, one vendor at a time, based on which POS systems the first stores use.

The loyalty card is an identifier, not a payment card.

## 12. Market and compliance (Finland / EU)

This is a planning note, not legal advice. Review before launch.

GDPR: customer data is personal data. Define the lawful basis, data minimization, retention, access and deletion rights, and the roles of BOKPOINTS and stores as controllers or processors. Stores see only their own customers' data.

Marketing messages: alerts and promotions to customers need clear consent and an easy way to opt out. Check the Finnish and EU rules on electronic direct marketing.

Points terms: points have no cash value; state the 3-month expiry and the redemption rules in the terms.

Gift cards and transferable value (v2): may raise financial-regulation questions. Review before building.

Subscription billing: invoices and VAT handled correctly for Finnish businesses.

Language: Finnish and English support at launch.

Pending customers: unclaimed pending-customer records, including the email address, are kept for 1 year and then deleted. The lawful basis for keeping them needs a privacy review.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Cold start: customers see little value until several stores participate | Launch in one tight local cluster; pilot with a few stores |
| Cashiers skip scanning because it is slow | Keep the scan flow to a few seconds; test at real tills; add NFC and POS later |
| Fake or inflated points | Staff-only awarding, audit log, limits and anomaly checks |
| Offline awarding adds complexity and fraud exposure | Short credential validity, one-time QR proofs, limits per award and per queue, validation at sync; build the online flow first, then the offline queue |
| Stores do not see enough value to keep paying | Make reports and campaigns clear and easy; track store churn from the start |
| Solo-builder overload (product, design, build, test, support) | Strict phase scope; reuse standard services; keep the MVP small; one codebase for the customer apps where possible |
| Two app stores plus web add release and review work | Plan store accounts and review lead time early; keep the app thin and the web version complete |
| NFC and wallet features depend on third-party approval and hardware | Delay to later phases; build the credential model first |
| Privacy or marketing-rule mistakes | Consent flows and data rules designed in from the MVP |
| POS dependency | No POS integration until a pilot store names its POS; the API-first award path means it arrives without a rewrite |
| Rule complexity creeping in | One rule type is proven before the next is added; only rule types a pilot store asks for |
| QR codes shared between people | Signed, short-lived rotating codes before any automatic discount, sooner if sharing is seen |
| Store typos in rules and discounts | Simulator before activation, platform technical ceilings that are not business limits, audit on every change |
| Cost of NFC cards and scanners | Delayed to their trigger; the MVP needs no special hardware (keyboard-style scanners are cheap) |

## 14. Assumptions and constraints

- One person builds and operates the product, and remains product manager and owner until decided otherwise.
- Stores will have a phone or tablet at the till, or can use a basic reader.
- Customers have a smartphone for the MVP QR flow.
- Stores are willing to scan customers for every eligible purchase.

## 15. Open questions

1. Subscription pricing: tiers, free trial, setup fee, and whether NFC cards are charged separately.
2. Points rules: standard earn rates and the redemption options for v1.1. Expiry is decided (3 months).
3. Technology stack and hosting: cross-platform customer apps, an offline-capable web app for cashiers, and sync (needed for AGENT.md).
4. Offline limits and security: the cap per offline award, the queue size and the credential validity period (see the FRD).
5. Which POS systems the pilot stores use.
6. Pilot area and the first stores to approach.
7. Brand, name checks and domain for the Finnish and EU market.
8. Who handles tax and legal review for terms of service and privacy policy, including how SMS costs are handled later.
9. Does "buy goods worth 100" mean a single purchase, or spend accumulated over time? The MVP assumes a single purchase.
10. Do discounted items earn points? Proposed: a per-rule store setting defaulting to points on the amount paid, to confirm with pilot stores.
11. Is a customer for pricing "someone who earned points in the last 12 months"? (Proposed, D-126.)
12. Which domain name, and who owns the email sender account? Staff invitations by email depend on it.
13. Which two or three stores are the pilot?

## 16. Next steps

Work follows "BOKPOINTS The Way Forward.md" (section 5), one work package at a time, recorded in `docs/HANDOFF.md` and `handoff/STATUS.md`:

1. WP0 — the security fixes (done: invites never alter an existing account; a verified email before a customer account is created or claimed).
2. WP1 — decisions and documents, this PRD and the FRD (done).
3. WP2 — store-owned earning rules (engine, tables, owner endpoints, permissions).
4. WP3 — the sale record and the quote-then-confirm flow, with the one basket threshold discount.
5. WP4 — the cashier screen, WP5 — the owner screen, WP6 — the customer app's rules view.
6. WP7 — domain, email sender, email invitations, billing, legal and signage. WP8 — the pilot.
