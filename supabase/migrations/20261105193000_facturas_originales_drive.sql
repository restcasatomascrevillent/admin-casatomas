set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105193000_facturas_originales_drive — Los originales de facturas, a
-- Google Drive; Supabase Storage solo como almacén TEMPORAL (05/11/2026)
-- ===========================================================================
-- ORDEN DEL DUEÑO
--   «No se puede guardar nada en Supabase Storage, que reventamos el
--   almacenamiento». El bucket facturas-originales queda para:
--     - pendientes/{uid}/{trabajo}/…  piezas del OCR por trabajos (se borran
--       al terminar o fallar el trabajo);
--     - temporal/{factura}-{nombre}   original de una factura cuando Drive
--       falla al guardarla («pendiente de Drive»).
--   Las rutas antiguas (AAAA/MM/…) se rescatan a Drive y se borran.
--
-- QUÉ CREA
--   1. facturas.drive_intentos / drive_error / drive_intento_at: fallos
--      seguidos subiendo el original a Drive. «Pendiente de Drive» =
--      archivo_path con drive_url null.
--   2. facturas_original_drive_fallo(factura, error): suma un fallo; al llegar
--      a 5 deja un aviso (prioridad alta) en la campana del panel
--      (notificaciones_dashboard, tipo «original_sin_drive»). Solo service_role.
--   3. facturas_originales_por_pasar(limite): lo que la Edge Function
--      facturas-originales-drive tiene que hacer (facturas con archivo_path,
--      ficheros huérfanos fuera de pendientes/ y ficheros de pendientes/ de
--      trabajos terminados). Solo service_role.
--   4. facturas_originales_drive_disparar(): si hay algo que hacer, llama a la
--      función por pg_net con el secreto de Vault «ocr_trabajos_secret» (el de
--      ocr-trabajo) y la URL de Vault «project_url». Mudo sin ellos.
--   5. pg_cron «facturas-originales-drive» cada 10 minutos.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de desplegar la Edge Function
-- facturas-originales-drive (y procesar-factura, ocr-trabajo e
-- importar-factura-historica): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí»
-- del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261105193000_facturas_originales_drive.sql
-- Idempotente. Tiene que terminar en «facturas_originales_drive: aplicada | …».
-- Deshacer: supabase/rollbacks/20261105193000_facturas_originales_drive_ROLLBACK.sql
-- Pruebas: npx supabase db query --linked -f supabase/tests/facturas_originales_drive_test.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.facturas') is null then v_faltan := v_faltan || 'public.facturas'::text; end if;
  if to_regclass('public.ocr_trabajos') is null then v_faltan := v_faltan || 'public.ocr_trabajos'::text; end if;
  if to_regclass('public.notificaciones_dashboard') is null then v_faltan := v_faltan || 'public.notificaciones_dashboard'::text; end if;
  if to_regclass('storage.objects') is null then v_faltan := v_faltan || 'storage.objects'::text; end if;
  if to_regclass('cron.job') is null then v_faltan := v_faltan || 'pg_cron (cron.job)'::text; end if;
  if to_regclass('vault.decrypted_secrets') is null then v_faltan := v_faltan || 'Vault (vault.decrypted_secrets)'::text; end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then v_faltan := v_faltan || 'pg_net (esquema net)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'MIGRACIÓN ABORTADA: falta %', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
alter table public.facturas
  add column if not exists drive_intentos smallint not null default 0,
  add column if not exists drive_error text,
  add column if not exists drive_intento_at timestamptz;

comment on column public.facturas.drive_intentos is
  'Fallos seguidos subiendo el original a Google Drive (0 = ninguno). Pendiente de Drive = archivo_path sin drive_url.';
comment on column public.facturas.drive_error is 'Último error subiendo el original a Drive.';
comment on column public.facturas.drive_intento_at is 'Cuándo falló por última vez la subida del original a Drive.';
comment on column public.facturas.archivo_path is
  'Copia TEMPORAL del original en Storage (facturas-originales) mientras no esté en Drive. Con drive_url, sobra y se borra.';

create index if not exists facturas_archivo_path_pendiente_idx
  on public.facturas (id) where archivo_path is not null;

