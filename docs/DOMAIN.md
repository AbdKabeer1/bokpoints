# Domain, hosting and email — the launch runbook

This is the WP7 slice: a real domain, HTTPS on every surface, and email that actually
arrives. It touches four places: DNS, hosting, Supabase Auth, and the apps' env.

Nothing here changes product scope. It replaces the placeholders (built-in Supabase
mailer, localhost URLs) with working infrastructure.

---

## 0. What ships where

Four web surfaces and one API. Subdomains keep cookies, CORS and support simple; a
single domain with paths would make every proxy rule harder.

| Surface | Hostname (example) | What it is |
| --- | --- | --- |
| Customer app | `app.omapointii.store` | Expo web export (`apps/customer/dist`) |
| Cashier till | `till.omapointii.store` | `apps/web/dist` |
| Merchant dashboard | `portal.omapointii.store` | `apps/owner/dist` |
| Platform admin | `admin.omapointii.store` | `apps/admin/dist` |
| API | `api.omapointii.store` | `apps/api` (Fastify, long-running process) |

Do not put the admin console on the same hostname as the merchant portal: separate
origins are a cheap safety boundary, and the admin app already labels itself.

---

## 1. Hosting (choose once)

The four web apps are static files after `pnpm build`; the API is a Node process that
needs a Postgres connection.

**Recommended for the pilot**

- **Static apps → Vercel** (free): four projects, each pointing at its `dist/`.
  Custom domains and TLS are automatic.
- **API → Railway or Render** (about $5/month): one service from `apps/api`, with
  `pnpm --filter @bokpoints/api build` and `node dist/server.js`.
- **Database → Supabase** (already live; the hosted project is at migration `0016`).

Alternatives that work unchanged: Cloudflare Pages for the static apps, Fly.io for the
API. A single VPS also works if you already run one — then Caddy or nginx terminates
TLS for all five hostnames and proxies `api.` to port 3000.

Whatever you pick, the API must be a **single long-running instance** for now: rate
limits and the rotating-code store are in process memory.

---

## 2. DNS

The domain is registered at **Namecheap** and uses **Namecheap BasicDNS**
(`dns1/dns2.registrar-servers.com`), currently showing the parking page. All records go in
Namecheap → Domain List → `omapointii.store` → **Advanced DNS**.

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| `CNAME` | `app` | `cname.vercel-dns.com` | Customer app |
| `CNAME` | `till` | `cname.vercel-dns.com` | Cashier till |
| `CNAME` | `portal` | `cname.vercel-dns.com` | Merchant dashboard |
| `CNAME` | `admin` | `cname.vercel-dns.com` | Platform admin |
| `CNAME` | `api` | `<service>.up.railway.app` | API |
| `TXT` | `@` (or `mail`) | Mailtrap SPF record | Email authentication |
| `CNAME` | Mailtrap DKIM names (2) | Mailtrap values | Email signing |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@omapointii.store` | Start in monitor mode |
| `TXT` | `@` | `v=spf1 include:...` | Only one SPF record; merge, never add a second |

Exact CNAME targets appear in the host's dashboard after you add the domain there.
Add Mailtrap's records exactly as shown; do not "correct" their names.

Wait for DNS propagation before verifying. `dig +short app.omapointii.store` should answer.

---

## 3. Email that arrives (Mailtrap)

Supabase's built-in mailer is rate-limited and unreliable for real customers. Mailtrap
Email Sending replaces it.

1. In Mailtrap, **Sending Domains → Add domain**. Use the bare domain (`omapointii.store`) so
   both `no-reply@omapointii.store` and future senders work.
2. Add the SPF, DKIM and DMARC records it shows. Verify in Mailtrap. Verification can
   take a few minutes to a few hours.
3. Create an **API token** (Sending). Keep it in your password manager.
4. In Supabase → **Authentication → Emails → SMTP Settings**, enable custom SMTP:

   | Field | Value |
   | --- | --- |
   | Host | `live.smtp.mailtrap.io` |
   | Port | `587` |
   | Username | `api` |
   | Password | the Mailtrap API token |
   | Sender email | `no-reply@omapointii.store` |
   | Sender name | `Poket` |

5. In Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `https://app.omapointii.store`
   - **Redirect URLs:** `https://app.omapointii.store/**`, `https://portal.omapointii.store/**`,
     `https://admin.omapointii.store/**`, `https://till.omapointii.store/**`, and keep
     `http://localhost:8081/**` for development.
