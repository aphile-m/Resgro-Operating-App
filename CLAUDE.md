# Resgro Operating App — project memory

Single-page operating app for **Resgro Capital (Pty) Ltd** (sole director Aphile
Molefe): deal book / opportunities, engagements, invoices, decisions, investor
targets, an AI invoice assistant, and an installable PWA. One monolithic app file
(HTML + CSS + inline ES-module script, ~4500 lines). Hosted free on **GitHub Pages**
at `https://aphile-m.github.io/Resgro-Operating-App/`. The root `index.html` is a
redirect stub → `m365.html` (the primary app); the app source is `app-supabase.html`.

## Backend: Microsoft 365 (Supabase retired 2026-09-27)

**Live app = `m365.html` on the user's own Microsoft 365 tenant.** The migration is
complete: data imported into SharePoint, and Aphile confirmed it works well.

- **`m365.html`** is the sole live app (root `index.html` redirects to it). Generated
  from `app-supabase.html` by `build-m365.mjs`; data/auth/storage/email all run on the
  M365 tenant via `m365-adapter.js` (a Supabase-compatible client over MSAL +
  SharePoint Lists + drive + Graph `/me/sendMail`). **Full pattern + Azure setup +
  gotchas:
   `M365_APP_PLAYBOOK.md` — read it before touching the M365 build or building any
   new app on M365.**
- **Legacy Supabase (project `ewdloawwudqkdrstqfet`) is RETIRED** — paused, kept only
  as a cold backup; the full data export lives with the user (`resgro-export.json`).
  Do not build against it or restore it unless the user explicitly asks. `send-invoice`
  Edge Function + Resend/Vault are obsolete (M365 uses Graph `/me/sendMail`).
  `app-supabase.html` remains **only** as the human-edited build source for
  `build-m365.mjs`; it is not a live app and its `sb.from(...)` calls target the dead
  DB — they exist so the build can swap them for the M365 adapter.

## M365 quick facts
- Tenant `resgrocapital.com`; Operating-App SPA client ID
  `33cc1f12-5385-4ddb-8832-6122e3beed83`; Graph delegated perms `User.Read`,
  `Sites.ReadWrite.All`, `Sites.Manage.All`, `Mail.Send` (admin-consented).
- **Human-edited source is `app-supabase.html`** (not `index.html`, which is now
  just the redirect stub). After editing it, run `node build-m365.mjs` to
  regenerate `m365.html`.
- MSAL from `cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/…`; never hang the app
  on a top-level `await` — surface bootstrap errors on screen (see playbook §5).

## Working agreement
- Branch `claude/focused-faraday-f5kxqj`; commit + push, then PR → merge to `main`.
  GitHub Pages redeploys `main` automatically.
- Edit the app in `app-supabase.html` (the build source), then ALWAYS run
  `node build-m365.mjs` and commit `m365.html` too — `m365.html` is the live app.
- **New data table?** Add its name to the `TABLES` array in `m365-adapter.js` so the
  SharePoint list auto-provisions. No SQL/migration needed (the adapter is
  schema-agnostic: one list per table, each row a JSON blob). New per-row fields need
  no schema change at all.
- Confidential deal data must never be committed. **The repo is public** — seed data
  in `app-supabase.html` and any export JSON must stay out of git (`.gitignore` covers
  local settings). Making the repo private (GitHub Pro or Cloudflare Pages) is an
  open recommendation.
