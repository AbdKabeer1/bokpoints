# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

The merchant surfaces (`apps/web`, `apps/owner`) are web apps. The customer app is
Expo/React Native shipping iOS, Android and a web export with one design language, so
platform guidance is applied per surface rather than assumed to be web everywhere.

## Stack

pnpm monorepo: Fastify + Drizzle API (`apps/api`), React + Vite merchant dashboard
(`apps/owner`) and till (`apps/web`), Expo/React Native customer app with a web export
(`apps/customer`), shared Zod schemas and the points engine in `packages/shared`.
PostgreSQL (local for development, Supabase for hosting). TypeScript throughout.

## Users

- **Shoppers in Finland** (customer app): in a queue, at home, or checking a balance.
  They need one code at the till and an honest view of points per store.
- **Cashiers** (till): one-handed at a counter, a customer waiting. Speed and clarity
  outrank everything else.
- **Store owners and managers** (merchant dashboard): a few minutes a day, at a desk or
  tablet. They configure earning rules, rewards, discounts, staff, and look at reports.
- **The platform operator** (admin console, not built): creates stores, watches billing
  and safety.

## Product Purpose

A loyalty platform for small businesses in Finland/EU. Stores pay a monthly
subscription; customers use it free. A customer shows a personal QR code, the cashier
enters the purchase, and points are earned at that store. Points are per store, expire
three months after they are earned, and are spent on the store's own rewards and
basket discount. Success is a store seeing repeat visits and a customer never needing
to explain how the scheme works.

## Positioning

Points, rewards and the discount belong to each store, not to a marketplace: the store
sets its own rules, funds its own discount, and keeps its own customers. The till is
offline-tolerant by design, and the same signed code earns points and unlocks a
one-time discount.

## Operating Context

- Finnish retail: cafés, bakeries, salons; euros, 24-hour clock, `12,50 €`,
  `24.10.2026`; Finnish and English both planned.
- A shared counter device, so staff sessions sign out after 15 idle minutes and require
  a second factor.
- The customer app is Expo (iOS/Android) with a web build used for demos. It has no
  email sender or domain yet; demo sign-in uses a generated one-time code.
- Billing provider, image storage (store logo), marketing email/SMS and the admin
  console are not connected. Placeholders say so rather than pretending.

## Capabilities and Constraints

- Earning rules (per euro, fixed per purchase, every Nth visit, product-based), a
  per-sale ceiling, rewards catalog with per-customer daily limits, one basket
  discount behind a 60-second signed QR, sale record with reversal policy, audit log.
- In-app campaigns reach only customers who opted in to store news, per store; no
  email or SMS.
- Levels, referrals, offline awarding, Finnish UI and billing are not in this build.
- The ledger is append-only; every write is audited; the server enforces every
  permission, never the UI.

## Brand Commitments

- The product's visible name is **Poket**; the company/repo name is BOKPOINTS.
- The brand dot after the wordmark is part of the identity.
- Merchant surfaces keep the approved green-and-white work-surface palette. The
  customer app has a warm editorial identity of its own (D-150).
- No third-party logos, sample data or borrowed brand colour from reference products.

## Evidence on Hand

`docs/PRD.md`, `docs/FRD.md`, `docs/DECISIONS.md` (D-001 to D-150),
`docs/ui/UIdesign_brief.md`, `UI_and_App_Components_revised.docx`,
`BOKPOINTS The Way Forward.md`, and the running product with demo data.
No customer logos, photography or testimonials are licensed for marketing use.