-- ─── 2. Fallo subiendo a Drive (+ aviso a los 5) ───────────────────────────
create or replace function public.facturas_original_drive_fallo(p_factura_id bigint, p_error text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_num text;
  v_prov text;
begin
  update public.facturas
     set drive_intentos = least(coalesce(drive_intentos, 0) + 1, 32000),
         drive_error = left(coalesce(p_error, 'error desconocido'), 1000),
         drive_intento_at = now()
   where id = p_factura_id
  returning drive_intentos, numero_documento, proveedor into v_n, v_num, v_prov;
  if v_n is null then
    return null;
  end if;
  if v_n = 5 then
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
    values ('original_sin_drive',
            'Original sin subir a Google Drive',
            left(format('El original de la factura %s (%s) no se ha podido subir a Drive tras %s intentos. '
                        || 'Está guardado temporalmente y se seguirá reintentando. Último error: %s',
                        coalesce(v_num, '#' || p_factura_id), coalesce(v_prov, 'sin proveedor'), v_n,
                        coalesce(p_error, 'desconocido')), 900),
            'facturas_original', 'alta');
  end if;
  return v_n;
end;
$$;

-- ─── 3. Qué hay que pasar a Drive / borrar ─────────────────────────────────
-- Reintentos: los 5 primeros en cada pasada del cron (10 min); después, cada 6 h.
create or replace function public.facturas_originales_por_pasar(p_limite integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lim as (select greatest(1, least(coalesce(p_limite, 20), 500)) as n),
  facturas_p as (
    select f.id, f.archivo_path, f.drive_url, f.fecha, coalesce(p.nombre, f.proveedor) as proveedor,
           f.drive_intentos,
           exists (select 1 from storage.objects o
                    where o.bucket_id = 'facturas-originales' and o.name = f.archivo_path) as existe
      from public.facturas f
      left join public.proveedores p on p.id = f.proveedor_id
     where f.archivo_path is not null
       and (f.drive_url is not null or f.drive_intentos < 5 or f.drive_intento_at is null
            or f.drive_intento_at < now() - interval '6 hours')
     order by (f.drive_url is null), f.id
     limit (select n from lim)
  ),
  huerfanos as (
    select o.name, (o.metadata->>'size')::bigint as bytes, f.id as factura_id, f.fecha,
           coalesce(p.nombre, f.proveedor) as proveedor
      from storage.objects o
      left join public.facturas f
        on f.id = nullif(substring(regexp_replace(o.name, '^.*/', '') from '^(\d{1,18})-'), '')::bigint
      left join public.proveedores p on p.id = f.proveedor_id
     where o.bucket_id = 'facturas-originales'
       and o.name not like 'pendientes/%'
       and o.created_at < now() - interval '1 hour'
       and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
       and not exists (select 1 from public.ocr_trabajos t where t.original_path = o.name)
     order by o.name
     limit (select n from lim)
  ),
  pendientes as (
    select o.name
      from storage.objects o
      left join public.ocr_trabajos t on t.id::text = split_part(o.name, '/', 3)
     where o.bucket_id = 'facturas-originales'
       and o.name like 'pendientes/%'
       and o.created_at < now() - interval '1 hour'
       and (t.id is null or t.estado in ('completado', 'fallido', 'cancelado'))
       and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
     order by o.name
     limit (select n * 10 from lim)
  )
  select jsonb_build_object(
    'facturas', coalesce((select jsonb_agg(to_jsonb(x)) from facturas_p x), '[]'::jsonb),
    'huerfanos', coalesce((select jsonb_agg(to_jsonb(x)) from huerfanos x), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(x.name) from pendientes x), '[]'::jsonb)
  );
$$;

-- ¿Hay algo que hacer? (barato: el cron no llama a la función en balde)
create or replace function public.facturas_originales_hay_trabajo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.facturas f
                  where f.archivo_path is not null
                    and (f.drive_url is not null or f.drive_intentos < 5 or f.drive_intento_at is null
                         or f.drive_intento_at < now() - interval '6 hours'))
      or exists (select 1 from storage.objects o
                  left join public.ocr_trabajos t on t.id::text = split_part(o.name, '/', 3)
                  where o.bucket_id = 'facturas-originales'
                    and o.created_at < now() - interval '1 hour'
                    and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
                    and ((o.name like 'pendientes/%' and (t.id is null or t.estado in ('completado', 'fallido', 'cancelado')))
                      or (o.name not like 'pendientes/%'
                          and not exists (select 1 from public.ocr_trabajos t2 where t2.original_path = o.name))));
$$;

-- ─── 4. Disparador del cron (mudo sin los secretos de Vault) ────────────────
create or replace function public.facturas_originales_drive_disparar()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secreto text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'ocr_trabajos_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return false;
  end if;
  if not public.facturas_originales_hay_trabajo() then
    return false;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/facturas-originales-drive',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := '{"accion":"pasar"}'::jsonb,
    timeout_milliseconds := 150000);
  return true;
end;
$$;

revoke all on function public.facturas_original_drive_fallo(bigint, text) from public, anon, authenticated;
revoke all on function public.facturas_originales_por_pasar(integer) from public, anon, authenticated;
revoke all on function public.facturas_originales_hay_trabajo() from public, anon, authenticated;
revoke all on function public.facturas_originales_drive_disparar() from public, anon, authenticated;
grant execute on function public.facturas_original_drive_fallo(bigint, text) to service_role;
grant execute on function public.facturas_originales_por_pasar(integer) to service_role;
grant execute on function public.facturas_originales_hay_trabajo() to service_role;
grant execute on function public.facturas_originales_drive_disparar() to service_role;

-- ─── 5. pg_cron cada 10 minutos ─────────────────────────────────────────────
select cron.unschedule('facturas-originales-drive')
 where exists (select 1 from cron.job where jobname = 'facturas-originales-drive');
select cron.schedule('facturas-originales-drive', '*/10 * * * *',
  $cron$ select public.facturas_originales_drive_disparar(); $cron$);

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from cron.job where jobname = 'facturas-originales-drive') <> 1 then
    v_malos := v_malos || 'el cron facturas-originales-drive no quedó instalado una vez'::text;
  end if;
  if has_function_privilege('authenticated', 'public.facturas_originales_por_pasar(integer)', 'execute')
     or has_function_privilege('anon', 'public.facturas_original_drive_fallo(bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_originales_drive_disparar()', 'execute') then
    v_malos := v_malos || 'alguna RPC es ejecutable fuera de service_role'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'facturas_originales_drive: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

-- Verificación (solo lectura).
select 'facturas_originales_drive: aplicada' as resultado,
       (select active from cron.job where jobname = 'facturas-originales-drive') as cron_activo,
       exists (select 1 from vault.decrypted_secrets where name = 'project_url') as vault_project_url,
       exists (select 1 from vault.decrypted_secrets where name = 'ocr_trabajos_secret') as vault_secreto_ocr,
       (select count(*) from public.facturas where archivo_path is not null) as facturas_con_copia_en_storage;
