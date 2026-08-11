# Microsoft 365 App Playbook — build or migrate any app onto Aphile's M365

This is a **reusable, self-contained recipe** for backing a web app entirely on a
Microsoft 365 Business Basic tenant — no Supabase, Firebase, or paid backend.
It was proven on the Resgro Operating App (this repo). Drop this file into any
new project, or paste it to Claude, and the whole pattern is available.

**Core idea:** a static single-page app (hosted free on GitHub/Cloudflare Pages)
talks directly to Microsoft Graph from the browser. M365 supplies everything a
backend normally does:

| Backend need | M365 service | Graph surface |
|---|---|---|
| Login / identity | Entra ID (Azure AD) | MSAL.js "Sign in with Microsoft" |
| Database | SharePoint **Lists** | `/sites/{id}/lists/{id}/items` |
| File storage | SharePoint **drive** | `/sites/{id}/drive/root:/…:/content` |
| Transactional email | Exchange (your mailbox) | `/me/sendMail` |

Business Basic includes all of this. It **cannot host** a custom web app, so
hosting stays on a static host (GitHub Pages, Cloudflare Pages).

---

## 1. One-time Azure setup (the human does this once, ~10 min)

The app needs an **App Registration** in the tenant. Only a tenant user/admin can
create it — Claude cannot (Azure has no MCP tool here, and device-code sign-in is
blocked by the sandbox permission classifier).

Portal → **portal.azure.com** → search **App registrations** → **New registration**:
- **Name:** anything, e.g. `Resgro Operating App`
- **Account types:** *Accounts in this organizational directory only* (**single tenant**)
- **Redirect URI:** platform **Single-page application (SPA)** → the exact page URL,
  e.g. `https://<user>.github.io/<repo>/m365.html`
  (MSAL matches this exactly — one entry per deployed page/origin.)
- Register → copy the **Application (client) ID**.
- **API permissions** → Add → Microsoft Graph → **Delegated** → add:
  `User.Read`, `Sites.ReadWrite.All`, `Sites.Manage.All`, `Mail.Send`
  → **Grant admin consent** (green ticks on all four).

