set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261109000000_instagram_campanas — Fechas y campañas de Instagram, fase 2
-- (09/11/2026)
-- ===========================================================================
-- Diseño: instagram-studio/propuesta/PROPUESTA.md, apartados 3.1-3.6, 4.5 y
-- fila «2» del apartado 7. Documentación: docs/instagram-campanas.md.
--
-- QUÉ CREA
--   1. public.marketing_fechas: fechas señaladas para la IA (Galicia,
--      temporada de producto gallego, Crevillent, Alicante y comerciales).
--      Cada fila es anual (se guarda con el año 2000 y se repite cada año;
--      si «hasta» es anterior a «desde», cruza el año: sep → abr) o de un
--      año concreto (Semana Santa, Entroido y Día de la Madre de 2027).
--      Columna «verificacion»: «verificada» solo para las fechas de
--      calendario fijas o calculadas (la Pascua de 2027 cae el 28/03); las
--      fiestas locales y las temporadas de producto van «sin verificar»: las
--      confirma el dueño. La siembra NO pisa filas ya editadas (on conflict
--      do nothing por «clave»).
--   2. public.instagram_campanas: propuestas de campaña de la IA (2-4
--      semanas) con su objetivo, público, mensaje y piezas (jsonb
--      «propuesta»). Estados: propuesta → aceptada | descartada (en_curso y
--      cerrada quedan para más adelante). La inserta la Edge Function
--      instagram-ia con el JWT del usuario; aceptarla o descartarla, SOLO por
--      RPC.
--   3. Borradores con fecha prevista: COLUMNAS en instagram_piezas
--      (fecha_prevista, campana_id, origen), no una tabla aparte. Por qué:
--        * un borrador de campaña ES una pieza: se abre en el editor, se
--          genera, se prueba y se programa por el camino de siempre, que ya
--          trabaja sobre instagram_piezas (historial, render, publicar);
--        * a diferencia de la programación (20261106110000), la fecha
--          prevista no tiene bloqueo, intentos ni historial: es un dato de
--          planificación, y nadie la reescribe al generar o probar (el
--          motivo por el que la programación va aparte era que «estado» se
--          pisa; fecha_prevista no se toca al cambiar el estado);
--        * así lo prevé el apartado 3.6 de la propuesta.
--      origen y campana_id solo los pone el servidor (trigger): el panel no
--      puede hacer pasar una pieza suya por «de la IA». fecha_prevista sí la
--      puede mover quien tiene Marketing (es solo un plan).
--   4. instagram_sugerencias_ia.tipo admite también «proponer_campana» e
--      «ideas_semana» (cuentan para el mismo cupo diario).
--   5. RPC:
--        marketing_fechas_entre(desde, hasta, marca)  fechas que caen en el
--          rango (anuales repetidas cada año). SECURITY INVOKER.
--        instagram_ia_contexto(marca, desde, hasta)  JSON compacto para la
--          IA: carta activa de la marca (featured primero; SIN precios),
--          novedades activas del periodo (solo Casa Tomás), fechas
--          señaladas, fotos de la biblioteca, resumen de métricas de 90 días
--          (formato, plantilla, tipo de foto, día y franja horaria) e
--          historial de ganchos. SECURITY INVOKER: manda la RLS del usuario.
--          Nunca reservas, clientes, teléfonos, correos ni facturas.
--        instagram_aceptar_campana(campaña, piezas[])  crea las piezas
--          elegidas como BORRADORES (estado «borrador», origen «ia»,
--          fecha_prevista y campana_id). NUNCA programa ni publica: no toca
--          instagram_programaciones. SECURITY DEFINER + Marketing en edición
--          + sesión de panel viva.
--        instagram_descartar_campana(campaña)
--
--   RLS (sección «marketing», como el resto de Instagram):
--     marketing_fechas    · LEER can_read_section; AÑADIR y CAMBIAR (activar,
--                           desactivar, corregir) can_write_section; borrar
--                           nadie del panel (se desactivan).
--     instagram_campanas  · LEER can_read_section; INSERTAR can_write_section
--                           (estado, creado_por y decisiones los pone el
--                           servidor); CAMBIAR solo por las RPC; borrar nadie.
--     Las dos con la política restrictiva acceso_panel_no_bloqueado si existe
--     private.sesion_panel_permitida(). anon nada. Se auditan.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Necesita antes 20261105090000_instagram.sql y
-- 20261108000000_instagram_ia.sql (las métricas, las fotos y la programación
-- son opcionales: si faltan, el contexto va sin ellas).
--   npx supabase db query --linked -f supabase/migrations/20261109000000_instagram_campanas.sql
-- Idempotente. Tiene que terminar en «instagram_campanas: aplicada».
-- Deshacer: supabase/rollbacks/20261109000000_instagram_campanas_ROLLBACK.sql
-- Pruebas: npm run test:instagram-campanas:db (PGlite).
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
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regclass('public.instagram_sugerencias_ia') is null then
    v_faltan := v_faltan || 'public.instagram_sugerencias_ia (aplica antes 20261108000000_instagram_ia.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_campanas: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Fechas señaladas ────────────────────────────────────────────────────
