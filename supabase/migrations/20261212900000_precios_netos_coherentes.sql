set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212900000_precios_netos_coherentes · Facturas (18/11/2026)
-- Revisión independiente de #288/#289/#292 (facturas-conocimiento/revision-cambios-pablo-2026-11-18.md).
-- Decisión: el panel entero trabaja con el coste real (neto = coalesce(importe_neto, total)); lo impreso
-- se enseña como desglose.
--  P3  Productos (productos_resumen, productos_gasto_por_categoria) y las herramientas del chat que
--      seguían en bruto pasan al neto con el MISMO patrón que 20261211300000 (sustitución de texto sobre
--      el cuerpo de la función; si un trozo no aparece se aborta). Una línea de descuento ya repartida
--      vale 0, así que el total de un proveedor o periodo no cambia, solo su reparto entre productos.
--      productos_resumen devuelve además gasto_impreso y ultimo_precio_impreso para enseñar el desglose.
--  P2  Una línea con neto 0 (100 % de descuento, regalo) no cuenta como precio pagado: los filtros
--      «pf.total > 0» de márgenes, alertas e informe de precios pasan a «neto > 0».
--  P1  Un reparto nunca deja una línea por debajo de 0 (el sobrante queda como descuento sin asociar) y
--      el reparto por nombre exige cantidad coherente con la de la línea.
--  P5  productos_factura.descuento_general: rappels, «DTO ESPECIE» y descuentos de telefonía o
--      gasolina no van a un producto; se marcan para que no salgan como pendientes.
--      descuentos_sin_asociar_resumen(): cuántos quedan sin asociar y de qué proveedor.
-- No cambia nada de lo impreso. Reaplicable. Rollback: supabase/rollbacks/20261212900000_precios_netos_coherentes_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'importe_neto') then
    raise exception '20261212900000: falta 20261211200000 (productos_factura.importe_neto). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.facturas_asociar_descuentos(bigint[])') is null then
    raise exception '20261212900000: falta facturas_asociar_descuentos. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Descuento general del proveedor (P5) ───
alter table public.productos_factura add column if not exists descuento_general boolean;
comment on column public.productos_factura.descuento_general is
  'true = línea de descuento que no va a un producto (rappel, DTO ESPECIE, telefonía, gasolina): descuento general del proveedor, no es un pendiente de asociar (20261212900000).';

