set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261118120000_rrss — RRSS: editor IA de fotos y vídeos, borradores de
-- Facebook e ideas para grabar (08/11/2026)
-- ===========================================================================
-- La sección «Instagram» del panel pasa a llamarse «RRSS» con tres pestañas:
-- Instagram (todo lo de antes, sin cambios en la base de datos), Facebook y
-- Subida de fotos (editor IA). Esta migración crea solo lo nuevo:
--
--   * rrss_proyectos     — un trabajo/borrador: marca, canal, tipo de
--                          contenido, estilo, instrucciones, plan de edición
--                          (el de la IA y el ajustado a mano) y textos.
--   * rrss_archivos      — fotos y vídeos ORIGINALES subidos (nunca se tocan)
--                          y su análisis (previa, hoja de contactos, audio,
--                          transcripción).
--   * rrss_generaciones  — cada vez que el motor transforma archivos (todo o
--                          solo unas piezas). Una sola activa por trabajo
--                          (índice único): no hay generaciones duplicadas.
--   * rrss_resultados    — los archivos editados (JPEG/MP4). Al regenerar una
--                          pieza, la anterior deja de ser vigente.
--   * rrss_ideas         — «Dame ideas para grabar» (propuestas guardadas).
--   * rrss_ia_peticiones — cada llamada a la IA (para el cupo diario).
--   * Cubo PRIVADO «rrss» (50 MB por archivo, el máximo del plan):
--       originales/<trabajo>/<archivo>.<ext>   previas/<trabajo>/<archivo>[-hoja].jpg
--       audio/<trabajo>/<archivo>.m4a          resultados/<trabajo>/<generación>/<n>[-portada].(jpg|mp4)
--   * Topes diarios (disparadores): generaciones de fotos y de vídeo por
--     usuario y de vídeo en total, y peticiones a la IA por usuario.
--   * Alta de «rrss-ia» en ia_funciones (sin instrumentar hasta desplegar).
--
-- Permisos: los de Marketing, como Instagram. Leer con «Ver»
-- (can_read_section); crear, cambiar, subir, generar y usar la IA con
-- «Editar» (can_edit_section). Más la política restrictiva de sesión de panel
-- no bloqueada. Nada publica en ninguna red: el panel no tiene integración de
-- publicación con Facebook y lo generado nunca se publica solo.
--
-- Necesita: can_read_section / can_edit_section (20261111000000) y
-- update_updated_at_column. Idempotente.
-- Rollback: supabase/rollbacks/20261118120000_rrss_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regprocedure('public.can_edit_section(text)') is null or to_regprocedure('public.can_read_section(text)') is null then
    raise exception 'rrss: faltan can_read_section / can_edit_section (aplica antes 20261111000000_instagram_seguridad.sql).';
  end if;
end;
$$;

-- ─── 1. Tablas ──────────────────────────────────────────────────────────────

create table if not exists public.rrss_proyectos (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (marca in ('casa-tomas', 'touza')),
  canal text not null check (canal in ('instagram', 'facebook')),
  tipo text not null check (tipo in ('publicacion', 'carrusel', 'story', 'reel', 'animada')),
  estilo text not null default 'elegante' check (estilo in ('elegante', 'natural', 'moderno', 'promocion', 'minimalista', 'marca')),
  instrucciones text not null default '' check (char_length(instrucciones) <= 1000),
  permitir_creativo boolean not null default false,
  origen text not null default 'editor' check (origen in ('editor', 'facebook')),
  titulo text not null default '' check (char_length(titulo) <= 120),
  plan jsonb,
  plan_ia jsonb,
  textos jsonb not null default '{}'::jsonb check (jsonb_typeof(textos) = 'object' and pg_column_size(textos) <= 20000),
  estado text not null default 'borrador' check (estado in ('borrador', 'listo', 'archivado')),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rrss_proyectos_plan_tamano check (plan is null or pg_column_size(plan) <= 200000),
  constraint rrss_proyectos_plan_ia_tamano check (plan_ia is null or pg_column_size(plan_ia) <= 200000)
);
create index if not exists rrss_proyectos_recientes on public.rrss_proyectos (updated_at desc);