create table if not exists public.marketing_fechas (
  id               uuid primary key default gen_random_uuid(),
  clave            text not null default ('propia-' || gen_random_uuid()::text),
  titulo           text not null,
  ambito           text not null,
  marcas           text[] not null default array['casa-tomas', 'touza'],
  desde            date not null,
  hasta            date not null,
  anual            boolean not null default true,
  idea             text,
  verificacion     text not null default 'sin verificar',
  fuente           text,
  activo           boolean not null default true,
  actualizado_por  uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint marketing_fechas_clave_key        unique (clave),
  constraint marketing_fechas_clave_chk        check (clave ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  constraint marketing_fechas_titulo_chk       check (char_length(btrim(titulo)) between 1 and 120),
  constraint marketing_fechas_ambito_chk       check (ambito in ('galicia', 'temporada', 'crevillent', 'alicante', 'comercial', 'propio')),
  constraint marketing_fechas_marcas_chk       check (
    cardinality(marcas) between 1 and 2 and marcas <@ array['casa-tomas', 'touza']::text[]),
  constraint marketing_fechas_verificacion_chk check (verificacion in ('verificada', 'sin verificar')),
  constraint marketing_fechas_textos_chk       check (
    coalesce(char_length(idea), 0) <= 600 and coalesce(char_length(fuente), 0) <= 300),
  -- Anuales: año 2000 de referencia, sin 29 de febrero (no existe todos los años);
  -- «hasta» antes que «desde» = cruza el año. De un año: hasta ≥ desde y ≤ 1 año.
  constraint marketing_fechas_rango_chk        check (
    case when anual
      then extract(year from desde) = 2000 and extract(year from hasta) = 2000
           and to_char(desde, 'MM-DD') <> '02-29' and to_char(hasta, 'MM-DD') <> '02-29'
      else hasta >= desde and hasta - desde <= 366
    end)
);
comment on table public.marketing_fechas is
  'Fechas señaladas para las campañas de Instagram (Galicia, temporada, Crevillent, Alicante, comerciales). '
  'Anuales con el año 2000 de referencia. verificacion = «sin verificar» hasta que el dueño las confirme. Ver docs/instagram-campanas.md.';
comment on column public.marketing_fechas.clave is 'Identificador estable (la siembra no pisa una fila con la misma clave).';
comment on column public.marketing_fechas.anual is 'true: se repite cada año (desde/hasta con el año 2000; si hasta < desde, cruza el año).';
comment on column public.marketing_fechas.verificacion is '«verificada» (calendario fijo o calculado) o «sin verificar» (fiestas locales, temporadas: las confirma el dueño).';
comment on column public.marketing_fechas.idea is 'Idea base para la IA. Se le pasa como datos, nunca como instrucciones.';

create or replace function public.marketing_fechas_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.clave := old.clave;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.actualizado_por := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.marketing_fechas_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.marketing_fechas_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists marketing_fechas_al_editar on public.marketing_fechas;
create trigger marketing_fechas_al_editar
  before insert or update on public.marketing_fechas
  for each row execute function public.marketing_fechas_al_editar();

-- ─── 2. Campañas ────────────────────────────────────────────────────────────
create table if not exists public.instagram_campanas (
  id                uuid primary key default gen_random_uuid(),
  marca             text not null,
  titulo            text not null,
  objetivo          text,
  publico           text,
  mensaje           text,
  razonamiento      text,
  peticion          text,
  desde             date not null,
  hasta             date not null,
  estado            text not null default 'propuesta',
  origen            text not null default 'ia',
  propuesta         jsonb not null default '{}'::jsonb,
  sugerencia_id     uuid references public.instagram_sugerencias_ia (id) on delete set null,
  modelo            text,
  piezas_aceptadas  smallint,
  creado_por        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  decidida_por      uuid references auth.users (id) on delete set null,
  decidida_at       timestamptz,
  constraint instagram_campanas_marca_chk   check (marca in ('casa-tomas', 'touza')),
  constraint instagram_campanas_estado_chk  check (estado in ('propuesta', 'aceptada', 'en_curso', 'cerrada', 'descartada')),
  constraint instagram_campanas_origen_chk  check (origen in ('ia', 'manual')),
  constraint instagram_campanas_titulo_chk  check (char_length(btrim(titulo)) between 1 and 120),
  constraint instagram_campanas_textos_chk  check (
    coalesce(char_length(objetivo), 0) <= 600 and coalesce(char_length(publico), 0) <= 400
    and coalesce(char_length(mensaje), 0) <= 300 and coalesce(char_length(razonamiento), 0) <= 1500
    and coalesce(char_length(peticion), 0) <= 500),
  -- 2 a 4 semanas (con un día de margen por si la última pieza cae en domingo).
  constraint instagram_campanas_fechas_chk  check (hasta >= desde and hasta - desde <= 31),
  constraint instagram_campanas_propuesta_chk check (
    jsonb_typeof(propuesta) = 'object' and pg_column_size(propuesta) <= 131072),
  constraint instagram_campanas_modelo_chk  check (modelo is null or modelo ~ '^[A-Za-z0-9._:-]{1,80}$'),
  constraint instagram_campanas_aceptadas_chk check (piezas_aceptadas is null or piezas_aceptadas between 0 and 40)
);
comment on table public.instagram_campanas is
  'Campañas de Instagram propuestas por la IA (instagram-ia, proponer_campana). Aceptar crea BORRADORES '
  '(instagram_aceptar_campana); nunca programa ni publica. Ver docs/instagram-campanas.md.';
comment on column public.instagram_campanas.propuesta is 'La campaña ya validada: fases y piezas (fecha, hora, formato, plantilla, plato, foto o «falta foto», textos).';
comment on column public.instagram_campanas.peticion is '«¿Qué quieres empujar?», ya sin correos ni teléfonos.';

create index if not exists instagram_campanas_marca_created_idx
  on public.instagram_campanas (marca, created_at desc);

create or replace function public.instagram_campanas_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.created_at := now();
    -- Desde el panel (o la función con el JWT del usuario) nace siempre como propuesta.
    if current_user in ('authenticated', 'anon') then
      new.estado := 'propuesta';
      new.piezas_aceptadas := null;
      new.decidida_por := null;
      new.decidida_at := null;
    end if;
  else
    new.id := old.id;
    new.marca := old.marca;
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_campanas_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_campanas_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_campanas_al_editar on public.instagram_campanas;
create trigger instagram_campanas_al_editar
  before insert or update on public.instagram_campanas
  for each row execute function public.instagram_campanas_al_editar();

-- ─── 3. Borradores con fecha prevista (columnas de instagram_piezas) ────────
alter table public.instagram_piezas add column if not exists fecha_prevista timestamptz;
alter table public.instagram_piezas add column if not exists campana_id uuid;
alter table public.instagram_piezas add column if not exists origen text not null default 'manual';
alter table public.instagram_piezas drop constraint if exists instagram_piezas_campana_id_fkey;
alter table public.instagram_piezas add constraint instagram_piezas_campana_id_fkey
  foreign key (campana_id) references public.instagram_campanas (id) on delete set null;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_origen_chk;
alter table public.instagram_piezas add constraint instagram_piezas_origen_chk
  check (origen in ('manual', 'ia', 'encargo'));
comment on column public.instagram_piezas.fecha_prevista is
  'Fecha y hora previstas de un borrador (plan del calendario, hora de Madrid al pintarla). NO programa nada: programar sigue siendo instagram_programar.';
comment on column public.instagram_piezas.campana_id is 'Campaña de la que salió el borrador (instagram_campanas). Solo la pone el servidor.';
comment on column public.instagram_piezas.origen is 'manual | ia (borrador de una campaña) | encargo. Solo lo pone el servidor.';

create index if not exists instagram_piezas_fecha_prevista_idx
  on public.instagram_piezas (fecha_prevista) where fecha_prevista is not null;
create index if not exists instagram_piezas_campana_idx
  on public.instagram_piezas (campana_id) where campana_id is not null;

-- origen y campana_id: solo el servidor (RPC SECURITY DEFINER, service_role).
-- Desde el panel una pieza nueva es siempre «manual» y sin campaña; al
-- editarla se conservan (la campaña solo se puede quitar, no cambiar).
create or replace function public.instagram_piezas_proteger_campana()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.origen := 'manual';
    new.campana_id := null;
  else
    new.origen := old.origen;
    new.campana_id := case when new.campana_id is null then null else old.campana_id end;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_proteger_campana() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_proteger_campana() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_proteger_campana on public.instagram_piezas;
create trigger instagram_piezas_proteger_campana
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_proteger_campana();

-- ─── 4. Tipos de sugerencia de la IA ────────────────────────────────────────
alter table public.instagram_sugerencias_ia drop constraint if exists instagram_sugerencias_ia_tipo_chk;
alter table public.instagram_sugerencias_ia add constraint instagram_sugerencias_ia_tipo_chk
  check (tipo in ('sugerir_texto', 'sugerir_rotulos', 'proponer_campana', 'ideas_semana'));

-- ─── 5. Auditoría (mismo trigger que instala instalar_auditoria_panel()) ────
do $$
declare
  v_tabla text;
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is null then
    return;
  end if;
  foreach v_tabla in array array['marketing_fechas', 'instagram_campanas'] loop
    if not exists (select 1 from pg_trigger
                    where tgrelid = format('public.%I', v_tabla)::regclass
                      and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                      and not tgisinternal) then
      execute format('drop trigger if exists trg_auditoria on public.%I', v_tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                      for each row execute function public.fn_registrar_auditoria()', v_tabla);
    end if;
  end loop;
end;
$$;

-- ─── 6. Permisos y RLS ──────────────────────────────────────────────────────
alter table public.marketing_fechas enable row level security;
alter table public.instagram_campanas enable row level security;
revoke all on public.marketing_fechas from public;
revoke all on public.instagram_campanas from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.marketing_fechas, public.instagram_campanas from anon, authenticated';
    execute 'grant select on public.marketing_fechas to authenticated';
    execute 'grant insert (titulo, ambito, marcas, desde, hasta, anual, idea, verificacion, fuente, activo)
               on public.marketing_fechas to authenticated';
    execute 'grant update (titulo, ambito, marcas, desde, hasta, anual, idea, verificacion, fuente, activo)
               on public.marketing_fechas to authenticated';
    execute 'grant select on public.instagram_campanas to authenticated';
    execute 'grant insert (marca, titulo, objetivo, publico, mensaje, razonamiento, peticion, desde, hasta,
               propuesta, sugerencia_id, modelo) on public.instagram_campanas to authenticated';
    execute 'grant all on public.marketing_fechas, public.instagram_campanas to service_role';
  end if;
end;
$$;

drop policy if exists marketing_fechas_select_seccion on public.marketing_fechas;
create policy marketing_fechas_select_seccion on public.marketing_fechas
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists marketing_fechas_insert_seccion on public.marketing_fechas;
create policy marketing_fechas_insert_seccion on public.marketing_fechas
  for insert to authenticated with check ((select public.can_write_section('marketing')));
drop policy if exists marketing_fechas_update_seccion on public.marketing_fechas;
create policy marketing_fechas_update_seccion on public.marketing_fechas
  for update to authenticated
  using ((select public.can_write_section('marketing')))
  with check ((select public.can_write_section('marketing')));
drop policy if exists marketing_fechas_service_role on public.marketing_fechas;
create policy marketing_fechas_service_role on public.marketing_fechas
  for all to service_role using (true) with check (true);

drop policy if exists instagram_campanas_select_seccion on public.instagram_campanas;
create policy instagram_campanas_select_seccion on public.instagram_campanas
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_campanas_insert_seccion on public.instagram_campanas;
create policy instagram_campanas_insert_seccion on public.instagram_campanas
  for insert to authenticated with check ((select public.can_write_section('marketing')));
drop policy if exists instagram_campanas_service_role on public.instagram_campanas;
create policy instagram_campanas_service_role on public.instagram_campanas
  for all to service_role using (true) with check (true);

do $$
declare
  v_tabla text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is null then
    return;
  end if;
  foreach v_tabla in array array['marketing_fechas', 'instagram_campanas'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', v_tabla);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', v_tabla);
  end loop;
end;
$$;

-- ─── 7. RPC ─────────────────────────────────────────────────────────────────

-- Fechas señaladas que caen en [desde, hasta] para una marca. Las anuales se
-- repiten cada año (y las que cruzan el año, del año anterior también).
create or replace function public.marketing_fechas_entre(p_desde date, p_hasta date, p_marca text default null)
returns table (id uuid, clave text, titulo text, ambito text, desde date, hasta date, idea text, verificacion text)
language sql
stable
security invoker
set search_path = ''
as $$
  with anios as (
    select generate_series(extract(year from p_desde)::int - 1, extract(year from p_hasta)::int) as y
  ),
  ocurrencias as (
    select f.id, f.clave, f.titulo, f.ambito, f.idea, f.verificacion,
           make_date(a.y, extract(month from f.desde)::int, extract(day from f.desde)::int) as ini,
           make_date(a.y + case when to_char(f.hasta, 'MM-DD') < to_char(f.desde, 'MM-DD') then 1 else 0 end,
                     extract(month from f.hasta)::int, extract(day from f.hasta)::int) as fin
      from public.marketing_fechas f
      cross join anios a
     where f.activo and f.anual
       and (p_marca is null or p_marca = any (f.marcas))
    union all
    select f.id, f.clave, f.titulo, f.ambito, f.idea, f.verificacion, f.desde, f.hasta
      from public.marketing_fechas f
     where f.activo and not f.anual
       and (p_marca is null or p_marca = any (f.marcas))
  )
  select o.id, o.clave, o.titulo, o.ambito, o.ini, o.fin, o.idea, o.verificacion
    from ocurrencias o
   where p_desde is not null and p_hasta is not null
     and o.ini <= p_hasta and o.fin >= p_desde
   order by o.ini, o.titulo;
$$;
revoke all on function public.marketing_fechas_entre(date, date, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.marketing_fechas_entre(date, date, text) from anon';
    execute 'grant execute on function public.marketing_fechas_entre(date, date, text) to authenticated, service_role';
  end if;
end;
$$;

-- Contexto compacto para la IA. SECURITY INVOKER: cada tabla con la RLS del
-- usuario. NUNCA lee reservas, clientes, teléfonos, correos ni facturas. Los
-- precios de la carta NO salen (la IA no debe escribirlos).
create or replace function public.instagram_ia_contexto(p_marca text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_col text;
  v_carta jsonb;
  v_novedades jsonb := '[]'::jsonb;
  v_fechas jsonb;
  v_fotos jsonb := '[]'::jsonb;
  v_metricas jsonb := null;
  v_historial jsonb;
  v_join_fotos text := '';
  v_tipo_foto text := $t$case when p.datos ->> 'foto' like 'carta:%' then 'carta' else null end$t$;
begin
  if p_marca is null or p_marca not in ('casa-tomas', 'touza') then
    raise exception 'marca debe ser «casa-tomas» o «touza»' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 62 then
    raise exception 'Rango de fechas no válido (como mucho 62 días)' using errcode = '22023';
  end if;
  if auth.uid() is not null and not coalesce(public.can_read_section('marketing'), false) then
    raise exception 'Sin permiso de Marketing' using errcode = '42501';
  end if;
  v_col := case p_marca when 'casa-tomas' then 'restaurante' else 'touza' end;

  -- Carta activa de la marca: featured primero. Sin precio.
  execute format($q$
    select coalesce(jsonb_agg(s.c order by s.ord), '[]'::jsonb) from (
      select jsonb_strip_nulls(jsonb_build_object(
               'id', p.id, 'nombre', p.nombre, 'categoria', p.categoria,
               'featured', coalesce(p.featured, false),
               'descripcion', nullif(left(coalesce(p.descripcion, ''), 160), ''),
               'tiene_foto', p.imagen_url is not null and p.imagen_url <> '',
               'alergenos_oficiales', p.alergenos_oficiales,
               'sin_gluten_disponible', coalesce(p.sin_gluten_disponible, false))) as c,
             row_number() over (order by coalesce(p.featured, false) desc, p.nombre) as ord
        from public."Platos" p
       where p.activado is true and p.%I is true and coalesce(p.nombre, '') <> ''
       order by coalesce(p.featured, false) desc, p.nombre
       limit 200) s
  $q$, v_col) into v_carta;

  -- Novedades y eventos activos que se solapan con el periodo (solo Casa Tomás:
  -- la tabla es de la web del restaurante).
  if p_marca = 'casa-tomas' and to_regclass('public.novedades') is not null then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', n.id, 'titulo', n.titulo, 'tipo', n.tipo,
             'descripcion', nullif(left(coalesce(n.descripcion, ''), 200), ''),
             'plato_id', n.plato_id, 'desde', n.fecha_inicio, 'hasta', n.fecha_fin)) order by n.fecha_inicio), '[]'::jsonb)
      into v_novedades
      from (select * from public.novedades x
             where x.activo is true and x.fecha_inicio <= p_hasta and (x.fecha_fin is null or x.fecha_fin >= p_desde)
             order by x.fecha_inicio limit 20) n;
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', f.id, 'titulo', f.titulo, 'ambito', f.ambito, 'desde', f.desde, 'hasta', f.hasta,
           'idea', f.idea, 'verificacion', f.verificacion))), '[]'::jsonb)
    into v_fechas
    from (select * from public.marketing_fechas_entre(p_desde, p_hasta, p_marca) limit 40) f;

  -- Fotos de la biblioteca (Drive) con tipo y descripción.
  if to_regclass('public.instagram_fotos') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('id', 'drive:' || f.drive_id, 'tipo', f.tipo,
               'descripcion', left(coalesce(f.descripcion, ''), 120))), '[]'::jsonb)
        from (select * from public.instagram_fotos x
               where x.marca = $1 and x.drive_id is not null
               order by x.created_at desc limit 60) f
    $q$ into v_fotos using p_marca;
    v_join_fotos := $j$left join public.instagram_fotos f on f.drive_id is not null and p.datos ->> 'foto' = 'drive:' || f.drive_id$j$;
    v_tipo_foto := $t$case when p.datos ->> 'foto' like 'carta:%' then 'carta' else f.tipo end$t$;
  end if;

  -- Resumen de métricas de 90 días (solo publicaciones que salieron del panel:
  -- de las demás no se conoce plantilla ni foto).
  if to_regclass('public.instagram_metricas_publicacion_ultima') is not null then
    execute format($q$
      with pubs as (
        select m.alcance::numeric as alcance,
               coalesce(m.interacciones, coalesce(m.me_gusta, 0) + coalesce(m.comentarios, 0)
                        + coalesce(m.guardados, 0) + coalesce(m.compartidos, 0))::numeric as inter,
               coalesce(m.guardados, 0)::numeric as guardados,
               p.formato, p.plantilla, %s as tipo_foto,
               (m.publicado_at at time zone 'Europe/Madrid') as local
          from public.instagram_metricas_publicacion_ultima m
          join public.instagram_piezas p on p.id = m.pieza_id
          %s
         where p.marca = $1 and m.publicado_at >= now() - interval '90 days'
      ),
      g as (
        select 'formato' as eje, formato as clave, alcance, inter, guardados from pubs
        union all select 'plantilla', plantilla, alcance, inter, guardados from pubs
        union all select 'tipo_foto', tipo_foto, alcance, inter, guardados from pubs where tipo_foto is not null
        union all select 'dia', (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow from local)::int],
                         alcance, inter, guardados from pubs
        union all select 'franja', lpad((extract(hour from local)::int / 2 * 2)::text, 2, '0') || ':00-'
                         || lpad((extract(hour from local)::int / 2 * 2 + 2)::text, 2, '0') || ':00',
                         alcance, inter, guardados from pubs
      ),
      r as (
        select eje, clave, count(*) as n,
               round(avg(alcance)) as alcance_medio,
               case when sum(alcance) filter (where alcance > 0) > 0
                    then round(100 * sum(inter) filter (where alcance > 0) / sum(alcance) filter (where alcance > 0), 1) end as tasa,
               case when sum(alcance) filter (where alcance > 0) > 0
                    then round(100 * sum(guardados) filter (where alcance > 0) / sum(alcance) filter (where alcance > 0), 2) end as guardados_por_alcance
          from g group by eje, clave
      )
      select case when (select count(*) from pubs) = 0 then null else jsonb_build_object(
        'publicaciones', (select count(*) from pubs),
        'periodo_dias', 90,
        'nota', 'tasa = interacciones / alcance (%%); guardados_por_alcance en %%',
        'por', (select jsonb_object_agg(eje, grupos) from (
                  select eje, jsonb_agg(jsonb_strip_nulls(jsonb_build_object('clave', clave, 'publicaciones', n,
                           'alcance_medio', alcance_medio, 'tasa', tasa, 'guardados_por_alcance', guardados_por_alcance))
                           order by tasa desc nulls last, n desc) as grupos
                    from r group by eje) e)) end
    $q$, v_tipo_foto, v_join_fotos) into v_metricas using p_marca;
  end if;

  -- Historial: ganchos (primera línea del texto) de las últimas piezas de la
  -- marca, para que la IA no se repita.
  select coalesce(jsonb_agg(jsonb_build_object('plantilla', h.plantilla, 'formato', h.formato,
           'gancho', h.gancho) order by h.created_at desc), '[]'::jsonb)
    into v_historial
    from (select x.plantilla, x.formato, x.created_at, left(split_part(btrim(x.caption), E'\n', 1), 120) as gancho
            from public.instagram_piezas x
           where x.marca = p_marca and coalesce(btrim(x.caption), '') <> '' and x.estado <> 'borrador'
           order by x.created_at desc limit 15) h;

  return jsonb_build_object(
    'marca', p_marca,
    'desde', p_desde,
    'hasta', p_hasta,
    'hoy', (now() at time zone 'Europe/Madrid')::date,
    'carta', coalesce(v_carta, '[]'::jsonb),
    'novedades', coalesce(v_novedades, '[]'::jsonb),
    'fechas', coalesce(v_fechas, '[]'::jsonb),
    'fotos', coalesce(v_fotos, '[]'::jsonb),
    'metricas', v_metricas,
    'historial', coalesce(v_historial, '[]'::jsonb));
