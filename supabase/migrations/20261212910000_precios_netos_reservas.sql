set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212910000_precios_netos_reservas · Facturas (19/11/2026)
-- Reservas de la revisión independiente del PR #300 (facturas-conocimiento/revision-pr300-precios-netos-2026-11-19.md).
-- Se aplica ENCIMA de 20261212900000 (no la modifica: puede estar ya en producción).
--  R2  El chat daba el coste real (neto) sin decir que lo es: compras_producto, historial_precios y ranking enseñan,
--      cuando hay descuento, precio_impreso y descuento_pct (precio_impreso_linea_agente); buscar_productos* también;
--      como_leer / criterio dicen que el precio es el coste real con descuentos. La regla del prompt está en chat-facturas.
--  R4  consulta_flexible: la media de precio_unitario no cuenta las líneas con neto <= 0 (regalos, 100 % de descuento),
--      igual que el último precio; n_con_precio_unitario cuenta las mismas. Las unidades (sum_cantidad) sí cuentan.
--  R3  detalle_documento_agente: si una pasada doble de 20261212900000 dejó la clave 'importe_neto' duplicada, queda una.
--      Las sustituciones de texto de esta migración se saltan si el trozo nuevo ya está: reaplicable.
--  R6  productos_resumen devuelve es_descuento (líneas de descuento convertidas en «producto»: Descuento comercial…):
--      el panel las enseña aparte, sin precio unitario; el ranking del chat no las trata como producto. Ningún total cambia.
-- Rollback: supabase/rollbacks/20261212910000_precios_netos_reservas_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'descuento_general') then
    raise exception '20261212910000: falta 20261212900000_precios_netos_coherentes. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Precio impreso y descuento de una línea (R2) ───
-- NULL si la línea no tiene descuento (neto = impreso) o si no hay cantidad: así los datos solo llevan precio_impreso
-- cuando el precio que se da (neto) difiere del de la factura.
create or replace function public.precio_impreso_linea_agente(p_linea bigint)
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
  select jsonb_build_object(
           'precio_impreso', trim_scale(round(pf.total / pf.cantidad, case when abs(pf.total / pf.cantidad) < 1 then 4 else 2 end)),
           'descuento_pct',  trim_scale(round(100 * (1 - pf.importe_neto / pf.total), 1)))
    from public.productos_factura pf
   where pf.id = p_linea and pf.importe_neto is not null and pf.total > 0 and pf.cantidad > 0
     and pf.importe_neto >= 0 and pf.importe_neto < pf.total - 0.01;
$f$;
revoke all on function public.precio_impreso_linea_agente(bigint) from public, anon;
grant execute on function public.precio_impreso_linea_agente(bigint) to authenticated, service_role;
comment on function public.precio_impreso_linea_agente(bigint) is
  'Precio unitario impreso y % de descuento de una línea con descuento; NULL si no lo tiene (20261212910000).';

-- ─── 2. detalle_documento_agente en estado limpio (R3) ───
do $$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
  c_x constant text := $q$ 'importe_neto', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.importe_neto::numeric, 2) end,$q$;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detalle_documento_agente';
  if v_oid is null then
    return;
  end if;
  v_def := pg_get_functiondef(v_oid);
  v_nuevo := v_def;
  while position(c_x || c_x in v_nuevo) > 0 loop
    v_nuevo := replace(v_nuevo, c_x || c_x, c_x);
  end loop;
  if v_nuevo <> v_def then
    execute v_nuevo;
    raise notice '20261212910000: detalle_documento_agente tenía la clave importe_neto repetida; queda una.';
  end if;
end;
$$;