-- ─── 2. Reparto de descuentos con tope y cantidad coherente (P1) y marca de descuento general (P5) ───
create or replace function public.facturas_asociar_descuentos(p_facturas bigint[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $f$
declare
  v_n integer := 0;
begin
  if p_facturas is null or cardinality(p_facturas) = 0 then
    return 0;
  end if;

  -- Lo automático se recalcula entero; lo 'manual' se respeta.
  delete from public.productos_factura_descuentos x
   using public.productos_factura p
   where p.id = x.descuento_linea_id and p.factura_id = any(p_facturas) and x.regla <> 'manual';

  -- Regalos (20261211400000): líneas a 0 € o sin importe, con cantidad, que son regalo → 100 % de descuento y su
  -- valor (el impreso; si no hay, el de la línea pagada del mismo producto, marcado como estimado).
  update public.productos_factura p
     set descuento_pct = 100,
         importe_bruto = coalesce(p.importe_bruto, round(p.cantidad * nullif(p.precio_unitario, 0), 2), round(p.cantidad * r.precio, 2)),
         importe_bruto_estimado = case when p.importe_bruto is not null then p.importe_bruto_estimado
                                       when nullif(p.precio_unitario, 0) is not null then false
                                       else r.precio is not null end
    from (
      select z.id,
             (select q.total / q.cantidad
                from public.productos_factura q
               where q.factura_id = z.factura_id and q.id <> z.id and q.total > 0 and q.cantidad > 0
                 and ((q.producto_id is not null and q.producto_id = z.producto_id) or q.nombre_normalizado = z.nombre_normalizado)
               order by q.id limit 1) as precio
        from public.productos_factura z
        join public.facturas f on f.id = z.factura_id
        left join public.productos_catalogo pc on pc.id = z.producto_id
        left join public.categorias_producto c on c.id = pc.categoria_id
        left join public.categorias_producto c2 on c2.id = c.padre_id
       where z.factura_id = any(p_facturas) and f.total > 0
         and (z.total = 0 or z.total is null) and z.cantidad > 0 and z.descuento_pct is null
         and coalesce(z.nombre_busqueda, lower(z.nombre)) !~ '(envase|palet|caja bn|retorn)'
         and coalesce(c2.clave, c.clave, '') <> 'servicios'
    ) r
   where r.id = p.id
     and (p.importe_bruto > 0
          or coalesce(p.nombre_busqueda, lower(p.nombre)) ~ '(sin cargo|(^|[^a-z])s/c([^a-z]|$)|regalo|obsequio|bonif|gratis|muestra|cortesia)'
          or r.precio is not null);

  create temp table if not exists _pfd_reparto (
    descuento_linea_id bigint, linea_id bigint, importe numeric, regla text
  ) on commit drop;
  truncate _pfd_reparto;

  insert into _pfd_reparto
  with lin as (
    select p.id, p.factura_id, coalesce(p.nombre_busqueda, lower(p.nombre)) as nb, p.total, p.cantidad,
           coalesce(p.albaran_ref, '') as alb,
           row_number() over (partition by p.factura_id order by p.pagina nulls first, p.orden nulls last, p.id) as rn
      from public.productos_factura p
      join public.facturas f on f.id = p.factura_id
     where p.factura_id = any(p_facturas) and f.total > 0 and p.total is not null
  ),
  d as (
    select l.*,
           regexp_replace(l.nb, '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s+', '') as limpio,
           replace(nullif(substring(l.nb from '(\d+(?:[.,]\d+)?)\s*%'), ''), ',', '.')::numeric as pct
      from lin l
     where l.total < 0 and public.es_linea_descuento(l.nb)
       and not exists (select 1 from public.productos_factura_descuentos m where m.descuento_linea_id = l.id)
  ),
  candidatas as (
    select d.id as did, l.id as lid, l.total as ltotal, extensions.similarity(l.nb, d.limpio) as s,
           l.rn, d.rn as drn,
           -- 20261212900000: «DESCUENTO <producto>» con otra cantidad que la línea (-6 frente a 5) no es de esa línea.
           (d.cantidad is null or l.cantidad is null or d.cantidad = 0
            or abs(abs(d.cantidad) - l.cantidad) < 0.001) as cant_ok
      from d join lin l on l.factura_id = d.factura_id and l.total > 0 and (d.alb = '' or l.alb = d.alb)
  ),
  por_nombre as (
    -- Se elige la línea más parecida y, si su cantidad no cuadra, el descuento no se asocia a otra peor.
    select distinct on (did) did, lid, cant_ok
      from candidatas
     where s >= 0.5
     order by did, s desc, (rn < drn) desc, abs(rn - drn), lid
  ),
  anterior as (
    select d.id as did, l.id as lid, l.total as ltotal
      from d join lin l on l.factura_id = d.factura_id and l.rn = d.rn - 1 and l.total > 0
  ),
  bloque as (
    select did, sum(ltotal) as btotal from candidatas group by did
  ),
  regla as (
    select d.id as did, d.total,
           case
             when d.nb ~ 'linea anterior' and a.lid is not null then 'linea_anterior'
             when n.did is not null then 'nombre'
             when d.pct is not null and a.lid is not null
                  and abs(-d.total - a.ltotal * d.pct / 100) <= greatest(0.02, a.ltotal * d.pct / 100 * 0.02) then 'pct_linea'
             when d.pct is not null and b.btotal > 0
                  and abs(-d.total - b.btotal * d.pct / 100) <= greatest(0.05, b.btotal * d.pct / 100 * 0.02) then 'pie'
             when d.pct is null and b.btotal > 0 and d.nb ~ '(comercial|pie|bonific)'
                  and abs(round(-d.total / b.btotal * 200) / 2 - (-d.total / b.btotal * 100)) <= 0.05 then 'pie'
             when d.pct is not null and f.total > 0
                  and abs(-d.total - (f.total - d.total) * d.pct / 100) <= greatest(0.5, f.total * 0.01) then 'pie_con_iva'
           end as regla,
           case when d.nb ~ 'linea anterior' and a.lid is not null then a.lid else coalesce(n.lid, a.lid) end as lid_unica,
           b.btotal
      from d
      join public.facturas f on f.id = d.factura_id
      left join por_nombre n on n.did = d.id and n.cant_ok
      left join anterior a on a.did = d.id
      left join bloque b on b.did = d.id
  )
  select r.did, r.lid_unica, r.total, r.regla
    from regla r
   where r.regla in ('nombre', 'linea_anterior', 'pct_linea')
  union all
  select r.did, c.lid, round(r.total * c.ltotal / r.btotal, 2), r.regla
    from regla r join candidatas c on c.did = r.did
   where r.regla in ('pie', 'pie_con_iva');

  -- Descuentos en POSITIVO (20261211400000): «DESC./DESCUENTO <producto>» con importe positivo justo
  -- debajo de su línea (Catral: deshace el descuento de una devolución, o lo cobra de más). Va a esa
  -- línea, sea positiva o negativa.
  insert into _pfd_reparto
  with lin as (
    select p.id, p.factura_id, coalesce(p.nombre_busqueda, lower(p.nombre)) as nb, p.total,
           row_number() over (partition by p.factura_id order by p.pagina nulls first, p.orden nulls last, p.id) as rn
      from public.productos_factura p
      join public.facturas f on f.id = p.factura_id
     where p.factura_id = any(p_facturas) and f.total > 0 and p.total is not null
  )
  select d.id, a.id, d.total, 'nombre'
    from lin d
    join lin a on a.factura_id = d.factura_id and a.rn = d.rn - 1 and a.total <> 0
   where d.total > 0
     and d.nb ~ '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s'
     and not public.es_linea_descuento(a.nb)
     and not exists (select 1 from public.productos_factura_descuentos m where m.descuento_linea_id = d.id)
     and extensions.similarity(a.nb, regexp_replace(d.nb, '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s+', '')) >= 0.5;

  -- Céntimos del reparto: a la línea que más recibe, para que sume exactamente el descuento.
  update _pfd_reparto t
     set importe = t.importe + x.resto
    from (
      select r.descuento_linea_id, p.total - sum(r.importe) as resto,
             (array_agg(r.linea_id order by abs(r.importe) desc, r.linea_id))[1] as linea_id
        from _pfd_reparto r join public.productos_factura p on p.id = r.descuento_linea_id
       group by r.descuento_linea_id, p.total
    ) x
   where t.descuento_linea_id = x.descuento_linea_id and t.linea_id = x.linea_id and x.resto <> 0;

  -- 20261212900000 (P1): nunca por debajo de 0. Los descuentos que caen en una línea positiva suman como
  -- mucho su importe (menos lo ya asignado a mano); lo que sobra no se asocia y queda como descuento sin
  -- asociar (descuentos_sin_asociar_resumen).
  update _pfd_reparto t
     set importe = -x.permitido
    from (
      select r.descuento_linea_id, r.linea_id,
             greatest(0, least(-r.importe,
                               l.total + coalesce((select sum(m.importe) from public.productos_factura_descuentos m
                                                    where m.linea_id = r.linea_id and m.regla = 'manual' and m.importe < 0), 0)
                               - coalesce(sum(-r.importe) over (partition by r.linea_id order by r.descuento_linea_id
                                                                 rows between unbounded preceding and 1 preceding), 0))) as permitido
        from _pfd_reparto r join public.productos_factura l on l.id = r.linea_id
       where r.importe < 0 and l.total > 0
    ) x
   where t.descuento_linea_id = x.descuento_linea_id and t.linea_id = x.linea_id and t.importe < 0
     and t.importe is distinct from -x.permitido;
  delete from _pfd_reparto where importe = 0;

  insert into public.productos_factura_descuentos (descuento_linea_id, linea_id, importe, regla)
  select descuento_linea_id, linea_id, importe, regla from _pfd_reparto
  on conflict (descuento_linea_id, linea_id) do nothing;
  get diagnostics v_n = row_count;

  -- importe_neto: la línea recibe sus descuentos; la línea de descuento se queda con lo que NO se ha
  -- repartido (0 si se repartió entero). Por documento, la suma sigue siendo la de `total`.
  update public.productos_factura p
     set importe_neto = x.neto
    from (
      select p2.id,
             case
               when rep.repartido is not null then p2.total - rep.repartido
               when s.asignado is not null then p2.total + s.asignado
             end as neto
        from public.productos_factura p2
        left join (
          select m.linea_id, sum(m.importe) as asignado
            from public.productos_factura_descuentos m
            join public.productos_factura q on q.id = m.linea_id
           where q.factura_id = any(p_facturas)
           group by m.linea_id
        ) s on s.linea_id = p2.id
        left join (
          select m.descuento_linea_id, sum(m.importe) as repartido
            from public.productos_factura_descuentos m
            join public.productos_factura q on q.id = m.descuento_linea_id
           where q.factura_id = any(p_facturas)
           group by m.descuento_linea_id
        ) rep on rep.descuento_linea_id = p2.id
       where p2.factura_id = any(p_facturas)
    ) x
   where x.id = p.id and p.importe_neto is distinct from x.neto;

  -- P5: descuentos que no van a un producto (rappel, DTO ESPECIE, telefonía, gasolina).
  update public.productos_factura p
     set descuento_general = x.g
    from (
      select p2.id,
             case when p2.total < 0 and coalesce(p2.importe_neto, p2.total) < 0
                       and public.es_linea_descuento(coalesce(p2.nombre_busqueda, lower(p2.nombre)))
                       and (coalesce(f.proveedor, '') ~* '(orange|avatel|solred|repsol)'
                            or coalesce(p2.nombre_busqueda, lower(p2.nombre)) ~ '(rappel|dto\.? especie|descuento especie)')
                  then true end as g
        from public.productos_factura p2
        join public.facturas f on f.id = p2.factura_id
       where p2.factura_id = any(p_facturas)
    ) x
   where x.id = p.id and p.descuento_general is distinct from x.g;

  return v_n;
end;
$f$;
comment on function public.facturas_asociar_descuentos(bigint[]) is
  'Asocia las líneas de descuento de esos documentos a sus productos y recalcula importe_neto (20261211200000). Desde 20261212900000: tope (nunca neto < 0), cantidad coherente y descuento_general. Devuelve cuántos repartos ha creado.';
revoke all on function public.facturas_asociar_descuentos(bigint[]) from public, anon, authenticated;
grant execute on function public.facturas_asociar_descuentos(bigint[]) to service_role;

-- ─── 3. Funciones que seguían en bruto → neto (P3) y regalos con neto 0 (P2) ───
-- Mismas sustituciones de texto que 20261211300000. Cada trozo debe aparecer exactamente `veces` veces; si no
-- aparece pero ya está el nuevo, se da por hecho (reaplicable); si no, se aborta sin cambiar nada. Una función que
-- aún no existe en la base (p. ej. producción sin alguna migración de staging) se salta.
drop table if exists pg_temp._cambios;
create temp table _cambios (fn text, viejo text, nuevo text, veces int) on commit drop;
insert into _cambios (fn, viejo, nuevo, veces) values
  -- gasto por familia (chat)
  ('gasto_categorias_agente', $q$pf.total::numeric as imp,$q$, $q$coalesce(pf.importe_neto, pf.total)::numeric as imp,$q$, 1),
  -- ranking (chat): precio e importe de línea
  ('ranking_agente', $q$pf.precio_unitario, pf.total,$q$,
     $q$coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario) as precio_unitario, coalesce(pf.importe_neto, pf.total) as total,$q$, 1),
  ('ranking_agente', $q$as unidad, pf.total,$q$, $q$as unidad, coalesce(pf.importe_neto, pf.total) as total,$q$, 1),
  -- resumen del periodo, ficha de proveedor (chat)
  ('resumen_periodo_agente', $q$round(sum(pf.total)::numeric, 2)$q$, $q$round(sum(coalesce(pf.importe_neto, pf.total))::numeric, 2)$q$, 1),
  ('ficha_proveedor_agente', $q$coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio$q$,
     $q$coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio$q$, 1),
  ('ficha_proveedor_agente', $q$pf.total as imp,$q$, $q$coalesce(pf.importe_neto, pf.total) as imp,$q$, 1),
  -- alertas de compras
  ('facturas_alertas_compras', $q$pf.cantidad, pf.precio_unitario, pf.total::numeric as importe$q$,
     $q$pf.cantidad, coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario) as precio_unitario, coalesce(pf.importe_neto, pf.total)::numeric as importe$q$, 1),
  ('facturas_alertas_compras', $q$and pf.total > 0$q$, $q$and coalesce(pf.importe_neto, pf.total) > 0$q$, 1),
  -- P2: neto 0 = regalo, no es un precio pagado
  ('facturas_alertas_candidatas', $q$pf.precio_unitario > 0 and pf.total > 0$q$, $q$pf.precio_unitario > 0 and coalesce(pf.importe_neto, pf.total) > 0$q$, 1),
  ('informe_precios_compras', $q$pf.precio_unitario > 0 and pf.total > 0$q$, $q$pf.precio_unitario > 0 and coalesce(pf.importe_neto, pf.total) > 0$q$, 1),
  ('margenes_carta_costes', $q$pf.total > 0 and pf.cantidad > 0$q$, $q$coalesce(pf.importe_neto, pf.total) > 0 and pf.cantidad > 0$q$, 1),
  ('margenes_carta_ultima', $q$pf.total > 0 and pf.cantidad > 0$q$, $q$coalesce(pf.importe_neto, pf.total) > 0 and pf.cantidad > 0$q$, 1),
  ('margenes_compras_producto', $q$pf.total > 0 and pf.cantidad > 0$q$, $q$coalesce(pf.importe_neto, pf.total) > 0 and pf.cantidad > 0$q$, 1),
  ('vinos_coste_carta_datos', $q$pf.producto_id = pc.id and pf.total > 0$q$, $q$pf.producto_id = pc.id and coalesce(pf.importe_neto, pf.total) > 0$q$, 1),
  ('referencias_precio_lote_agente', $q$coalesce(pf.total, 0) > 0$q$, $q$coalesce(pf.importe_neto, pf.total, 0) > 0$q$, 1),
  ('referencias_precio_lote_agente', $q$g.total = 0 and g.cantidad > 0$q$, $q$coalesce(g.importe_neto, g.total) = 0 and g.total >= 0 and g.cantidad > 0$q$, 1),
  -- consulta flexible (chat): métricas de línea en neto; la base de IVA por tipo sigue en lo impreso
  ('consulta_flexible_agente', $q$when 'precio_unitario' then 'l.precio_unitario'$q$,
     $q$when 'precio_unitario' then 'coalesce(l.importe_neto / nullif(l.cantidad, 0), l.precio_unitario)'$q$, 1),
  ('consulta_flexible_agente', $q$when 'total_linea'     then 'l.total'$q$, $q$when 'total_linea'     then 'coalesce(l.importe_neto, l.total)'$q$, 1),
  ('consulta_flexible_agente', $q$if v_col like 'l.%' and not$q$, $q$if (v_col like 'l.%' or v_col like 'coalesce(l.%') and not$q$, 1),
  -- búsqueda de líneas (chat): importe y precio netos y, si difieren, el impreso al lado
  ('buscar_productos_agente', $q$round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),$q$,
     $q$round(coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario)::numeric, case when abs(coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario)) < 1 then 4 else 2 end),$q$, 1),
  ('buscar_productos_agente', $q$'importe',    round(pf.total::numeric, 2),$q$,
     $q$'importe',    round(coalesce(pf.importe_neto, pf.total)::numeric, 2), 'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end,$q$, 1),
  ('buscar_productos_texto_agente', $q$round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),$q$,
     $q$round(coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario)::numeric, case when abs(coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario)) < 1 then 4 else 2 end),$q$, 1),
  ('buscar_productos_texto_agente', $q$'importe',    round(pf.total::numeric, 2),$q$,
     $q$'importe',    round(coalesce(pf.importe_neto, pf.total)::numeric, 2), 'importe_impreso', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.total::numeric, 2) end,$q$, 1),
  ('buscar_contexto_chatbot', $q$pf.precio_unitario,$q$,
     $q$coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario) AS precio_unitario, pf.precio_unitario AS precio_impreso,$q$, 1),
  ('buscar_contexto_chatbot', $q$pf.total,$q$, $q$coalesce(pf.importe_neto, pf.total) AS total, pf.total AS total_impreso,$q$, 1),
  -- detalle de un documento (chat): sigue en impreso (cuadra con la cabecera) y añade el neto si difiere
  ('detalle_documento_agente', $q$'importe',  round(pf.total::numeric, 2),$q$,
     $q$'importe',  round(pf.total::numeric, 2), 'importe_neto', case when pf.importe_neto is not null and pf.importe_neto is distinct from pf.total then round(pf.importe_neto::numeric, 2) end,$q$, 1);

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
      raise notice '20261212900000: la función % no existe en esta base (se creará más adelante); se salta.', v_fn;
      continue;
    end if;
    v_def := pg_get_functiondef(v_oid);
    v_nuevo := v_def;
    for c in select * from _cambios where fn = v_fn loop
      v_veces := (length(v_nuevo) - length(replace(v_nuevo, c.viejo, ''))) / length(c.viejo);
      if v_veces = 0 then
        if position(c.nuevo in v_nuevo) = 0 then
          raise exception '20261212900000: en % no aparece el trozo «%» ni su sustituto. No se ha cambiado nada.', v_fn, c.viejo;
        end if;
      elsif v_veces <> c.veces then
        raise exception '20261212900000: en % el trozo «%» aparece % veces (se esperaba %).', v_fn, c.viejo, v_veces, c.veces;
      else
        v_nuevo := replace(v_nuevo, c.viejo, c.nuevo);
      end if;
    end loop;
    if v_nuevo <> v_def then
      execute v_nuevo;
      raise notice '20261212900000: % ya usa el importe con descuentos.', v_fn;
    else
      raise notice '20261212900000: % sin cambios (ya estaba).', v_fn;
    end if;
  end loop;