end;
$$;
revoke all on function public.instagram_ia_contexto(text, date, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_ia_contexto(text, date, date) from anon';
    execute 'grant execute on function public.instagram_ia_contexto(text, date, date) to authenticated, service_role';
  end if;
end;
$$;

-- Marketing con edición y sesión de panel viva (mismo criterio que la RLS).
create or replace function public.instagram_campanas_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_write_section('marketing'), false) then
    raise exception 'Sin permiso de Marketing' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;
revoke all on function public.instagram_campanas_permiso() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_campanas_permiso() from anon, authenticated';
  end if;
end;
$$;

-- Acepta una campaña: crea como BORRADORES las piezas elegidas (índices de
-- propuesta->'piezas', empezando en 0; null = todas). Vuelve a validar cada
-- pieza (no se fía del JSON guardado). NUNCA programa ni publica.
create or replace function public.instagram_aceptar_campana(p_campana_id uuid, p_piezas integer[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_campanas;
  v_piezas jsonb;
  v_total int;
  v_indices int[];
  v_i int;
  p jsonb;
  v_fecha date;
  v_hora text;
  v_formato text;
  v_plantilla text;
  v_foto text;
  v_titular text;
  v_antetitulo text;
  v_caption text;
  v_hashtags text;
  v_alt text;
  v_para timestamptz;
  v_id uuid;
  v_creadas jsonb := '[]'::jsonb;
  v_prefijo text;
begin
  perform public.instagram_campanas_permiso();
  select * into v from public.instagram_campanas where id = p_campana_id for update;
  if not found then
    raise exception 'La campaña no existe' using errcode = 'P0002';
  end if;
  if v.estado <> 'propuesta' then
    raise exception 'Esta campaña ya está %: no se puede volver a aceptar', v.estado using errcode = '22023';
  end if;
  if v.hasta < (now() at time zone 'Europe/Madrid')::date then
    raise exception 'La campaña ya ha terminado (%): pide otra', v.hasta using errcode = '22023';
  end if;
  v_piezas := coalesce(v.propuesta -> 'piezas', '[]'::jsonb);
  if jsonb_typeof(v_piezas) <> 'array' then
    raise exception 'La propuesta no tiene piezas' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(v_piezas);
  if p_piezas is null then
    select coalesce(array_agg(g), '{}') into v_indices from generate_series(0, v_total - 1) g;
  else
    select coalesce(array_agg(distinct x order by x), '{}') into v_indices from unnest(p_piezas) x;
  end if;
  if cardinality(v_indices) = 0 then
    raise exception 'Elige al menos una pieza' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_indices) x where x is null or x < 0 or x >= v_total) then
    raise exception 'Pieza fuera de la campaña (hay %)', v_total using errcode = '22023';
  end if;
  v_prefijo := case v.marca when 'casa-tomas' then 'ct-' else 'tz-' end;

  foreach v_i in array v_indices loop
    p := v_piezas -> v_i;
    if jsonb_typeof(p) <> 'object' then
      raise exception 'La pieza % no es válida', v_i + 1 using errcode = '22023';
    end if;
    begin
      v_fecha := (p ->> 'fecha')::date;
    exception when others then
      raise exception 'La pieza % no tiene una fecha válida', v_i + 1 using errcode = '22023';
    end;
    if v_fecha is null or v_fecha < v.desde or v_fecha > v.hasta then
      raise exception 'La pieza % cae fuera de la campaña', v_i + 1 using errcode = '22023';
    end if;
    v_hora := coalesce(nullif(p ->> 'hora', ''), '13:00');
    if v_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'La pieza % no tiene una hora válida', v_i + 1 using errcode = '22023';
    end if;
    v_formato := p ->> 'formato';
    if v_formato is null or v_formato not in ('post', 'story') then
      raise exception 'La pieza % no tiene un formato válido', v_i + 1 using errcode = '22023';
    end if;
    v_plantilla := p ->> 'plantilla';
    if v_plantilla is null or v_plantilla !~ '^[a-z0-9][a-z0-9-]{0,79}$' or left(v_plantilla, 3) <> v_prefijo then
      raise exception 'La pieza % no tiene una plantilla de la marca', v_i + 1 using errcode = '22023';
    end if;
    v_foto := nullif(p ->> 'foto', '');
    if coalesce((p ->> 'faltaFoto')::boolean, false) then
      v_foto := null;
    end if;
    if v_foto is not null and v_foto !~ '^(drive|carta):[A-Za-z0-9_-]{1,200}$' then
      raise exception 'La pieza % tiene una foto no válida', v_i + 1 using errcode = '22023';
    end if;
    v_titular := nullif(btrim(coalesce(p ->> 'titular', '')), '');
    v_antetitulo := nullif(btrim(coalesce(p ->> 'antetitulo', '')), '');
    if coalesce(char_length(v_titular), 0) > 100 or coalesce(char_length(v_antetitulo), 0) > 100 then
      raise exception 'La pieza % tiene rótulos demasiado largos', v_i + 1 using errcode = '22023';
    end if;
    v_hashtags := (select string_agg(h, ' ') from jsonb_array_elements_text(
                     case when jsonb_typeof(p -> 'hashtags') = 'array' then p -> 'hashtags' else '[]'::jsonb end) h);
    v_caption := nullif(btrim(concat_ws(E'\n\n', nullif(btrim(coalesce(p ->> 'caption', '')), ''), v_hashtags)), '');
    if coalesce(char_length(v_caption), 0) > 2200 then
      raise exception 'El texto de la pieza % pasa de 2200 caracteres', v_i + 1 using errcode = '22023';
    end if;
    v_alt := nullif(left(btrim(coalesce(p ->> 'altText', '')), 1000), '');
    v_para := (v_fecha::text || ' ' || v_hora)::timestamp at time zone 'Europe/Madrid';

    insert into public.instagram_piezas (marca, plantilla, formato, datos, caption, alt_text, estado,
                                         fecha_prevista, campana_id, origen)
    values (v.marca, v_plantilla, v_formato,
            jsonb_strip_nulls(jsonb_build_object('marca', v.marca, 'plantilla', v_plantilla, 'formato', v_formato,
              'foto', v_foto, 'antetitulo', v_antetitulo, 'titular', v_titular)),
            v_caption, case when v_formato = 'post' then v_alt end, 'borrador', v_para, v.id, 'ia')
    returning id into v_id;
    v_creadas := v_creadas || jsonb_build_object('id', v_id, 'indice', v_i, 'fechaPrevista', v_para);
  end loop;

  update public.instagram_campanas
     set estado = 'aceptada', decidida_por = auth.uid(), decidida_at = now(),
         piezas_aceptadas = cardinality(v_indices)
   where id = v.id;
  if v.sugerencia_id is not null then
    update public.instagram_sugerencias_ia set aceptada = true where id = v.sugerencia_id;
  end if;
  return jsonb_build_object('ok', true, 'campanaId', v.id, 'piezas', v_creadas);
