set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Orden de la carta como ENTERO en Platos y Vinos (2026-11-01)
-- ===========================================================================
--
-- PROBLEMA: el Gestor web › Carta ya permite ordenar los platos, bebidas,
-- vinos y cócteles de cada categoría y guarda en `orden` enteros consecutivos
-- desde 1 dentro de la categoría. En Bebidas y Cocteles la columna ya es
-- bigint, pero en Platos y Vinos es TEXT, y Postgres ordena texto
-- alfabéticamente: "10" < "2". Las webs piden `order=categoria.asc,orden.asc`
-- a PostgREST (carta-ssg.mjs, CartaPlatos, CartaVinos) y paginan con `range`,
-- así que a partir del 10.º plato de una categoría saldrían desordenados (y
-- ordenar en el navegador no sirve con paginación).
--
-- DECISIÓN: pasar `orden` a INTEGER en Platos y Vinos. Así el orden numérico
-- sale de la base de datos para todos (panel, SSG, webs, chatbot) sin tocar
-- ninguna consulta. El panel ya escribe números (PostgREST los guardaría como
-- texto mientras esta migración no esté aplicada) y ordena por número en
-- cliente, así que funciona antes y después de aplicarla.
--
-- DATOS (consultado el 2026-11-01, demo y producción iguales):
--   Platos 153 filas, todas '0' · Vinos 238 '0' + 6 NULL.
--   Bebidas (bigint, 1..30) y Cocteles (bigint, 1..13): no se tocan.
-- Si apareciera un valor que no es un entero, la migración ABORTA sin tocar
-- nada (no se pierde ningún dato convirtiéndolo en NULL). Una cadena vacía
-- pasa a NULL.
--
-- DEPENDENCIAS revisadas en el catálogo de producción (2026-11-01): ninguna
-- vista, índice, política RLS ni función SQL usa `orden` de Platos o Vinos.
-- Triggers: trg_auditoria (genérico, to_jsonb) y trg_vinos_exclusion_sulfitos
-- (no lee `orden`). Edge Functions de este repo: ninguna lee ni escribe
-- `orden` de la carta. web-casatomas: solo `.order('orden')` (PostgREST) y el
-- tipo `orden?: string | number | null`, que acepta el entero.
--
-- AUDITORÍA: los registros de audit_log anteriores guardan `"orden": "0"`
-- (texto); tras la migración la fila tiene `"orden": 0`. «Revertir cambio»
-- compara la fila actual con la de la auditoría, así que un cambio de la carta
-- ANTERIOR a esta migración se rechaza con «Hay cambios posteriores» (falla
-- sin escribir nada; no corrompe datos).
--
-- PASOS (NO APLICADA; la aplica el orquestador/dueño, primero en la demo):
--   1. Probar: supabase db query --linked -f supabase/tests/carta_orden_entero_test.sql
--      (BEGIN … ROLLBACK: no deja nada).
--   2. Aplicar: supabase db query --linked -f supabase/migrations/20261101090000_carta_orden_entero.sql
--   3. Deshacer: supabase/rollbacks/20261101090000_carta_orden_entero_ROLLBACK.sql
-- Se puede ejecutar más de una vez: si la columna ya es integer, no hace nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $migracion$
declare
  v_tabla text;
  v_tipo text;
  v_malos text;
begin
  foreach v_tabla in array array['Platos', 'Vinos'] loop
    select c.data_type into v_tipo
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_tabla and c.column_name = 'orden';

    if v_tipo is null then
      raise exception 'Abortado sin tocar nada: no existe public.%.orden', v_tabla;
    elsif v_tipo = 'integer' then
      raise notice 'public.%.orden ya es integer: nada que hacer', v_tabla;
      continue;
    elsif v_tipo not in ('text', 'character varying') then
      raise exception 'Abortado sin tocar nada: public.%.orden es % (se esperaba text)', v_tabla, v_tipo;
    end if;

    execute format(
      $q$select string_agg(format('%%s=%%L', id, orden), ', ')
           from (select id, orden from public.%I
                  where orden is not null and btrim(orden) <> '' and btrim(orden) !~ '^-?[0-9]{1,9}$'
                  limit 20) x$q$,
      v_tabla)
      into v_malos;
    if v_malos is not null then
      raise exception 'Abortado sin tocar nada: public.%.orden tiene valores que no son enteros (%)', v_tabla, v_malos;
    end if;

    execute format(
      'alter table public.%I alter column orden type integer using nullif(btrim(orden), '''')::integer',
      v_tabla);
    raise notice 'public.%.orden: text -> integer', v_tabla;
  end loop;
end
$migracion$;

comment on column public."Platos".orden is
  'Posición del plato dentro de su categoría: 1, 2, 3… (Gestor web › Carta › Ordenar). 0 = sin ordenar todavía.';
comment on column public."Vinos".orden is
  'Posición del vino dentro de su categoría: 1, 2, 3… (Gestor web › Carta › Ordenar). 0 o NULL = sin ordenar todavía.';

-- Que PostgREST vea el tipo nuevo sin esperar (Supabase también lo recarga solo tras un DDL).
notify pgrst, 'reload schema';

commit;
