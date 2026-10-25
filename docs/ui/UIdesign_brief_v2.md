# BOKPOINTS (Poket): UI Design Brief for the Build Agent

*Written 24 October 2026 for the build agent working in the `bokpoints` repo. Owner: A. This brief says how the four interfaces should look and feel. It does not add features.*

---

## 0. How to use this brief

**Reference images:** `docs/ui-reference/` holds four screenshots (section 1). They are style references only.

**Read first, in this order:** `AGENT.md`, `docs/PRD.md`, `docs/FRD.md`, `docs/DECISIONS.md`, `docs/HANDOFF.md`, then the two planning documents A maintains: **"UI and App Components by User Type"** (what each interface contains, with a phase tag on every component) and **"The Way Forward"** (MVP boundary and work packages).

**What this brief is.** A visual and structural style guide, taken from four reference screenshots A supplied. The references are dashboards from other products (named below for context only). They show a *style to follow*, not features to build.

**The scope gate.** Before building any element from this brief, answer three questions. If any answer is "no", stop and ask A.

1. Is this component listed in "UI and App Components by User Type" with the tag **MVP** (or an earlier phase A has promoted)?
2. Does the data it shows already exist in the API, or is the endpoint part of the work A has asked for?
3. Is it needed by the people using this interface (customer, cashier, store admin, platform admin) and not just attractive?

**Hard rules**
- Keep the existing **Poket white-and-green** brand (section 2). Do not import the reference products' colours, logos, copy, fonts or sample data.
- Do not build any feature listed in section 8 ("Do not add").
- Use the existing token names and files. Do not introduce a second theme system.
- Every visible string goes through the existing language setup (Finnish and English). No hard-coded text.
- Follow `AGENT.md`: state a short plan for large changes, wait for A's go-ahead, write tests with the change, update `HANDOFF.md` and `STATUS.md` at the end of the session.

**Names.** *Store admin* means the store owner or manager. *Platform admin* means A, the software owner. In code, `is_admin` means platform admin. The product's visible names today are **Poket** (customer app), **Poket Store Portal** (cashier till, `apps/web`) and **Poket Merchant Platform** (store admin dashboard, `apps/owner`).

---

## 1. The reference screenshots

A supplied four screenshots. Save them in the repo at **`docs/ui-reference/`** (the JPG files that come with this brief). They are also described here so this brief stands on its own. Look at the images when you design a screen, and use the table below to see which one to open.

| # | File | Product (context only) | What it shows |
| --- | --- | --- | --- |
| 1 | `01-retainr-client-dashboard.jpg` | **Retainr**, a client dashboard | Left sidebar with grouped sections and a red count badge. Search box with a keyboard hint. Breadcrumb, large page title, one orange-red primary button and one white secondary button. Cards on a light grey background. A big "62%" with a segmented progress bar. A row of three stats. A recent-activity list with monospace dates and a red "NEEDS YOU" tag. An open-items card with a Review button. A blue info callout. A right column with a plan card, a seats meter (8 of 10, segmented), a usage bar, a team list, and a "Manage subscription" button. |
| 2 | `02-mise-today-left.jpg` | **Mise**, a kitchen app (left half of its dashboard) | Sidebar with the business and location name, a search box, grouped nav with badges, and a user popover at the bottom. A page header with a date chip and a segmented filter (All stations, Hot line, and so on). KPI cards with an icon tile, a large number and a change chip. A table with thumbnails, priority tags (a coloured dot plus a label) and quantity progress bars. |
| 3 | `03-clearbill-supplier-page.jpg` | **Clearbill**, a supplier page | Sidebar with a workspace switcher, a search box and a status chip at the bottom ("Connected, 2:10 PM"). Breadcrumb, a page title with an amber "Action required" pill, and a black primary button. Tabs with counts. A readiness card (72%, tick-mark progress bar, a checklist with done, in-progress and to-do states). A key-value details card. A four-number stats strip. A "Common issues" list with dotted bars. A blue pattern callout with an action button. A recent-invoices table with monospace IDs and status pills. |
| 4 | `04-mise-today-right.jpg` | **Mise**, the right half of its dashboard | Header buttons (secondary and black primary), an "Updated 11:40 AM" stamp, KPI cards with change chips, table rows with due times and a red "Running late", per-row Start and Continue buttons, a "Needs attention" card with icon tiles, a short sentence and a link action each, and a small bar chart card. |

