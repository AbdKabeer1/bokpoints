# UI rebuild — plan (from `docs/ui/UIdesign_brief.md`)

## Source of truth

- **Look and feel:** `docs/ui/UIdesign_brief.md` (§2 tokens, §3 shell, §4 per-app, §7 done).
- **Scope:** `BOKPOINTS The Way Forward.md` + `UI_and_App_Components_revised.docx`.
- **A's explicit additions (2026-10-24):** in-app campaigns, notifications, store logo/brand colour
  and public contact visibility, support/FAQ, sign out, role and store switching, colourful charts.
  These override §4.2/§8 of the brief, which listed them as v1.1. Recorded as D-148.

## Order

1. Owner shell + tokens (sidebar, grouped nav, page headers, cards, tables, pills, bars).
2. Owner Home (Overview) from existing data + 30-day series added to the reports endpoint.
3. Owner Campaigns (compose, send now, list, reach), Notifications, Billing placeholder.
4. Owner existing screens restyled to the shell (Rules, Rewards, Discount, Customers, Customer
   detail, People, Branches, Profile, Counter sign, Reports, Audit, Settings).
5. Customer app: tokens, Home (QR + points + store cards + progress + bottom tabs), Inbox,
   Profile/Settings, Store history.
6. Till: connection chip, reward progress on the customer card, recent awards list.
7. Verification: typecheck, lint, unit + integration tests, three builds. Docs + decisions.

## Not in this pass

- Platform admin console (Build 21) — separate work package.
- Email/SMS delivery, logo upload (needs storage), billing provider, Finnish translation.
  These appear as disabled or plain placeholders, never as fake working controls.