-- ─── 3. Sustituciones de texto en las funciones del chat (R2, R4, R6) ───
-- Cada trozo debe aparecer exactamente `veces` veces; si ya está el nuevo, se salta (reaplicable); si no aparece ni el
-- uno ni el otro, se aborta sin cambiar nada. Una función que no existe en la base se salta.
drop table if exists pg_temp._cambios;
create temp table _cambios (fn text, viejo text, nuevo text, veces int) on commit drop;
insert into _cambios (fn, viejo, nuevo, veces) values
  ('compras_producto_agente', $q$'precio_linea', case when e.coste is not null then trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)) end,$q$,
     $q$'precio_linea', case when e.coste is not null then trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)) end, 'precio_impreso', precio_impreso_linea_agente(x.id) -> 'precio_impreso', 'descuento_pct', precio_impreso_linea_agente(x.id) -> 'descuento_pct',$q$, 1),
  ('compras_producto_agente', $q$'precios', jsonb_agg(trim_scale(round(y.pu, case when y.pu < 1 then 4 else 2 end)) order by y.pu),$q$,
     $q$'precios', jsonb_agg(trim_scale(round(y.pu, case when y.pu < 1 then 4 else 2 end)) order by y.pu), 'precios_impreso', case when bool_or(precio_impreso_linea_agente(y.id) is not null) then jsonb_agg(precio_impreso_linea_agente(y.id) -> 'precio_impreso' order by y.pu) end,$q$, 1),
  ('compras_producto_agente', $q$(y precio_linea).' end$q$,
     $q$(y precio_linea). Precios = coste real con los descuentos; precio_impreso, descuento_pct y precios_impreso (en el orden de precios) = lo que dice la factura.' end$q$, 1),
  ('ranking_agente', $q$'importe',         round(total::numeric, 2),$q$,
     $q$'importe',         round(total::numeric, 2), 'precio_impreso', case when desde is null then precio_impreso_linea_agente(id) -> 'precio_impreso' end, 'descuento_pct', case when desde is null then precio_impreso_linea_agente(id) -> 'descuento_pct' end,$q$, 1),
  ('ranking_agente', $q$validas as (select * from l where valor is not null and valor > 0 and (v_uni is null or unidad = v_uni))$q$,
     $q$validas as (select * from l where valor is not null and valor > 0 and (v_uni is null or unidad = v_uni) and not es_linea_descuento(lower(nombre)))$q$, 1),
  ('ranking_agente', $q$'Precio unitario de linea SIN IVA'$q$,
     $q$'Precio unitario de linea SIN IVA y con descuentos (coste real; precio_impreso = el de la factura)'$q$, 1),
  ('ranking_agente', $q$'Importe de linea (cantidad x precio) SIN IVA'$q$,
     $q$'Importe de linea (cantidad x precio) SIN IVA y con descuentos aplicados'$q$, 1),
  ('consulta_flexible_agente', $q$v_expr := format('round(%s(%s)::numeric, 2)', v_func, v_col);$q$,
     $q$v_expr := format('round(%s(%s)::numeric, 2)', v_func, v_col); if v_func = 'avg' and v_col like 'coalesce(l.importe_neto / nullif(l.cantidad%' then v_expr := format('round(avg(%s) filter (where coalesce(l.importe_neto, l.total, 1) > 0)::numeric, 2)', v_col); end if;$q$, 1),
  ('consulta_flexible_agente', $q$v_sel := v_sel || format('count(%s) as %I', v_col, 'n_con_' || substr(k, 5));$q$,
     $q$v_sel := v_sel || case when v_func = 'avg' and v_col like 'coalesce(l.importe_neto / nullif(l.cantidad%' then format('count(%s) filter (where coalesce(l.importe_neto, l.total, 1) > 0) as %I', v_col, 'n_con_' || substr(k, 5)) else format('count(%s) as %I', v_col, 'n_con_' || substr(k, 5)) end;$q$, 1),
  ('consulta_flexible_agente', $q$'; precios e importes de linea SIN IVA'$q$,
     $q$'; precios e importes de linea SIN IVA y con descuentos (coste real, no el impreso); la media de precio_unitario no cuenta las lineas a 0 (regalos)'$q$, 1),
  ('buscar_productos_agente', $q$'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end,$q$,
     $q$'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end, 'precio_impreso', precio_impreso_linea_agente(pf.id) -> 'precio_impreso', 'descuento_pct', precio_impreso_linea_agente(pf.id) -> 'descuento_pct',$q$, 1),
  ('buscar_productos_texto_agente', $q$'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end,$q$,
     $q$'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end, 'precio_impreso', precio_impreso_linea_agente(pf.id) -> 'precio_impreso', 'descuento_pct', precio_impreso_linea_agente(pf.id) -> 'descuento_pct',$q$, 1),
  ('historial_precios_agente', $q$'precio_unitario', trim_scale(x.precio), 'convertido_desde', x.desde,$q$,
     $q$'precio_unitario', trim_scale(x.precio), 'convertido_desde', x.desde, 'precio_impreso', case when x.desde is null then precio_impreso_linea_agente(x.id) -> 'precio_impreso' end, 'descuento_pct', case when x.desde is null then precio_impreso_linea_agente(x.id) -> 'descuento_pct' end,$q$, 1),
  ('historial_precios_agente', $q$'precios', 'precio unitario de linea, SIN IVA',$q$,
     $q$'precios', 'precio unitario de linea SIN IVA, coste real con descuentos',$q$, 1),
  ('historial_precios_agente', $q$precio_min, precio_max y precio_medio solo despues, como contexto.',$q$,
     $q$precio_min, precio_max y precio_medio solo despues, como contexto. Precios = coste real con descuentos; precio_impreso y descuento_pct (si salen) = lo que dice la factura.',$q$, 1),
  ('ficha_proveedor_agente', $q$'nota', 'gasto con IVA; precios de linea SIN IVA',$q$,
     $q$'nota', 'gasto con IVA; precios de linea SIN IVA y con descuentos (coste real)',$q$, 1);

do $$
declare
  c record;
  v_oid oid;
  v_def text;
  v_nuevo text;
  v_veces int;
  v_fn text;
begin
  for v_fn in select distinct fn from _cambios loop
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_oid is null then
      raise notice '20261212910000: la función % no existe en esta base; se salta.', v_fn;
      continue;
    end if;
    v_def := pg_get_functiondef(v_oid);
    v_nuevo := v_def;
    for c in select * from _cambios where fn = v_fn loop
      if position(c.nuevo in v_nuevo) > 0 then
        continue;
      end if;
      v_veces := (length(v_nuevo) - length(replace(v_nuevo, c.viejo, ''))) / length(c.viejo);
      if v_veces <> c.veces then
        raise exception '20261212910000: en % el trozo «%» aparece % veces (se esperaba %). No se ha cambiado nada.', v_fn, c.viejo, v_veces, c.veces;
      end if;
      v_nuevo := replace(v_nuevo, c.viejo, c.nuevo);
    end loop;
    if v_nuevo <> v_def then
      execute v_nuevo;
      raise notice '20261212910000: % actualizada.', v_fn;
    end if;
  end loop;
end;
$$;

-- ─── 4. Productos: es_descuento (R6) ───
drop function if exists public.productos_resumen(date, date, text);
create function public.productos_resumen(p_desde date default null, p_hasta date default null, p_tipo text default null)
returns table(producto_id bigint, nombre text, categoria_id bigint, origen text, unidad_habitual text, compras integer,
              documentos integer, cantidades jsonb, gasto numeric, lineas_sin_importe integer, ultimo_precio numeric,
              ultima_fecha date, proveedores text[], gasto_impreso numeric, ultimo_precio_impreso numeric, es_descuento boolean)
language sql
stable
set search_path to 'public'
as $function$
  -- 20261212910000: es_descuento marca los «productos» sintéticos que son líneas de descuento (Descuento comercial,
  -- Descuento Heineken…): no se compran, el panel los enseña aparte y sin precio unitario; su gasto sigue en el total.
  -- 20261212900000: gasto y último precio con los descuentos asociados (importe_neto), como Análisis y el chat;
  -- gasto_impreso y ultimo_precio_impreso son lo que dicen los documentos. Una línea a neto 0 (regalo) no
  -- cuenta como último precio.
  with l as (
    select pf.id, pf.producto_id, pf.factura_id, pf.cantidad, coalesce(nullif(btrim(pf.unidad), ''), '') as unidad,
           pf.total, coalesce(pf.importe_neto, pf.total) as neto, pf.precio_unitario,
           coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario) as pu_neto,
           f.fecha, f.proveedor
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (p_tipo is null or f.tipo = p_tipo)
       -- 20261106120000: el albarán ya facturado no suma (sus líneas ya están en la factura).
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  cant as (
    select x.producto_id, jsonb_object_agg(x.unidad, x.suma order by x.unidad) as c
      from (select producto_id, unidad, round(sum(cantidad), 3) as suma from l group by producto_id, unidad) as x
     group by x.producto_id
  ),
  ult as (
    select distinct on (producto_id) producto_id, pu_neto, precio_unitario as pu_impreso, fecha
      from l where pu_neto is not null and coalesce(neto, 1) > 0
     order by producto_id, fecha desc nulls last, id desc
  )
  select p.id, p.nombre, p.categoria_id, p.origen, p.unidad_habitual,
         count(l.id)::integer,
         count(distinct l.factura_id)::integer,
         coalesce(cant.c, '{}'::jsonb),
         round(coalesce(sum(l.neto), 0), 2),
         (count(l.id) filter (where l.total is null))::integer,
         ult.pu_neto,
         max(l.fecha),
         coalesce(array_agg(distinct l.proveedor) filter (where l.proveedor is not null), '{}'::text[]),
         round(coalesce(sum(l.total), 0), 2),
         ult.pu_impreso,
         public.es_linea_descuento(lower(p.nombre))
    from public.productos_catalogo p
    left join l    on l.producto_id = p.id
    left join cant on cant.producto_id = p.id
    left join ult  on ult.producto_id = p.id
   group by p.id, cant.c, ult.pu_neto, ult.pu_impreso
   order by round(coalesce(sum(l.neto), 0), 2) desc, p.nombre;
$function$;
revoke all on function public.productos_resumen(date, date, text) from public, anon;
grant execute on function public.productos_resumen(date, date, text) to authenticated, service_role;
