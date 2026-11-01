set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261101090000_carta_orden_entero.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: devuelve `orden` de Platos y Vinos a TEXT con el mismo número en
-- texto (0 -> '0', 7 -> '7', NULL -> NULL). Antes de la migración todos los
-- valores eran '0' o NULL, así que vuelve exactamente al estado previo; los
-- órdenes que se hayan guardado después se conservan como texto ('1', '2'…),
-- y la web volvería a ordenarlos alfabéticamente ('10' antes que '2').
-- Si la columna ya es texto, no hace nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $rb$
declare
  v_tabla text;
  v_tipo text;
begin
  foreach v_tabla in array array['Platos', 'Vinos'] loop
    select c.data_type into v_tipo
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_tabla and c.column_name = 'orden';
    if v_tipo is null then
      raise exception 'Abortado sin tocar nada: no existe public.%.orden', v_tabla;
    elsif v_tipo in ('text', 'character varying') then
      raise notice 'public.%.orden ya es texto: nada que hacer', v_tabla;
      continue;
    end if;
    execute format('alter table public.%I alter column orden type text using orden::text', v_tabla);
    raise notice 'public.%.orden: % -> text', v_tabla, v_tipo;
  end loop;
end
$rb$;

comment on column public."Platos".orden is null;
comment on column public."Vinos".orden is null;

notify pgrst, 'reload schema';

commit;
