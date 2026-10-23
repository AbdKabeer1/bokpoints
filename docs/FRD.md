# BOKPOINTS: Functional Requirements Document (FRD)

Version 0.2 (draft), based on PRD v0.1 and the product owner's answers to the open decisions. Product owner and product manager: A. Prepared with Claude. Status: planning, no build started.

## 1. Purpose and conventions

This document says exactly what BOKPOINTS must do. The PRD explains why and for whom; this FRD explains what the system does, screen by screen and rule by rule. It is written so that one builder, or an AI coding agent working from AGENT.md, can implement from it.

Detail level: the MVP is specified in full. v1.1 and v2 are outlined only and will be detailed before their phase begins.

Requirement IDs: FR-<MODULE>-<number>, for example FR-PTS-3.

Priority words:

- MUST: required for the phase it is tagged with.
- SHOULD: strongly wanted; cut only if time forces it.
- COULD: nice to have.

Phase tags: [MVP], [v1.1], [v2]. A requirement with no tag is [MVP].

Modules: AUTH (accounts and sign-in), CUS (customer dashboard), STO (store dashboard), ADM (admin panel), PTS (points engine), CRD (credentials), BIL (billing), NTF (notifications), API (API and integrations), AUD (audit and fraud), PRV (privacy and consent), LOC (localization), NFR (non-functional).

## 2. Roles and permissions

A person can hold different roles in different stores. Admin accounts are separate from store and customer accounts.

| Capability | Admin | Store owner | Store manager | Cashier | Customer |
| --- | --- | --- | --- | --- | --- |
| Create, suspend and offboard stores | Yes | No | No | No | No |
| Manage store profile and billing | Yes (support) | Yes | No | No | No |
| Add and remove staff | Yes (support) | Yes | Yes (cashiers only) | No | No |
| Manage earning rules and the basket threshold discount | No (technical limits only) | Yes | Yes | No | No |
| Scan customer and award points | No | Yes | Yes | Yes | No |
| Manual point adjustment (never below zero) | Yes (support) | Yes | Yes | No | No |
| Fraud clawback (may go below zero) | Yes | No | No | No | No |
| Manage cashier devices | Yes (support) | Yes | Yes | No | No |
| View store customer list | No (support lookup only) | Yes | Yes | Limited (name and balance at scan) | No |
| Register a customer at the till by email | No (support lookup only) | Yes | Yes | Yes | No |
| Manage products and discounts | No | Yes | Yes | No | No |
| Send alerts and campaigns [v1.1] | No | Yes | Yes | No | No |
| View own points and history | No | No | No | No | Yes |
| Manage own consent and account | No | Own | Own | Own | Yes |
| View audit logs | Yes | Store-level | Store-level | No | Own history only |

## 3. Core concepts and data model

| Entity | Purpose | Key fields |
| --- | --- | --- |
| Customer | One global person | account id, name, email, phone (optional, not verified in the MVP), verification status, language, created date, status |
| Credential | A way to identify a customer at the till | id, customer id, type (app QR, NFC card, wallet pass), identifier, device public key, valid until, status (active, lost, revoked), created date |
| Store | A participating business | id, name, business ID, address, contact, VAT details, status, plan, created date |
| Store member | A staff account at a store | user id, store id, role (owner, manager, cashier), status |
| Cashier device | A till device registered to a store, with its own credentials (D-135) | id, store id, optional branch, name, secret hash, scopes (identify, quote, confirm, reversal), status (active, revoked), last seen, last sync, registered by |
| Customer-store link | Connects a customer to a store | customer id, store id, joined date, marketing consent for this store, status (active, under fraud review) |
| Earning rule | The store's own rules for earning points | store id, rule type (points per euro, fixed points per purchase, threshold bonus, every-Nth-visit bonus), parameters, conditions (minimum spend, active dates, branch), effective date, status (active, paused), version |
| Discount rule (MVP: basket threshold) | The store's own discount, applied at the till | store id, threshold amount, value (fixed amount or percent), conditions, effective date, status, version |
| Sale | One purchase that points came from | id, store id, branch, customer id, staff or device, amount before discount, amount paid after discount, rules applied with their versions, discount applied, optional POS reference, status |
| Sale item line [unused in the MVP] | Optional item detail of a sale | sale id, product id or description, quantity, unit price, line total |
| Points ledger entry | One change to a balance (append-only) | id, customer id, store id, type (earn, redeem, adjust, expire, fraud clawback, reversal), points (positive or negative), remaining points and expiry date (earn entries), sale id, amount in cents, rule versions, reversal of entry (reversal entries), reason, staff id, device id, scan time, idempotency key, created date |
| Points balance | Current total per customer and store | derived from the ledger; cached for speed |
| Rejected offline award | An offline award the server did not accept at sync | id, store id, device id, customer id, amount, scan time, reason, reviewed by |
| Product [v1.1] | Item in the store shop | id, store id, name, description, price, image, stock note, active |
| Discount [v1.1] | A price reduction on a product | product id, type, value, start and end date, status |
| Reward [v1.1] | Something a customer can redeem with points | store id, name, point cost, active, limits |
| Campaign / alert [v1.1] | A message from a store to customers | store id, audience, message, schedule, status, results |
| Subscription | A store's paid plan | store id, plan, status, billing dates, first failed payment date, provider references |
| Audit log entry | Record of a sensitive action | who, what, when, which store, before and after values |

Rules that hold across the model:

- The ledger is append-only. Entries are never edited or deleted. Manual adjustments (see 4.5) correct a mistake and only an admin can apply a fraud clawback (see 4.6). A POS-initiated refund or void is the one reversal: a `reversal` entry tied to the original sale, bounded by the original award and reversing only unspent points (D-132).
- Money is stored as whole cents in euros. Points are whole numbers.
- A customer's balance at a store is the sum of that customer's ledger entries for that store, expiry entries included.
- Points belong to the store that issued them and cannot be used elsewhere.
- Points expire 3 months after the day they were earned. The oldest points are used first.
- A balance never goes below zero, except through an admin fraud clawback.
- Points from all matching earning rules add up, capped by the store's per-sale ceiling and the platform's technical ceiling (FR-RUL-5). A rule change takes effect from its chosen date and never alters points already earned (FR-RUL-4).

## 4. Key flows (MVP)

### 4.1 Admin onboards a store

1. Admin creates the store record: name, business ID, address, contact person, email, VAT details, plan.
2. System sends an invitation email to the owner with a secure link.
3. Owner accepts, sets up sign-in, and lands in the store dashboard in setup mode.
4. Owner completes the store profile, reviews and edits the starting points rule the system created (a template, not a final word), and adds staff.
5. Subscription starts according to the plan (trial or immediate billing).
6. Store status becomes Active once setup and billing are complete.

Store status lifecycle: Invited, Setup, Active, Paused (from day 14 of a failed payment), Suspended (from day 30), Offboarded. A reminder goes to the owner on day 7 without changing the status (see FR-BIL-4).

### 4.2 Customer signs up

1. Customer installs the app from the Apple App Store or Google Play, or opens the web app, and enters an email address.
2. Customer verifies with a one-time code or link sent by email.
3. Customer accepts the terms and privacy notice, and chooses a language. A phone number can be added but is not verified in the MVP.
4. Customer lands on the dashboard with a personal QR code and an empty store list.

### 4.3 Cashier awards points (core flow)

1. Cashier opens the Cashier screen (an installable web app) and signs in once per shift or device.
2. Customer shows the QR code in the app (later: taps an NFC card). The QR code works with or without a connection.
3. Cashier scans it with the device camera.
4. The device checks the code. Online, the system resolves the credential to the customer and shows the first name and the current balance at this store. Offline, the device verifies the code on its own and shows the first name only; no balance is shown.
5. Cashier enters the purchase amount. The screen returns a quote with no side effects: the points to earn, which rules produced them, and any basket threshold discount to apply (FR-CHK-2).
6. The customer pays.
7. The cashier confirms that payment was taken and enters the amount actually paid. The points are awarded on that confirm, and the call is idempotent, so sending it twice never awards twice (FR-CHK-3). There is no undo after this step.
8. Online: the system writes the sale, the ledger entry and the balance in one step, and both screens show the confirmation with its breakdown. Offline: the device saves the award in a local queue, shows "Saved offline", and sends it when the connection returns; the customer's balance updates after that sync.

If this is the customer's first purchase at this store, the system also creates the customer-store link when the award is recorded. The customer sees a first-time notice the next time they open the app, with the store's marketing consent shown as off until the customer opts in.

### 4.4 Cashier registers a customer without the app [MVP]

1. Cashier enters the customer's email address.
2. System sends the customer an invitation to create an account and claim any points. SMS is not used in the MVP.
3. Points earned before sign-up are held on a pending account and become visible once the customer verifies the account.
4. Pending points expire after 3 months like any other points. If the customer never claims the account, the pending record, including the email address, is deleted after 1 year.

### 4.5 Manual adjustment

1. Owner or manager opens a customer in the store customer list.
2. They choose Add or Remove points, enter the amount and a required reason. Removing points cannot take the balance below zero.
3. System writes an adjustment ledger entry and an audit log entry.

### 4.6 Fraud clawback (admin only)

1. After a fraud case is confirmed, the admin opens the customer-store record.
2. Admin chooses Fraud clawback, enters the points to remove and a case note. This is the only action that can take a balance below zero.
3. System writes a clawback ledger entry, marks the customer-store link as under fraud review, and writes an audit log entry. Later earnings first offset a negative balance (proposed).

### 4.7 Redemption [v1.1]

1. Customer chooses a reward in the app or asks at the till.
2. Cashier scans the customer, selects the reward, and confirms.
3. System checks the balance, writes a redeem entry using the oldest points first, and shows the new balance.

### 4.8 Offline awards and sync [MVP]

1. The Cashier screen keeps working without a connection. It holds the store's points rule, the list of revoked credentials, and the keys it needs to check QR codes.
2. Each offline award is saved in an encrypted local queue with its scan time, amount, points, rule version, device ID and idempotency key.
3. When the connection returns, the device sends the queue automatically and retries until every item is confirmed.
4. The server accepts an award if, at the scan time, the credential was valid, the store was not suspended, the QR proof had not been used before, and the amount was within the offline limits.
5. An accepted award is written to the ledger with its original scan time, and the customer's balance updates.
6. A rejected award is not written to the ledger. It appears in the store's rejected-awards list with the reason, and the owner can add points manually if the purchase was genuine.

## 5. Functional requirements

### 5.1 AUTH: accounts and sign-in

**FR-AUTH-1** (MUST): Customers sign up and sign in with an email address verified by a one-time code or link. Creating or claiming a customer account requires that the email is confirmed: an unconfirmed address is refused and neither creates nor claims anything (AC-17). A phone number is optional and is not used for verification in the MVP.

