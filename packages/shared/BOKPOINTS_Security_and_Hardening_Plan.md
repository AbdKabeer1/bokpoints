# BOKPOINTS (Poket): Security and Hardening Plan

*Written 25 October 2026 for the build agent and A. Based on a review of `main` at the latest commit, with the full test suite run locally. This document says what to change and how to know it is done. It contains no code.*

---

## 0. How to use this plan

**Priorities**

| Tag | Meaning |
| --- | --- |
| **P0** | Do before any real store or real customer uses the live system. |
| **P1** | Do before the pilot ends or before public launch. |
| **P2** | Do soon after, as part of keeping the platform healthy. |

**Rules for the builder**
- Follow `AGENT.md`: state a short plan, wait for A's go-ahead on large changes, write tests with each change, and update `HANDOFF.md`, `STATUS.md` and `DECISIONS.md` at the end of the session.
- Never edit a migration that has been applied. Add a new one. Keep the migration journal test passing.
- Never put a real secret in the repo, in chat, in a screenshot or in a log.
- Each item below has **Why**, **Where**, **Steps** and **Acceptance**. An item is done only when its acceptance checks pass.

**What I checked, and what I could not.** I checked the code, the tests, the deployment files in the repo and the dependency audit. I could **not** see the live dashboards: Supabase settings, Render and Vercel settings, DNS records, GitHub repository settings, or GitHub Actions results. Part C lists those as checks for A to do by hand.

**Current state in one paragraph.** 92 unit and 290 integration tests pass. Typecheck and lint are clean across six workspaces. No secrets are committed and no `.env` file is tracked. Row-level security is on for every table. Sign-in needs a second factor for staff and admins, invites cannot alter existing accounts, customer emails are verified, the reversal policy is enforced, and the discount code is signed and used once. The fixes below close the remaining gaps.

---

## Part A. The six fixes (P0)

### A1. Remove public diagnostic endpoints

**Why.** `/v1/health/auth` and `/v1/health/db` need no login. Every call makes an outbound request to Supabase (up to 8 seconds), so anyone can generate load, and the auth endpoint returns the Supabase project URL. They were added to diagnose a deployment problem and are no longer needed publicly.

**Where.** `apps/api/src/app.ts`.

**Steps**
1. Keep `/v1/health` exactly as it is: no database, no outbound calls. Render uses it as the health check.
2. Remove `/v1/health/auth` and `/v1/health/db` from the public API.
3. If A still wants diagnostics, add one platform-admin-only route (admin role, second factor required) that runs the same checks. It must not return the project URL, connection details or raw error messages.
4. Put a per-route rate limit on whatever remains.
5. Record the change as a decision in `DECISIONS.md`.

**Acceptance**
- An unauthenticated request to either old path returns 404.
- No response from any unauthenticated route contains the Supabase URL.
- `/v1/health` still returns 200 with no database access.

### A2. Make `TRUST_PROXY` accept a hop count and fix the runbook

**Why.** The rate limiter keys on the caller's address. Today `TRUST_PROXY` is only `true` or `false`. With `true`, Fastify trusts every `X-Forwarded-For` entry, so a caller can invent an address and get a fresh rate-limit bucket on every request. Also, `docs/DOMAIN.md` tells the operator to set `TRUST_PROXY=1`, but the code rejects that value, so following the runbook would stop the server from starting.

**Where.** `apps/api/src/env.ts`, `apps/api/src/server.ts` (where `trustProxy` is passed), `render.yaml`, `docs/DOMAIN.md`, decisions D-095 and D-097.

**Steps**
1. Change the setting to accept `false`, `true`, or a positive whole number of proxy hops. Pass the number to Fastify as the trusted hop count.
2. In production, require the value to be set explicitly. Refuse to start if it is missing.
3. Work out the correct number for Render in a staging check: send a request with a made-up `X-Forwarded-For` header and log the address the API sees. The number is correct when the logged address is the real caller and the made-up one is ignored. Remove any temporary logging afterwards.
4. Set that number in `render.yaml` instead of `"true"`, and make `docs/DOMAIN.md` match the code.

