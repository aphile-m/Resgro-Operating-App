-- Applied 2026-07-14 (mirror of live DB state).
-- Service-role-only accessor for Supabase Vault secrets, used by the
-- send-invoice edge function to read RESEND_API_KEY. The secret itself is
-- stored encrypted via: select vault.create_secret('<key>','RESEND_API_KEY');
create or replace function public.get_vault_secret(secret_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

revoke all on function public.get_vault_secret(text) from public;
revoke all on function public.get_vault_secret(text) from anon;
revoke all on function public.get_vault_secret(text) from authenticated;
grant execute on function public.get_vault_secret(text) to service_role;
