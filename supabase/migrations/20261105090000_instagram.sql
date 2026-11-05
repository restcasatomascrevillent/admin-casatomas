set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105090000_instagram — Sección Instagram del panel (05/11/2026)
-- ===========================================================================
-- Piezas de Instagram (post 1080×1350 y story 1080×1920) de Casa Tomás y
-- Touza, hechas con las plantillas de src/lib/instagram (portadas del
-- prototipo instagram-studio).
--
-- QUÉ CREA
--   * Bucket PÚBLICO «instagram». Contiene SOLO:
--       fotos/<marca>/*.jpg   fotos de la biblioteca (las sube
--                             scripts/instagram/subir-recursos.mjs)
--       piezas/…              imágenes generadas de las piezas (temporales;
--                             las sube el panel o la función de render)
--     Fuentes y logos NO van aquí: decisión del dueño (04/11/2026), para no
--     llenar el bucket, van en el propio panel (public/instagram/, ~1 MB).
--     8 MB por fichero (el máximo de Instagram para JPEG). Tipos: JPEG, PNG
--     y WebP.
--       - Lectura: URL pública /storage/v1/object/public/instagram/… (no pasa
--         por la RLS). Lectura por API (list, download, upsert, remove) solo
--         autenticados con la sección marketing.
--       - Escritura (insert/update/delete): autenticados con
--         can_write_section('marketing'). service_role (scripts y funciones
--         de Vercel) se salta la RLS.
--   * public.instagram_piezas: cada pieza (datos de la plantilla, pie de
--     foto, estado de publicación y lo que devuelve la API de Instagram).
--       estado: borrador → generada → prueba_ok → publicada (o error).
--       creado_por lo pone el servidor (auth.uid()), no el cliente.
--       updated_at por trigger. Índice (estado, created_at desc).
--     RLS: leer con can_read_section('marketing'); crear, editar y borrar con
--     can_write_section('marketing'); sesión de panel viva
--     (acceso_panel_no_bloqueado); service_role todo. SE AUDITA.
--
-- PERMISO: la sección «marketing» del panel (src/hooks/useUserRole.tsx →
-- SECTIONS; en la UI se llama «Newsletter»). Mismo patrón que el resto
-- (20260918120000: can_read_section / can_write_section →
-- has_section_permission; el super admin siempre dentro).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño:
--   npx supabase db query --linked -f supabase/migrations/20261105090000_instagram.sql
-- Idempotente. Tiene que terminar en «instagram: aplicada». Después, subir las
-- fotos (ver cabecera de scripts/instagram/subir-recursos.mjs).
-- Deshacer: supabase/rollbacks/20261105090000_instagram_ROLLBACK.sql
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
  if to_regclass('storage.buckets') is null then
    v_faltan := v_faltan || 'storage.buckets'::text;
  end if;
  if to_regclass('storage.objects') is null then
    v_faltan := v_faltan || 'storage.objects'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Bucket público «instagram» ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('instagram', 'instagram', true, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- Políticas de storage.objects acotadas al bucket (invariante de
-- 20261001180000: ninguna lectura sin bucket_id). `(select …)` para que se
-- evalúe una vez por consulta. upload({upsert}) = INSERT + UPDATE y necesita
-- SELECT; remove() = DELETE … RETURNING, también necesita SELECT.
drop policy if exists instagram_objetos_select_seccion on storage.objects;
create policy instagram_objetos_select_seccion on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram' and (select public.can_read_section('marketing')) );

drop policy if exists instagram_objetos_insert_seccion on storage.objects;
create policy instagram_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );

drop policy if exists instagram_objetos_update_seccion on storage.objects;
create policy instagram_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) )
  with check ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );

drop policy if exists instagram_objetos_delete_seccion on storage.objects;
create policy instagram_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );

-- ─── 2. Tabla de piezas ─────────────────────────────────────────────────────
create table if not exists public.instagram_piezas (
  id             uuid primary key default gen_random_uuid(),
  marca          text not null,
  plantilla      text not null,
  formato        text not null,
  datos          jsonb not null default '{}'::jsonb,
  caption        text,
  estado         text not null default 'borrador',
  imagen_ruta    text,
  contenedor_id  text,
  media_id       text,
  permalink      text,
  error          text,
  creado_por     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint instagram_piezas_marca_chk     check (marca in ('casa-tomas', 'touza')),
  constraint instagram_piezas_formato_chk   check (formato in ('post', 'story')),
  constraint instagram_piezas_plantilla_chk check (plantilla ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  constraint instagram_piezas_estado_chk    check (estado in ('borrador', 'generada', 'prueba_ok', 'publicada', 'error')),
  constraint instagram_piezas_datos_chk     check (jsonb_typeof(datos) = 'object' and pg_column_size(datos) <= 65536),
  -- 2200 caracteres: el máximo de Instagram para el pie de foto.
  constraint instagram_piezas_caption_chk   check (caption is null or char_length(caption) <= 2200),
  constraint instagram_piezas_textos_chk    check (
    coalesce(char_length(imagen_ruta), 0) <= 500 and coalesce(char_length(contenedor_id), 0) <= 200
    and coalesce(char_length(media_id), 0) <= 200 and coalesce(char_length(permalink), 0) <= 500
    and coalesce(char_length(error), 0) <= 4000)
);
comment on table public.instagram_piezas is
  'Piezas de Instagram (Casa Tomás y Touza) hechas con las plantillas de src/lib/instagram. '
  'datos = JSON de la pieza (validarPieza); imagen en el bucket instagram (imagen_ruta). Sección de permisos marketing. Se audita.';
comment on column public.instagram_piezas.datos is 'JSON de la pieza tal como lo valida src/lib/instagram/esquema.ts (validarPieza).';
comment on column public.instagram_piezas.caption is 'Pie de foto para Instagram (≤ 2200 caracteres).';
comment on column public.instagram_piezas.estado is 'borrador → generada → prueba_ok → publicada; error si algo falla (ver columna error).';
comment on column public.instagram_piezas.imagen_ruta is 'Ruta de la imagen generada dentro del bucket instagram.';
comment on column public.instagram_piezas.contenedor_id is 'Id del contenedor de medios de la API de Instagram (paso previo a publicar).';
comment on column public.instagram_piezas.media_id is 'Id de la publicación en Instagram.';
comment on column public.instagram_piezas.permalink is 'Enlace a la publicación en Instagram.';
comment on column public.instagram_piezas.creado_por is 'Quién la creó: lo pone el servidor (auth.uid()), no el cliente.';

create index if not exists instagram_piezas_estado_created_idx
  on public.instagram_piezas (estado, created_at desc);

-- updated_at siempre; creado_por y created_at no se falsean ni se cambian.
create or replace function public.instagram_piezas_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_piezas_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_al_editar on public.instagram_piezas;
create trigger instagram_piezas_al_editar
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_al_editar();

-- Auditoría: el mismo trigger y la misma función que instala
-- instalar_auditoria_panel() (la demo no tiene el event trigger).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.instagram_piezas'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.instagram_piezas';
    execute 'create trigger trg_auditoria after insert or update or delete on public.instagram_piezas
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- RLS: solo el panel con la sección marketing; anon nada.
alter table public.instagram_piezas enable row level security;
revoke all on public.instagram_piezas from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_piezas from anon, authenticated';
    execute 'grant select, insert, update, delete on public.instagram_piezas to authenticated';
    execute 'grant all on public.instagram_piezas to service_role';
  end if;
end;
$$;

drop policy if exists instagram_piezas_select_seccion on public.instagram_piezas;
create policy instagram_piezas_select_seccion on public.instagram_piezas
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_piezas_insert_seccion on public.instagram_piezas;
create policy instagram_piezas_insert_seccion on public.instagram_piezas
  for insert to authenticated with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_piezas_update_seccion on public.instagram_piezas;
create policy instagram_piezas_update_seccion on public.instagram_piezas
  for update to authenticated
  using ((select public.can_write_section('marketing')))
  with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_piezas_delete_seccion on public.instagram_piezas;
create policy instagram_piezas_delete_seccion on public.instagram_piezas
  for delete to authenticated using ((select public.can_write_section('marketing')));
drop policy if exists instagram_piezas_service_role on public.instagram_piezas;
create policy instagram_piezas_service_role on public.instagram_piezas
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.instagram_piezas';
    execute 'create policy "acceso_panel_no_bloqueado" on public.instagram_piezas as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_malas text;
begin
  if not exists (select 1 from storage.buckets where id = 'instagram' and public and file_size_limit = 8388608) then
    v_malos := v_malos || 'el bucket instagram no es público de 8 MB'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_piezas'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_piezas'::text;
  end if;
  -- Invariante de 20261001180000: ninguna lectura de storage.objects sin bucket.
  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'instagram_%'
     and coalesce(qual, with_check) not like '%bucket_id = ''instagram''%';
  if v_malas is not null then
    v_malos := v_malos || format('políticas de storage sin acotar al bucket: %s', v_malas);
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.instagram_piezas', 'SELECT')
       or has_table_privilege('anon', 'public.instagram_piezas', 'INSERT')
       or has_table_privilege('anon', 'public.instagram_piezas', 'UPDATE')
       or has_table_privilege('anon', 'public.instagram_piezas', 'DELETE')
       or has_table_privilege('anon', 'public.instagram_piezas', 'TRUNCATE') then
      v_malos := v_malos || 'anon tiene acceso a instagram_piezas'::text;
    end if;
    if has_table_privilege('authenticated', 'public.instagram_piezas', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated tiene TRUNCATE en instagram_piezas'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'instagram';
--   select policyname, cmd, roles from pg_policies where policyname like 'instagram_%' order by 1;