**Acceptance**
- Unit tests: `false`, `true`, `1` and `2` are accepted; `yes`, `0` and `-1` are rejected.
- With the production value, a request carrying a forged `X-Forwarded-For` is rate-limited by the real address.
- The runbook instructions boot the server.

### A3. Verify the database certificate

**Why.** The connection to hosted Postgres is encrypted but the certificate is not checked (`rejectUnauthorized: false`). Traffic could be intercepted by someone able to sit between Render and the database. The code comment is right that this matches `sslmode=require`, but verified TLS is the better practice and is cheap here.

**Where.** `apps/api/src/db/client.ts` (`poolConfig`), `apps/api/test/unit/db-client.test.ts`, `render.yaml`, `docs/DOMAIN.md`.

**Steps**
1. In the Supabase dashboard, download the project's CA certificate (Project Settings, Database, SSL configuration). Check the exact menu name there.
2. Add an environment variable `DATABASE_CA_CERT` holding the certificate text, set in Render only.
3. When it is set, connect with verification turned on and that certificate as the trusted authority. When it is not set and the host is local, keep today's behaviour.
4. In production, refuse to start without it, after the staging check in step 5.
5. **Test in staging first.** I have not confirmed that the session pooler's certificate chains to that CA. If verification fails with the pooler address, ask Supabase's documentation which host and certificate to use before enforcing.
6. Keep the unit tests for each branch of `poolConfig`.

**Acceptance**
- A production-style connection with the certificate succeeds.
- The same connection with a wrong certificate fails to connect.
- Local development still works with no certificate.

### A4. Move the API off the Render free plan

**Why.** `render.yaml` sets `plan: free`, which sleeps when idle. A cashier's first scan after a quiet period could hang for many seconds. The file's own comment says Starter is the honest choice for a pilot.

**Where.** `render.yaml`, Render dashboard.

**Steps**
1. Change the plan to Starter before the first real store.
2. In the Render service settings, deploy only after CI checks pass.
3. Confirm the health check path is `/v1/health`.
4. Do a cold-start test: leave the service idle, then time the first scan.

**Acceptance**
- The first request after idle responds in under two seconds.
- A commit with failing CI does not deploy.

### A5. Customer data export and account deletion

**Why.** Customers have a legal right to a copy of their data and to erasure. The decision log already says deletion must anonymise the customer and keep the ledger totals, and the components document lists "download my data" and "delete my account" as MVP. Neither exists in the API or the app, and the platform admin's "anonymise customer" action does not exist either. This is required before any real customer signs up.

**Where.** `apps/api/src/routes/customer.ts`, `apps/api/src/db/customers.ts`, `apps/api/src/auth/supabase-admin.ts`, the customer app Settings screen, and the admin console's safety area.

**Steps**
1. **Export.** Add a signed-in customer endpoint that returns their own data as JSON: profile, consents, masked credentials, balances per store, and their ledger entries. It must never include another customer's data. Rate limit it to a few requests per hour.
2. **Deletion.** Add a signed-in customer endpoint that requires a fresh sign-in (a new one-time code) before it acts. In one database transaction it:
   - replaces the email with a non-identifying placeholder and clears the name, phone and other personal fields,
   - revokes every credential,
   - removes notification tokens,
   - sets the status to `deleted`,
   - keeps ledger entries untouched, so balances and store totals stay consistent,
   - writes an audit entry that contains no personal data.
   Then it deletes the Supabase Auth user through the admin API. Make the two steps safe to retry if the second fails.
3. **Admin.** Give the platform admin an "anonymise customer" action that calls the same function. It needs a reason, typed confirmation and a second-factor token issued recently.
4. **App.** Add "Download my data" and "Delete my account" to Settings, with a clear confirmation screen.
5. **Retention.** Implement the agreed rule that a pending customer's email is kept for one year, and delete it after that.
6. Update the privacy notice text to describe all of this.

**Acceptance**
- After deletion, the old token cannot sign in or be used to claim the account, and the same email can register as a new customer.
- Store ledger totals are unchanged by a deletion.
- An export contains only that customer's data, verified by a test with two customers.
- A repeated deletion request changes nothing.

### A6. Use a separate signing key for discount codes