create table if not exists public.rrss_archivos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.rrss_proyectos (id) on delete cascade,
  tipo text not null check (tipo in ('foto', 'video')),
  ruta text not null unique check (ruta ~ '^originales/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov|m4v|webm)$'),
  nombre text not null default '' check (char_length(nombre) <= 200),
  mime text not null check (mime ~ '^(image|video)/[a-z0-9.+-]+$'),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  ancho integer check (ancho is null or ancho between 1 and 20000),
  alto integer check (alto is null or alto between 1 and 20000),
  duracion_s numeric(8, 2) check (duracion_s is null or duracion_s between 0 and 3600),
  orden integer not null default 0 check (orden between 0 and 100),
  estado text not null default 'subido' check (estado in ('subido', 'analizando', 'listo', 'error')),
  analisis jsonb not null default '{}'::jsonb check (jsonb_typeof(analisis) = 'object' and pg_column_size(analisis) <= 100000),
  error text check (error is null or char_length(error) <= 1000),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rrss_archivos_proyecto on public.rrss_archivos (proyecto_id, orden);

create table if not exists public.rrss_generaciones (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.rrss_proyectos (id) on delete cascade,
  medio text not null check (medio in ('foto', 'video')),
  -- Índices de las piezas a hacer (null = todas): «regenerar solo esta parte».
  piezas integer[] check (piezas is null or (cardinality(piezas) between 1 and 20)),
  plan jsonb not null check (pg_column_size(plan) <= 200000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'listo', 'error', 'cancelado')),
  progreso jsonb not null default '{}'::jsonb check (jsonb_typeof(progreso) = 'object'),
  avisos text[] not null default '{}',
  error text check (error is null or char_length(error) <= 2000),
  lease_hasta timestamptz,
  intentos integer not null default 0 check (intentos between 0 and 10),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminado_at timestamptz
);
-- Una sola generación viva por trabajo: el segundo clic (o la segunda pestaña) choca aquí.
create unique index if not exists rrss_generaciones_una_activa on public.rrss_generaciones (proyecto_id) where estado in ('pendiente', 'procesando');
create index if not exists rrss_generaciones_proyecto on public.rrss_generaciones (proyecto_id, created_at desc);
create index if not exists rrss_generaciones_cupo on public.rrss_generaciones (creado_por, created_at);

create table if not exists public.rrss_resultados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.rrss_proyectos (id) on delete cascade,
  generacion_id uuid references public.rrss_generaciones (id) on delete set null,
  indice integer not null check (indice between 0 and 19),
  medio text not null check (medio in ('foto', 'video')),
  ruta text not null unique check (ruta ~ '^resultados/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{1,2}\.(jpg|mp4)$'),
  portada_ruta text check (portada_ruta is null or portada_ruta ~ '^resultados/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{1,2}-portada\.jpg$'),
  ancho integer not null check (ancho between 1 and 4096),
  alto integer not null check (alto between 1 and 4096),
  duracion_s numeric(8, 2),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  receta jsonb not null default '{}'::jsonb check (pg_column_size(receta) <= 50000),
  avisos text[] not null default '{}',
  vigente boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists rrss_resultados_vigente on public.rrss_resultados (proyecto_id, indice) where vigente;

