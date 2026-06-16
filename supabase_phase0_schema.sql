-- =====================================================================
-- Phase 0 — Foundations migration (additive, idempotent)
-- =====================================================================
-- Run once in the Supabase SQL Editor for project ewdloawwudqkdrstqfet.
--
-- This is the single schema migration that unblocks the rest of the backlog:
--   * Phase 2 — the P1 deal-register migration (TODO items 6 & 7): every P1
--     deal becomes a row in public.opportunities, so the financial/calc fields
--     and per-deal overrides live here.
--   * Deal Tracking dashboard — milestone-based probability weighting and a
--     "stalled deal" signal (last_activity).
--   * Document attachments (TODO) — documents.opportunity_id.
--
-- It is ENTIRELY ADDITIVE: only new nullable columns, a sequence, indexes and
-- a FK. Nothing is dropped or rewritten, so it is safe to run on live data and
-- safe to re-run (every statement is guarded with IF NOT EXISTS). The
-- destructive part of item 6 (stripping the inline `deals` array from
-- p1_versions.data and backfilling) is deliberately NOT here — that is Phase 2.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. opportunities — financial / calc fields (TODO item 6)
--    These move the P1 model's per-deal economics onto the opportunity row.
--    All nullable; NULL on an override column means "inherit the global
--    assumption" (the existing sidebar value in the P1 model).
-- ---------------------------------------------------------------------
alter table public.opportunities
  add column if not exists notional_usd_m        numeric,   -- deal notional, USD millions (calc layer)
  add column if not exists gross_fee_bps_override numeric,  -- per-deal gross fee, bps. NULL = inherit global
  add column if not exists osh_override          numeric,   -- RC origination share %. NULL = inherit global
  add column if not exists psh_override          numeric,   -- RC placement share %.   NULL = inherit global
  add column if not exists consultant_split_pct  numeric,   -- consultant share of RC fee, %
  add column if not exists placed_pct            numeric,   -- % of notional placed by RC
  add column if not exists close_month           text,      -- expected close, 'YYYY-MM'
  add column if not exists origin_by             text,      -- who originated: 'RC' | 'Iroko'
  add column if not exists active_in_p1          boolean not null default false; -- in the live P1 deal register

-- ---------------------------------------------------------------------
-- 2. opportunities — pipeline tracking fields
--    execution_milestone drives the probability weighting used by the Deal
--    Tracking dashboard and the P1 register milestone picker (TODO item 3).
--    last_activity is the "real movement" timestamp for the stalled-deal flag
--    (distinct from updated_at, which bumps on any cosmetic edit).
-- ---------------------------------------------------------------------
alter table public.opportunities
  add column if not exists execution_milestone text,    -- 'engaged'|'eoi'|'assessing'|'approved'|'custom'
  add column if not exists execution_prob      numeric, -- explicit probability 0-100 (used when milestone='custom')
  add column if not exists last_activity        timestamptz default now();

-- Constrain execution_milestone to the known set (NULL allowed = not yet set).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_execution_milestone_chk'
  ) then
    alter table public.opportunities
      add constraint opportunities_execution_milestone_chk
      check (execution_milestone is null or execution_milestone in
             ('engaged','eoi','assessing','approved','custom'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. opportunities — deal identifier codes (RC-NNN) (TODO item 6 / Tier 1)
--    A shared sequence + a unique code column. The app assigns
--    'RC-' || lpad(nextval, 3, '0') when it creates a pillar-1 deal.
-- ---------------------------------------------------------------------
create sequence if not exists public.opportunity_code_seq;

alter table public.opportunities
  add column if not exists code text;

create unique index if not exists opportunities_code_uniq
  on public.opportunities (code)
  where code is not null;

-- Helper the app (or a backfill) can call to mint the next code.
create or replace function public.next_opportunity_code()
  returns text language sql as $$
  select 'RC-' || lpad(nextval('public.opportunity_code_seq')::text, 3, '0');
$$;

-- ---------------------------------------------------------------------
-- 4. helpful indexes for the deal-register / dashboard views
-- ---------------------------------------------------------------------
create index if not exists opportunities_pillar_active_idx
  on public.opportunities (pillar, active_in_p1);

create index if not exists opportunities_stage_idx
  on public.opportunities (stage);

-- ---------------------------------------------------------------------
-- 5. documents — attach a document to an opportunity (TODO: attachments)
--    One doc -> one opportunity (the simple FK; richer many-to-many can come
--    later if a master NDA needs to span deals). ON DELETE SET NULL so
--    deleting a deal never deletes its paperwork.
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists opportunity_id uuid
    references public.opportunities (id) on delete set null;

create index if not exists documents_opportunity_id_idx
  on public.documents (opportunity_id);

-- =====================================================================
-- 6. OPTIONAL backfill — review before running.
--    Marks existing pillar-1 opportunities as active in the P1 register and
--    seeds last_activity. Mints RC codes for any pillar-1 rows missing one,
--    ordered by creation so the numbering is stable. Commented out so the
--    migration itself is purely structural; uncomment to apply.
-- =====================================================================
-- update public.opportunities
--   set active_in_p1 = true
--   where pillar = 1 and active_in_p1 = false;
--
-- update public.opportunities
--   set last_activity = coalesce(updated_at, created_at, now())
--   where last_activity is null;
--
-- with ordered as (
--   select id from public.opportunities
--   where pillar = 1 and code is null
--   order by created_at, id
-- )
-- update public.opportunities o
--   set code = public.next_opportunity_code()
--   from ordered
--   where o.id = ordered.id;

-- ---------------------------------------------------------------------
-- Done. RLS policies on public.opportunities and public.documents are
-- unchanged — new columns inherit the existing table-level policies.
-- ---------------------------------------------------------------------