### Shared qualities to carry over

- Warm light background, white cards, generous space, very little decoration.
- One strong action per area, a quieter secondary action beside it.
- Small uppercase **monospace labels** ("eyebrows") above content, and monospace for dates, IDs and times.
- **Large numerals** for the one number that matters, with a small comparison beside it.
- **Segmented progress bars**, status pills with a dot, tabs with counts.
- Left sidebar with group labels, count badges and a store switcher.
- Quiet info callouts for notices, with a clear action button.

---

## 2. The visual system to keep (Poket white and green)

These values already exist in the code. Reuse them.

| Token | Value | Use |
| --- | --- | --- |
| background | `#f4f8f6` (web), `#ffffff` (customer screens) | Page background |
| surface / card | `#ffffff`, soft card `#f0f7f3` / `#f5faf7` | Cards and quiet panels |
| ink / text | `#0f1512` | Main text |
| muted | `#5f6f66` | Secondary text |
| line | `#e3ebe6`, strong `#d4ded8` | 1px borders and dividers |
| green | `#0b7a4b`, deep `#075c38`, soft `#e8f4ee` | **Primary buttons, brand mark, positive state** |
| gold (amber) | `#b98a1b` | Warnings and "needs attention" |
| danger | `#b42318`, soft `#f6d5d1` / `#fdecea` | Errors, destructive actions, urgent tags |

**Add only these new tokens**, used for notices and nothing else: `--info: #2b5fb4`, `--info-soft: #e8f0fb`, `--warn-soft: #fbf1d9`.

**Differences from the references (important).** The references use a **black** primary button and one **orange-red** call to action. Poket's primary action is **green**. Use near-black (`--ink`) only for strong secondary emphasis. Red is for urgency and destructive actions, not for the main button.

### Type, spacing and shape

- **Font.** Keep the existing system sans-serif stack, so there is no web-font download on a till. Use a monospace stack (already in the CSS) for IDs, codes, dates, times and eyebrow labels.
- **Scale.** Body 14 to 15 px (16 px on the till and customer app). Page title 24 to 28, semibold. KPI numbers 32 to 40, semibold, tabular figures. Eyebrow labels 11 px, semibold, uppercase, letter-spacing 0.06 to 0.08 em, in muted.
- **Spacing.** An 8 px grid. Card padding 20 to 24. Gap between cards 16.
- **Radius.** Cards 16 px (customer app keeps its 18). Buttons and inputs 10 to 12. Pills fully rounded.
- **Borders over shadows.** 1 px `--line` borders, at most a very light shadow. No heavy drop shadows or gradients.
- **Numbers and dates (Finnish).** `12,50 €`, 24-hour time, dates as `24.10.2026`. Use the existing format helpers. Allow about 30% longer text in Finnish.
- **Accessibility.** Text contrast of at least 4.5 to 1. Tap targets at least 44 px (56 px on the cashier till). Visible focus rings. Never use colour alone: pair it with a label or icon. Respect reduced-motion. Progress bars expose `role="progressbar"` with values.

### Reusable component recipes

| Component | Recipe |
| --- | --- |
| **Stat card** | Eyebrow label, large number, optional change chip (green up, red down) with "vs last week". Show the chip **only** if the API returns the previous period. |
| **Stat strip** | One card divided into 3 or 4 stats, with a hairline between them (as in screenshots 1 and 3). |
| **Segmented bar** | 8 to 12 equal segments, filled ones in `--ink` or `--green`, the rest in `--line`. Used for tier usage, reward progress and levels. |
| **Status pill** | A small dot plus a label: green (active, earned, paid), amber (needs attention, expiring), red (failed, suspended), grey (paused, closed), blue (info). |
| **Tabs** | Underlined tabs with an optional count. |
| **Segmented control** | A pill group for filters, such as All branches, Helsinki, Tampere. |
| **Data table** | Header row in eyebrow style, 48 to 56 px rows, monospace IDs and times, status pills, no zebra stripes. |
| **Key-value list** | Label left in muted, value right, hairlines between rows. |
| **Checklist card** | Done = filled green circle with a tick. In progress = amber clock. To do = empty circle. Each item has a one-line subtitle. Ends with one primary button. |
| **Callout** | Soft tinted panel with an icon and a sentence, plus an optional button. Blue for information, amber for a warning, red for a problem. **System and account notices only**, never AI-written insights. |
| **Status chip** | A small chip with a dot and a time, for example "Online, synced 14:10". |
| **Needs-attention list** | Icon tile, a short title, one sentence, a link action. Only for items that come from real data (see section 4.2). |
| **Empty state** | One line saying what belongs here, and one button to create it. |
| **Confirm dialog** | For destructive actions: states what will happen, requires a reason, and for the biggest actions requires typing the store name. |