**Why.** The one-time discount proof is signed with a key derived from `SUPABASE_SECRET_KEY`, the administrator key for the whole Supabase project. One secret is doing two jobs, so rotating either breaks or exposes the other. If a non-production deployment does not set `NODE_ENV=production`, it also falls back to a fixed, publicly known development key.

**Where.** `apps/api/src/db/discount-proof.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts`, `render.yaml`.

**Steps**
1. Add a dedicated secret `DISCOUNT_PROOF_SECRET`: at least 32 random bytes, encoded as text.
2. Sign and verify proofs with it, and stop deriving anything from the Supabase secret key.
3. Make it required whenever `NODE_ENV` is `production`.
4. Allow the development fallback only when the API runs locally. Any shared environment (staging included) must supply a real secret.
5. Document rotation: change the value and redeploy. In-flight codes last about a minute, so they simply fail and the customer refreshes.

**Acceptance**
- Production refuses to start without the secret.
- A proof signed with the old secret is rejected after rotation.
- No code path reads `SUPABASE_SECRET_KEY` to sign proofs.

---

## Part B. Improvements (P1)

### B1. Rate limits on every route, not only scanning and awarding

**Why.** Rate limiting is applied per route (`global: false`), so only scanning and awarding endpoints are limited (D-095). Unlimited today: customer sign-in provisioning, logo upload, reversals and adjustments, all admin routes, export and deletion once built, and the health and OpenAPI routes.

**Steps**
1. Register a sensible global default per caller address (for example 300 requests a minute).
2. Add tighter limits to expensive or sensitive routes: customer provisioning, uploads, reversals, adjustments, admin actions, export, deletion.
3. Return a `Retry-After` header on a limit hit.

**Acceptance.** A test that exceeds the limit on a previously unlimited route receives 429.

### B2. Keep the documents honest

1. Rewrite section 5 ("Next steps") of `docs/HANDOFF.md` to match reality. It still describes WP2 as in progress, but builds 19 to 22 are done. A new agent would repeat finished work.
2. Merge `docs/ui/UIdesign_brief.md` and `docs/ui/UIdesign_brief_v2.md` into one file.
3. Check the other documents for the kind of drift found in A2 (runbook values that the code rejects).

### B3. Make CI catch more

1. Add a build step for all four web apps and the customer web build, so a Vercel failure is caught before deploy.
2. Add a dependency audit step that reports but does not block, with a short documented allowlist (see B9).
3. Add a secret scanner (for example gitleaks) that blocks on a finding.
4. Add `.github/dependabot.yml` for npm and GitHub Actions, weekly.
5. Turn on GitHub's CodeQL code scanning and secret scanning with push protection (repository settings).
6. Add branch protection on `main`: require a pull request, require CI to pass, and **block force pushes**. The history shows a force push has already happened once.

**Acceptance.** A deliberately broken build or a fake secret in a test branch fails CI.

### B4. One end-to-end test of the pilot path

Add a test that runs the whole path against a local stack: scan a code, quote, take payment, confirm, redeem a reward, then reverse a sale. Run it in CI or on demand. It protects the one flow that matters most.

### B5. Decide about offline awarding

Offline awarding is not built, and the project's own notes call it the highest technical risk. Before the pilot, ask each pilot store whether the counter's wifi is reliable. If yes, record a decision to defer it. In every case, make sure the till clearly says "Offline: cannot award" and **never queues an award silently**.

### B6. Decide about billing

Billing is not built (no Stripe code) and the pricing decision (D-059) is open. For a pilot of two or three stores, invoice by hand and record that decision so nobody builds half a billing system.

### B7. Backups you have tested

1. Check which Supabase plan the project is on and whether daily backups and point-in-time recovery are included. A points ledger needs recovery to a specific moment.
2. Restore a backup into a scratch project once, before the pilot, and confirm the data is intact.
3. Write down how much data loss and downtime you can accept, and how to restore.

### B8. Monitoring and logging

1. Check that `SENTRY_DSN` is wired in the API and the web apps, and test that an error arrives.
2. Add an outside uptime monitor on `/v1/health` with an alert to A.
3. Alert on spikes in 5xx errors, sign-in failures and rate-limit hits.
4. Set the logger to redact the `authorization` and `cookie` headers and never log request bodies, tokens or one-time codes.