create table if not exists public.rrss_ideas (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (marca in ('casa-tomas', 'touza')),
  canal text not null check (canal in ('instagram', 'facebook')),
  tipo text check (tipo is null or tipo in ('publicacion', 'carrusel', 'story', 'reel', 'animada')),
  objetivo jsonb not null default '{}'::jsonb check (pg_column_size(objetivo) <= 10000),
  propuestas jsonb not null check (jsonb_typeof(propuestas) = 'array' and pg_column_size(propuestas) <= 200000),
  modelo text,
  guardada boolean not null default false,
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rrss_ideas_recientes on public.rrss_ideas (created_at desc);

create table if not exists public.rrss_ia_peticiones (
  id bigserial primary key,
  accion text not null check (accion in ('proponer', 'ideas', 'textos', 'transcribir', 'pieza')),
  proyecto_id uuid references public.rrss_proyectos (id) on delete set null,
  modelo text,
  ok boolean,
  creado_por uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists rrss_ia_peticiones_cupo on public.rrss_ia_peticiones (creado_por, created_at);

-- ─── 2. updated_at ──────────────────────────────────────────────────────────

drop trigger if exists rrss_proyectos_updated_at on public.rrss_proyectos;
create trigger rrss_proyectos_updated_at before update on public.rrss_proyectos
  for each row execute function public.update_updated_at_column();
drop trigger if exists rrss_generaciones_updated_at on public.rrss_generaciones;
create trigger rrss_generaciones_updated_at before update on public.rrss_generaciones
  for each row execute function public.update_updated_at_column();

-- ─── 3. Topes diarios (día de Madrid) ───────────────────────────────────────
-- Generaciones: 120 de fotos y 20 de vídeo por usuario y día; 40 de vídeo en
-- total (el vídeo gasta CPU de Vercel, que en el plan Hobby es limitada).
-- IA: 80 peticiones por usuario y día.

create or replace function public.rrss_comprobar_cupo_generacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_mias integer;
  v_todas integer;
begin
  -- Un tope por medio a la vez (dos peticiones simultáneas no se lo saltan).
  perform pg_advisory_xact_lock(hashtext('rrss_cupo_generacion_' || new.medio));
  new.creado_por := auth.uid();
  -- La fecha también la pone el servidor: con un created_at viejo la fila no
  -- contaría para el tope de hoy (y se podría generar sin límite).
  new.created_at := now();
  new.estado := 'pendiente';
  new.intentos := 0;
  new.lease_hasta := null;
  select count(*) into v_mias from public.rrss_generaciones
    where creado_por = new.creado_por and medio = new.medio and created_at >= v_dia;
  if new.medio = 'foto' and v_mias >= 120 then
    raise exception 'rrss_cupo: has llegado al tope de 120 ediciones de fotos por hoy' using errcode = 'P0001';
  end if;
  if new.medio = 'video' then
    if v_mias >= 20 then
      raise exception 'rrss_cupo: has llegado al tope de 20 vídeos por hoy' using errcode = 'P0001';
    end if;
    select count(*) into v_todas from public.rrss_generaciones where medio = 'video' and created_at >= v_dia;
    if v_todas >= 40 then
      raise exception 'rrss_cupo: se ha llegado al tope de 40 vídeos por hoy entre todos' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.rrss_comprobar_cupo_generacion() from public;

drop trigger if exists rrss_generaciones_cupo on public.rrss_generaciones;
create trigger rrss_generaciones_cupo before insert on public.rrss_generaciones
  for each row execute function public.rrss_comprobar_cupo_generacion();

create or replace function public.rrss_comprobar_cupo_ia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v integer;
begin
  perform pg_advisory_xact_lock(hashtext('rrss_cupo_ia_' || coalesce(auth.uid()::text, '')));
  new.creado_por := auth.uid();
  new.created_at := now(); -- ídem: un created_at viejo no contaría para el tope
  select count(*) into v from public.rrss_ia_peticiones where creado_por = new.creado_por and created_at >= v_dia;
  if v >= 80 then
    raise exception 'rrss_cupo_ia: has llegado al tope de 80 peticiones a la IA por hoy' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.rrss_comprobar_cupo_ia() from public;

drop trigger if exists rrss_ia_peticiones_cupo on public.rrss_ia_peticiones;
create trigger rrss_ia_peticiones_cupo before insert on public.rrss_ia_peticiones
  for each row execute function public.rrss_comprobar_cupo_ia();

-- Una generación no vuelve atrás: nada de «pendiente» otra vez (sería
-- repetirla sin pasar por el tope) ni bajar los intentos. Lo que se ejecuta
-- (trabajo, medio, plan, piezas), su autor y su fecha no cambian: además,
-- authenticated solo puede actualizar las columnas del estado (grant de abajo).
create or replace function public.rrss_proteger_generacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'pendiente' and old.estado <> 'pendiente' then
    raise exception 'rrss: una generación no puede volver a «pendiente»: pide otra' using errcode = 'P0001';
  end if;
  -- Ni a «procesando» una vez terminada: con el lease vencido el motor la
  -- reclamaría y la repetiría igual que si estuviera «pendiente».
  if new.estado = 'procesando' and old.estado not in ('pendiente', 'procesando') then
    raise exception 'rrss: una generación terminada no vuelve a ejecutarse: pide otra' using errcode = 'P0001';
  end if;
  -- El lease no se adelanta (si no, otra ejecución la reclamaría mientras sigue en marcha); solo se alarga o se quita.
  if new.lease_hasta is not null and old.lease_hasta is not null and new.lease_hasta < old.lease_hasta then
    raise exception 'rrss: el plazo de una generación en marcha no se acorta' using errcode = 'P0001';
  end if;
  if new.intentos < old.intentos then
    raise exception 'rrss: los intentos de una generación no bajan' using errcode = 'P0001';
  end if;
  new.proyecto_id := old.proyecto_id;
  new.medio := old.medio;
  new.plan := old.plan;
  new.piezas := old.piezas;
  -- El autor solo puede quedar NULL: es el «on delete set null» al dar de baja
  -- al usuario (si se repusiera, la fila apuntaría a un usuario que no existe).
  -- authenticated no puede tocar creado_por (grant de columnas).
  if new.creado_por is not null then
    new.creado_por := old.creado_por;
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists rrss_generaciones_proteger on public.rrss_generaciones;
create trigger rrss_generaciones_proteger before update on public.rrss_generaciones
  for each row execute function public.rrss_proteger_generacion();

-- El autor lo pone el servidor (no se puede atribuir un trabajo a otro).
create or replace function public.rrss_fijar_autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
  elsif new.creado_por is not null then
    -- Solo puede quedar NULL: el «on delete set null» al dar de baja al usuario
    -- (si se repusiera, la fila apuntaría a un usuario que no existe).
    new.creado_por := old.creado_por;
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['rrss_proyectos', 'rrss_archivos', 'rrss_ideas'] loop
    execute format('drop trigger if exists rrss_fijar_autor on public.%I', t);
    execute format('create trigger rrss_fijar_autor before insert or update on public.%I for each row execute function public.rrss_fijar_autor()', t);
  end loop;
end;
$$;

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────

alter table public.rrss_proyectos enable row level security;
alter table public.rrss_archivos enable row level security;
alter table public.rrss_generaciones enable row level security;
alter table public.rrss_resultados enable row level security;
alter table public.rrss_ideas enable row level security;
alter table public.rrss_ia_peticiones enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['rrss_proyectos', 'rrss_archivos', 'rrss_resultados', 'rrss_ideas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''marketing'')))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_edit_section(''marketing'')))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.can_edit_section(''marketing''))) with check ((select public.can_edit_section(''marketing'')))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_edit_section(''marketing'')))', t || '_delete', t);
  end loop;
end;
$$;

-- Generaciones: se crean «pendiente» (el disparador lo fuerza) y las cambia el
-- motor, que trabaja COMO el usuario con «Editar». No se borran desde el panel.
drop policy if exists rrss_generaciones_select on public.rrss_generaciones;
create policy rrss_generaciones_select on public.rrss_generaciones for select to authenticated
  using ((select public.can_read_section('marketing')));
drop policy if exists rrss_generaciones_insert on public.rrss_generaciones;
create policy rrss_generaciones_insert on public.rrss_generaciones for insert to authenticated
  with check ((select public.can_edit_section('marketing')));
drop policy if exists rrss_generaciones_update on public.rrss_generaciones;
create policy rrss_generaciones_update on public.rrss_generaciones for update to authenticated
  using ((select public.can_edit_section('marketing'))) with check ((select public.can_edit_section('marketing')));

-- Peticiones a la IA: las inserta la Edge Function con el JWT del usuario.
drop policy if exists rrss_ia_peticiones_select on public.rrss_ia_peticiones;
create policy rrss_ia_peticiones_select on public.rrss_ia_peticiones for select to authenticated
  using ((select public.can_read_section('marketing')));
drop policy if exists rrss_ia_peticiones_insert on public.rrss_ia_peticiones;
create policy rrss_ia_peticiones_insert on public.rrss_ia_peticiones for insert to authenticated
  with check ((select public.can_edit_section('marketing')));
drop policy if exists rrss_ia_peticiones_update on public.rrss_ia_peticiones;
create policy rrss_ia_peticiones_update on public.rrss_ia_peticiones for update to authenticated
  using ((select public.can_edit_section('marketing')) and creado_por = (select auth.uid()))
  with check ((select public.can_edit_section('marketing')) and creado_por = (select auth.uid()));

grant select, insert, update, delete on public.rrss_proyectos, public.rrss_archivos, public.rrss_resultados, public.rrss_ideas to authenticated;
grant select, insert on public.rrss_generaciones, public.rrss_ia_peticiones to authenticated;
-- Solo las columnas del estado (el motor y «Cancelar»); el resto no se toca después de crearla.
revoke update, delete, truncate on public.rrss_generaciones, public.rrss_ia_peticiones from authenticated;
grant update (estado, progreso, avisos, error, lease_hasta, intentos, terminado_at) on public.rrss_generaciones to authenticated;
grant update (ok) on public.rrss_ia_peticiones to authenticated;
grant usage, select on sequence public.rrss_ia_peticiones_id_seq to authenticated;
revoke all on public.rrss_proyectos, public.rrss_archivos, public.rrss_resultados, public.rrss_ideas, public.rrss_generaciones, public.rrss_ia_peticiones from anon;

-- Sesión de panel viva y no bloqueada (como el resto de tablas del panel).
do $$
declare
  t text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    foreach t in array array['rrss_proyectos', 'rrss_archivos', 'rrss_generaciones', 'rrss_resultados', 'rrss_ideas', 'rrss_ia_peticiones'] loop
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end if;
end;
$$;

-- ─── 5. Auditoría ───────────────────────────────────────────────────────────
-- Trabajos, archivos y resultados (las generaciones cambian su progreso cada
-- pocos segundos: auditarlas solo llenaría el registro).
do $$
declare
  t text;
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    foreach t in array array['rrss_proyectos', 'rrss_archivos', 'rrss_resultados', 'rrss_ideas'] loop
      execute format('drop trigger if exists trg_auditoria on public.%I', t);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_registrar_auditoria()', t);
    end loop;
  end if;
end;
$$;

-- ─── 6. Cubo privado «rrss» ─────────────────────────────────────────────────

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('rrss', 'rrss', false, 52428800,
      array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'audio/mp4'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

-- Rutas admitidas en el cubo (las mismas que comprueban las tablas).
create or replace function public.rrss_ruta_valida(p_nombre text)
returns boolean
language sql
immutable
as $$
  select p_nombre ~ '^originales/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov|m4v|webm)$'
      or p_nombre ~ '^previas/[0-9a-f-]{36}/[0-9a-f-]{36}(-hoja)?\.jpg$'
      or p_nombre ~ '^audio/[0-9a-f-]{36}/[0-9a-f-]{36}\.m4a$'
      or p_nombre ~ '^resultados/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{1,2}(-portada)?\.(jpg|mp4)$'
$$;
grant execute on function public.rrss_ruta_valida(text) to authenticated;

-- Mismas reglas que las tablas, incluida la sesión de panel viva y no
-- bloqueada (si existe private.sesion_panel_permitida).
do $$
declare
  v_sesion text := case when to_regprocedure('private.sesion_panel_permitida()') is not null
                        then ' and (select private.sesion_panel_permitida())' else '' end;
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists rrss_objetos_select on storage.objects';
    execute 'create policy rrss_objetos_select on storage.objects for select to authenticated using (bucket_id = ''rrss'' and (select public.can_read_section(''marketing''))' || v_sesion || ')';
    execute 'drop policy if exists rrss_objetos_insert on storage.objects';
    execute 'create policy rrss_objetos_insert on storage.objects for insert to authenticated with check (bucket_id = ''rrss'' and (select public.can_edit_section(''marketing'')) and public.rrss_ruta_valida(name)' || v_sesion || ')';
    execute 'drop policy if exists rrss_objetos_update on storage.objects';
    execute 'create policy rrss_objetos_update on storage.objects for update to authenticated using (bucket_id = ''rrss'' and (select public.can_edit_section(''marketing''))' || v_sesion || ') with check (bucket_id = ''rrss'' and (select public.can_edit_section(''marketing'')) and public.rrss_ruta_valida(name)' || v_sesion || ')';
    execute 'drop policy if exists rrss_objetos_delete on storage.objects';
    execute 'create policy rrss_objetos_delete on storage.objects for delete to authenticated using (bucket_id = ''rrss'' and (select public.can_edit_section(''marketing''))' || v_sesion || ')';
  end if;
end;
$$;

-- ─── 7. Coste de la IA ──────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('rrss-ia', 'RRSS · editor IA (plan de edición, textos, ideas para grabar y transcripción)', false, 'llamada', 62)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

do $$
begin
  raise notice 'rrss: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select tablename from pg_tables where tablename like 'rrss_%' order by 1;
--   select id, public, file_size_limit from storage.buckets where id = 'rrss';
--   select polname from pg_policy where polname like 'rrss_%' order by 1;