6. Edit the email templates. The customer app signs in with a **code**, so the
   Magic Link template must contain `{{ .Token }}` (the six-to-ten digit code), not only
   `{{ .ConfirmationURL }}`. Keep "Confirm email" enabled.

Local and CI must use the **Sandbox**, not the live endpoint, so test mail never reaches
a real inbox. Keep both tokens in separate env vars:

```bash
MAILTRAP_API_TOKEN=...          # live sending (API server)
MAILTRAP_SANDBOX_TOKEN=...      # local/test, routes to the sandbox inbox
MAILTRAP_INBOX_ID=...
```

The app does not send mail yet except through Supabase Auth, so these are staged for the
staff-invitation and campaign work.

---

## 4. App configuration

Each app reads env at build time (Vite) or bundle time (Expo). Production values:

```bash
# apps/web, apps/owner, apps/admin
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_API_BASE=https://api.omapointii.store

# apps/customer
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
EXPO_PUBLIC_API_BASE=https://api.omapointii.store
```

Local development keeps `VITE_API_BASE` empty (the Vite proxy handles `/v1`) and the
customer app keeps `http://127.0.0.1:3000`.

API environment:

```bash
DATABASE_URL=postgresql://...        # Supabase session pooler for IPv4 networks
CORS_ORIGINS=https://app.omapointii.store,https://till.omapointii.store,https://portal.omapointii.store,https://admin.omapointii.store
TRUST_PROXY=1                        # Railway/Render/Vercel sit behind a proxy
NODE_ENV=production
```

`CORS_ORIGINS` is an exact allow-list: no wildcard, no trailing slash. The admin console
calling the API from `admin.` is the origin that most often gets forgotten.

`TRUST_PROXY=1` matters: without it, the rate limiter sees the proxy's IP and throttles
every user together.

**In-process state warning:** the API keeps rate-limit counters and the one-time discount
proof store in memory. One instance only until that moves to Postgres or Redis.

---

## 5. Deploy order

1. API first: deploy, set env, run migrations against the production database
   (`pnpm db:migrate` with the production `DATABASE_URL`), check
   `curl https://api.omapointii.store/v1/health`.
2. The four static apps with `VITE_API_BASE` / `EXPO_PUBLIC_API_BASE` set.
3. DNS and TLS, then Supabase URLs and SMTP.
4. Smoke test in this order:
   - open each hostname, no console errors;
   - owner signs in with TOTP, loads the overview;
   - till identifies a customer and previews an award (no write);
   - admin lists stores and opens one;
   - customer requests a code and it **arrives** at a real address;
   - a campaign is sent and appears in the customer inbox.

---

## 6. Security checklist

- [ ] HTTPS on all five hostnames, HSTS from the host.
- [ ] `CORS_ORIGINS` lists exactly the four app origins.
- [ ] `TRUST_PROXY=1` on the API.
- [ ] Supabase redirect allow-list has no wildcard beyond the app origins.
- [ ] No service-role or secret key in any static app bundle.
- [ ] Mailtrap live token only in the API host and Supabase SMTP settings.
- [ ] DMARC starts at `p=none`, then moves to `p=quarantine` after a week of clean mail.
- [ ] Supabase "Confirm email" stays on.
- [ ] Admin console refuses non-admin accounts (already enforced server-side).

---

## 7. What is deliberately not included

- Marketing/bulk email (campaigns stay in-app; the plan of record says v1.1).
- Universal links / app-store builds for the customer app (WP8).
- A CDN in front of the API, multi-region, or autoscaling.
- Custom email templates beyond the code and invitation.
