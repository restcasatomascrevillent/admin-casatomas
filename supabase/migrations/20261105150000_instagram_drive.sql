set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105150000_instagram_drive — El archivo de Instagram vive en Google Drive
-- ===========================================================================
-- Decisión del dueño (05/11/2026): las fotos de la biblioteca y las piezas
-- publicadas se guardan en Google Drive, dentro de la carpeta «marketing»
-- (secreto GOOGLE_DRIVE_MARKETING_FOLDER_ID):
--   marketing/instagram/fotos/casa-tomas   fotos de la biblioteca
--   marketing/instagram/fotos/touza
--   marketing/instagram/publicadas/AAAA-MM JPEG de cada pieza publicada
-- El bucket «instagram» queda solo como escala temporal (Meta y el render
-- necesitan una URL JPEG pública directa): tmp/<uuid>.jpg y piezas/….
-- Ver docs/instagram.md y docs/instagram-fotos.md.
--
-- QUÉ CAMBIA
--   * public.instagram_fotos:
--       - drive_id (id del fichero en Drive, único, solo [A-Za-z0-9_-]).
--       - ruta pasa a ser opcional: las fotos de Drive no tienen fichero en
--         el bucket. Si la hay, sigue siendo fotos/<marca>/subidas/<id>.jpg.
--       - Cada fila tiene ruta o drive_id (o las dos).
--       - drive_id no se puede cambiar al editar (como ruta, marca o medidas).
--   * public.instagram_piezas.drive_id: id en Drive del JPEG publicado
--     (lo rellena la Edge Function instagram-publicar tras publicar).
--   No cambia RLS, permisos, el bucket ni sus políticas.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261105090000_instagram y
-- 20261105120000_instagram_fotos: demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí»
-- del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261105150000_instagram_drive.sql
-- Idempotente. Tiene que terminar en «instagram_drive: aplicada».
-- Deshacer: supabase/rollbacks/20261105150000_instagram_drive_ROLLBACK.sql
-- Pruebas: npm run test:instagram:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regclass('public.instagram_fotos') is null then
    v_faltan := v_faltan || 'public.instagram_fotos (aplica antes 20261105120000_instagram_fotos.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_drive: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. instagram_fotos: id de Drive y ruta opcional ────────────────────────
alter table public.instagram_fotos add column if not exists drive_id text;
alter table public.instagram_fotos alter column ruta drop not null;

alter table public.instagram_fotos drop constraint if exists instagram_fotos_ruta_chk;
alter table public.instagram_fotos add constraint instagram_fotos_ruta_chk
  check (ruta is null or ruta = 'fotos/' || marca || '/subidas/' || id::text || '.jpg');

alter table public.instagram_fotos drop constraint if exists instagram_fotos_drive_id_chk;
alter table public.instagram_fotos add constraint instagram_fotos_drive_id_chk
  check (drive_id is null or drive_id ~ '^[A-Za-z0-9_-]{10,200}$');

alter table public.instagram_fotos drop constraint if exists instagram_fotos_origen_chk;
alter table public.instagram_fotos add constraint instagram_fotos_origen_chk
  check (ruta is not null or drive_id is not null);

alter table public.instagram_fotos drop constraint if exists instagram_fotos_drive_id_key;
alter table public.instagram_fotos add constraint instagram_fotos_drive_id_key unique (drive_id);

comment on column public.instagram_fotos.ruta is
  'Ruta en el bucket instagram (fotos/<marca>/subidas/<id>.jpg, CHECK) de las fotos subidas antes de Drive; null en las de Drive.';
comment on column public.instagram_fotos.drive_id is
  'Id del fichero en Google Drive (marketing/instagram/fotos/<marca>). No se cambia al editar.';

-- Al editar solo cambian tipo y descripción (ahora también se fija drive_id).
create or replace function public.instagram_fotos_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subida_por := coalesce(auth.uid(), new.subida_por);
    new.created_at := now();
  else
    new.id         := old.id;
    new.marca      := old.marca;
    new.ruta       := old.ruta;
    new.drive_id   := old.drive_id;
    new.ancho      := old.ancho;
    new.alto       := old.alto;
    new.subida_por := old.subida_por;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_fotos_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_fotos_al_editar() from anon, authenticated';
  end if;
end;
$$;

-- ─── 2. instagram_piezas: id de Drive del JPEG publicado ────────────────────
alter table public.instagram_piezas add column if not exists drive_id text;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_drive_id_chk;
alter table public.instagram_piezas add constraint instagram_piezas_drive_id_chk
  check (drive_id is null or drive_id ~ '^[A-Za-z0-9_-]{10,200}$');
comment on column public.instagram_piezas.drive_id is
  'Id en Google Drive (marketing/instagram/publicadas/AAAA-MM) del JPEG publicado. Con él, el JPEG ya no está en el bucket.';

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'instagram_fotos' and column_name = 'drive_id') then
    v_malos := v_malos || 'falta instagram_fotos.drive_id'::text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'instagram_piezas' and column_name = 'drive_id') then
    v_malos := v_malos || 'falta instagram_piezas.drive_id'::text;
  end if;
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'instagram_fotos' and column_name = 'ruta') <> 'YES' then
    v_malos := v_malos || 'instagram_fotos.ruta sigue siendo obligatoria'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_fotos'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.instagram_piezas'::regclass) then
    v_malos := v_malos || 'RLS apagada'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_drive: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_drive: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN:
--   select id, marca, ruta, drive_id, tipo from public.instagram_fotos order by created_at desc limit 5;
--   select id, estado, imagen_ruta, drive_id from public.instagram_piezas where estado = 'publicada' order by updated_at desc limit 5;