### B9. The two dependency advisories

`pnpm audit --prod` reports two **high** findings: `node-forge` (no patched version exists) and `zod` below 4.6.6. All the reported paths run through the Expo command-line build tool in the customer app, which is used to build the app and is not shipped inside it. Real exposure is low. Record them as accepted with this reason in the audit allowlist, try an override to `zod` 4.6.6 or later if it is compatible, and re-check on every Expo upgrade.

---

## Part C. Securing the platform (accounts, settings, data)

Most of these are settings A checks by hand in each dashboard. The builder helps with the ones marked "builder".

### C1. Accounts and access (P0)
- Turn on **two-factor authentication** on every account: GitHub, Supabase, Render, Vercel, Namecheap, the email provider, and later Stripe and the Apple and Google developer accounts. Prefer an authenticator app or hardware key.
- Use a password manager and unique passwords. Store recovery codes offline.
- No shared logins. Keep the number of people with access to production small.
- Give the build agent only what it needs: a repository token limited to this repo, no production credentials, no admin rights.

### C2. Secrets (P0)
- List every secret and where it lives: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `DISCOUNT_PROOF_SECRET`, `DATABASE_CA_CERT`, the email provider key. They exist only in Render and Vercel settings, never in the repo or chat.
- Rotate on a schedule (about every six months), and **immediately** after a suspected leak or when someone with access leaves.
- If the database password or secret key has ever been pasted anywhere outside those dashboards, rotate it now. The publishable key is public by design.
- Check that the built apps contain no secrets: search the build output of each web app and the customer app bundle for key prefixes before each release (builder).

### C3. Supabase settings (P0, check by hand)
Setting names may differ slightly in the dashboard.
- **Auth:** confirm email is on; password sign-up off unless needed; authenticator-app multi-factor on; one-time code expiry as short as is practical; refresh token rotation on; redirect URLs limited to the `omapointii.store` addresses.
- **CAPTCHA on sign-in.** Email one-time code requests can be abused to flood a stranger's inbox or run up email costs. Turn on CAPTCHA protection for sign-in.
- **Email:** custom sender on your domain (see C4), not the default sender.
- **Database:** enforce SSL; a long random password; if Render's outbound addresses are fixed, consider allowing only those; daily backups and point-in-time recovery (B7).
- **Row-level security:** run a query in the SQL editor confirming every table in `public` has it on and has no policies, and check the Data API does not expose tables you do not intend.
- **Storage:** the `store-logos` bucket is public for reading only, and no policy lets the public write or delete.
- Turn on the organisation-wide requirement for two-factor.

### C4. Domain and email (P0)
- Namecheap: two-factor on, **registrar lock** on, auto-renew on, privacy on.
- Email authentication: SPF, DKIM (from the email provider) and DMARC. Start DMARC at `p=none` with reports, then tighten to `quarantine`.
- Add CAA records limiting certificate issuance to the providers you use.
- Remove any DNS record that points to a service you no longer use.
- Confirm all four sub-domains resolve to the right Vercel projects and nobody else can claim a similar name.

### C5. Web security headers (P1, builder)
Only the customer app has a `vercel.json`, and it sets no security headers. Add a `headers` section to each web app's Vercel config, then check each app still works.

| Header | Value |
| --- | --- |
| Content-Security-Policy | Own scripts only. Connections allowed to the API and the Supabase project. Images from itself, `data:` and the Supabase storage address. `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Start in report-only mode, then enforce. |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | The **till** allows the camera for itself (it scans QR codes). Every other app denies camera, microphone and location. |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains`. Verify what Vercel already sends before adding it. |
| X-Robots-Tag | `noindex` for the till, merchant dashboard and admin console, plus a `robots.txt` that disallows them |

**Acceptance.** A header scanner reports no high-severity findings for each address, and each app still loads, signs in and (for the till) opens the camera.

### C6. API hardening (P1, builder)
- Confirm `/v1/docs` returns 404 on the live API, and decide whether `/v1/openapi.json` should be public. Disable it in production unless integrators need it.
- Set request and connection timeouts.
- CORS stays an exact allow-list, with no wildcard.
- **Step-up sign-in for dangerous actions.** Anonymising a customer, suspending a store and similar actions should require a second-factor token issued within the last ten minutes, not just a valid session.
- Keep access tokens short-lived (about an hour) and keep the idle sign-out on every staff surface.

