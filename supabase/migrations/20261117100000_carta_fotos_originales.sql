set client_encoding = 'UTF8';
-- ===========================================================================
-- carta_fotos_originales — el ORIGINAL de la foto de cada plato y vino de la
-- carta, guardado en Google Drive (marketing/carta/<marca>/…). Ver
-- docs/instagram-fotos.md, «Originales de la carta en Drive».
--
-- Por qué una tabla aparte y no columnas en "Platos" y "Vinos":
--   · "Platos" y "Vinos" se leen como `anon` desde las webs (política
--     «Público puede ver … activos» y select * en algunos sitios): unas
--     columnas nuevas publicarían el id de Drive y las medidas del original.
--     Esta tabla no la ve `anon`.
--   · "Platos" tiene triggers al editar (updated_at, sin foto → no expandida,
--     publicación de vinos, auditoría): anotar el original tocaría updated_at
--     y dispararía todo eso sin que nadie haya cambiado la ficha.
--   · Permisos propios: escribe quien edita la carta (gestor_carta) y lee
--     también Marketing (Instagram), sin abrir la carta a Marketing.
--   · Se borra sola con el plato o el vino (ON DELETE CASCADE).
--
-- Cada fila es de UN plato o de UN vino (CHECK), uno por ficha (UNIQUE).
-- La escribe la Edge Function instagram-drive (acción subir_original) con el
-- JWT del usuario: RLS con can_edit_section('gestor_carta').
--
-- Se puede aplicar dos veces. Rollback:
-- supabase/rollbacks/20261117100000_carta_fotos_originales_ROLLBACK.sql
-- (los ficheros siguen en Drive).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regprocedure('public.can_edit_section(text)') is null then
    v_faltan := v_faltan || 'public.can_edit_section(text) (aplica antes 20261001170000)'::text;
  end if;
  if to_regclass('public."Platos"') is null then
    v_faltan := v_faltan || 'la tabla "Platos"'::text;
  end if;
  if to_regclass('public."Vinos"') is null then
    v_faltan := v_faltan || 'la tabla "Vinos"'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'carta_fotos_originales: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

