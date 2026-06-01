# Resgro Operating App — Open issues

Issues logged for resolution on the next deploy. Add new items at the top.
When done, delete the item (git history preserves it).

---

## P1 deal register — opportunity link, click-to-edit, gross-fee override column

Filed: 2026-05-27. Items 1-4 SHIPPED 2026-05-27 (Tier 1). Remaining below.

> DONE (Tier 1, commit on 2026-05-27): bulk on/off buttons; 100% vs
> prob-weighted revenue (KPI sub-lines + footer @100% row); milestone-driven
> probability picker (Engaged 10 / EOI 20 / Assessing 60 / Approved 100 +
> Custom escape hatch); deal identifier codes (RC-NNN). These all live in
> the inline `deals` array and persist via the existing p1_versions sync.
> When item 6 (opportunity link) lands, migrate `code`/`milestone`/overrides
> from the JSONB onto the opportunity row.

5. **Click deal name to open a detail editor.** The deal-name cell becomes
   a clickable link (not a text input). Clicking opens the existing
   Opportunity edit modal from the outer app — passes the opportunity_id
   from iframe to parent via postMessage, parent opens its modal. After
   save, parent posts back the updated row, iframe re-fetches and
   re-renders that row. This relies on item 6.

6. **Link every deal to an opportunity row.** This is the architectural
   move. Today the P1 deal register has its own `deals` array stored
   inline in `p1_versions.data`; the outer app has a rich `opportunities`
   table with all the deal-management fields (client, deal_type, source,
   blockers, notes, next_action, iroko_relevant, fais_required, etc.).
   Reshape so:

   - Every P1 deal IS an opportunity (one row in `public.opportunities`),
     filtered to `pillar = 1` for the deal-register view.
   - Add the financial/calc fields to `opportunities`: `notional_usd_m`,
     `gross_fee_bps_override`, `osh_override`, `psh_override`,
     `consultant_split_pct`, `placed_pct`, `close_month`, `origin_by`
     (RC/Iroko), `active_in_p1`, `execution_milestone` (item 3 values).
   - The "deal register" becomes a view of `opportunities where pillar=1
     and active_in_p1=true` plus calcs.
   - Drop the inline `deals` array from `p1_versions.data` — that table
     now only holds shared assumptions (FX, gross fee, splits, costs,
     drawing tranches). Versions become "what-if assumption sets," not
     "what-if deal lists."
   - Pillar tag: opportunities with `pillar = 1` (Iroko / asset
     origination) are the universe of candidate deals. Other pillars
     (corporate finance, risk management, etc.) won't appear in the
     deal register but their opportunities still appear in the main
     pipeline view.

   **Migration:** read the current seed deals out of the model code, map
   each onto an existing opportunity row by name match where possible
   (most of them — Ecobank, Oragroup, BGFI CI, etc. — already exist in
   the OPP_SEEDS), and merge the financial fields onto those rows. Add
   the rest as new pillar-1 opportunities. Then strip the seed `deals`
   array from the iframe; the model becomes purely a calc layer over
   the opportunities table.

7. **Show effective gross-fee rate per deal + visual override state +
   reset button.** Add a "Gross Fee bps" column to the deal register
   showing the rate that's actually being applied to that deal.
   - Default value comes from the global assumption (sidebar `a-gfee`).
   - When a deal overrides it, render the cell in the gold-highlighted
     "overridden" style (bold + `color:var(--gold-l)` + subtle gold
     background — same pattern the model already uses for `val-gold`).
     When inheriting the global, render in muted/faint style.
   - Each row gets a small **⟲** reset button next to the rate that
     clears the per-deal override and snaps the cell back to the global.

   Apply the same treatment to **RC Origination Share %** (`osh`) and
   **RC Placement Share %** (`psh`) — these already support overrides
   via the placeholder pattern, but lack the visual differentiation and
   a one-click reset. Hide all three override columns on mobile (already
   the rule for `osh`/`psh`; extend to `gfee_override`).

   Storage: per-deal nullable columns `gross_fee_bps_override`,
   `osh_override`, `psh_override` on the opportunities row (already
   listed in item 6). Null = inherit global.

**Files affected:**
- `index.html` srcdoc — replace `deals` array with a Supabase query
  against `opportunities`; replace `prob` input with milestone picker;
  add bulk-toggle buttons; add 100% revenue rows; add postMessage hook
  for opening the opportunity modal; add gfee column with override
  formatting + reset buttons
- `index.html` outer — receive postMessage from iframe and open the
  opportunity modal; broadcast updates back to iframe on save
