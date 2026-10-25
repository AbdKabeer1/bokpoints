# Security notes

## Dependency audit allowlist

`pnpm audit --prod` currently reports two **high** advisories. Both paths run
through the Expo command-line build tool in the customer app; that tool builds
the app and is not shipped inside it. Real exposure is low.

| Package | Advisory | Why accepted | Re-check |
| --- | --- | --- | --- |
| `node-forge` | GHSA-86w9-cpqp-85rv | No patched version exists; used only by `@expo/cli` at build time | Every Expo upgrade |
| `zod` < 4.6.6 | GHSA-mrhx-c7xc-m3w5 | Pulled by `@expo/cli`; the app's own zod is current | Every Expo upgrade |

The CI audit step reports the result but does not block. Remove a row when the
dependency is patched or the Expo toolchain drops it.

## Secrets

- Values live in Render and Vercel settings, never in the repo.
- `DATABASE_CA_CERT` is the public Supabase Root 2021 CA.
- `DISCOUNT_PROOF_SECRET` is rotated by changing the Render value and
  redeploying; in-flight codes last about a minute and simply fail.


## Bot and abuse protection

What is in place:

- Global per-caller API rate limits plus tighter limits on sign-in, uploads,
  reversals, adjustments, feedback and admin actions.
- One-time email codes rather than passwords for customers.
- Staff and admin accounts require a second factor.
- The API returns 429 with `Retry-After` on a limit hit.
- Vercel serves the four web apps behind its CDN; the API is behind Render.

What must be enabled in the dashboard:

1. **Supabase Auth CAPTCHA** — Authentication → Settings → Enable CAPTCHA.
   Use Cloudflare Turnstile or hCaptcha and put the secret in Supabase. This is
   enforced by Supabase Auth, not by our code, and covers sign-in code requests.
2. **Email rate limits** — keep Supabase's built-in limits; they stop a stranger
   being flooded with codes.
3. **Vercel Bot Protection / Firewall** — enable the managed rules for the four
   web apps. The till and admin apps are already `noindex`.
4. **Cloudflare (optional)** — if the domain moves behind Cloudflare, turn on
   Bot Fight Mode and a rate-limit rule for `/auth/v1/*` and `/v1/*`.

If a Turnstile widget is added to our own forms later, the site key is public
and the secret stays in Supabase. The app must send the token as
`options.captchaToken`; no secret belongs in the bundle.
