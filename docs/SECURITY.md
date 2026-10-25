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