**FR-AUTH-2** (MUST): Store staff and admins sign in with email and a secure credential. Multi-factor authentication is required for admin and store owner accounts.

**FR-AUTH-3** (MUST): Email is unique per customer. A duplicate sign-up is blocked, or merged only after verification.

**FR-AUTH-4** (MUST): Sessions expire after a configurable idle time (the cashier screen signs out after an idle shift). Cashier devices keep a longer session so they can work offline, and the owner can revoke any device; a revoked device stops working at its next sync.

**FR-AUTH-5** (MUST): Users can sign out everywhere and reset access securely.

**FR-AUTH-6** (MUST): Access to every screen and action is enforced on the server by role and by store; hiding buttons is never the only control.

### 5.2 CUS: customer dashboard

**FR-CUS-1** (MUST): Show the customer's personal QR code on the home screen, large and readable, with screen brightness guidance. The code works without a connection.

**FR-CUS-2** (MUST): List every store where the customer has points, with store name, current balance, and last activity.

**FR-CUS-3** (MUST): Show per-store history: date, type (earned, redeemed, adjusted, expired), points, and resulting balance.

**FR-CUS-4** (MUST): Show a confirmation after each award. An award saved offline at the till shows as pending until that till syncs.

**FR-CUS-5** (MUST): Let the customer manage profile data, language, and notification and marketing consent per store.

**FR-CUS-6** (MUST): Let the customer export their data and delete their account (see PRV).

**FR-CUS-7** (SHOULD): Let the customer mark a credential as lost and generate a new QR code.

**FR-CUS-8** (MUST): Show points that will expire soon, with the expiry date, as an in-app notice (reminder window proposed at 14 days).

**FR-CUS-9** (MUST): The customer app is available on the Apple App Store, Google Play and the web, with the same account on all three. Balances show as last synced when offline.

**FR-CUS-10** (v1.1): Show rewards a customer can afford, per store, and store offers and discounts.

**FR-CUS-11** (v1.1): Show alerts and offers in an inbox, with push notifications for opted-in customers.

**FR-CUS-12** (v2): Gift or transfer points, buy or send gift cards.

### 5.3 STO: store dashboard

#### Profile and staff

**FR-STO-1** (MUST): Owner edits store name, address, contact details, opening info, and logo.

**FR-STO-2** (MUST): Owner and manager invite staff by email, assign a role, and deactivate staff. Deactivation takes effect immediately, including on active sessions. An invitation never modifies an existing account: for an email that already exists, only the store membership is added, and the account's name, admin flag and sign-in link are never changed (AC-14).

**FR-STO-3** (MUST): Every staff action that changes points is attributed to a staff member.

#### Points rules

**FR-STO-4** (MUST): Owner or manager creates, edits, pauses and deletes the store's own earning rules and the basket threshold discount, within the platform's technical limits. The platform administrator cannot edit them (FR-RUL-1, AC-13).

**FR-STO-5** (MUST): A change to a rule applies to future purchases only and records the date it took effect; every sale records the rule versions it used (FR-RUL-4).

**FR-STO-6** (SHOULD): A points-rule preview lets the owner enter a sample amount and see the points result.

**FR-STO-7** (MUST): Points expire 3 months after the day they were earned, for every store, and the oldest points are used first. Stores cannot change this period in the MVP; a store-level setting is a later option.

#### Cashier screen

**FR-STO-8** (MUST): A dedicated, simple Cashier screen, installable as a web app on a phone or tablet, with a camera scanner, a numeric amount field, and a clear confirm button.

**FR-STO-9** (MUST): After scanning, show the customer's first name. Online, also show the current balance at this store; offline, never show a balance as if it were current.

**FR-STO-10** (MUST): Show a clear success, "Saved offline", or error state; never leave the cashier unsure whether an award was recorded.

**FR-STO-11** (MUST): Before the cashier confirms, show the amount and the points it will award. There is no undo after confirming.

**FR-STO-12** (SHOULD): Look up a customer by email when the QR code cannot be scanned (online only).

#### Offline use and devices

**FR-STO-23** (MUST): The Cashier screen opens and awards points without a connection once it has been loaded and synced at least once on that device.

**FR-STO-24** (MUST): Show the sync state at all times (online, offline, number of awards waiting) and the time of the last successful sync.

**FR-STO-25** (MUST): Owner or manager registers, names and revokes cashier devices. A revoked device is blocked at its next sync, and its unsent awards are held for review.

**FR-STO-26** (MUST): Show a list of rejected offline awards with the reason, and let the owner dismiss each one after review.

**FR-STO-27** (SHOULD): Show the last 10 awards made on this device, read-only, with their sync status.

#### Customers

**FR-STO-13** (MUST): Customer list with search, current balance, last visit, and total points earned and redeemed.

**FR-STO-14** (MUST): Customer detail page with ledger history and manual adjustment (see 4.5).

**FR-STO-15** (MUST): A store sees only customers linked to that store, and only the data needed for loyalty (name, contact if the customer consented, balance, history).

#### Reports

**FR-STO-16** (SHOULD): Basic report: customers enrolled, points issued and redeemed, awards per day, and top customers, for a selected date range.

**FR-STO-17** (COULD): Export report data as CSV.

#### Products, discounts and campaigns [v1.1]

**FR-STO-18** (v1.1): Add, edit and remove products; set a discount on any product with start and end dates.

**FR-STO-19** (v1.1): Create rewards with a point cost and optional limits.

