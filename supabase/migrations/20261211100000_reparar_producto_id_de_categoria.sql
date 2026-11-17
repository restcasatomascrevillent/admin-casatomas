set client_encoding = 'UTF8';
-- ============================================================================
-- 20261211100000_reparar_producto_id_de_categoria · Facturas (17/11/2026)
-- La clasificación con IA ponía en producto_id el id de la CATEGORÍA: la categoría Servicios tiene
-- id 11 y el producto 11 es «Mostaza de cerveza Rooftop 150 g», así que desde el 08/11/2026 la
-- mostaza recibió alquileres, luz, fontanería, bonificaciones de Riscal y promociones de Makro (en
-- producción, 191 textos y 252 líneas, 13.530 €). La función ya lo rechaza
-- (clasificar-productos/clasificacion.ts, productoSospechoso); esto limpia lo que entró:
--  · borra los alias de origen 'ia' que apuntan a un producto cuyo id coincide con el de una
--    categoría, son de otra familia que ese producto y no comparten ninguna palabra con su nombre;
--  · deja sin producto (producto_id NULL) las líneas de ese producto con esos textos: el cron
--    «clasificar-productos» las vuelve a clasificar, ya con la función corregida.
-- Antes se guarda todo en productos_reparacion_ia_20261117 para poder volver atrás.
-- ORDEN: desplegar antes la función clasificar-productos corregida (si no, el cron las vuelve a
-- meter en la mostaza).
-- Rollback: supabase/rollbacks/20261211100000_reparar_producto_id_de_categoria_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

create table if not exists public.productos_reparacion_ia_20261117 (
  tipo text not null check (tipo in ('alias', 'linea')),
  texto_normalizado text not null,
  producto_id bigint not null,
  linea_id bigint,
  alias_origen text,
  alias_created_at timestamptz,
  guardado_en timestamptz not null default now()
);
comment on table public.productos_reparacion_ia_20261117 is
  'Respaldo de 20261211100000_reparar_producto_id_de_categoria: alias y líneas que la IA había metido en un producto cuyo id es el de una categoría. Lo usa el rollback.';
alter table public.productos_reparacion_ia_20261117 enable row level security;
revoke all on public.productos_reparacion_ia_20261117 from public, anon, authenticated;
grant all on public.productos_reparacion_ia_20261117 to service_role;

do $$
declare
  v_alias int := 0;
  v_lineas int := 0;
begin
  create temp table _malos on commit drop as
  with prod as (
    -- Productos cuyo id coincide con el de una categoría, con las palabras de su nombre.
    select pc.id, pc.categoria_id,
           array(select w from regexp_split_to_table(translate(lower(pc.nombre), 'áéíóúüàèìòùñ', 'aeiouuaeioun'), '[^a-z0-9]+') w
                  where length(w) >= 3 and w !~ '^[0-9]+$') as palabras
      from public.productos_catalogo pc
     where pc.id in (select c.id from public.categorias_producto c)
  )
  select a.texto_normalizado, a.producto_id, a.origen, a.created_at
    from public.productos_alias a
    join prod on prod.id = a.producto_id
   where a.origen = 'ia'
     and a.created_at >= '2026-11-08'
     and not exists (
       select 1
         from regexp_split_to_table(translate(lower(a.texto_normalizado), 'áéíóúüàèìòùñ', 'aeiouuaeioun'), '[^a-z0-9]+') t
         cross join unnest(prod.palabras) p
        where length(t) >= 3 and t !~ '^[0-9]+$'
          and (p like t || '%' or t like p || '%'));

  insert into public.productos_reparacion_ia_20261117 (tipo, texto_normalizado, producto_id, alias_origen, alias_created_at)
  select 'alias', m.texto_normalizado, m.producto_id, m.origen, m.created_at from _malos m;
  get diagnostics v_alias = row_count;

  insert into public.productos_reparacion_ia_20261117 (tipo, texto_normalizado, producto_id, linea_id)
  select 'linea', pf.nombre_normalizado, pf.producto_id, pf.id
    from public.productos_factura pf
    join _malos m on m.producto_id = pf.producto_id and m.texto_normalizado = pf.nombre_normalizado;
  get diagnostics v_lineas = row_count;

  -- Primero los alias (así nada vuelve a asignar esas líneas por su texto) y luego las líneas.
  delete from public.productos_alias a
   using _malos m
   where a.texto_normalizado = m.texto_normalizado and a.producto_id = m.producto_id;

  update public.productos_factura pf
     set producto_id = null
    from _malos m
   where m.producto_id = pf.producto_id and m.texto_normalizado = pf.nombre_normalizado;

  raise notice '20261211100000: % alias borrados y % líneas sin producto (se reclasifican solas).', v_alias, v_lineas;
end;
$$;
