-- Deal book update from Outlook activity — prepared 2026-07-17.
-- Applied via the Supabase connector when available (kept here as the record).

-- 1) PROJECT TORO — reclassify as principal investment (Pillar 5, active).
--    Consortium (Moshabele) acquiring 100% of SepFluor Ltd; Resgro 33%; $150m EV.
update public.opportunities set
  pillar = 5,
  stage = 'active',
  deal_type = 'Principal investment — consortium acquisition (33% equity)',
  client_name = 'Moshabele Consortium / SepFluor Limited',
  estimated_size = 150,
  estimated_fee_pct = null,
  description = 'Moshabele Consortium (Resgro 33% as it stands, with UBU Holdings / Caret Invest / Kgabi Masia) acquiring 100% of SepFluor Limited — producing SA fluorspar mine plus fluorochemical processing asset and growth projects; fluorspar is a designated critical mineral (US/EU/China/SA). ~$150m EV. Competitive sale run by Standard Bank for the seller: Phase I EOI + NDA submitted; Phase II (Information Memorandum) awaited; data room after NBO. Catalyst Capital mandated as financing adviser (letter 15 Jul). Financing outreach: PIC (letter of support sought), Afreximbank (call 16 Jul), AFC (via Iroko), Maia Capital (EOI received, supportive).',
  next_action = 'PIC session Mon 20 Jul (Botsang Ramorwa) — secure Letter of Support for Phase-1 EOI; consolidate financing indications (Maia, Afrexim, AFC); await Standard Bank Phase II IM',
  last_activity = now()
where title ilike '%toro%';

-- 2) EBID — order book filling; deal in motion.
update public.opportunities set
  stage = 'active',
  next_action = 'Fill order book: SA DFI anchor in for size; close Investec ($30m indication, Reagile Moatshe) and JP Morgan SA (Tiego Nxumalo); confirm allocations with Iroko',
  last_activity = now()
where title ilike '%EBID%';

-- 3) BIIC BSO — new Iroko-originated deal, in execution, missing from book.
insert into public.opportunities
  (title, description, pillar, stage, likelihood, client_name, client_type,
   deal_type, source, estimated_size, estimated_fee_pct, estimated_months_to_close,
   iroko_relevant, fais_required, next_action, created_by)
select
  'BIIC Benin — BSO / TCR USD 234m',
  'Balance-sheet optimisation for BIIC (largest bank in Benin) via TCR: TRS notional USD 234m, 143% overcollateralisation via EUR 174m BRVM bond portfolio purchased/pledged through Marula, BCEAO legal opinion to be issued. Iroko-originated under the executed Iroko/Resgro fee-sharing agreement (7 Jul). Investor outreach: Investec (Matt — interested, needs hands-on support), JP Morgan SA, MCB, RMB. Iroko targeting close end-July / mid-August.',
  1, 'active', 'medium', 'BIIC (Banque Internationale pour l''Industrie et le Commerce)', 'african_bank',
  'TRS / BSO (TCR)', 'iroko_book', 234, 0.25, 2,
  true, true,
  'Chase investor feedback: Investec (Matt), JP Morgan SA, MCB; review Iroko''s corrected TCR docs (collateral reconciliation, FS figures); track end-Jul/mid-Aug close',
  (select id from public.profiles where email='aphile@resgrocapital.com' limit 1)
where not exists (select 1 from public.opportunities where title ilike '%BIIC%');