**FR-STO-20** (v1.1): Create and schedule alerts to enrolled customers who opted in, with audience filters (for example, all customers or customers with a minimum balance).

**FR-STO-21** (v1.1): View alert results: sent, delivered, opened, and visits or redemptions afterwards where measurable.

#### Subscription

**FR-STO-22** (MUST): Owner views plan, next billing date, invoices, and payment status, and updates the payment method.

### 5.4 ADM: admin panel

**FR-ADM-1** (MUST): Create, edit, suspend, reactivate and offboard stores, with the status lifecycle in 4.1.

**FR-ADM-2** (MUST): Send, resend and revoke owner invitations.

**FR-ADM-3** (MUST): Search stores, staff and customers; open a record to see profile, status, links, and recent activity for support.

**FR-ADM-4** (MUST): Support actions (adjust points, apply a fraud clawback, deactivate a credential or device, merge duplicate customers) require a reason and are written to the audit log.

**FR-ADM-5** (MUST): View and filter the audit log across the platform.

**FR-ADM-6** (MUST): View each store's subscription and billing state, with the ability to extend a trial or pause billing.

**FR-ADM-7** (SHOULD): Platform dashboard: stores by status, new stores, total customers, awards per day, failed payments.

**FR-ADM-8** (SHOULD): A support notes field on each store and customer, visible only to admins.

**FR-ADM-9** (SHOULD): Admin tools respect the same privacy rules: customer detail is shown only as far as needed for support.

### 5.5 PTS: points engine

**FR-PTS-1** (MUST): Points are calculated by evaluating the purchase against the store's set of earning rules; the points from every matching rule add up (FR-RUL-5). The points-per-euro rule — one type among them — is: points = purchase amount in euros times that rule's rate, rounded using the rule's rounding rule (default: round down to a whole number).

**FR-PTS-2** (MUST): If the amount is below the store's minimum purchase, award zero points and tell the cashier why.

**FR-PTS-3** (MUST): If the result exceeds a rule's or the store's per-sale ceiling, award up to the ceiling and show that it was capped (FR-RUL-5, FR-RUL-7).

**FR-PTS-4** (MUST): Each award request carries an idempotency key, so a retry, a double tap, or a resend after an offline period never awards twice.

**FR-PTS-5** (MUST): Write the ledger entry and update the balance in one atomic step; if either fails, neither is saved.

**FR-PTS-6** (MUST): Reject online awards for suspended or offboarded stores and for revoked credentials, with a clear message. Offline awards are judged at sync on the state at the scan time (FR-PTS-11).

**FR-PTS-7** (SHOULD): Warn the cashier when the same customer received an award at this store for the same amount within a short window (default: 2 minutes), and require confirmation. The check also works offline, on that device only.

**FR-PTS-8** (MUST): There are no reversals. A balance can never go below zero, except through an admin fraud clawback.

**FR-PTS-9** (v1.1): Redemption checks the balance, uses the oldest points first, writes a redeem entry, and rejects it if points are insufficient.

**FR-PTS-10** (MUST): Points expire 3 months after the day they were earned. Each earn entry records its expiry date and its remaining points, and a daily job writes an expiry entry for each batch that has run out of time.

**FR-PTS-11** (MUST): An offline award keeps the time of the scan. Its expiry date is counted from that time, and it is accepted at sync if the credential, the store status and the offline limits were valid at that time.

**FR-PTS-12** (MUST): A one-time QR proof can be used once per store. A second use is rejected, including when two devices send it at sync.

Worked example: the store rule is 1 point per euro, rounded down. The cashier enters 23.80 euros. The customer receives 23 points.

### 5.6 CRD: credentials

**FR-CRD-1** (MUST): Every customer has an app QR credential created at sign-up.