- Supabase schema migration — add financial fields to `opportunities`;
  add deal-code sequence; backfill from current model state
- `p1_versions` — `data` JSONB shrinks to just assumptions

---

## Document attachments on opportunities

Filed: 2026-05-27

The outer app already has a `documents` table and a documents view; today
documents are project-wide, not tied to specific opportunities. Add a
many-to-one (or many-to-many if a doc can belong to several deals) link
so each opportunity can carry its own deal documents — teaser, IM, term
sheet, KYC pack, board approval, etc.

**Schema:**
- Easiest: add a nullable `opportunity_id` column to `public.documents`
  (FK to `opportunities.id`, `on delete set null`). One doc → one
  opportunity. Sufficient for most cases.
- Richer: a join table `public.opportunity_documents (opportunity_id,
  document_id, relationship)` if a doc can belong to multiple deals
  (e.g. a master NDA). Probably premature — start with the simple FK.

**UI:**
- The Opportunity edit modal (item 5 of the P1 block above opens this
  from the deal register) gets a **Documents** section listing attached
  docs with name, type, uploaded-by, date. Two actions: **+ Attach
  existing** (picker from the global doc list) and **+ Upload new**
  (existing upload flow, but prefills `opportunity_id` to this deal).
- The deal register row gets a small 📎 badge with a count if any docs
  are attached. Clicking the badge opens the opportunity modal scrolled
  to the Documents section.
- The global Documents view gets a new filter dropdown: "All / Deal:
  Ecobank Nigeria / Deal: BGFI CI / ..." so the user can see what's
  attached to any given opportunity.

**Files affected:**
- Supabase schema migration — `alter table documents add column
  opportunity_id uuid references opportunities(id) on delete set null;`
- `index.html` outer — Opportunity modal gets a Documents section;
  Documents view gets the opportunity filter; deal register row gets the
  📎 badge (via the iframe→parent bridge — iframe queries doc counts per
  opportunity_id from Supabase directly).
- `index.html` srcdoc — render the 📎 badge in the name cell.

---

## Theming overhaul — unify P1 model with main app + add theme control

Filed: 2026-05-27

**Three sub-items, do them together since they share the same CSS work:**

1. **Rebrand the P1 model page** so it visually matches the main app — same
   font choices, button styles, header treatment, surface colors, and spacing.
   The model currently has its own self-contained palette and typography
   inside the iframe `srcdoc`; the main app has a different look. Pick one
   visual language and apply it to both.

2. **Add a theme toggle to the main app** that the user controls. Light /
   dark (and optionally a "system" follow). The toggle must propagate into
   the P1 model iframe so the two stay in sync — the iframe should read the
   parent's theme via `window.parent.__resgro` (or a new `getTheme()` helper)
   on init AND on theme-change events. Use CSS variables on `:root` so
   switching is a single class flip, not a stylesheet swap.

3. **Make the P1 model's current colour palette the dark-mode theme for the
   whole app.** The P1 model values to lift:
   ```
   --bg:#09090F    --surf:#111120    --surf2:#181828    --surf3:#1F1F38
   --border:#262640    --border2:#303058
   --gold:#C8952A    --gold-l:#E8B850    --gold-d:#9A6E1A
   --text:#EDE8E0    --muted:#8A8799    --faint:#4A4862
   --green:#3DB87A    --red:#E05050    --blue:#6A9EEE    --purple:#A090E8
   ```
   These should become the canonical dark-mode tokens in the outer app's
   `:root[data-theme="dark"]` block.

**Implementation sketch:**

- Define CSS variables on `:root` (light) and `:root[data-theme="dark"]`
  (dark) in the main app. Refactor existing hardcoded colors to reference
  the variables.
- Add a toggle button somewhere in the main app's header — sets
  `document.documentElement.dataset.theme` and persists to `localStorage`.
- Expose theme on the parent: extend `window.__resgro` with
  `getTheme: () => document.documentElement.dataset.theme || 'dark'` and
  fire a `CustomEvent('resgro-theme', { detail: theme })` on change.
- In the P1 model iframe: on init read the parent theme, apply via
  `document.documentElement.dataset.theme`; listen for the custom event
  via `window.parent.addEventListener('resgro-theme', ...)` and re-apply.
- The model's existing palette stays the dark theme; build a parallel
  light palette from scratch (or ship dark-only as v1 and add light later).

**Files affected:**
- `index.html` — outer app CSS (currently has its own color system)
- `index.html` srcdoc — P1 model CSS (already uses CSS variables — easy)
- New: `window.__resgro` extension for theme bridge