### C7. Test the permissions, not just the features (P1, builder)
Add a test that goes through **every route** and **every kind of caller** (not signed in, customer, cashier limited to a branch, cashier, manager, owner, another store's owner, platform admin) and asserts the expected answer. Add a start-up check that fails the build if any route has no declared access rule, so new routes are denied by default and nothing is exposed by accident as the API grows.

### C8. Fraud and abuse signals (P1)
Use the data that already exists: awards per cashier per day, redemptions per customer, reversals and adjustments by staff. Show unusual numbers in the store's "needs attention" list and in the platform admin's Safety area. Agree thresholds with A, and keep the first version simple.

### C9. Customer app (P1)
- Public build variables must hold public values only. Verify no secret appears in the compiled bundle.
- Protect app-signing credentials and the account that publishes updates with two-factor.
- Validate deep links, and fill in the store privacy labels accurately.

### C10. Privacy and legal basics (P0 for real customers)
- Sign the data processing agreement with each provider that handles personal data: Supabase, Render, Vercel, the email provider, and later Stripe.
- Publish the privacy notice and terms in Finnish and English, with the agreed rule on keeping a pending customer's email for one year, and the marketing consent wording.
- Keep a simple record of what personal data you process, where, and for how long.
- Know the breach duty: a personal data breach must be reported to the Finnish data protection authority within 72 hours of becoming aware. Write who does what.
- Get the legal and privacy review that `HANDOFF.md` already lists. This plan is not legal advice.

### C11. Incident and recovery runbook (P1)
Write a one-page runbook and test it once:
- **Global kill switch:** an environment setting that turns awarding off for all stores without a code change (builder: add it).
- How to suspend one store, rotate each secret, and restore from backup.
- Who tells the pilot stores, and how.

### C12. Separate staging from production (P1)
Everything now appears to run against one live Supabase project. Create a **staging** project and a staging API, run migrations there first, and point the build agent and all tests at staging. This protects real data from mistakes and from the agent, and it is where the A2 and A3 checks should run first.

### C13. Review before public launch (P2)
- Run an automated scan (for example OWASP ZAP's baseline scan) against staging.
- Walk through the OWASP ASVS level 1 checklist once, and keep the results in `docs/`.
- Consider a short outside penetration test before the platform has many stores.
- Third-party "skills" installed for the build agent (for example under `.opencode/skills`, with `skills-lock.json`) are instructions the agent follows. Read each one, keep them pinned, and remove any that are not needed.

---

## Part D. Launch gate: before the first real store

Tick every line before a store uses the live system.

**Code**
- [ ] A1 to A6 done, each with its acceptance checks passing
- [ ] B1 global rate limits, B3 CI additions, B4 end-to-end test
- [ ] C7 permissions test and default-deny check

**Accounts and settings**
- [ ] C1 two-factor on every account, recovery codes stored
- [ ] C2 secrets inventory, rotation done where a leak is possible
- [ ] C3 Supabase checklist done, CAPTCHA on, row-level security query clean
- [ ] C4 DNS email records, registrar lock, CAA
- [ ] C5 headers live and scanned

**Operations**
- [ ] A4 Starter plan, cold-start test passed
- [ ] B7 backup restored once into a scratch project
- [ ] B8 monitoring and alerts tested with a real error
- [ ] C11 kill switch and runbook tested
- [ ] C12 staging environment in use

**People and law**
- [ ] C10 agreements signed, privacy notice and terms published, breach plan written
- [ ] Pilot stores briefed, with each cashier on their own account (no shared logins)

---

## Part E. Suggested order of work

| Week | Work |
| --- | --- |
| 1 | A1 to A6. In parallel A does C1, C2, C3 and C4 by hand. |
| 2 | B1, B3, B8, C5, C6. Create staging (C12) and run A2 and A3 checks there. |
| 3 | C7, B4, B7 restore test, C11 runbook, ZAP scan. Then the launch gate. |

These are rough guides, not promises. The launch gate decides, not the calendar.