**FR-CRD-2** (MUST): The QR code can be checked without a connection. Proposed design: it carries a credential signed by the platform (customer, credential and the phone's public key, valid for about 7 days and refreshed automatically whenever the app is online) plus a one-time proof created by the phone, valid for about one minute. The cashier device checks both locally. The final design is set in the architecture work.

**FR-CRD-3** (MUST): The system resolves any credential type to the same customer ID, so awarding logic does not depend on how the customer was identified.

**FR-CRD-4** (SHOULD): A customer or admin can mark a credential lost or revoked. Online checks reject it at once; offline devices learn of it at their next sync, so the credential validity period limits the exposure.

**FR-CRD-5** (v1.1): Physical NFC card credential: stores only an opaque identifier, never a balance; cryptographically protected against cloning; linked to a customer by activation in the app or by an admin. Offline checking of cards needs card keys on the reader side and is designed in that phase.

**FR-CRD-6** (v2): Apple and Google Wallet pass credentials, with NFC tap only where the platform's approval is granted.

### 5.7 BIL: billing

**FR-BIL-1** (MUST): Each store has a monthly subscription with a plan, a start date, and an optional trial.

**FR-BIL-2** (MUST): Payments are processed by an external payment provider; BOKPOINTS stores no card numbers.

**FR-BIL-3** (MUST): Issue an invoice for each billing period that shows the correct Finnish VAT treatment.

**FR-BIL-4** (MUST): Failed payments follow this schedule, counted from the first failed payment: automatic retries, a reminder to the owner at day 7, the store Paused at day 14, and the store Suspended at the end of the first month (day 30). Paying at any point restores the store at once.

**FR-BIL-5** (MUST): A Paused store cannot create or change campaigns, rewards, products or points rules, but can still award points. A Suspended store cannot award points and its dashboard is read-only except for billing. Customers can always see their balances and history, and points still expire.

**FR-BIL-6** (SHOULD): Owner can change plan or cancel; cancellation takes effect at the end of the paid period.

**FR-BIL-7** (COULD): Charge separately for NFC cards.

### 5.8 NTF: notifications

**FR-NTF-1** (MUST): In the MVP, transactional messages go by email only: verification codes, invitations, security notices and billing reminders. SMS is not used.

**FR-NTF-2** (MUST): Customer notices (a new award, points expiring soon) appear in an in-app notice area.

**FR-NTF-3** (v1.1): Push notifications and store alerts go only to customers who opted in for that store, and every message gives an easy way to opt out.

**FR-NTF-4** (v1.1): Customers can control channels (push, email) and mute a single store.

**FR-NTF-5** (v1.1): Limit how many marketing messages a customer can receive per store per period (limit to be decided).

**FR-NTF-6** (v2): SMS as an extra channel once a cost plan exists. SMS fees are normally billed to the sender, so BOKPOINTS would carry them unless they are passed on to stores.

### 5.9 API: API and integrations

**FR-API-1** (MUST): The Cashier screen uses the same internal API as any future integration: identify customer, award points (including batches of offline awards), and get balance.

**FR-API-2** (MUST): Every API call is authenticated, scoped to one store, and permission-checked.

**FR-API-3** (MUST): The API is versioned and documented from the start.

**FR-API-4** (v2): Store-level API keys and webhooks for POS integrations, with rate limits and per-key revocation.

**FR-API-5** (v2): Webhooks notify a store system when points are awarded or reversed.

### 5.10 AUD: audit and fraud

**FR-AUD-1** (MUST): Record in the audit log: store creation and status changes, staff changes, rule changes, manual adjustments, fraud clawbacks, credential and device changes, rejected offline awards, and admin support actions.

**FR-AUD-2** (MUST): Audit entries cannot be edited or deleted through the product.

**FR-AUD-3** (SHOULD): Flag unusual patterns for review: many awards by one cashier in a short time, repeated large amounts, many adjustments, or repeated failed scans.

**FR-AUD-4** (SHOULD): Rate-limit scanning and awarding per device and per cashier.

**FR-AUD-5** (SHOULD): Limit the exposure of offline use: cap the amount per offline award and the number of awards waiting per device, and flag devices whose clock differs from server time.

### 5.11 PRV: privacy and consent

**FR-PRV-1** (MUST): Show the terms and privacy notice at customer sign-up and record the version accepted and the time.

**FR-PRV-2** (MUST): Marketing consent is separate from the terms, off by default, recorded per store, and can be withdrawn at any time.

**FR-PRV-3** (MUST): A customer can export their data and delete their account. On deletion, personal data is removed and ledger entries are kept in anonymized form for store accounting.

**FR-PRV-4** (MUST): A store can see only its own customers' data and cannot see other stores' balances or history.

**FR-PRV-5** (MUST): Delete unclaimed pending-customer records, including their email addresses, after 1 year. Define other retention periods for inactive accounts and apply them automatically.

**FR-PRV-6** (MUST): Log access by admins to customer data.

### 5.12 LOC: localization

**FR-LOC-1** (MUST): Finnish and English (proposed) in all customer, store and admin screens and in messages.

**FR-LOC-2** (MUST): Currency in euros, with Finnish number and date formats.

**FR-LOC-3** (SHOULD): Text is stored in translation files so more languages can be added later without code changes.

### 5.13 RUL: earning rules

**FR-RUL-1** (MUST): A store owner can create, edit, pause and delete the store's own earning rules. The platform administrator cannot; they set only technical limits, suspend a store, or switch off a campaign in a fraud case.

**FR-RUL-2** (MUST): MVP rule types: points per euro, a fixed number of points per purchase, a threshold bonus (spend at least X in one purchase, earn Y bonus points), and optionally a bonus for every Nth visit.

**FR-RUL-3** (MUST): A rule may carry conditions: minimum spend, active dates, and branch.

**FR-RUL-4** (MUST): Rules are versioned and take effect from a chosen date. A change never alters points already earned, and every sale records the rule versions used.

**FR-RUL-5** (MUST): Points from all matching rules add up, capped by the store's per-sale ceiling and the platform's technical ceiling.

**FR-RUL-6** (MUST): A simulator shows the points for a sample purchase before a rule is activated.

**FR-RUL-7** (MUST): Platform technical limits protect against typos (rate bounds, a per-sale ceiling) and are not business limits.

**FR-RUL-8** (MUST): Rule changes are locked while a store is Paused for non-payment, and every change is audited.

**FR-RUL-9** (MUST): Customers can see, in the app, how they earn at each store, in plain language.

### 5.14 CHK: checkout flow

**FR-CHK-1** (MUST): Customers are identified at the cashier screen by QR code or NFC card ID, including by a keyboard-style countertop scanner that types the code and presses Enter.

**FR-CHK-2** (MUST): The quote step returns the points to be earned and any discount to apply, with no side effects.

**FR-CHK-3** (MUST): Points are awarded when the cashier confirms payment and enters the amount paid. The call is idempotent.

**FR-CHK-4** (MUST): Points are earned on the amount actually paid, after discounts (D-129). The confirm recomputes from that amount on the server.

**FR-CHK-5** (MUST): Every award shows and stores a breakdown of the rules that produced it.

**FR-CHK-6** (MUST): The cashier screen gives a short sound and visual confirmation on a successful read.

**FR-CHK-7** (MUST): Discount (MVP-lite): one basket threshold type, automatic, shown in the quote and applied by the cashier in the store's own till. One discount per sale: the single best applicable one, no stacking (D-131). The store funds it; the platform never reimburses or settles it (D-130).

**FR-CHK-8** (MUST): A discount requires a signed, short-lived (about 60 seconds), one-time-per-store rotating QR proof, verified online and bound to the customer. A static `CUS-` code may earn points but never unlocks a discount, and no discount is awarded offline (D-133).

**FR-CHK-9** (MUST): A terminal or camera can identify, quote and confirm through a device credential with exactly those scopes; it cannot adjust points, read customer lists, or reach staff or admin endpoints (FR-DEV, D-135).

### 5.15 SAL: sales

**FR-SAL-1** (MUST): Every award belongs to a sale record: store, branch, customer, staff or device, amounts before and after discount, the rules applied with their versions, an optional POS reference, and a status.

**FR-SAL-2** (MAY): A sale may carry optional item lines. They are unused in the MVP, and a store without item data sends one line carrying the purchase total.

**FR-SAL-3** (MUST): Manual staff corrections remain manual adjustments (see 4.5). Refunds and voids arrive with POS integration as reversals tied to the sale (FR-SAL-4).

**FR-SAL-4** (MUST): A POS refund or void writes a `reversal` entry tied to the original sale and earn entry. It is bounded by the original award, idempotent per original entry, and reverses only the unspent part of the batch: points already redeemed or expired are not clawed back by the refund (D-132). It is accepted only from a POS device credential or an admin.

**FR-SAL-5** (MUST): A sale records the amount before discount, the discount applied with its rule version, and the amount actually paid. Points are computed from the amount actually paid (D-129).

### 5.16 DEV: device credentials

**FR-DEV-1** (MUST): Each terminal or camera gets its own credential: a random secret shown once, stored only as a hash, bound to a store and optionally one branch.

**FR-DEV-2** (MUST): A device credential carries fixed scopes — identify a customer, quote a purchase, confirm a sale, and (later) post a reversal. It grants no human capability: no adjustments, no customer list, no staff or admin endpoints.

**FR-DEV-3** (MUST): A device credential can be revoked immediately by an owner or admin and is rate-limited per device. Every use is attributed to the device in the audit log, with a last-seen time.

## 6. Screen inventory (MVP)

Customer app

- Sign up and sign in
- Home with QR code
- Stores, balances and expiring points
- Store detail and history
- Profile and consent settings
- Data export and account deletion

Store dashboard (web)

- Sign in and setup wizard
- Cashier screen (identify, quote, take payment, confirm, result, offline and sync status)
- Customer list and customer detail
- Earning rules and the discount (list, create, edit, pause, with a simulator)
- Store audit log
- Staff, cashier devices and rejected offline awards
- Store profile
- Basic reports
- Subscription and invoices

Admin panel (web)

- Sign in
- Stores list and store detail
- New store and invitation
- Customer and staff lookup
- Audit log
- Billing overview
- Platform dashboard

## 7. Edge cases and error states

| Situation | Required behavior |
| --- | --- |
| QR code expired (proof older than about a minute, or credential past its validity) | Cashier sees "Code expired, ask customer to refresh"; no points awarded |
| QR code replayed, copied from a screenshot, or credential revoked | Rejected; online at once, offline at sync; event logged |
| Network lost during award | Award is saved offline and sent later; the same idempotency key prevents a double award |
| Cashier enters the wrong amount | The confirm step shows the points first; after confirming there is no undo. Owner or manager can adjust points, never below zero |
| Customer scanned at a suspended store (online) | Rejected; customer unaffected |
| Store becomes suspended while a device is offline | Awards scanned before the suspension are accepted at sync; later ones are rejected and shown to the owner |
| Same one-time QR proof used on two offline devices | First to sync is accepted; the second is rejected and reported |
| Offline award rejected at sync | Customer gets no points; owner sees it in the rejected-awards list and can add points manually if the purchase was genuine |
| Same customer awarded twice for the same amount in 2 minutes | Warning and confirm step |
| Two cashiers award the same customer at once | Both succeed in order; ledger remains consistent |
| Customer has no account yet | Cashier can register by email (see 4.4) |
| Customer deletes their account | Personal data removed; stores see the customer as removed; anonymized ledger kept |
| Store rule changed after a purchase | Past awards are unchanged; an offline award uses the rule version cached on the device, and the ledger records which version applied |
| Removal or clawback would take a balance below zero | Blocked, except for an admin fraud clawback |
| Camera permission denied | Cashier is prompted to allow it, or uses lookup by email (online only) |
| Cashier device lost or stolen | Owner revokes it; unsent awards from it are held for review |
| Customer phone clock is wrong | The proof check fails; customer is asked to correct the time |
| Duplicate customer accounts | Admin merge tool with audit entry |

## 8. Non-functional requirements

**FR-NFR-1** (MUST) Speed: a scan-to-confirmation round trip should feel immediate. Proposed target: under 3 seconds on a normal mobile connection, measured at the 95th percentile. An offline confirmation appears on the device within about one second (proposed).

**FR-NFR-2** (MUST) Reliability: the award flow is the most critical path; plan monitoring and alerts for it from the first release. The offline queue survives app restarts and device reboots, and retries with backoff until the server confirms each item.

**FR-NFR-3** (MUST) Security: encrypted traffic and stored data; hashed secrets; protection against common web attacks; least-privilege access; secrets kept out of code.

**FR-NFR-4** (MUST) Data integrity: automatic backups with a tested restore, and a ledger that can always be reconciled to balances.

**FR-NFR-5** (MUST) Devices: customer apps for current iOS and Android versions from the App Store and Google Play, and for current Safari and Chrome on the web; store and admin dashboards in current desktop and mobile browsers, with the Cashier screen installable on phones and tablets.

**FR-NFR-6** (SHOULD) Accessibility: follow WCAG 2.1 AA practices; readable contrast and large tap targets on the cashier screen.

**FR-NFR-7** (MUST) Observability: structured logs, error tracking, and a way to trace one award end to end for support, including its offline queue and sync history.

**FR-NFR-8** (SHOULD) Privacy by design: collect only the data needed; no customer data in logs.

**FR-NFR-9** (MUST) Testing: automated tests for the points engine, expiry, permissions, the award flow and offline sync; a manual test checklist for each release.

**FR-NFR-10** (MUST) Offline security: data stored on a cashier device is encrypted and limited to what the till needs; no customer list is kept on the device.

## 9. MVP acceptance criteria

### AC-1 Award points

Given an active store with a rule of 1 point per euro (round down) and a customer with a valid QR code,  
when the cashier scans the code and enters 23.80,  
then 23 points are added once, the customer's balance increases by 23, and both screens show the confirmation.

### AC-2 No double award

Given an award request was sent and the response was lost,  
when the same request is retried with the same idempotency key,  
then the customer's balance increases only once.

### AC-3 Store isolation

Given a customer has points at Store A and Store B,  
when a Store A manager opens the customer,  
then only Store A's balance and history are visible.

### AC-4 Permissions

Given a cashier is signed in,  
when they try to open the points rules or make a manual adjustment,  
then the server refuses and the attempt is logged.

### AC-5 Suspended store

Given a store is suspended for non-payment,  
when a cashier tries to award points,  
then the award is refused with a clear message, and customers can still see their existing balance.

### AC-6 Expiry

Given a customer earned 23 points at a store on 2 June,  
when the date reaches 2 September,  
then an expiry entry of minus 23 points is written and the balance drops by 23.

### AC-7 Customer deletion

Given a customer requests account deletion,  
when the deletion completes,  
then their personal data is removed, their credentials stop working, and ledger entries remain without personal identifiers.

### AC-8 Admin onboarding

Given an admin creates a store and sends an invitation,  
when the owner accepts it and completes setup and billing,  
then the store becomes Active and its cashiers can award points.

### AC-9 Award offline

Given a cashier device that synced earlier and now has no connection, and a customer with a valid QR code,  
when the cashier scans the code and confirms 23.80, and the connection later returns,  
then the award shows "Saved offline", is sent at sync, is written to the ledger once with its original scan time, and the customer's balance rises by 23.

### AC-10 Offline award rejected

Given an offline award made after the store was suspended, or with a QR proof that was already used,  
when the device syncs,  
then the award is rejected, no points are written, and it appears in the store's rejected-awards list with the reason.

### AC-11 No negative balance

Given a customer has 5 points at a store,  
when a manager tries to remove 8 points,  
then the removal is refused; and when an admin applies a fraud clawback of 8 points with a case note, the balance becomes minus 3 and the link is marked under fraud review.

### AC-12 Owner creates a rule

Given an owner creates a rule and checks it in the simulator,  
when they activate it,  
then the next award follows it.

### AC-13 Admin cannot edit rules

Given a store with earning rules,  
when the platform admin tries to edit them,  
then the API answers 403 and nothing changes.

### AC-14 Invitations never alter an account

Given an account exists with an email,  
when an owner at another store invites that email with a different Supabase user id,  
then the account's name, admin flag and sign-in link are unchanged, and only a store membership is added.

### AC-15 A rule change is not retroactive

Given points already earned under a rule,  
when the owner changes that rule,  
then the earned points and their expiry stay exactly as they were.

### AC-16 Quote, pay, confirm awards once

Given a quote with no side effects,  
when the cashier confirms payment and the confirm is sent twice,  
then the customer is awarded once, and the sale carries the rules that produced it.

### AC-17 Claiming needs a verified email

Given a sign-in whose email Supabase has not confirmed,  
when provisioning runs,  
then it is refused with 403 and no customer row is created or claimed.

### AC-18 Discounted amounts and points

Given a purchase that crosses the store's basket threshold,  
when the quote is shown,  
then the discount to apply is stated, and the points follow the store's per-rule setting for discounted amounts (FR-CHK-4).

### AC-19 Points on the amount actually paid

Given a purchase with a discount,  
when the cashier confirms the amount actually paid,  
then the points are computed from that amount, not from the pre-discount total.

### AC-20 A discount needs a rotating proof

Given a static member code, or a device with no connection,  
when a discount would apply,  
then the discount is refused and only points may be awarded, with the reason shown to the cashier.

### AC-21 A POS reversal is bounded and idempotent

Given an award whose points were partly redeemed,  
when the POS posts a refund for the sale,  
then only the unspent points are reversed, the balance does not go below zero, and posting the same refund twice changes nothing the second time.

### AC-22 A device credential does what the till does

Given a valid device credential,  
when it calls adjust, the customer list, or a staff endpoint,  
then the API answers 403; when it identifies, quotes or confirms, it succeeds and the audit log names the device.

## 10. Later phases (outline)

### v1.1

- Rewards catalog and redemption at the till (oldest points first).
- Products and discounts in the store shop.
- Store alerts and campaigns with consent, limits and results.
- Push notifications for opted-in customers.
- Physical NFC loyalty card and its activation flow, including offline checking of cards.

### Parked until its trigger is met (documented, not scheduled)

- **FR-CMP** campaigns with opt-in and per-product scope — builds when several stores want them.
- **FR-POS** quote-and-commit for terminals and the POS adapter — builds when a pilot store names its POS. Refunds and voids (D-132) and device credentials (D-135) are decided and land with the sale record and the adapter.
- Signed, short-lived rotating QR codes — promoted to the MVP by D-133, and required before any discount is enabled.
- NFC card reading and wallet passes — when pilot stores ask for tap-to-identify. Plain-ID cards are identification-only and never discount-eligible (D-134); secure cards need a per-card key.
- Spend accumulated over time (a monthly total, for example) — when a store asks and the single-purchase version is not enough.
- Card-linked payments — much later: it needs a payment partner and heavy compliance work.

### v2

- Gifting and transferring points, with limits and fraud controls.
- Gift cards (needs a regulatory review first).
- Restock, last-stock and seasonal sale alerts.
- Apple and Google Wallet passes, with NFC tap where approved.
- Store API keys, webhooks and the first POS integrations.
- SMS as an extra notification channel, with a plan for its cost.
- Store-level expiry settings.
- Possible universal points (needs settlement design and legal review).

## 11. Decisions made and open points

Open points

1. Expiry meaning (confirmed): this FRD reads "every 3 months" as each batch of points expiring 3 months after it was earned.
2. "Pause" (confirmed): this FRD defines Paused as no changes to campaigns, rewards, products or rules, while awarding continues.
3. Manual removal (confirmed): owners and managers can still remove points by adjustment (never below zero).
4. Offline limits: the cap per offline award, the queue size and the 7-day credential validity are proposals, to be set in the architecture work.
5. Fraud clawback process: who decides a case, and what the case note must contain.
6. Pending-customer data: keeping an email address for a year without an account needs a privacy review of the lawful basis.
7. Expiry reminder: the 14-day window is a proposal.
8. SMS costs: SMS fees are normally billed to the sender, not the recipient. A later plan must decide whether BOKPOINTS absorbs them or passes them to stores.
9. App store accounts: developer accounts and review lead time for the iOS and Android apps are launch tasks.

| Decision | Choice |
| --- | --- |
| Points expiry | Points expire 3 months after the day they were earned, in the MVP (moved up from v1.1) |
| Reversals and negative balances | No reversals. Balances never go below zero, except an admin-only fraud clawback. Manual adjustments stay, never below zero |
| Pending customers | Included in the MVP; registered by email; unclaimed records deleted after 1 year |
| Customer app | Apple App Store, Google Play and web |
| Failed payments | Reminder at day 7, store Paused at day 14, Suspended at day 30 |
| Offline awarding | Required in the MVP: QR checked on the device, awards queued and synced later |
| Messages and cost | Email verification and in-app notices in the MVP; SMS later |
| Pilot stores' needs | Scope frozen; pilot requests go to a backlog reviewed after the pilot |
| Earning rules | Belong to each store; the platform sets only technical limits and cannot edit them (D-115) |
| MVP rule set | Purchase-based rules plus one basket threshold discount applied by the cashier (D-116) |
| Engine input | A basket of item lines; one line carries the total when a store has no item data (D-117) |
| Sale record | Every award belongs to a sale record (D-118) |
| Checkout | Quote first, confirm after payment, with the amount actually paid (D-123) |
| Corrections | Manual adjustments stay; sale-based refunds wait for POS integration (D-124) |
| Staff invitations | Never modify an existing account (D-119) |
| Customer sign-in | Requires a verified email before create or claim (D-120) |
| Pilot | Two or three stores, about four weeks, before any parked item builds (D-125) |
| Points and discounts | Points on the amount actually paid (D-129); the store funds its own discounts (D-130); one automatic discount, no stacking (D-131) |
| POS reversals | Refunds and voids write a bounded, idempotent reversal tied to the sale (D-132) |
| Discount identity | A discount requires a rotating, signed, one-time QR proof, online (D-133) |
| Cards | Plain-ID cards are identification-only, never discount-eligible (D-134) |
| Devices | Per-device credentials with fixed till scopes, revocable, rate-limited, audited (D-135) |

## 12. Traceability to the PRD

| PRD goal | FRD modules |
| --- | --- |
| Fast points at the till | STO (Cashier screen), PTS, CRD, API |
| One view of points across stores | CUS |
| Tools for stores | STO, PTS, RUL, NTF (v1.1) |
| Store-owned rules and discounts | RUL, STO |
| Quote, pay, confirm | CHK, SAL, STO |
| Full admin control | ADM, AUD, BIL |
| Extendable to NFC, wallets and POS | CRD, API |
| Finland and EU readiness | PRV, LOC, BIL |

## 13. Next steps

Work follows "BOKPOINTS The Way Forward.md" (section 5), one work package at a time: WP0 security (done), WP1 documents (this change), WP2 earning rules, WP3 sale record and quote-then-confirm, WP4 cashier screen, WP5 owner screen, WP6 customer app rules view, WP7 pilot readiness, WP8 pilot. Progress lives in `docs/HANDOFF.md` and `handoff/STATUS.md`; every decision goes in `docs/DECISIONS.md`.
