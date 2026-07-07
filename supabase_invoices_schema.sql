-- =====================================================================
-- Invoices — Supabase schema
-- =====================================================================
-- Run once in the Supabase SQL Editor for project ewdloawwudqkdrstqfet.
-- Backs the Finance → Invoices view. Line items are stored as JSONB on the
-- invoice row ({desc, amount}[]) — simple, atomic, and sufficient at this
-- scale. Additive and idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,           -- INV-YYYY-NNN, assigned by the app
  status       text not null default 'draft'
               check (status in ('draft','sent','paid','void')),
  issue_date   date,
  due_date     date,
  currency     text not null default 'ZAR',
  vat_pct      numeric not null default 0,     -- 0 = not VAT registered
  bill_to      jsonb not null default '{}'::jsonb,  -- {company, contact, reg, email, addr}
  line_items   jsonb not null default '[]'::jsonb,  -- [{desc, amount}]
  bank_details text,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists invoices_status_idx on public.invoices (status);

-- Auto-bump updated_at on every UPDATE (same pattern as p1_versions).
create or replace function public.invoices_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_invoices_touch on public.invoices;
create trigger trg_invoices_touch
  before update on public.invoices
  for each row execute function public.invoices_touch_updated_at();

-- ---------------------------------------------------------------------
-- Row-level security: shared across all authenticated users.
-- ---------------------------------------------------------------------
alter table public.invoices enable row level security;

drop policy if exists "invoices read"   on public.invoices;
drop policy if exists "invoices insert" on public.invoices;
drop policy if exists "invoices update" on public.invoices;
drop policy if exists "invoices delete" on public.invoices;

create policy "invoices read"
  on public.invoices for select
  to authenticated using (true);

create policy "invoices insert"
  on public.invoices for insert
  to authenticated with check (auth.uid() = created_by);

create policy "invoices update"
  on public.invoices for update
  to authenticated using (true) with check (true);

create policy "invoices delete"
  on public.invoices for delete
  to authenticated using (true);

-- ---------------------------------------------------------------------
-- Done. On first load after this runs, the app seeds two draft invoices
-- (Kgabi / Portia — company registration + share of the R100k mandate
-- initiation fee) for review and completion in the Invoices view.
-- ---------------------------------------------------------------------
