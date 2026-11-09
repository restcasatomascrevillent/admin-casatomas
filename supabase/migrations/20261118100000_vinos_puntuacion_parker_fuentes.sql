set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261118100000_vinos_puntuacion_parker_fuentes — Puntuaciones Parker con
-- fuente, por añada, y solo las verificadas en la web (08/11/2026)
-- ===========================================================================
-- Petición del dueño (08/11/2026): revisar las puntuaciones Parker de la carta,
-- completar las que falten y que la foto de la etiqueta también la busque.
-- Reglas: la puntuación tiene que ser del vino y la añada EXACTOS, con su
-- fuente; los intervalos no se convierten en una cifra; las provisionales se
-- distinguen; en la carta pública solo salen las verificadas y aplicables a la
-- añada que se sirve.
--
-- QUÉ AÑADE
--   "Vinos".anada            smallint NULL — añada que se sirve (la de la
--                            botella de la carta). NULL = no se sabe.
--   "Vinos".sin_anada        boolean NOT NULL DEFAULT false — vino sin añada
--                            (champagne NV…). Con true, anada es NULL.
--   "Vinos".puntuacion_parker_texto  text NULL — la puntuación tal y como se
--                            enseña en la web: «94», «94+», «93–95».
--   vinos_puntuacion_parker  — una fila por (vino, añada) con el resultado de
--                            la búsqueda o la revisión: estado, puntos (con
--                            intervalo), entidad, crítico, fecha de la
--                            valoración, fuente (nombre, URL, original o
--                            secundaria, cita), fecha de consulta, motivo si no
--                            se pudo verificar y fuentes contradictorias.
--
-- ESTADOS (columna estado)
--   verificada     puntuación de RP/WA del vino y la añada exactos, con fuente.
--   revision       dato pendiente de revisión (una sola fuente dudosa, fuentes
--                  contradictorias, o resultado de la búsqueda sin confirmar).
--   no_localizada  no se pudo verificar; motivo obligatorio:
--                  anada_desconocida · referencia_ambigua · fuente_inaccesible
--                  · no_localizada · fuentes_contradictorias. «No localizada»
--                  no quiere decir que el vino no tenga puntuación.
--   pendiente      búsqueda por hacer.
--   fallida        la búsqueda falló (red, IA…); se puede repetir.
--
-- LO QUE VE LA WEB (anon) NO CAMBIA DE SITIO: "Vinos".puntuacion_parker,
-- puntuacion_parker_anada y, nuevo, puntuacion_parker_texto. Ahora los calcula
-- la base de datos (trigger vinos_parker_publicado) a partir de la fila
-- VERIFICADA y NO provisional de la añada que se sirve (o la fila sin añada si
-- el vino es NV). Sin esa fila quedan a NULL: la web no pinta el icono (nunca
-- un cero). Lo que se escriba a mano en esas tres columnas se ignora.
--
-- Al aplicar, se recalculan las tres columnas de TODOS los vinos: como la
-- tabla nace vacía, se quedan a NULL hasta aplicar los datos de la revisión
-- (20261118110000_vinos_puntuacion_parker_revision_datos). Aplicar las dos
-- seguidas.
--
-- Permisos: la tabla nueva no la ve anon. Leen quienes ven la carta
-- (can_read_section('gestor_carta')); escriben quienes la editan
-- (can_edit_section('gestor_carta')), igual que "Vinos".
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «vinos_puntuacion_parker_fuentes:
-- aplicada».
-- Deshacer: supabase/rollbacks/20261118100000_vinos_puntuacion_parker_fuentes_ROLLBACK.sql
-- Pruebas: npm run test:vinos-parker:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public."Vinos"') is null then
    v_faltan := v_faltan || 'la tabla "Vinos"'::text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'Vinos' and column_name = 'puntuacion_parker') then
    v_faltan := v_faltan || 'la columna "Vinos".puntuacion_parker (aplica antes 20261104140000_vinos_copeo_y_parker)'::text;
  end if;
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regprocedure('public.can_edit_section(text)') is null then
    v_faltan := v_faltan || 'public.can_edit_section(text)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'vinos_puntuacion_parker_fuentes: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── "Vinos": añada que se sirve y texto público de la puntuación ──────────
alter table public."Vinos"
  add column if not exists anada smallint,
  add column if not exists sin_anada boolean not null default false,
  add column if not exists puntuacion_parker_texto text;