end;
$$;
revoke all on function public.instagram_aceptar_campana(uuid, integer[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_aceptar_campana(uuid, integer[]) from anon';
    execute 'grant execute on function public.instagram_aceptar_campana(uuid, integer[]) to authenticated';
  end if;
end;
$$;

create or replace function public.instagram_descartar_campana(p_campana_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_campanas;
begin
  perform public.instagram_campanas_permiso();
  select * into v from public.instagram_campanas where id = p_campana_id for update;
  if not found then
    raise exception 'La campaña no existe' using errcode = 'P0002';
  end if;
  if v.estado <> 'propuesta' then
    raise exception 'Esta campaña ya está %', v.estado using errcode = '22023';
  end if;
  update public.instagram_campanas
     set estado = 'descartada', decidida_por = auth.uid(), decidida_at = now()
   where id = v.id;
  return jsonb_build_object('ok', true, 'campanaId', v.id);
end;
$$;
revoke all on function public.instagram_descartar_campana(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_descartar_campana(uuid) from anon';
    execute 'grant execute on function public.instagram_descartar_campana(uuid) to authenticated';
  end if;
end;
$$;

-- ─── 8. Siembra de fechas (05/11/2026) ──────────────────────────────────────
-- Anuales con el año 2000. «verificada»: calendario fijo o calculado (Pascua
-- de 2027 = 28/03, cómputo gregoriano; Día de la Madre = primer domingo de
-- mayo). El resto «sin verificar»: fiestas locales cuya fecha cambia cada año
-- y temporadas de producto que dependen de la lonja y del proveedor.
insert into public.marketing_fechas (clave, titulo, ambito, marcas, desde, hasta, anual, idea, verificacion, fuente)
values
  -- Galicia
  ('galicia-entroido-2027', 'Entroido (carnaval gallego)', 'galicia', array['casa-tomas'],
   '2027-02-06', '2027-02-09', false, 'Filloas, orejas y cocido de Entroido: la mesa de carnaval en Galicia.', 'verificada',
   'Calculado: martes de carnaval = Pascua (28/03/2027) − 47 días'),
  ('galicia-letras-galegas', 'Día das Letras Galegas', 'galicia', array['casa-tomas', 'touza'],
   '2000-05-17', '2000-05-17', true, 'Guiño a la lengua: el lema en gallego como firma, sin traducir lo informativo.', 'verificada',
   'Fiesta oficial de Galicia, 17 de mayo'),
  ('galicia-san-xoan', 'Noite de San Xoán', 'galicia', array['casa-tomas', 'touza'],
   '2000-06-23', '2000-06-24', true, 'Sardinas, fuego y queimada; en Alicante coincide con las Fogueres.', 'verificada',
   'Víspera de San Juan, 23 de junio'),
  ('galicia-dia-de-galicia', 'Día de Galicia (Santiago)', 'galicia', array['casa-tomas', 'touza'],
   '2000-07-25', '2000-07-25', true, 'La casa gallega de Crevillent: producto, familia y morriña.', 'verificada',
   'Día Nacional de Galicia, 25 de julio'),
  ('galicia-festa-marisco-o-grove', 'Festa do Marisco de O Grove', 'galicia', array['casa-tomas'],
   '2000-10-01', '2000-10-12', true, 'El marisco gallego en su gran fiesta: lo que llega de las rías a la mesa.', 'sin verificar',
   'Primera quincena de octubre; la fecha exacta cambia cada año'),
  ('galicia-magosto', 'Magosto: castañas', 'galicia', array['casa-tomas', 'touza'],
   '2000-10-25', '2000-11-16', true, 'Castañas asadas y otoño gallego.', 'sin verificar',
   'Los magostos se celebran entre finales de octubre y mediados de noviembre'),
  ('galicia-san-martin', 'San Martín y la matanza', 'galicia', array['casa-tomas'],
   '2000-11-11', '2000-11-11', true, '«A cada cerdo le llega su San Martín»: cocido, cecina y lacón.', 'verificada',
   'San Martín, 11 de noviembre'),
  -- Temporada de producto gallego
  ('temporada-marisco-meses-r', 'Marisco: los meses con «r»', 'temporada', array['casa-tomas'],
   '2000-09-01', '2000-04-30', true, 'El marisco gallego está en su mejor momento de septiembre a abril.', 'sin verificar',
   'Dicho popular; depende de la lonja y del proveedor'),
  ('temporada-centolla-necora', 'Centolla y nécora', 'temporada', array['casa-tomas'],
   '2000-11-01', '2000-03-31', true, 'Centolla y nécora de invierno.', 'sin verificar',
   'Temporada habitual de invierno; depende de vedas y lonja'),
  ('temporada-percebe-navidad', 'Percebe de Navidad', 'temporada', array['casa-tomas'],
   '2000-12-01', '2000-12-31', true, 'El percebe, protagonista de las mesas de Navidad.', 'sin verificar',
   'Pico de demanda en diciembre; precio y disponibilidad variables'),
  ('temporada-lamprea', 'Lamprea', 'temporada', array['casa-tomas'],
   '2000-01-01', '2000-04-30', true, 'Producto gallego de invierno y primavera, solo si está en carta.', 'sin verificar',
   'Temporada habitual enero-abril; depende de la veda'),
  ('temporada-cocido-grelos', 'Cocido gallego y grelos', 'temporada', array['casa-tomas'],
   '2000-11-15', '2000-03-15', true, 'Platos de cuchara para el frío.', 'sin verificar',
   'Temporada de grelos en invierno'),
  ('temporada-pimientos-padron', 'Pimientos de Padrón', 'temporada', array['casa-tomas'],
   '2000-06-01', '2000-09-30', true, '«Uns pican e outros non»: el verano gallego.', 'sin verificar',
   'Temporada habitual de verano'),
  ('temporada-setas', 'Setas de otoño', 'temporada', array['casa-tomas'],
   '2000-10-01', '2000-11-30', true, 'Boletus, níscalos y rebozuelos, solo si están en carta.', 'sin verificar',
   'Depende de las lluvias del año'),
  ('temporada-castanas', 'Castañas', 'temporada', array['casa-tomas', 'touza'],
   '2000-10-15', '2000-12-15', true, 'La castaña en postres y en la barra.', 'sin verificar',
   'Temporada habitual de otoño'),
  -- Crevillent
  ('crevillent-semana-santa-2027', 'Semana Santa de Crevillent', 'crevillent', array['casa-tomas', 'touza'],
   '2027-03-21', '2027-03-28', false, 'La Semana Santa de Crevillent llena el pueblo: comidas de familia y visitantes.', 'verificada',
   'Calculado: Domingo de Ramos 21/03/2027 a Domingo de Resurrección 28/03/2027'),
  ('crevillent-fiestas-patronales', 'Fiestas patronales de Crevillent', 'crevillent', array['casa-tomas', 'touza'],
   '2000-08-01', '2000-08-10', true, 'Fiestas del pueblo: la casa abierta a quien viene de fuera.', 'sin verificar',
   'Fecha aproximada; el dueño confirma el programa de cada año'),
  ('crevillent-moros-cristianos', 'Moros y Cristianos de Crevillent', 'crevillent', array['casa-tomas', 'touza'],
   '2000-10-01', '2000-10-10', true, 'Desfiles y comparsas: comidas de grupo y celebración.', 'sin verificar',
   'Primeros días de octubre; la fecha exacta cambia cada año'),
  -- Alicante y Comunitat Valenciana
  ('alicante-fogueres', 'Fogueres de Sant Joan (Alicante)', 'alicante', array['casa-tomas', 'touza'],
   '2000-06-20', '2000-06-24', true, 'Semana de hogueras en la provincia; se cruza con San Xoán.', 'sin verificar',
   'Del 20 al 24 de junio según el programa de cada año'),
  ('alicante-dia-comunitat', 'Día de la Comunitat Valenciana', 'alicante', array['casa-tomas', 'touza'],
   '2000-10-09', '2000-10-09', true, 'Festivo autonómico: comida de familia.', 'verificada',
   '9 de octubre, festivo autonómico'),
  -- Comerciales
  ('comercial-reyes', 'Reyes', 'comercial', array['casa-tomas', 'touza'],
   '2000-01-05', '2000-01-06', true, 'Último regalo de las fiestas: una experiencia.', 'verificada', '5 y 6 de enero'),
  ('comercial-san-valentin', 'San Valentín', 'comercial', array['casa-tomas', 'touza'],
   '2000-02-14', '2000-02-14', true, 'Cena para dos; en TOUZA, la noche empieza en la barra.', 'verificada', '14 de febrero'),
  ('comercial-dia-del-padre', 'Día del Padre', 'comercial', array['casa-tomas'],
   '2000-03-19', '2000-03-19', true, 'Comida en familia; regala una experiencia.', 'verificada', '19 de marzo (San José)'),
  ('comercial-dia-de-la-madre-2027', 'Día de la Madre', 'comercial', array['casa-tomas'],
   '2027-05-02', '2027-05-02', false, 'Comida de domingo en familia.', 'verificada',
   'Primer domingo de mayo: 02/05/2027'),
  ('comercial-comidas-empresa', 'Comidas y cenas de empresa', 'comercial', array['casa-tomas', 'touza'],
   '2000-11-15', '2000-12-23', true, 'Grupos de fin de año; en TOUZA, la copa de después.', 'sin verificar',
   'Temporada habitual; no es una fecha fija'),
  ('comercial-regalo-experiencia', 'Regalar una experiencia', 'comercial', array['casa-tomas', 'touza'],
   '2000-12-01', '2000-01-06', true, 'Cheque regalo como regalo de Navidad y Reyes.', 'sin verificar',
   'Campaña propia de Navidad'),
  ('comercial-navidad', 'Nochebuena y Navidad', 'comercial', array['casa-tomas', 'touza'],
   '2000-12-24', '2000-12-25', true, 'La mesa de Navidad: producto gallego y familia.', 'verificada', '24 y 25 de diciembre'),
  ('comercial-nochevieja', 'Nochevieja', 'comercial', array['casa-tomas', 'touza'],
   '2000-12-31', '2000-12-31', true, 'Despedir el año; en TOUZA, el brindis.', 'verificada', '31 de diciembre')
on conflict (clave) do nothing;

-- ─── 9. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_tabla text;
begin
  foreach v_tabla in array array['marketing_fechas', 'instagram_campanas'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', v_tabla)::regclass) then
      v_malos := v_malos || format('RLS apagada en %s', v_tabla);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_table_privilege('anon', format('public.%I', v_tabla), 'SELECT')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'INSERT')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'UPDATE')
         or has_table_privilege('anon', format('public.%I', v_tabla), 'DELETE') then
        v_malos := v_malos || format('anon tiene acceso a %s', v_tabla);
      end if;
      if has_table_privilege('authenticated', format('public.%I', v_tabla), 'DELETE')
         or has_table_privilege('authenticated', format('public.%I', v_tabla), 'TRUNCATE') then
        v_malos := v_malos || format('authenticated puede borrar en %s', v_tabla);
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('authenticated', 'public.instagram_campanas', 'UPDATE') then
    v_malos := v_malos || 'authenticated puede cambiar campañas sin RPC'::text;
  end if;
  if (select count(*) from public.marketing_fechas) < 20 then
    v_malos := v_malos || 'faltan las fechas sembradas'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_campanas: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_campanas: aplicada';
end;
$$;

commit;
