-- ===========================================================================
--  CT-REM-FN-11 (prerrequisito de release) · trg_novedades_limpiar_foto
--  autenticado con x-webhook-secret y sin URL de proyecto en duro.
--
--  Sin aplicar: la aplica el dueño (demo primero). Este repo es el canónico
--  de las migraciones; sustituye a la definición de
--  web-casatomas/supabase/migrations/20261022070000_limpiar_fotos_novedades.sql,
--  que apuntaba al proyecto viejo (que ya no se usa) y no mandaba secreto.
--
--  La edge function limpiar-fotos-novedades nueva (rama rem/t2-backend de
--  web-casatomas) exige `x-webhook-secret` == LIMPIAR_FOTOS_WEBHOOK_SECRET y
--  falla en cerrado. Este trigger lee de Vault:
--    · 'project_url'                    -> p. ej. https://<ref>.supabase.co
--    · 'limpiar_fotos_novedades_secret' -> el MISMO valor que el secret
--                                          LIMPIAR_FOTOS_WEBHOOK_SECRET de la función.
--  Si falta cualquiera de los dos (o Vault/pg_net no responden), el trigger
--  NO llama a nadie, deja la ruta en la cola, avisa con WARNING y la
--  operación sobre la novedad sigue adelante. La ruta saldrá con el
--  siguiente aviso que sí pueda enviarse.
--
--  PASOS DE RELEASE (en este orden, en demo y luego en producción):
--   1. select vault.create_secret('<valor-aleatorio-largo>', 'limpiar_fotos_novedades_secret');
--      select vault.create_secret('https://<ref-del-proyecto>.supabase.co', 'project_url');
--      (si 'project_url' ya existe, no se crea de nuevo)
--   2. npx supabase secrets set LIMPIAR_FOTOS_WEBHOOK_SECRET=<el-mismo-valor> --project-ref <ref>
--   3. Aplicar esta migración.
--   4. Desplegar limpiar-fotos-novedades (web-casatomas) con la comprobación del secreto.
--
--  Idempotente (create if not exists / create or replace).
-- ===========================================================================

begin;

create table if not exists public.novedades_fotos_por_borrar (
  ruta text primary key,
  creado_en timestamptz not null default now()
);

comment on table public.novedades_fotos_por_borrar is
  'Fotos del bucket novedades pendientes de borrar. Solo la escribe trg_novedades_limpiar_foto y solo la procesa la edge function limpiar-fotos-novedades.';

alter table public.novedades_fotos_por_borrar enable row level security;
revoke all on public.novedades_fotos_por_borrar from anon, authenticated;

create or replace function public.novedades_limpiar_foto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruta    text;
  v_base    text;
  v_secreto text;
begin
  if tg_op = 'UPDATE' and new.imagen_url is not distinct from old.imagen_url then
    return null;
  end if;

  -- Solo fotos del bucket `novedades`: una foto de la carta (bucket `platos`)
  -- reutilizada en una novedad no se toca nunca.
  v_ruta := substring(old.imagen_url from '/storage/v1/object/public/novedades/([^?#]+)');
  if v_ruta is null then
    return null;
  end if;

  insert into public.novedades_fotos_por_borrar (ruta) values (v_ruta)
  on conflict (ruta) do nothing;

  -- Un fallo al avisar nunca debe impedir borrar o editar la novedad.
  begin
    select max(decrypted_secret) filter (where name = 'project_url'),
           max(decrypted_secret) filter (where name = 'limpiar_fotos_novedades_secret')
      into v_base, v_secreto
    from vault.decrypted_secrets
    where name in ('project_url', 'limpiar_fotos_novedades_secret');

    if coalesce(btrim(v_base), '') = '' or coalesce(v_secreto, '') = '' then
      raise warning 'novedades_limpiar_foto: falta el secreto de Vault project_url o limpiar_fotos_novedades_secret; la ruta % queda en cola sin avisar', v_ruta;
      return null;
    end if;

    perform net.http_post(
      url := rtrim(btrim(v_base), '/') || '/functions/v1/limpiar-fotos-novedades',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secreto),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000);
  exception when others then
    raise warning 'novedades_limpiar_foto: no se pudo avisar a limpiar-fotos-novedades: %', sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.novedades_limpiar_foto() from public, anon, authenticated;

drop trigger if exists trg_novedades_limpiar_foto on public.novedades;
create trigger trg_novedades_limpiar_foto
  after delete or update of imagen_url on public.novedades
  for each row execute function public.novedades_limpiar_foto();

commit;
