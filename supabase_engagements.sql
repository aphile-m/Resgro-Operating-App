-- Engagement tracking + opportunity delete — 2026-07-17.
-- Applied via the Supabase connector when available (kept here as the record).

-- 1) Per-deal engagement log (JSONB array of {name, org, status, last_contact, follow_up, note}).
alter table public.opportunities
  add column if not exists engagements jsonb not null default '[]'::jsonb;

-- 2) Allow deleting opportunities from the app.
do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='opportunities' and cmd='DELETE') then
    create policy "opps delete" on public.opportunities
      for delete to authenticated using (true);
  end if;
end $$;

-- 3) Seed engagements from the 2026-07-17 Outlook scan (only where still empty).
update public.opportunities set engagements='[
  {"name":"Botsang Ramorwa","org":"PIC","status":"engaged","last_contact":"2026-07-17","follow_up":"2026-07-20","note":"Teaser sent; Teams session Mon 20 Jul; letter of support sought"},
  {"name":"Stanley Sachikonye","org":"Afreximbank","status":"awaiting","last_contact":"2026-07-16","follow_up":"2026-07-23","note":"Intro call held 16 Jul; awaiting feedback"},
  {"name":"Tshandu Ramusetheli","org":"Maia Capital","status":"engaged","last_contact":"2026-07-17","follow_up":"2026-07-24","note":"EOI received; asked to be kept updated on progress"},
  {"name":"Francois Ekam-Dick (AFC intro)","org":"Iroko / AFC","status":"awaiting","last_contact":"2026-07-07","follow_up":"2026-07-21","note":"Teaser passed to AFC contact; chase feedback"},
  {"name":"Reginald Shaver","org":"Catalyst Capital","status":"committed","last_contact":"2026-07-16","follow_up":null,"note":"Mandated financing adviser (letter 15 Jul)"}
]'::jsonb, last_activity=now()
where title ilike '%toro%' and (engagements is null or engagements='[]'::jsonb);

update public.opportunities set engagements='[
  {"name":"Matt","org":"Investec Global Markets","status":"awaiting","last_contact":"2026-06-30","follow_up":"2026-07-20","note":"Interested; needs hands-on structuring support"},
  {"name":"Tiego Nxumalo","org":"JP Morgan SA","status":"awaiting","last_contact":"2026-06-22","follow_up":"2026-07-20","note":"Shown BIIC BSO; confirm available size"},
  {"name":"MCB","org":"MCB","status":"to_contact","last_contact":null,"follow_up":"2026-07-22","note":"Show TCR once corrected docs arrive"},
  {"name":"Quentin Abouanou","org":"Iroko","status":"engaged","last_contact":"2026-06-30","follow_up":"2026-07-20","note":"Corrected TCR docs received; review and revert"}
]'::jsonb, last_activity=now()
where title ilike '%BIIC%' and (engagements is null or engagements='[]'::jsonb);

update public.opportunities set engagements='[
  {"name":"Reagile Moatshe","org":"Investec","status":"awaiting","last_contact":"2026-06-22","follow_up":"2026-07-20","note":"Asked about $30m for EBID; pin down commitment"},
  {"name":"Tiego Nxumalo","org":"JP Morgan SA","status":"awaiting","last_contact":"2026-06-22","follow_up":"2026-07-20","note":"Order book filling; SA DFI anchor in — confirm JPM size"}
]'::jsonb, last_activity=now()
where title ilike '%EBID%' and (engagements is null or engagements='[]'::jsonb);