end;
$$;

-- ─── 4. Productos: gasto y último precio en neto, con el impreso al lado ───
drop function if exists public.productos_resumen(date, date, text);
create function public.productos_resumen(p_desde date default null, p_hasta date default null, p_tipo text default null)
returns table(producto_id bigint, nombre text, categoria_id bigint, origen text, unidad_habitual text, compras integer,
              documentos integer, cantidades jsonb, gasto numeric, lineas_sin_importe integer, ultimo_precio numeric,
              ultima_fecha date, proveedores text[], gasto_impreso numeric, ultimo_precio_impreso numeric)
language sql
stable
set search_path to 'public'
as $function$
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
         ult.pu_impreso
    from public.productos_catalogo p
    left join l    on l.producto_id = p.id
    left join cant on cant.producto_id = p.id
    left join ult  on ult.producto_id = p.id
   group by p.id, cant.c, ult.pu_neto, ult.pu_impreso
   order by round(coalesce(sum(l.neto), 0), 2) desc, p.nombre;
$function$;
revoke all on function public.productos_resumen(date, date, text) from public, anon;
grant execute on function public.productos_resumen(date, date, text) to authenticated, service_role;

create or replace function public.productos_gasto_por_categoria(p_desde date default null, p_hasta date default null, p_tipo text default null)
returns table(categoria_id bigint, categoria text, padre_id bigint, padre text, sin_clasificar boolean, gasto numeric,
              lineas integer, productos integer, lineas_sin_importe integer)
