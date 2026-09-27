-- Accounts (customer register) + statement support. 2026-09-27.
-- The M365 build needs no migration (the SharePoint adapter is schema-agnostic
-- and auto-creates the list); this keeps the legacy Supabase app working.

create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  account_number text not null,
  name           text not null,
  aliases        jsonb not null default '[]'::jsonb,  -- alternate spellings this account is billed as
  contact        text,
  email          text,
  reg            text,
  phone          text,
  addr           text,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists accounts_number_idx on public.accounts (account_number);

-- Link invoices to an account (nullable; legacy invoices match by company name).
alter table public.invoices
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table public.accounts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='accounts') then
    create policy "accounts all" on public.accounts for all to authenticated using (true) with check (true);
  end if;
end $$;