create table if not exists public.carta_fotos_originales (
  id          uuid primary key default gen_random_uuid(),
  plato_id    text references public."Platos" (id) on delete cascade,
  vino_id     text references public."Vinos" (id) on delete cascade,
  marca       text not null,
  drive_id    text not null,
  nombre      text not null,
  ancho       integer not null,
  alto        integer not null,
  bytes       integer not null,
  subido_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint carta_fotos_originales_plato_key   unique (plato_id),
  constraint carta_fotos_originales_vino_key    unique (vino_id),
  constraint carta_fotos_originales_drive_key   unique (drive_id),
  -- De un plato O de un vino, nunca de los dos ni de ninguno.
  constraint carta_fotos_originales_ficha_chk   check ((plato_id is null) <> (vino_id is null)),
  constraint carta_fotos_originales_marca_chk   check (marca in ('casa-tomas', 'touza')),
  constraint carta_fotos_originales_drive_chk   check (drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint carta_fotos_originales_nombre_chk  check (nombre ~ '^[a-z0-9-]{1,60}-[A-Za-z0-9_-]{1,100}\.jpg$'),
  -- Lado mayor ≤ 4000 px (lo que deja el panel al convertir) y JPEG ≤ 8 MB.
  constraint carta_fotos_originales_medidas_chk check (ancho between 1 and 4000 and alto between 1 and 4000),
  constraint carta_fotos_originales_bytes_chk   check (bytes between 1 and 8388608)
);
comment on table public.carta_fotos_originales is
  'Original (JPEG a tamaño completo, lado mayor ≤ 4000) de la foto de un plato o un vino de la carta, guardado en Google Drive '
  '(marketing/carta/<marca>/<nombre>-<id>.jpg). Lo escribe instagram-drive (subir_original); Instagram lo usa en vez de la versión web. '
  'Escribe gestor_carta («Editar»); leen gestor_carta y marketing («Ver»). Ver docs/instagram-fotos.md.';
comment on column public.carta_fotos_originales.drive_id is 'Id del fichero en Google Drive (dentro de marketing/carta/<marca>).';
comment on column public.carta_fotos_originales.nombre is 'Nombre del fichero en Drive: <nombre-del-plato>-<id>.jpg.';
comment on column public.carta_fotos_originales.ancho is 'Ancho real del JPEG original (px, ya girado según EXIF).';
comment on column public.carta_fotos_originales.alto is 'Alto real del JPEG original (px, ya girado según EXIF).';
comment on column public.carta_fotos_originales.subido_por is 'Quién lo subió la última vez: lo pone la base de datos (auth.uid()), no el cliente.';

create or replace function public.carta_fotos_originales_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subido_por := coalesce(auth.uid(), new.subido_por);
    new.created_at := now();
  else
    -- La ficha no cambia de dueño: un original es siempre del mismo plato o vino.
    new.id         := old.id;
    new.plato_id   := old.plato_id;
    new.vino_id    := old.vino_id;
    new.created_at := old.created_at;
    new.subido_por := coalesce(auth.uid(), old.subido_por);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.carta_fotos_originales_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.carta_fotos_originales_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists carta_fotos_originales_al_editar on public.carta_fotos_originales;
create trigger carta_fotos_originales_al_editar
  before insert or update on public.carta_fotos_originales
  for each row execute function public.carta_fotos_originales_al_editar();

-- Auditoría, como el resto de tablas (si existe la función).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.carta_fotos_originales'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.carta_fotos_originales';
    execute 'create trigger trg_auditoria after insert or update or delete on public.carta_fotos_originales
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

alter table public.carta_fotos_originales enable row level security;
revoke all on public.carta_fotos_originales from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.carta_fotos_originales from anon, authenticated';
    execute 'grant select, insert, update, delete on public.carta_fotos_originales to authenticated';
    execute 'grant all on public.carta_fotos_originales to service_role';
  end if;
end;
$$;

drop policy if exists carta_fotos_originales_select_seccion on public.carta_fotos_originales;
create policy carta_fotos_originales_select_seccion on public.carta_fotos_originales
  for select to authenticated
  using ((select public.can_read_section('gestor_carta')) or (select public.can_read_section('marketing')));
drop policy if exists carta_fotos_originales_insert_seccion on public.carta_fotos_originales;
create policy carta_fotos_originales_insert_seccion on public.carta_fotos_originales
  for insert to authenticated with check ((select public.can_edit_section('gestor_carta')));
drop policy if exists carta_fotos_originales_update_seccion on public.carta_fotos_originales;
create policy carta_fotos_originales_update_seccion on public.carta_fotos_originales
  for update to authenticated
  using ((select public.can_edit_section('gestor_carta')))
  with check ((select public.can_edit_section('gestor_carta')));
drop policy if exists carta_fotos_originales_delete_seccion on public.carta_fotos_originales;
create policy carta_fotos_originales_delete_seccion on public.carta_fotos_originales
  for delete to authenticated using ((select public.can_edit_section('gestor_carta')));
drop policy if exists carta_fotos_originales_service_role on public.carta_fotos_originales;
create policy carta_fotos_originales_service_role on public.carta_fotos_originales
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.carta_fotos_originales';
    execute 'create policy "acceso_panel_no_bloqueado" on public.carta_fotos_originales as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

do $$
declare
  v_malos text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.carta_fotos_originales'::regclass) then
    v_malos := v_malos || 'RLS apagada'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'carta_fotos_originales'
        and policyname like 'carta_fotos_originales_%') <> 5 then
    v_malos := v_malos || 'faltan políticas'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.carta_fotos_originales', 'SELECT')
       or has_table_privilege('anon', 'public.carta_fotos_originales', 'INSERT')
       or has_table_privilege('anon', 'public.carta_fotos_originales', 'UPDATE')
       or has_table_privilege('anon', 'public.carta_fotos_originales', 'DELETE')
       or has_table_privilege('anon', 'public.carta_fotos_originales', 'TRUNCATE') then
      v_malos := v_malos || 'anon tiene acceso'::text;
    end if;
    if has_table_privilege('authenticated', 'public.carta_fotos_originales', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated tiene TRUNCATE'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'carta_fotos_originales: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'carta_fotos_originales: aplicada';
end;
$$;

commit;
