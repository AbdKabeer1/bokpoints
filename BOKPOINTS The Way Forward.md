# BOKPOINTS: The Way Forward

*Prepared 23 October 2026 for A (product owner). Based on a review of the GitHub repo (latest `main`) and the scope discussions of 22 and 23 October. This is a plan, not code: it says what to do, what not to do, what to change in the PRD and FRD, and which parts of the code to work on.*

## 1. Where things stand

**Built and working.** A pnpm monorepo with four packages. The API has Supabase sign-in with enforced second factor, store branches, store and staff setup, the points ledger with batches, the expiry job, customer endpoints and row-level security on every table. There is a cashier web screen and an Expo customer app. In a local run of the latest `main`, typecheck and lint are clean and 68 unit and 170 integration tests pass. The first live run against the Supabase project (Stockholm) succeeded: an admin signed in with a real second factor, a store was created, a cashier awarded points, and the expiry job ran once and then did nothing on a second run.

**Not yet verified.** The GitHub Actions status could not be read during the review, so check for a green tick on the latest commit.

**Verdict.** Not green yet. There is one serious security bug (section 4) and a few smaller issues. The rest is in good shape.

**The real risk is scope, not code.** Branches, NFC cards, cameras, discounts and product-level rules were each reasonable, but together the finish line keeps moving, and no real store owner has tested the product. This plan fixes the boundary and puts a pilot first.

## 2. Guiding principles

1. **Stores own their programs.** Each store decides how points are earned and which discounts run. The platform administrator sets only technical safety limits and can suspend a store or switch off a campaign in a fraud case.
2. **Build what pilot stores ask for.** Small stores mostly use two or three rule types. Do not build a generic rule engine before seeing which ones they use.
3. **Design for baskets, ship purchases.** The points engine takes a basket of item lines from day one. A store without item data sends one line for the whole purchase. Product-level rules then arrive later without a rewrite.
4. **No POS yet.** BOKPOINTS does not become a POS and does not integrate with one until a pilot store's actual POS is known.
5. **Record every decision** in `DECISIONS.md`, and update `HANDOFF.md` and `STATUS.md` at the end of every work session, as `AGENT.md` already requires.

## 3. The MVP boundary

### Build now

| Area | In the MVP |
| --- | --- |
| Identification | Customer QR code typed or scanned into the cashier screen. A countertop scanner that types the code plus Enter works with no integration. NFC card IDs use the same entry. The screen plays a short sound and visual on a successful read. |
| Earning rules | Store-owned: points per euro spent, a fixed number of points per purchase, a threshold bonus (spend at least X in one purchase, earn Y bonus points), and optionally a bonus for every Nth visit. |
| Discounts (MVP-lite) | One type: a basket threshold discount (spend at least X, get a fixed amount or percent off). It is automatic, the quote shows the cashier what to apply, and the cashier applies it in the store's own till. |
| Checkout flow | Quote first, then confirm after payment: the cashier confirms payment was taken and enters the amount actually paid, and points are awarded on that confirm. |
| Store control | An owner screen to create, edit and pause rules, with a simulator that shows the points for a sample purchase before activation. |
| Customers | The app shows, in plain language, how they earn at each store. |
| Corrections | Manual adjustments by owners and managers, as today. |
| Business basics | Domain, an email sender, staff invitations by email, subscription billing and a pricing meter. |

### Do not build now (the parking lot)

Each item moves into the build only when its trigger is met.