comment on column public."Vinos".anada is
  'Añada que se sirve (la de la botella de la carta). NULL = no se sabe: la web no enseña la puntuación Parker (08/11/2026).';
comment on column public."Vinos".sin_anada is
  'Vino sin añada (champagne NV…). Con true, anada es NULL y vale la puntuación «sin añada» de la edición/saca del nombre.';
comment on column public."Vinos".puntuacion_parker is
  'Puntos Parker que enseña la web (el mínimo si es un intervalo). Lo calcula el trigger vinos_parker_publicado desde vinos_puntuacion_parker: solo verificadas, definitivas y de la añada que se sirve. No escribir a mano.';
comment on column public."Vinos".puntuacion_parker_anada is
  'Añada de la puntuación que enseña la web (NULL si el vino es NV). La calcula el trigger vinos_parker_publicado.';
comment on column public."Vinos".puntuacion_parker_texto is
  'Puntuación Parker tal y como la enseña la web: «94», «94+» o «93–95». La calcula el trigger vinos_parker_publicado.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_anada_valida') then
    alter table public."Vinos" add constraint vinos_anada_valida
      check (anada is null or anada between 1900 and 2100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_sin_anada_sin_ano') then
    alter table public."Vinos" add constraint vinos_sin_anada_sin_ano
      check (not (sin_anada and anada is not null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_parker_texto_valido') then
    alter table public."Vinos" add constraint vinos_parker_texto_valido
      check (puntuacion_parker_texto is null or puntuacion_parker_texto ~ '^[0-9]{2,3}(\+|–[0-9]{2,3})?$') not valid;
  end if;
end;
$$;
alter table public."Vinos" validate constraint vinos_anada_valida;
alter table public."Vinos" validate constraint vinos_sin_anada_sin_ano;
alter table public."Vinos" validate constraint vinos_parker_texto_valido;

-- ─── Tabla de puntuaciones con fuente ──────────────────────────────────────
create table if not exists public.vinos_puntuacion_parker (
  id               uuid primary key default gen_random_uuid(),
  vino_id          text not null references public."Vinos" (id) on delete cascade,
  anada            smallint,
  sin_anada        boolean not null default false,
  -- Una fila por vino y añada: la añada, 0 si es la del vino sin añada (NV) y
  -- -1 si es la fila «añada desconocida» de la revisión.
  clave_anada      smallint generated always as (coalesce(anada, case when sin_anada then 0 else -1 end)) stored,
  estado           text not null,
  motivo           text,
  puntos_texto     text,
  puntos_min       smallint,
  puntos_max       smallint,
  provisional      boolean not null default false,
  vino_evaluado    text,
  entidad          text not null default 'Robert Parker Wine Advocate',
  critico          text,
  fecha_valoracion text,
  fuente_nombre    text,
  fuente_url       text,
  fuente_tipo      text,
  cita             text,
  fecha_consulta   date,
  discrepancias    jsonb not null default '[]'::jsonb,
  notas            text,
  origen           text not null default 'manual',
  actualizado_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vinos_puntuacion_parker_vino_anada_key unique (vino_id, clave_anada),
  constraint vinos_puntuacion_parker_estado_chk check (estado in ('verificada', 'revision', 'no_localizada', 'pendiente', 'fallida')),
  constraint vinos_puntuacion_parker_motivo_chk check (motivo is null or motivo in
    ('anada_desconocida', 'referencia_ambigua', 'fuente_inaccesible', 'no_localizada', 'fuentes_contradictorias', 'busqueda_fallida')),
  constraint vinos_puntuacion_parker_anada_chk check (anada is null or anada between 1900 and 2100),
  constraint vinos_puntuacion_parker_nv_chk check (not (sin_anada and anada is not null)),
  constraint vinos_puntuacion_parker_puntos_chk check (
    (puntos_min is null and puntos_max is null)
    or (puntos_min between 50 and 100 and puntos_max between puntos_min and 100)),
  constraint vinos_puntuacion_parker_texto_chk check (
    puntos_texto is null or (char_length(puntos_texto) <= 16 and puntos_texto ~ '^\(?[0-9]{2,3}\+?([-–][0-9]{2,3}\+?)?\)?$')),
  -- Solo Robert Parker / The Wine Advocate: ni Peñín, ni Suckling, ni Decanter…
  constraint vinos_puntuacion_parker_entidad_chk check (
    char_length(entidad) <= 120 and entidad ~* '(parker|wine advocate)'
    and entidad !~* '(pe[ñn]in|suckling|decanter|vivino|spectator|vinous|galloni|atkin|enthusiast|falstaff)'),
  constraint vinos_puntuacion_parker_fuente_tipo_chk check (fuente_tipo is null or fuente_tipo in ('original', 'secundaria', 'manual')),
  constraint vinos_puntuacion_parker_url_chk check (fuente_url is null or (fuente_url ~ '^https?://[^\s]+$' and char_length(fuente_url) <= 1000)),
  constraint vinos_puntuacion_parker_origen_chk check (origen in ('revision', 'foto', 'busqueda', 'manual')),
  constraint vinos_puntuacion_parker_textos_chk check (
    coalesce(char_length(vino_evaluado), 0) <= 300 and coalesce(char_length(critico), 0) <= 120
    and coalesce(char_length(fecha_valoracion), 0) <= 40 and coalesce(char_length(fuente_nombre), 0) <= 200
    and coalesce(char_length(cita), 0) <= 600 and coalesce(char_length(notas), 0) <= 2000),
  constraint vinos_puntuacion_parker_discrepancias_chk check (jsonb_typeof(discrepancias) = 'array'),
  -- Verificada = puntos + fuente con URL + fecha de consulta + añada concreta (o NV).
  constraint vinos_puntuacion_parker_verificada_chk check (
    estado <> 'verificada' or (puntos_min is not null and fuente_url is not null and fuente_nombre is not null
                               and fecha_consulta is not null and (anada is not null or sin_anada))),
  -- No localizada: siempre con motivo y sin puntos.
  constraint vinos_puntuacion_parker_no_localizada_chk check (
    estado <> 'no_localizada' or (motivo is not null and puntos_min is null)),
  constraint vinos_puntuacion_parker_sin_puntos_chk check (estado not in ('pendiente', 'fallida') or puntos_min is null)
);

comment on table public.vinos_puntuacion_parker is
  'Puntuación Robert Parker / The Wine Advocate de cada vino por añada, con su fuente y estado (verificada, revision, '
  'no_localizada, pendiente, fallida). La web no la lee: usa "Vinos".puntuacion_parker*, que calcula el trigger '
  'vinos_parker_publicado solo con la fila verificada y definitiva de la añada que se sirve. 08/11/2026.';
comment on column public.vinos_puntuacion_parker.anada is 'Añada evaluada. NULL con sin_anada = vino NV; NULL sin sin_anada = fila «añada desconocida» de la revisión.';
comment on column public.vinos_puntuacion_parker.puntos_texto is 'La puntuación como la publica la fuente: «94», «94+», «(93-95)».';
comment on column public.vinos_puntuacion_parker.puntos_min is 'Puntos (el bajo si es un intervalo).';
comment on column public.vinos_puntuacion_parker.puntos_max is 'Puntos (el alto si es un intervalo; igual que puntos_min si es una cifra).';
comment on column public.vinos_puntuacion_parker.provisional is 'Valoración provisional (muestra de barrica / en primeur) según la fuente. No se publica en la web.';
comment on column public.vinos_puntuacion_parker.vino_evaluado is 'Vino y añada como los nombra la fuente.';
comment on column public.vinos_puntuacion_parker.fuente_tipo is 'original (robertparker.com) · secundaria (bodega, Wine-Searcher, tienda que la atribuye) · manual (la puso el dueño).';
comment on column public.vinos_puntuacion_parker.cita is 'Texto literal de la fuente donde se ve la puntuación atribuida a RP/WA.';
comment on column public.vinos_puntuacion_parker.fecha_consulta is 'Día en que se consultó la fuente.';
comment on column public.vinos_puntuacion_parker.fecha_valoracion is 'Fecha de la valoración si la fuente la da (AAAA-MM-DD, AAAA-MM o AAAA).';
comment on column public.vinos_puntuacion_parker.discrepancias is 'Otras fuentes con datos distintos: [{fuente_nombre, fuente_url, puntos_texto, nota}].';
comment on column public.vinos_puntuacion_parker.origen is 'revision (revisión del catálogo) · foto (lectura de la etiqueta) · busqueda (botón «Buscar» del panel) · manual.';
comment on column public.vinos_puntuacion_parker.actualizado_por is 'Quién la tocó la última vez: lo pone la base de datos (auth.uid()), no el cliente.';

create index if not exists vinos_puntuacion_parker_estado_idx on public.vinos_puntuacion_parker (estado);

-- Fecha de alta/cambio y autor los pone la base de datos; la fila no cambia de vino.
create or replace function public.vinos_puntuacion_parker_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.actualizado_por := coalesce(auth.uid(), new.actualizado_por);
  else
    new.id := old.id;
    new.vino_id := old.vino_id;
    new.created_at := old.created_at;
    new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Lo que la web puede enseñar para un vino: la fila verificada y definitiva de
-- la añada que se sirve (o la sin añada si el vino es NV). Sin ella, NULL.
create or replace function public.vinos_parker_calculado(p_vino text, p_anada smallint, p_sin_anada boolean,
  out puntos smallint, out anada smallint, out texto text)
language sql
stable
set search_path = ''
as $$
  select p.puntos_min,
         p.anada,
         case
           when p.puntos_max > p.puntos_min then p.puntos_min::text || '–' || p.puntos_max::text
           when p.puntos_texto like '%+%' then p.puntos_min::text || '+'
           else p.puntos_min::text
         end
    from public.vinos_puntuacion_parker p
   where p.vino_id = p_vino
     and p.estado = 'verificada'
     and not p.provisional
     and ((p_anada is not null and p.anada = p_anada)
          or (p_anada is null and coalesce(p_sin_anada, false) and p.sin_anada and p.anada is null))
   limit 1
$$;

-- "Vinos": las tres columnas públicas se calculan siempre (lo escrito a mano se ignora).
create or replace function public.vinos_parker_publicado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.vinos_parker_calculado(new.id, new.anada, new.sin_anada);
  new.puntuacion_parker := c.puntos;
  new.puntuacion_parker_anada := c.anada;
  new.puntuacion_parker_texto := c.texto;
  return new;
end;
$$;

-- Al cambiar una puntuación, recalcula su vino (solo si cambia lo publicado:
-- así no se generan cambios vacíos en "Vinos" ni en la auditoría).
create or replace function public.vinos_puntuacion_parker_refrescar_vino()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vino text;
begin
  for v_vino in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.vino_id end,
      case when tg_op <> 'DELETE' then new.vino_id end]) as x
     where x is not null
  loop
    update public."Vinos" v
       set puntuacion_parker = c.puntos,
           puntuacion_parker_anada = c.anada,
           puntuacion_parker_texto = c.texto
      from public.vinos_parker_calculado(v_vino,
             (select w.anada from public."Vinos" w where w.id = v_vino),
             (select w.sin_anada from public."Vinos" w where w.id = v_vino)) as c
     where v.id = v_vino
       and (v.puntuacion_parker, v.puntuacion_parker_anada, v.puntuacion_parker_texto)
           is distinct from (c.puntos, c.anada, c.texto);
  end loop;
  return null;
end;
$$;

do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.vinos_puntuacion_parker_al_editar()',
    'public.vinos_parker_calculado(text, smallint, boolean)',
    'public.vinos_parker_publicado()',
    'public.vinos_puntuacion_parker_refrescar_vino()'
  ] loop
    execute format('revoke all on function %s from public', v_f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', v_f);
    end if;
  end loop;
end;
$$;

drop trigger if exists vinos_puntuacion_parker_al_editar on public.vinos_puntuacion_parker;
create trigger vinos_puntuacion_parker_al_editar
  before insert or update on public.vinos_puntuacion_parker
  for each row execute function public.vinos_puntuacion_parker_al_editar();

drop trigger if exists vinos_puntuacion_parker_refrescar_vino on public.vinos_puntuacion_parker;
create trigger vinos_puntuacion_parker_refrescar_vino
  after insert or update or delete on public.vinos_puntuacion_parker
  for each row execute function public.vinos_puntuacion_parker_refrescar_vino();

drop trigger if exists trg_vinos_parker_publicado on public."Vinos";
create trigger trg_vinos_parker_publicado
  before insert or update on public."Vinos"
  for each row execute function public.vinos_parker_publicado();

-- Auditoría, como el resto de tablas (si existe la función).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.vinos_puntuacion_parker'::regclass
                        and tgfoid = to_regprocedure('public.fn_registrar_auditoria()')
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.vinos_puntuacion_parker';
    execute 'create trigger trg_auditoria after insert or update or delete on public.vinos_puntuacion_parker
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- ─── Permisos ──────────────────────────────────────────────────────────────
alter table public.vinos_puntuacion_parker enable row level security;
revoke all on public.vinos_puntuacion_parker from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.vinos_puntuacion_parker from anon, authenticated';
    execute 'grant select, insert, update, delete on public.vinos_puntuacion_parker to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.vinos_puntuacion_parker to service_role';
  end if;
end;
$$;

drop policy if exists vinos_puntuacion_parker_select_seccion on public.vinos_puntuacion_parker;
create policy vinos_puntuacion_parker_select_seccion on public.vinos_puntuacion_parker
  for select to authenticated using ((select public.can_read_section('gestor_carta')));
drop policy if exists vinos_puntuacion_parker_insert_seccion on public.vinos_puntuacion_parker;
create policy vinos_puntuacion_parker_insert_seccion on public.vinos_puntuacion_parker
  for insert to authenticated with check ((select public.can_edit_section('gestor_carta')));
drop policy if exists vinos_puntuacion_parker_update_seccion on public.vinos_puntuacion_parker;
create policy vinos_puntuacion_parker_update_seccion on public.vinos_puntuacion_parker
  for update to authenticated
  using ((select public.can_edit_section('gestor_carta')))
  with check ((select public.can_edit_section('gestor_carta')));
drop policy if exists vinos_puntuacion_parker_delete_seccion on public.vinos_puntuacion_parker;
create policy vinos_puntuacion_parker_delete_seccion on public.vinos_puntuacion_parker
  for delete to authenticated using ((select public.can_edit_section('gestor_carta')));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'drop policy if exists vinos_puntuacion_parker_service_role on public.vinos_puntuacion_parker';
    execute 'create policy vinos_puntuacion_parker_service_role on public.vinos_puntuacion_parker
      for all to service_role using (true) with check (true)';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.vinos_puntuacion_parker';
    execute 'create policy "acceso_panel_no_bloqueado" on public.vinos_puntuacion_parker as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── Recalcular lo publicado de todos los vinos (la tabla nace vacía) ───────
update public."Vinos" v
   set puntuacion_parker = c.puntos,
       puntuacion_parker_anada = c.anada,
       puntuacion_parker_texto = c.texto
  from public."Vinos" w
  cross join lateral public.vinos_parker_calculado(w.id, w.anada, w.sin_anada) as c
 where v.id = w.id
   and (v.puntuacion_parker, v.puntuacion_parker_anada, v.puntuacion_parker_texto)
       is distinct from (c.puntos, c.anada, c.texto);

notify pgrst, 'reload schema';

do $$
declare
  v_malos text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.vinos_puntuacion_parker'::regclass) then
    v_malos := v_malos || 'RLS apagada'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vinos_puntuacion_parker'
        and policyname like 'vinos_puntuacion_parker_%_seccion') <> 4 then
    v_malos := v_malos || 'faltan políticas'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.vinos_puntuacion_parker', 'SELECT')
       or has_table_privilege('anon', 'public.vinos_puntuacion_parker', 'INSERT')
       or has_table_privilege('anon', 'public.vinos_puntuacion_parker', 'UPDATE')
       or has_table_privilege('anon', 'public.vinos_puntuacion_parker', 'DELETE') then
      v_malos := v_malos || 'anon tiene acceso'::text;
    end if;
    if has_table_privilege('authenticated', 'public.vinos_puntuacion_parker', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated tiene TRUNCATE'::text;
    end if;
  end if;
  if exists (select 1 from public."Vinos" w
               cross join lateral public.vinos_parker_calculado(w.id, w.anada, w.sin_anada) as c
              where (w.puntuacion_parker, w.puntuacion_parker_anada, w.puntuacion_parker_texto)
                    is distinct from (c.puntos, c.anada, c.texto)) then
    v_malos := v_malos || 'quedan puntuaciones publicadas sin fila verificada de la añada que se sirve'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'vinos_puntuacion_parker_fuentes: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'vinos_puntuacion_parker_fuentes: aplicada';
end;
$$;

commit;