---

## 3. The shared shell for the web surfaces

Applies to the store admin dashboard and the platform admin console. The cashier till has its own lighter layout (section 4.1).

- **Sidebar** (about 240 px, collapsible): brand mark and name at the top; below it the **store and branch switcher** (the references' workspace switcher; `StorePicker` already exists); a search box with a hint chip only where there is something to search; grouped navigation with eyebrow group labels and count badges; at the bottom a status chip and a user menu (name, email, account, language, sign out).
- **Top bar**: breadcrumbs on the left (for example `Customers / Aino V.`), the user avatar on the right. **No notification bell in the MVP.** There is nothing to put in it yet. Payment and system notices appear as a callout at the top of the page.
- **Page header**: title, an optional status pill, and at most one primary and one secondary button on the right.
- **Content**: a card grid, two columns on wide screens with a narrower right column for plan or details, one column below 1024 px.
- **Session safety** (already required): idle sign-out on every staff surface, and second-factor sign-in.

---

## 4. The four interfaces

Phase tags are those in "UI and App Components by User Type". Existing means a file already exists and should be improved, not rebuilt.

### 4.1 Cashier till: Poket Store Portal (`apps/web`, existing)

**Who and where.** A cashier at a counter on a phone, tablet or computer, often with a customer waiting. Speed and clarity matter more than anything else.

**Layout.** One screen for one task, **no sidebar**. A slim top bar: brand, store and branch, a **connection status chip** ("Online, synced 14:10" or "Offline, 3 waiting"), and the user menu. Below it, a single column on phones. On wider screens, the sale on the left and a "Recent awards" list on the right.

**The flow (already built, keep the order).** Scan or type the code, check name and balance, enter the amount, optional reward, preview, take payment in the store's own till, confirm payment.

**Style notes**
- Large type: amount and points are the biggest things on screen. Buttons at least 56 px high. **One primary green button per step.**
- The customer confirmation card shows first name and balance. Add a small **segmented bar toward the next reward the store offers**, for example "320 of 500 points, Free coffee", using the rewards the API already returns. (MVP, only if the rewards data is already loaded.)
- The preview shows points to be earned, the reward to apply and any discount to apply, each with one short line saying which rule produced it.
- Errors use a red pill and one plain sentence ("Code not recognised", "Store is paused"). Success uses the existing mint result panel and the existing sound.
- **Recent awards**: a compact list with monospace times, first name, points, and a pill for Earned, Redeemed or Reversed (borrowed from the "Recent activity" list).
- Keep the camera scanner and the keyboard-scanner input exactly as they work today.

**Do not add:** KPI cards, charts, tabs, tables, a sidebar, or settings pages on the till.

### 4.2 Store admin dashboard: Poket Merchant Platform (`apps/owner`, existing)

**Who and where.** A store owner or manager at a desk, on a laptop or tablet, for a few minutes a day. The owner can do everything. The manager handles day-to-day work and not billing or ownership.

**Existing screens to restyle with the shared shell:** Rules, Rewards, Discount, Customers, Customer detail, People, Branches, Profile, Counter sign, Reports, Audit log, Settings, Store picker, sign-in and second factor.

**Navigation (group labels in eyebrow style)**
- **Overview:** Home
- **Program:** Rules, Rewards, Discount
- **Customers:** Customers
- **Store:** Profile, Branches, People, Counter sign
- **Account:** Plan and billing, Audit log, Settings, Reports (where it fits best)

**New: Home screen.** This is the main way the references improve the product. Build it only from data the API already has.

| Card | Contents | Source and phase |
| --- | --- | --- |
| Header | Store name, **segmented control for branches** (All, then each branch) when the store has branches | MVP |
| Stat row | Active customers, points issued, points redeemed, points outstanding, each with a change chip **only if** the previous period is available | MVP (basic reports) |
| **Plan card** (right column) | Plan name, renewal date, and **active customers against the tier limit as a segmented bar, for example 312 of 500**, plus "Contact us" | MVP (subscription and billing) |
| **Setup checklist** | Store profile, first earning rule, first reward, invite a cashier, print the counter sign. Hides itself when all are done | MVP (onboarding) |
| **Needs attention** | Only real items: payment problem (when billing exists), a rule or reward that is paused, staff invitations not yet accepted, points about to expire this week | MVP |
| **Recent activity** | Latest awards, redemptions, reversals and adjustments, with monospace time, staff name and first name of the customer | MVP (audit trail) |

**Other screens**
- **Rules:** a list of rule cards with status pills and a side panel with the **simulator**, where the owner enters a sample purchase and sees the points before activating. The rule history appears as a quiet list.
- **Rewards:** a table with name, points cost, limit, a status pill (Active, Paused) and a pause switch.
- **Customer detail** (the "supplier page" pattern from screenshot 3): breadcrumb, name with a status pill, the code in monospace, a **stat strip** (balance, earned in total, redeemed, last visit), a key-value details card, and a history table with status pills (Earned, Redeemed, Expired, Adjusted, Reversed). The manual-adjustment action sits in the page header with the confirm dialog.
- **People:** a list with initials avatars, a role pill, branch, and an Invite button.
- **Audit log:** a table with monospace times and IDs, filters as a segmented control, and no charts.
- **Reports:** a stat strip plus simple tables. No charts unless the data already exists and A asks for one.

**Do not add:** a bell or notification centre, AI insight callouts, forecasts, campaign analytics, push composer or the store-page editor. All of those are v1.1 or Ideas.

### 4.3 Platform admin console (new, `apps/admin`; A only)

**Who and where.** A, on a laptop. This is the control room for the whole platform. **No admin interface exists in the repo yet** (the store-creation endpoints exist). The builder confirms the folder and sets it up as a new workspace that **reuses the shared shell and tokens**.

**Navigation**
- **Platform:** Stores, Subscriptions, Support, Safety
- **Account:** Audit log, Settings

A red count badge on **Subscriptions** (failed payments) and **Safety** (open flags), as the "Exceptions 24" badge works in screenshot 3.

**Screens (all MVP in "UI and App Components")**
- **Stores list.** A table with store, plan, status pill (Active, Paused, Suspended), customers, last activity. A **segmented filter** (All, Active, Paused, Suspended) and a Create store button.
- **Store detail** (the supplier page pattern from screenshot 3, adapted):
  - Header: store name, status pill, and the actions **Suspend** or **Reactivate** and **Open as support view**.
  - Tabs: **Overview, Staff, Rules, Billing, Audit**.
  - **Onboarding checklist card** (the readiness card): owner login created, first rule, first reward, first cashier, counter sign printed. Shows how far along the store is.
  - **Stat strip:** customers, awards in the last 30 days, redemptions, points outstanding.
  - **Details card** and a **recent activity** table.
- **Subscriptions.** A table of plans and payment status. Rows with failed payments carry a pill for their stage (reminder, paused, suspended), matching the day 7, 14 and 30 rules.
- **Support.** One search box (customer code or email, or store name) leading to the same customer detail and store detail views, read-only except for the actions below.
- **Safety.** A list of flagged items. Actions: disable a campaign, **anonymise a customer** (keeps the ledger totals, needs a reason, and is audited). Every destructive action uses the confirm dialog with typed confirmation.
- **Platform analytics.** A stat strip only: stores, customers, awards, subscription revenue.
- **Audit log.** The same table component as the store audit log, showing every admin action.

**Style notes.** The same shell as 4.2, but a visible **"Platform admin"** role label in the sidebar, so it can never be mistaken for a store view. Destructive buttons are red, never green.

**Do not add:** feature switches, platform messages, system health, staff roles for platform support, legal records. These are v1.1.

### 4.4 Customer app: Poket (`apps/customer`, Expo, existing)

**Who and where.** A shopper on a phone, in a queue or at home. White space first. The references are desktop dashboards, so **take only their visual language** (type, cards, pills, bars), **never their layouts**.

**Existing screens:** Splash, Onboarding, Sign-in, Home, Store history, Settings.

**Style notes**
- **Home:** the **"My code" QR card at the top**, large, with the customer's name and brightness raised when it is shown. Below it, one **card per store**: store name with an initial avatar, the **balance as the largest number**, and a **segmented bar toward the next reward** ("320 of 500, Free coffee"). If points are about to expire, an **amber pill** ("40 points expire 14 Nov").
- **Store detail:** a short **"How to earn"** card in plain language, a **Rewards** list (points cost, and for each either "Ready to use" or a bar showing how far away it is), and a **history list** with monospace dates, a plus or minus amount, and pills for Earned, Redeemed, Expired, Adjusted, Reversed.
- **Levels** (an Idea; build only if A promotes it): a segmented bar from bronze to silver to gold, using the store's own level names. Levels are based on points earned over a rolling period, not the current balance.
- **Settings:** language, marketing consent, privacy (download my data, delete my account), help and contact. The phone-verification prompt after registration is v1.1.
- Large type (16 px or more), 44 px tap targets, no tables, no sidebar, no search. Keep the existing animated Poket wordmark and the sign-in by emailed one-time code.

**Do not add:** dashboards, stat rows, activity feeds with filters, a notifications centre (v1.1), referral or store discovery (Ideas).

---

## 5. Build once, share everywhere

If it does not delay the pilot-critical work, put the repeated pieces in one place so the three web apps stay consistent.

1. **A shared tokens file** (the table in section 2), used by `apps/web`, `apps/owner` and the new `apps/admin`. The customer app keeps `theme.ts` but takes its values from the same list.
2. **A small shared set of web components:** AppShell, Sidebar, PageHeader, Breadcrumbs, Card, StatCard, StatStrip, ChangeChip, SegmentedBar, StatusPill, Tabs, SegmentedControl, DataTable, KeyValueList, ChecklistCard, Callout, StatusChip, EmptyState, Avatar, UserMenu, ConfirmDialog, Button, MoneyInput. The till uses only the ones it needs.

This is **optional**. Ask A before creating a new package, and never let it block a work package from "The Way Forward".

---

## 6. Suggested order of UI work

Follow the work-package order in "The Way Forward". Within it:

1. **Tokens and shared pieces** (section 5), with no visible change to the till.
2. **Cashier till polish:** status chip, recent awards, reward progress on the customer card.
3. **Store admin:** the shared shell, then **Home**, the setup checklist, the plan card, then restyle the existing screens.
4. **Customer app:** progress bars, pills and the expiring-points pill.
5. **Platform admin console:** stores list, store detail, suspend and reactivate, support search. Then subscriptions, safety, analytics and audit.

---

## 7. Definition of done for any screen

- It matches section 2: tokens, type, radius, green primary.
- Every element passes the scope gate (section 0).
- It works at these widths: till 360 to 1280 px, store admin and platform admin 768 to 1440 px, customer app 360 to 430 px.
- Finnish and English both fit, and numbers and dates use Finnish formats.
- Loading, empty and error states exist and read plainly.
- The keyboard works on the web surfaces, with visible focus.
- Colour is never the only signal.
- Tests pass, typecheck and lint are clean, and `HANDOFF.md` and `STATUS.md` are updated.

---

## 8. Do not add (found in the references, not part of BOKPOINTS)

- An AI advisor or chat, escalations, "conversations", knowledge, frameworks, or **AI usage meters**.
- **Seats meters.** Our version of this pattern is the active-customers tier bar and nothing else.
- Forecasts, "expected covers", prep boards, waste logging, inventory, menus, purchase requests.
- Supplier, invoice, payment, VAT or e-invoicing modules.
- A global command palette. A simple search box where search is needed is enough.
- A notification centre or bell (v1.1).
- Task assignment, due dates and "client actions" checklists.
- Photos or thumbnails in tables.
- Per-row Start and Continue buttons.
- Generated "insights" or "patterns" callouts. Callouts are for system and account notices only.
- The reference products' colours, black primary buttons, orange-red call to action, logos, wording and sample data.

---

## 9. Open points for A

1. **Brand name on screen.** The apps say Poket. Confirm BOKPOINTS is the company or working name only.
2. **Admin console location.** The brief assumes a new `apps/admin`. Confirm.
3. **Shared package.** Confirm whether the optional shared tokens and components may be created now or after the pilot work.
4. **Change chips.** They need the previous period's numbers. Confirm whether the reports endpoint should return them or the chip should be left out for now.
