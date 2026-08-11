# Resgro Operating App — project memory

Single-page operating app for **Resgro Capital (Pty) Ltd** (sole director Aphile
Molefe): deal book / opportunities, engagements, invoices, decisions, investor
targets, an AI invoice assistant, and an installable PWA. One monolithic
`index.html` (HTML + CSS + inline ES-module script, ~4500 lines). Hosted free on
**GitHub Pages** at `https://aphile-m.github.io/Resgro-Operating-App/`.

## Two backend stacks

1. **Live / production → `index.html` on Supabase.** Postgres + email/password auth
   + an `send-invoice` Edge Function (Resend, key in Supabase Vault; cc/reply-to
   `aphile@resgrocapital.com`). Project id `ewdloawwudqkdrstqfet`. The Supabase MCP
   connector is **flaky** — it drops for minutes at a time; wait and retry, and it
   comes back. Free tier **auto-pauses on inactivity** (restore via the connector if
   the app won't load).
2. **Parallel / target → `m365.html` on Microsoft 365** (Aphile wants to move off
   Supabase onto his Business Basic suite). Generated from `index.html` by
   `build-m365.mjs`; data/auth/storage/email all run on his own M365 tenant via
   `m365-adapter.js` (a Supabase-compatible client over MSAL + SharePoint Lists +
   drive + Graph `/me/sendMail`). **Full pattern + Azure setup + gotchas:
   `M365_APP_PLAYBOOK.md` — read it before touching the M365 build or building any
   new app on M365.**

## M365 quick facts
- Tenant `resgrocapital.com`; Operating-App SPA client ID
  `33cc1f12-5385-4ddb-8832-6122e3beed83`; Graph delegated perms `User.Read`,
  `Sites.ReadWrite.All`, `Sites.Manage.All`, `Mail.Send` (admin-consented).
- After editing `index.html`, regenerate the M365 build: `node build-m365.mjs`.
- MSAL from `cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/…`; never hang the app
  on a top-level `await` — surface bootstrap errors on screen (see playbook §5).

## Working agreement
- Branch `claude/focused-faraday-f5kxqj`; commit + push, then PR → merge to `main`.
  GitHub Pages redeploys `main` automatically.
- After any `index.html` data-layer change, run `node build-m365.mjs` and commit
  `m365.html` too, so the two stacks stay in lockstep.
- Confidential deal data must never be committed. **The repo is public** — seed data
  in `index.html` and any export JSON must stay out of git (`.gitignore` covers
  local settings). Making the repo private (GitHub Pro or Cloudflare Pages) is an
  open recommendation.
- Schema changes to Supabase go through the MCP connector as migrations; mirror the
  SQL into a repo file for the record.