### Known values for Aphile's tenant (reuse across apps)
- **Tenant:** `resgrocapital.com`  (authority `https://login.microsoftonline.com/resgrocapital.com`)
- **Resgro Operating App client ID:** `33cc1f12-5385-4ddb-8832-6122e3beed83`
  *(register a NEW app per project — client IDs are per-app, not secret; a public
  SPA has no client secret. Redirect URI must match the new app's page URL.)*
- **cc / reply-to for outbound mail:** `aphile@resgrocapital.com`

---

## 2. The adapter — `m365-adapter.js` (generic, copy as-is)

`m365-adapter.js` in this repo is **app-agnostic**. It exposes a
**Supabase-compatible** client so existing Supabase apps port with almost no logic
changes. Copy the file, then:

```html
<script src="https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js"></script>
<script type="module">
import { createM365Client } from './m365-adapter.js';
const sb = await createM365Client({
  clientId: '<APP CLIENT ID>',
  tenant:   'resgrocapital.com',
  cc:       'aphile@resgrocapital.com',   // optional: cc + reply-to on sendMail
  // site:  'contoso.sharepoint.com:/sites/MySite',  // optional; defaults to /sites/root
});
</script>
```

Supported surface (matches how the app already called Supabase):
- `sb.from(t).select().eq().neq().in().match().order().limit().single()` → `{data,error}`
- `sb.from(t).insert(rowOrRows)` (honors a provided `id`, else generates a GUID)
- `sb.from(t).update(patch).eq(...)`, `sb.from(t).delete().eq(...)`, `.upsert()`
- `sb.auth.getSession() / signIn() / signOut()`
- `sb.storage.from(bucket).upload(path,file) / getPublicUrl(path)`
- `sb.functions.invoke('send-invoice', { body:{ to, subject, html, text, pdf_base64, filename } })`
- extras: `sb._ensureAllLists(onStep)` (provision lists up front), `sb._graph(method,path,body)`

### Data model (why it's schema-agnostic)
Each table → a SharePoint list named `resgro_<table>` with **two columns**:
`uid` (indexed text, the row's stable id) + `Data` (multi-line text = the whole row
as JSON). Reads fetch all items once and **filter/sort client-side** — no Graph
`$filter`/indexing headaches, and no per-column mapping to maintain as the schema
evolves. Fine for small data (dozens–hundreds of rows/table). For large tables,
promote hot filter columns and push `$filter` server-side instead.

Lists auto-create on first `from(table)` / `_ensureAllLists()`. Edit the `TABLES`
array at the top of the adapter to change which lists get provisioned.

---

## 3. Build pattern — one source of truth, generated M365 variant

Don't hand-maintain two copies. Keep the app as `index.html` (or your SPA) and
generate the M365 build with a small Node script that swaps **only the data + auth
layer**. See `build-m365.mjs`: it does four string replacements on `index.html` →
`m365.html`:
1. Inject the MSAL `<script src>` before the app module.
2. Swap the Supabase `createClient(url,key)` init for `createM365Client(config)`,
   as `let sb=null; async function ensureClient(){…}` (see gotcha #2).
3. Swap the email/password auth screen for a "Sign in with Microsoft" button
   (+ a one-time data-import link).
4. Swap the sign-in handler (`signInWithPassword` → `sb.auth.signIn()`).

Re-run `node build-m365.mjs` after any `index.html` change so the two stay in
lockstep. Everything else (all UI, render logic, invoices, AI features) is reused
verbatim.

---

## 4. Data migration (Supabase → SharePoint), no repo exposure

Export shape is `{ "<table>": [ {row}, … ], … }`. The importer in the M365 build
reads an **uploaded JSON file**, signs into Microsoft, and inserts each row
(idempotent — skips ids already present). Confidential data goes file → browser →
SharePoint; **never into the (public) repo**.

Two ways to produce the export file:
- **Claude via the Supabase MCP connector** (when it's up): dump all tables to JSON,
  send the file with SendUserFile.
- **Self-serve SQL** (works even when the connector is down; user can reach the
  Supabase dashboard): run in SQL Editor and save the single cell as `export.json`:
  ```sql
  select jsonb_build_object(
    'opportunities', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from opportunities t),
    'invoices',      (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from invoices t)
    -- …one line per table…
  )::text as export;
  ```
- The **anon key cannot bypass RLS** — a browser export with only the anon key
  returns `[]`. Use an authenticated session or the two routes above.

---

## 5. Gotchas learned the hard way (don't repeat these)

1. **MSAL CDN must be a real version.** `alcdn.msauth.net/browser/3.28.1/…` 404s.
   Use `cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js`
   (global is `window.msal`). A missing library = silent crash = endless loader.
2. **Make bootstrap errors visible.** Never gate the app behind a top-level
   `await createM365Client()` — if it throws (bad tenant, no consent, blocked
   popup) the module dies and the loading screen hangs with no message. Create the
   client *inside* the init `try/catch` (via `ensureClient()`) so failures show on
   the sign-in screen and the loader clears.
3. **Redirect URI is per exact URL.** `m365.html` and `index.html` (or a different
   origin) each need their own SPA redirect entry in the registration.
4. **`Sites.Manage.All` is required to create lists** (`Sites.ReadWrite.All` alone
   can read/write items but not create lists). `Mail.Send` for `/me/sendMail`.
5. **Email "just works" and is better than Resend:** `/me/sendMail` sends *as the
   user* from Exchange, lands a copy in **Sent Items**, and `cc`/`replyTo` need no
   domain/DNS verification because it *is* the user sending.
6. **Storage URLs** returned by the adapter are SharePoint `webUrl`s — viewable by
   authenticated tenant users (fine for an internal single-user tool; not public).
7. **Hosting stays static.** Business Basic can't host the app. Keep it on GitHub
   Pages / Cloudflare Pages. If the repo must be private for confidential seed data,
   GitHub Pages needs Pro (~$4/mo) or move to Cloudflare Pages (free, private repos).

---

## 6. Reuse recipe for a brand-new app

1. Register a new SPA app (§1), note its client ID + set the redirect URI to the new
   page URL. Same tenant, same four Graph perms, grant consent.
2. Copy `m365-adapter.js` into the project. Set `TABLES` to your tables.
3. Init `sb = await createM365Client({clientId, tenant:'resgrocapital.com', cc})`.
4. Use `sb.from(...)`, `sb.auth`, `sb.storage`, `sb.functions.invoke('send-invoice',…)`
   exactly like Supabase.
5. Host the static files on GitHub/Cloudflare Pages. Done — one tenant, no backend
   bill, no free-tier pausing.