| Parked item | Promote when |
| --- | --- |
| POS integration and the quote-and-commit API for terminals | A pilot store names its POS and wants automation |
| Product catalog, product and category rules, product discounts, buy-X-get-Y | Pilot stores ask for them and item data is available |
| Automatic discounts applied by the terminal | POS integration exists |
| Opt-in campaigns that customers activate | Several stores want them |
| Signed, short-lived rotating QR codes | Before any automatic discount, or sooner if QR sharing is seen |
| Device credentials for terminals and cameras | POS integration starts |
| Refunds and voids that reverse a sale | POS integration starts |
| NFC card reading and wallet passes | Pilot stores ask for tap-to-identify |
| Spend accumulated over time (for example a monthly total) | A store asks, and the single-purchase version is not enough |
| Card-linked payments (tapping the customer's bank card) | Much later. It needs a payment partner and heavy compliance work |

Also avoid: adding roles, adding rule types nobody asked for, and changing scope during the pilot without a request from a store.

## 4. Fix first: security and quality

These come before any new feature.

### 4.1 Staff invites can take over any staff account (high)

The invite endpoint reuses the account helper written for the one-time admin bootstrap. If the email already exists, that helper overwrites the account's name, admin flag and Supabase link with what the inviting owner or manager sent. An owner at one store could therefore take over another store's owner, or a platform admin, by inviting their email with a Supabase ID they control.

**Work to do**

- In `apps/api/src/db/staff.ts` and `apps/api/src/routes/staff.ts`, split the helper in two. The overwrite version stays for the bootstrap script only. A new invite path creates an account only when the email is new. If the email exists, it only adds the store membership, and refuses if the person is already a member. It never changes the existing name, admin flag or Supabase link.
- Refuse a Supabase ID that is already linked to another staff account.
- Add tests: an owner invites another store's owner, and an admin, using a different Supabase ID, and the accounts are unchanged with only a membership added.
- Check the staff rows in the live database look as expected.

**Acceptance.** Inviting an existing email can never alter that account's name, admin flag or Supabase link.

### 4.2 Customer sign-in trusts an unverified email (medium)

Provisioning claims an existing unlinked customer row by the email claim in the token. If Supabase email confirmation is ever off, someone could sign up with a victim's email and take over their points.

**Work to do**

- In the customer resolver in `apps/api/src/auth/supabase-session.ts`, require proof in the token that the email was verified by a one-time code. Confirm the exact claim names against a real token first.
- In `apps/api/src/db/customers.ts`, claim or create a customer only when that proof is present.
- In the Supabase dashboard, keep "Confirm email" on and avoid password sign-up for customers.
- Add tests with an unverified token.

### 4.3 Invites need a Supabase user ID (medium)

An owner cannot know a cashier's Supabase user ID. The correct design is an email invitation that the person claims on first sign-in with a verified address. That needs an email sender and domain. Until then, an admin does the linking. When the domain exists, build the email-invitation flow and retire the user-ID field.

### 4.4 Smaller items

- Customer app: move the session from plain AsyncStorage to secure storage (`apps/customer/src/lib/session.ts`) before any store release.
- Cashier web screen: add an idle sign-out (`apps/web/src/auth.ts`).
- `apps/api/src/db/customers.ts`: fix the unindented transaction block. CI does not enforce formatting, so consider adding a Prettier check for changed files.
- Confirm the GitHub Actions run is green.

## 5. Work packages, in order

Each package is finished and recorded in the docs before the next starts. The builder asks A before expanding scope, and updates `HANDOFF.md` and `STATUS.md` after each one.

### WP0. Fix first

Section 4. Done when the tests in 4.1 and 4.2 pass and the live data has been checked.

### WP1. Decisions and documents

Record the decisions in section 8 in `DECISIONS.md`. Apply the PRD changes in section 6 and the FRD changes in section 7. Update `HANDOFF.md` and `STATUS.md`.

### WP2. Store-owned earning rules (backend)

- **Engine.** In `packages/shared/src/points/` (`calculate.ts` and the types), change the calculation from "amount times one rate" to evaluating a purchase against a store's set of rules. The existing per-euro rule becomes one rule type. The input is a list of item lines. Where a store has no item data it is one line carrying the purchase total.
- **Data.** In `apps/api/src/db/schema.ts`, add an earning-rules table (store, type, parameters, conditions, effective date, status, version) and a sales table (see WP3). Decide how to carry the existing `points_rules` rows forward: convert them to per-euro earning rules in the same migration. Generate a new migration with `pnpm db:generate`. Never edit a migration already applied to the live database.
- **Endpoints.** New routes for owners to list, create, edit, pause and simulate rules, with audit entries on every change.
- **Permissions.** In `packages/shared/src/permissions.ts`, add a capability for managing earning rules. Follow the FRD section 2 matrix; if it is silent, owners edit and managers view. The platform admin gets no edit right.
- **Rules of operation.** Points from all matching rules add up, capped by a per-sale ceiling. A rule change applies only from its effective date and never alters points already earned. Rule changes are blocked while a store is Paused for non-payment.
- **Technical limits.** Keep the existing rate bound. Add a per-sale ceiling that protects against typos and is not a business limit.
- **Admin store creation** (`apps/api/src/routes/admin.ts`): the first points rule becomes an optional starting template that the owner then edits.
- **Tests.** A store with one per-euro rule behaves exactly as today. Multiple rules add up. A rule change is not retroactive. An admin is refused (403) when trying to edit rules. The simulator matches what a real award does.

### WP3. The sale record and the quote-then-confirm flow

- **Sale record.** Add a sales table: store, branch, customer, staff or device, amount before and after discount, the rules applied, an optional POS reference, and status. Every award links to its sale. Add an optional table of item lines, unused in the MVP.
- **Breakdown.** Store and return a plain breakdown of which rule gave how many points, and which discount applied.
- **Quote.** Extend the existing award preview in `apps/api/src/routes/stores.ts` and `apps/api/src/db/ledger.ts` to return points and the discount to apply. It has no side effects.
- **Confirm.** The award call becomes the confirm step: it takes the amount actually paid, stays idempotent, and records the sale and breakdown.
- **Discount (MVP-lite).** Add the single basket-threshold discount type, store-owned, with the same effective-date and audit rules.

### WP4. Cashier screen

In `apps/web/src/Till.tsx`: keep the identifier box focused for scanner input, play a short sound and visual on a successful read, show the breakdown and any discount to apply, and add a "payment taken" confirm step before awarding. Keep the existing offline behaviour decisions intact.

### WP5. Owner screen

A new rules screen in `apps/web` for owners: list the store's rules, create and edit them with the simulator, pause them, and see the rule history.

### WP6. Customer app

Show each store's active rules in plain language. Move the session to secure storage if not done in WP0.

### WP7. Pilot readiness

- Register a domain, set up an email sender, and build the email invitation flow.
- Subscription billing and the pricing meter (section 9).
- Terms, privacy notice and the Supabase data processing agreement.
- Counter signage with the store's QR, and a short recommended-scanner list (any countertop 2D scanner that types like a keyboard).

### WP8. Pilot

Two or three stores for about four weeks. Record what they ask for. Only then promote items from the parking lot.

## 6. What to add to the PRD

1. **Goals and principles.** Add that each store owns its earning rules and discounts, and that the platform sets only technical limits.
2. **Scope table.** Move "store-defined earning rules (simple)" and "basket threshold discount, applied by the cashier" into the MVP. Keep product-level rules, product discounts, opt-in campaigns and automatic terminal discounts in v1.1 or later, tied to POS integration. Keep NFC cards and wallet passes where they are. State that countertop scanners are supported through keyboard-style input.
3. **Customer experience.** Describe the checkout moment: scan or tap, see the discount, pay, points arrive after payment is confirmed.
4. **Store owner persona.** Owners create and pause their own rules and see a simulator. The admin does not.
5. **Risks.** POS dependency, rule complexity, QR codes being shared, store typos, and the cost of NFC cards and scanners.
6. **Pilot plan and success measures.** Two or three stores, four weeks. Measure awards per day, repeat customers, which rules stores use, scan time at the till, and issues raised.
7. **Pricing.** Tiers by number of active customers, with an active customer defined as someone who earned points in the last 12 months (proposed, to confirm). Never block awarding at the till when a store passes its tier.
8. **Open questions.** The pilot stores' POS, single-purchase versus accumulated thresholds, whether discounted items earn points, and the final definition of a customer.

## 7. What to add to the FRD

Use the FRD's existing numbering style and renumber the proposed IDs to fit. The families below are proposals.

### Earning rules (FR-RUL, new)

- **FR-RUL-1** A store owner can create, edit, pause and delete the store's own earning rules. The platform administrator cannot.
- **FR-RUL-2** MVP rule types: points per euro, fixed points per purchase, threshold bonus, and optionally every-Nth-visit bonus.
- **FR-RUL-3** A rule may carry conditions: minimum spend, active dates, and branch.
- **FR-RUL-4** Rules are versioned and take effect from a chosen date. A change never alters earned points, and every sale records the rule versions used.
- **FR-RUL-5** Points from all matching rules add up, capped by the store's per-sale ceiling and the platform's technical ceiling.
- **FR-RUL-6** A simulator shows the points for a sample purchase before a rule is activated.
- **FR-RUL-7** Platform technical limits protect against typos and are not business limits.
- **FR-RUL-8** Rule changes are locked while a store is Paused for non-payment, and every change is audited.
- **FR-RUL-9** Customers can see, in the app, how they earn at each store.

### Checkout flow (FR-CHK, new)

- **FR-CHK-1** Customers are identified by QR code or NFC card ID entered at the cashier screen, including by a keyboard-style scanner.
- **FR-CHK-2** The quote step returns the points to be earned and any discount to apply, with no side effects.
- **FR-CHK-3** Points are awarded when the cashier confirms payment and enters the amount paid. The call is idempotent.
- **FR-CHK-4** Whether a discounted amount earns points is a per-rule store setting (default to confirm).
- **FR-CHK-5** Every award shows and stores a breakdown of the rules that produced it.
- **FR-CHK-6** The cashier screen gives a sound and visual confirmation on a successful read.
- **FR-CHK-7** Discount (MVP-lite): one basket threshold type, automatic, applied by the cashier.

### Sales (FR-SAL, new)

- **FR-SAL-1** Every award belongs to a sale record: store, branch, customer, staff or device, amounts, rules applied, optional POS reference and status.
- **FR-SAL-2** A sale may carry optional item lines, unused in the MVP.
- **FR-SAL-3** Corrections remain manual adjustments (D-013) until POS refunds arrive.

### Existing requirements to change

- The points calculation requirement changes from one store rate to a set of store-owned rules, with per-euro as one type.
- The store setup requirement changes: the first rule is an optional template that the owner edits.
- The staff invitation requirement changes: invites never modify an existing account.
- The customer sign-in requirement changes: claiming or creating a customer needs a verified email.
- Section 2 (permissions) gains a capability for managing earning rules.
- Section 3 (data model) gains the earning-rules and sales tables.

### Parked requirement families (document only, marked later)

Campaigns with opt-in and per-product scope (FR-CMP), POS quote-and-commit with device credentials and refunds (FR-POS), signed rotating QR codes, NFC card reading, wallet passes.

### Acceptance criteria (AC-12 onward)

- **AC-12** An owner creates a rule, checks it in the simulator, activates it, and the next award follows it.
- **AC-13** An admin cannot edit a store's rules (403).
- **AC-14** Inviting an existing email never changes that account.
- **AC-15** A rule change does not alter points already earned.
- **AC-16** The quote, pay and confirm flow awards points once, even if the confirm is sent twice.
- **AC-17** Claiming a customer account is refused without a verified email.

## 8. Decisions to record

The next free decision number after the handoff is D-113.

| ID | Decision | Why |
| --- | --- | --- |
| D-113 | Earning rules and discounts belong to each store. The administrator has no edit rights except suspending a store or disabling a campaign for fraud. | Stores know their business, and a fixed platform rule set would feel generic. |
| D-114 | The MVP is purchase-based rules plus one basket threshold discount applied by the cashier. Everything in the parking lot waits for its trigger. | Keeps the build small and lets a pilot decide what is worth building. |
| D-115 | The points engine evaluates a basket of item lines. A store without item data sends one line. | Product-level rules can arrive later without a rewrite. |
| D-116 | Every award belongs to a sale record. | Per-line awards, refunds and redemptions need a parent. |
| D-117 | Points from all matching rules add up, capped by a per-sale ceiling. | Simple to explain and safe against typos. |
| D-118 | Whether discounted items earn points is a per-rule store setting, defaulting to points on the amount paid (to confirm). | It is the store's business choice. |
| D-119 | Invites never alter an existing staff account. Email invitations claimed on verified sign-in replace the Supabase-ID field once a domain exists. | Closes the account-takeover bug. |
| D-120 | Customer sign-in must show a verified email before an account is created or claimed. | Prevents takeover by an unconfirmed signup. |
| D-121 | The cashier screen uses quote then confirm-after-payment. | Points are awarded only when payment is confirmed. |
| D-122 | The MVP keeps manual adjustments for corrections. Sale-based refunds wait for POS integration. | Refunds only exist as a feature once a POS reports them. |
| D-123 | A pilot of two or three stores for about four weeks comes before any parked item is built. | Real use replaces guesses. |
| D-124 | Pricing tiers by active customers, with an active customer defined as earning in the last 12 months (proposed). | Fair to small stores and easy to explain. |

## 9. Pilot and pricing (hypotheses to test)

- **Pilot size.** Two or three stores, one of them ideally with branches, about four weeks.
- **Interview questions.** Which rules did you set up? What did you want and could not do? How long does a scan take at the till? What does it cost you now to keep customers returning?
- **Starting prices to test.** Around 19 euros a month up to 500 active customers, 39 up to 1,000 and 69 up to 2,000, with a custom plan above that, a small free tier for tiny shops, and a discount for paying a year upfront. These are guesses informed by typical small-business loyalty software prices, not market facts.
- **Rule.** Passing a tier never blocks awarding at the till. The store gets a nudge to upgrade after a month or two.
- **Selling points that match what is built.** No per-transaction fees, a staff signature on every award, one program across all branches, and customer data kept in the EU.

## 10. Open decisions for A

1. Which POS or payment terminal do the first pilot stores use? This decides when and how POS integration starts.
2. Does "buy goods worth 100" mean a single purchase, or spend accumulated over time? The MVP assumes a single purchase.
3. Do discounted items earn points by default?
4. Is the definition of a customer for pricing "earned points in the last 12 months"?
5. Which domain name, and who owns the email sender account?
6. Which two or three stores are the pilot?
7. Who is building, and who reviews their work?

## 11. Suggested order and timing

These are rough guides, not promises.

| Weeks | Work |
| --- | --- |
| 1 to 2 | WP0 security fixes and WP1 decisions and documents. In parallel, choose pilot stores and buy the domain. |
| 3 to 5 | WP2 rules backend, WP3 sale record and quote then confirm, WP4 cashier screen. |
| 5 to 6 | WP5 owner screen, WP6 customer app, and the email invitation flow. |
| 6 to 7 | WP7 billing, legal and signage. Install scanners at pilot stores. |
| 8 to 11 | WP8 pilot. Record every request. |
| 12 | Decide what to promote from the parking lot, with real data. |

## 12. Notes for the builder

- Follow `AGENT.md`: state a short plan for large changes and wait for A's go-ahead, write tests with the change, never commit secrets, and update the documents at the end of each session.
- Never edit a migration already applied to the live database. Generate a new one, and keep the migration journal test passing.
- Keep the file paths in this document as starting points and confirm them in the code before changing anything.
- When something in this plan conflicts with what the code shows, stop and raise it with A instead of guessing.
