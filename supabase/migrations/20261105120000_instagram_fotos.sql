set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105120000_instagram_fotos — Fotos subidas desde el panel (05/11/2026)
-- ===========================================================================
-- Biblioteca de fotos de Instagram ampliable por los usuarios: además del
-- catálogo estático (src/lib/instagram/fotos.ts → FOTOS), quien tenga la
-- sección marketing sube sus fotos desde Marketing › Instagram › «Subir foto».
-- El navegador la convierte (orientación EXIF aplicada, lado mayor ≤ 2560 px,
-- JPEG sRGB calidad 0,9, ≤ 8 MB) y la sube al bucket «instagram» con su
-- sesión (RLS del bucket: 20261105090000_instagram.sql) en
--   fotos/<marca>/subidas/<id>.jpg
-- y guarda aquí la fila. Ver docs/instagram-fotos.md.
--
-- QUÉ CREA
--   * public.instagram_fotos: id (uuid, lo genera el navegador y es el id de
--     la foto en las piezas), marca, ruta (= fotos/<marca>/subidas/<id>.jpg,
--     CHECK), ancho y alto reales del JPEG, tipo (TIPOS_FOTO de fotos.ts),
--     descripción (≤ 140), subida_por (auth.uid(), no se falsea) y created_at.
--     Solo se pueden editar tipo y descripción (el resto lo fija el trigger).
--     RLS: leer con can_read_section('marketing'); subir, editar y borrar con
--     can_write_section('marketing'); sesión de panel viva
--     (acceso_panel_no_bloqueado); service_role todo; anon nada. SE AUDITA.
--
-- No toca el bucket (ya admite JPEG/PNG/WebP de hasta 8 MB) ni sus políticas.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261105090000_instagram:
-- demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo
-- tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261105120000_instagram_fotos.sql
-- Idempotente. Tiene que terminar en «instagram_fotos: aplicada».
-- Deshacer: supabase/rollbacks/20261105120000_instagram_fotos_ROLLBACK.sql
-- Pruebas: npm run test:instagram:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    v_faltan := v_faltan || 'public.can_write_section(text)'::text;
  end if;
  if to_regclass('storage.buckets') is null
     or not exists (select 1 from storage.buckets where id = 'instagram') then
    v_faltan := v_faltan || 'el bucket instagram (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_fotos: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.instagram_fotos (
  id          uuid primary key default gen_random_uuid(),
  marca       text not null,
  ruta        text not null,
  ancho       integer not null,
  alto        integer not null,
  tipo        text not null,
  descripcion text not null default '',
  subida_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint instagram_fotos_ruta_key        unique (ruta),
  constraint instagram_fotos_marca_chk       check (marca in ('casa-tomas', 'touza')),
  -- La ruta es SIEMPRE la de la foto: nadie puede apuntar a otro fichero del bucket.
  constraint instagram_fotos_ruta_chk        check (ruta = 'fotos/' || marca || '/subidas/' || id::text || '.jpg'),
  -- Lado mayor ≤ 2560 (lo que deja el navegador al convertir).
  constraint instagram_fotos_medidas_chk     check (ancho between 1 and 2560 and alto between 1 and 2560),
  -- Los mismos que TIPOS_FOTO de src/lib/instagram/fotos.ts.
  constraint instagram_fotos_tipo_chk        check (tipo in ('plato', 'sala', 'bebida', 'ambiente', 'barra', 'coctel', 'interior')),
  constraint instagram_fotos_descripcion_chk check (char_length(descripcion) <= 140)
);
comment on table public.instagram_fotos is
  'Fotos de Instagram subidas desde el panel (además del catálogo estático de src/lib/instagram/fotos.ts). '
  'Fichero en el bucket instagram (ruta). id = id de la foto en las piezas. Sección de permisos marketing. Se audita.';
comment on column public.instagram_fotos.ruta is 'Ruta en el bucket instagram: fotos/<marca>/subidas/<id>.jpg (CHECK).';
comment on column public.instagram_fotos.ancho is 'Ancho real del JPEG subido (px).';
comment on column public.instagram_fotos.alto is 'Alto real del JPEG subido (px).';
comment on column public.instagram_fotos.tipo is 'Tipo de foto (TIPOS_FOTO de src/lib/instagram/fotos.ts): decide qué plantillas la admiten.';
comment on column public.instagram_fotos.subida_por is 'Quién la subió: lo pone el servidor (auth.uid()), no el cliente.';

create index if not exists instagram_fotos_marca_created_idx
  on public.instagram_fotos (marca, created_at desc);

-- subida_por y created_at no se falsean; al editar solo cambian tipo y descripción.
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
drop trigger if exists instagram_fotos_al_editar on public.instagram_fotos;
create trigger instagram_fotos_al_editar
  before insert or update on public.instagram_fotos
  for each row execute function public.instagram_fotos_al_editar();

-- Auditoría: el mismo trigger que instala instalar_auditoria_panel().
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.instagram_fotos'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.instagram_fotos';
    execute 'create trigger trg_auditoria after insert or update or delete on public.instagram_fotos
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- ─── 2. RLS: solo el panel con la sección marketing; anon nada ──────────────
alter table public.instagram_fotos enable row level security;
revoke all on public.instagram_fotos from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_fotos from anon, authenticated';
    execute 'grant select, insert, update, delete on public.instagram_fotos to authenticated';
    execute 'grant all on public.instagram_fotos to service_role';
  end if;
end;
$$;

drop policy if exists instagram_fotos_select_seccion on public.instagram_fotos;
create policy instagram_fotos_select_seccion on public.instagram_fotos
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_fotos_insert_seccion on public.instagram_fotos;
create policy instagram_fotos_insert_seccion on public.instagram_fotos
  for insert to authenticated with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_fotos_update_seccion on public.instagram_fotos;
create policy instagram_fotos_update_seccion on public.instagram_fotos
  for update to authenticated
  using ((select public.can_write_section('marketing')))
  with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_fotos_delete_seccion on public.instagram_fotos;
create policy instagram_fotos_delete_seccion on public.instagram_fotos
  for delete to authenticated using ((select public.can_write_section('marketing')));
drop policy if exists instagram_fotos_service_role on public.instagram_fotos;
create policy instagram_fotos_service_role on public.instagram_fotos
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.instagram_fotos';
    execute 'create policy "acceso_panel_no_bloqueado" on public.instagram_fotos as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_fotos'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_fotos'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'instagram_fotos'
        and policyname like 'instagram_fotos_%') <> 5 then
    v_malos := v_malos || 'faltan políticas en instagram_fotos'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.instagram_fotos', 'SELECT')
       or has_table_privilege('anon', 'public.instagram_fotos', 'INSERT')
       or has_table_privilege('anon', 'public.instagram_fotos', 'UPDATE')
       or has_table_privilege('anon', 'public.instagram_fotos', 'DELETE')
       or has_table_privilege('anon', 'public.instagram_fotos', 'TRUNCATE') then
      v_malos := v_malos || 'anon tiene acceso a instagram_fotos'::text;
    end if;
    if has_table_privilege('authenticated', 'public.instagram_fotos', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated tiene TRUNCATE en instagram_fotos'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_fotos: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_fotos: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN:
--   select policyname, cmd, roles, permissive from pg_policies where tablename = 'instagram_fotos' order by 1;
--   select id, marca, ruta, ancho, alto, tipo from public.instagram_fotos order by created_at desc limit 5;
