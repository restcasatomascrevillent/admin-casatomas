set client_encoding = 'UTF8';
-- ============================================================================
-- Redes: aviso inmediato a rrss al quitar «Redes» (24/11/2026, PR «Redes»)
-- ----------------------------------------------------------------------------
-- Revisión de seguridad A2, capa 2. Cuando a alguien se le quita «Ver» en la
-- sección `redes` (o se borra su fila, o se borra al usuario: la fila cae en
-- cascada), la base de datos llama a la Edge Function `rrss-embed-revoke`, que
-- avisa a rrss con un aviso firmado y rrss le quita el acceso al momento. Sin
-- este aviso, rrss lo corta igual por caducidad (~20 minutos).
--
-- Necesita en Vault `project_url` (ya existe) y `rrss_embed_revoke_secret` (el
-- mismo valor que el secreto RRSS_EMBED_REVOKE_SECRET de la función). Sin ellos,
-- o sin pg_net, no hace nada (no rompe el guardado de permisos).
-- Vuelta atrás: supabase/rollbacks/20261219100100_redes_aviso_revocar_ROLLBACK.sql
-- Tiene que terminar en «redes_aviso_revocar: aplicado».
-- ============================================================================
create or replace function public.rrss_redes_avisar_revocacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secreto text;
begin
  if old.section_key is distinct from 'redes' or not coalesce(old.can_view, false) then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.section_key = 'redes' and new.user_id = old.user_id and coalesce(new.can_view, false) then
    return null;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''rrss_embed_revoke_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return null;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 10000)'
    using rtrim(v_url, '/') || '/functions/v1/rrss-embed-revoke',
          jsonb_build_object('Content-Type', 'application/json', 'x-rrss-revoke-secret', v_secreto),
          jsonb_build_object('user_id', old.user_id);
  return null;
exception when others then
  -- Nunca impide guardar los permisos: si el aviso no sale, rrss lo corta por caducidad.
  raise warning 'rrss_redes_avisar_revocacion: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.rrss_redes_avisar_revocacion() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.rrss_redes_avisar_revocacion() from anon, authenticated';
  end if;
end;
$$;

drop trigger if exists user_permissions_redes_revocar on public.user_permissions;
create trigger user_permissions_redes_revocar
  after update or delete on public.user_permissions
  for each row execute function public.rrss_redes_avisar_revocacion();

do $$ begin raise notice 'redes_aviso_revocar: aplicado'; end $$;
