set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261107010000_instagram_limpieza_bucket — Borrar los JPEG que no se
-- publican SIN romper las programaciones (fase 0, 07/11/2026)
-- ===========================================================================
-- PROBLEMA
--   Los JPEG de las piezas que nunca se publican se quedan en el bucket
--   «instagram» para siempre (docs/instagram.md, «Propuesta (sin hacer)»).
--   La propuesta original (borrarlos a las 24 h) ROMPERÍA las programaciones:
--   se puede programar hasta 75 días vista y el programador publica justo el
--   JPEG del bucket.
--
-- QUÉ CREA
--   1. instagram_piezas.imagen_borrada_at: cuándo se borró el JPEG por no
--      publicarse. Vuelve a null al regenerar la pieza (el render la deja en
--      «generada»). El panel no puede ponerla ni quitarla a mano.
--   2. instagram_programacion_pieza (la usan instagram_programar e
--      instagram_reprogramar) rechaza una pieza con el JPEG borrado: «vuelve a
--      generarla».
--   3. RPC instagram_piezas_reclamar_jpeg_caducados(dias, limite) (solo
--      service_role): marca y devuelve (id, imagen_ruta) de las piezas con
--      JPEG que llevan `dias` sin cambios y
--        - NO están publicadas (ni tienen media_id),
--        - NO tienen una programación activa (programada o publicando),
--        - NO se están publicando ahora (cerrojo de 20261107000000).
--      FOR UPDATE SKIP LOCKED: si alguien la está programando en ese momento,
--      se salta (y programar, que bloquea la pieza, ve la marca y se niega).
--      La Edge Function instagram-programador (acción «limpiar») borra después
--      esos ficheros por la API de Storage y las copias tmp/ de más de 24 h.
--   4. pg_cron «instagram-limpieza-bucket» a diario a las 03:30 UTC:
--      net.http_post a <project_url>/functions/v1/instagram-programador con
--      { "accion": "limpiar" } y el MISMO secreto que el programador (Vault
--      'instagram_programador_secret'). Mudo mientras falte en Vault.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261107000000_instagram_
-- publicacion_servidor y de desplegar instagram-programador (si no, la
-- llamada diaria con «limpiar» haría una pasada normal, sin limpiar): demo
-- primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo tras
-- aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261107010000_instagram_limpieza_bucket.sql
-- Idempotente. Tiene que terminar en «instagram_limpieza_bucket: aplicada | …».
-- Deshacer: supabase/rollbacks/20261107010000_instagram_limpieza_bucket_ROLLBACK.sql
-- Pruebas: npm run test:instagram-servidor:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_programaciones') is null then
    v_faltan := v_faltan || 'public.instagram_programaciones (aplica antes 20261106110000_instagram_programacion.sql)'::text;
  end if;
  if to_regclass('public.instagram_publicaciones_en_curso') is null then
    v_faltan := v_faltan || 'public.instagram_publicaciones_en_curso (aplica antes 20261107000000_instagram_publicacion_servidor.sql)'::text;
  end if;
  if to_regclass('cron.job') is null then
    v_faltan := v_faltan || 'pg_cron (cron.job)'::text;
  end if;
  if to_regnamespace('net') is null then
    v_faltan := v_faltan || 'pg_net (esquema net)'::text;
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    v_faltan := v_faltan || 'Vault (vault.decrypted_secrets)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_limpieza_bucket: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. imagen_borrada_at ───────────────────────────────────────────────────
alter table public.instagram_piezas add column if not exists imagen_borrada_at timestamptz;
comment on column public.instagram_piezas.imagen_borrada_at is
  'Cuándo se borró el JPEG del bucket por no publicarse (limpieza diaria). null = el JPEG está. Vuelve a null al regenerar.';

-- El panel no la falsea: al regenerar (el render deja la pieza «generada»)
-- vuelve a null; cualquier otro cambio desde el panel la conserva.
create or replace function public.instagram_piezas_imagen_borrada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.imagen_borrada_at := null;
    elsif new.estado = 'generada' then
      new.imagen_borrada_at := null;
    else
      new.imagen_borrada_at := old.imagen_borrada_at;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_imagen_borrada() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_imagen_borrada() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_imagen_borrada on public.instagram_piezas;