language sql
stable
set search_path to 'public'
as $function$
  -- 20261212900000: gasto con los descuentos asociados (importe_neto), igual que productos_resumen y Análisis.
  select c.id,
         coalesce(c.nombre, case when pf.producto_id is null then 'Sin clasificar' else 'Sin categoría' end),
         c.padre_id,
         pc.nombre,
         pf.producto_id is null,
         round(coalesce(sum(coalesce(pf.importe_neto, pf.total)), 0), 2),
         count(*)::integer,
         count(distinct pf.producto_id)::integer,
         (count(*) filter (where pf.total is null))::integer
    from public.productos_factura pf
    join public.facturas f on f.id = pf.factura_id
    left join public.productos_catalogo p   on p.id = pf.producto_id
    left join public.categorias_producto c  on c.id = p.categoria_id
    left join public.categorias_producto pc on pc.id = c.padre_id
   where (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
     and (p_tipo is null or f.tipo = p_tipo)
     -- 20261106120000: el albarán ya facturado no suma (sus líneas ya están en la factura).
     and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
   group by c.id, c.nombre, c.padre_id, pc.nombre, pf.producto_id is null
   order by round(coalesce(sum(coalesce(pf.importe_neto, pf.total)), 0), 2) desc;
$function$;

-- ─── 5. Descuentos sin asociar: cuántos y de qué proveedor ───
create or replace function public.descuentos_sin_asociar_resumen()
returns table(proveedor text, lineas integer, documentos integer, importe numeric, general boolean)
language sql
stable
set search_path to 'public'
as $f$
  -- Líneas de descuento (importe negativo) de las que queda algo sin repartir a un producto.
  -- general = descuento general del proveedor (rappel, telefonía…): no es un pendiente.
  select coalesce(f.proveedor, '(sin proveedor)')::text,
         count(*)::integer,
         count(distinct f.id)::integer,
         round(sum(coalesce(p.importe_neto, p.total)), 2),
         coalesce(p.descuento_general, false)
    from public.productos_factura p
    join public.facturas f on f.id = p.factura_id
   where p.total < 0 and coalesce(p.importe_neto, p.total) < 0 and f.total > 0
     and public.es_linea_descuento(coalesce(p.nombre_busqueda, lower(p.nombre)))
   group by 1, 5
   order by 5, 4;
$f$;
revoke all on function public.descuentos_sin_asociar_resumen() from public, anon;
grant execute on function public.descuentos_sin_asociar_resumen() to authenticated, service_role;
comment on function public.descuentos_sin_asociar_resumen() is
  'Descuentos sin asociar a un producto, por proveedor; general = descuento general del proveedor (20261212900000).';

-- ─── 6. Relleno del histórico ───
-- Sin una fila de auditoría por línea (el importe impreso no cambia).
do $$
declare
  v_ids bigint[];
  v_n integer;
  v_auditoria boolean := exists (
    select 1 from pg_trigger t where t.tgrelid = 'public.productos_factura'::regclass and t.tgname = 'trg_auditoria');
begin
  select array_agg(distinct p.factura_id) into v_ids
    from public.productos_factura p
   where p.importe_neto is not null
      or (p.total < 0 and public.es_linea_descuento(coalesce(p.nombre_busqueda, lower(p.nombre))));
  if v_auditoria then
    execute 'alter table public.productos_factura disable trigger trg_auditoria';
  end if;
  v_n := public.facturas_asociar_descuentos(v_ids);
  if v_auditoria then
    execute 'alter table public.productos_factura enable trigger trg_auditoria';
  end if;
  raise notice '20261212900000: % repartos nuevos en % documentos.', v_n, coalesce(cardinality(v_ids), 0);
end;
$$;
