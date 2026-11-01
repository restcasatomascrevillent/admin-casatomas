set client_encoding = 'UTF8';
-- Prueba de 20261101090000_carta_orden_entero.sql: BEGIN … ROLLBACK, no deja nada.
-- Convierte Platos.orden y Vinos.orden a integer DENTRO de la transacción y
-- comprueba que se conservan los valores y que el orden ya es numérico.
begin;
set local lock_timeout = '5s';

create temporary table _antes on commit drop as
  select 'Platos'::text as tabla, id, orden::text as orden from public."Platos"
  union all
  select 'Vinos', id, orden::text from public."Vinos";

do $$
declare
  v_tabla text;
  v_tipo text;
begin
  foreach v_tabla in array array['Platos', 'Vinos'] loop
    select data_type into v_tipo from information_schema.columns
     where table_schema = 'public' and table_name = v_tabla and column_name = 'orden';
    if v_tipo in ('text', 'character varying') then
      execute format('alter table public.%I alter column orden type integer using nullif(btrim(orden), '''')::integer', v_tabla);
    end if;
  end loop;
end $$;

do $$
declare
  v_distintos int;
  v_tipos text;
  v_primero int;
begin
  select string_agg(table_name || '=' || data_type, ', ') into v_tipos
    from information_schema.columns
   where table_schema = 'public' and table_name in ('Platos', 'Vinos') and column_name = 'orden';
  if v_tipos <> 'Platos=integer, Vinos=integer' and v_tipos <> 'Vinos=integer, Platos=integer' then
    raise exception 'Tipos inesperados: %', v_tipos;
  end if;

  -- Ningún valor cambia (salvo '' -> NULL).
  select count(*) into v_distintos
    from _antes a
    left join public."Platos" p on a.tabla = 'Platos' and p.id = a.id
    left join public."Vinos" v on a.tabla = 'Vinos' and v.id = a.id
   where nullif(btrim(a.orden), '') is distinct from coalesce(p.orden, v.orden)::text;
  if v_distintos > 0 then
    raise exception '% valores de orden han cambiado al convertir', v_distintos;
  end if;

  -- El orden es numérico: 2 va antes que 10.
  update public."Platos" set orden = 10 where id = (select id from public."Platos" order by id limit 1);
  update public."Platos" set orden = 2 where id = (select id from public."Platos" order by id offset 1 limit 1);
  select orden into v_primero from public."Platos" where orden in (2, 10) order by orden limit 1;
  if v_primero <> 2 then
    raise exception 'El orden sigue sin ser numérico (primero: %)', v_primero;
  end if;

  raise notice 'OK: Platos.orden y Vinos.orden son integer, sin perder valores, y 2 < 10';
end $$;

rollback;