create trigger instagram_piezas_imagen_borrada
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_imagen_borrada();

-- ─── 2. No se programa una pieza sin JPEG ───────────────────────────────────
-- Igual que en 20261106110000, más la comprobación de imagen_borrada_at.
create or replace function public.instagram_programacion_pieza(p_pieza_id uuid)
returns public.instagram_piezas
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.instagram_piezas;
begin
  select * into v from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    raise exception 'No existe esa pieza' using errcode = 'P0002';
  end if;
  if v.media_id is not null or v.estado = 'publicada' then
    raise exception 'Esa pieza ya está publicada' using errcode = '22023';
  end if;
  if v.imagen_ruta is null then
    raise exception 'La pieza no tiene imagen: genérala antes de programarla' using errcode = '22023';
  end if;
  if v.imagen_borrada_at is not null then
    raise exception 'La imagen de esta pieza se borró por llevar días sin publicarse: vuelve a generarla antes de programarla' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.instagram_programacion_pieza(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programacion_pieza(uuid) from anon, authenticated';
  end if;
end;
$$;

-- ─── 3. RPC de la limpieza (solo service_role) ──────────────────────────────
create or replace function public.instagram_piezas_reclamar_jpeg_caducados(p_dias integer default 7, p_limite integer default 100)
returns table (id uuid, imagen_ruta text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatas as (
    select pz.id
      from public.instagram_piezas pz
     where pz.imagen_ruta is not null
       and pz.imagen_borrada_at is null
       and pz.estado <> 'publicada'
       and pz.media_id is null
       and pz.updated_at < now() - make_interval(days => greatest(1, least(coalesce(p_dias, 7), 365)))
       and not exists (select 1 from public.instagram_programaciones p
                        where p.pieza_id = pz.id and p.estado in ('programada', 'publicando'))
       and not exists (select 1 from public.instagram_publicaciones_en_curso e
                        where e.pieza_id = pz.id and e.bloqueada_hasta > now())
     order by pz.updated_at
     limit greatest(1, least(coalesce(p_limite, 100), 500))
     for update of pz skip locked
  )
  update public.instagram_piezas pz
     set imagen_borrada_at = now()
    from candidatas c
   where pz.id = c.id
  returning pz.id, pz.imagen_ruta;
end;
$$;
revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from anon, authenticated';
    execute 'grant execute on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) to service_role';
  end if;
end;
$$;

-- ─── 4. pg_cron diario (mudo sin los secretos de Vault) ─────────────────────
select cron.unschedule('instagram-limpieza-bucket')
 where exists (select 1 from cron.job where jobname = 'instagram-limpieza-bucket');

select cron.schedule(
  'instagram-limpieza-bucket',
  '30 3 * * *',
  $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{"accion":"limpiar"}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_programador_secret'
    and u.name = 'project_url';
  $cron$
);

-- ─── 5. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from cron.job where jobname = 'instagram-limpieza-bucket') <> 1 then
    v_malos := v_malos || 'el cron instagram-limpieza-bucket no quedó instalado una vez'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('authenticated', 'public.instagram_piezas_reclamar_jpeg_caducados(integer, integer)', 'execute')
       or has_function_privilege('anon', 'public.instagram_piezas_reclamar_jpeg_caducados(integer, integer)', 'execute') then
      v_malos := v_malos || 'la RPC de limpieza es ejecutable fuera de service_role'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_limpieza_bucket: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): «aplicada | cron activo | secretos de Vault».
select 'instagram_limpieza_bucket: aplicada' as resultado,
       (select active from cron.job where jobname = 'instagram-limpieza-bucket') as cron_activo,
       exists (select 1 from vault.decrypted_secrets where name = 'project_url') as vault_project_url,
       exists (select 1 from vault.decrypted_secrets where name = 'instagram_programador_secret') as vault_secreto_programador;
