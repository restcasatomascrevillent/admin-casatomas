set client_encoding = 'UTF8';
-- ROLLBACK de 20261130200000_decidir_hoy_recalculo.sql: quita el recálculo al cambiar una
-- factura y deja facturas_alertas_candidatas y facturas_alertas_tras_verificar como estaban
-- en la demo el 14/11/2026 (20261130120000 / 20261130140000).
begin;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'facturas-alertas-recalculo') then
    perform cron.unschedule('facturas-alertas-recalculo');
  end if;
end;
$$;
drop trigger if exists facturas_alertas_recalculo_ins_del on public.facturas;
drop trigger if exists facturas_alertas_recalculo_upd on public.facturas;
drop trigger if exists facturas_alertas_recalculo_lineas_ins_del on public.productos_factura;
drop trigger if exists facturas_alertas_recalculo_lineas_upd on public.productos_factura;
drop function if exists public.facturas_alertas_recalcular_pendiente(interval);
drop function if exists public.facturas_alertas_marcar_recalculo();
drop table if exists public.facturas_alertas_recalculo_cola;

CREATE OR REPLACE FUNCTION public.facturas_alertas_candidatas(p_hoy date DEFAULT CURRENT_DATE)
 RETURNS TABLE(tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamp with time zone, datos jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
#variable_conflict use_column
-- 20261107300000_facturas_alertas · 20261130120000_decidir_ultima_factura (referencia = factura anterior)
declare
  u          jsonb := public.facturas_alertas_umbrales();
  v_hoy      date := coalesce(p_hoy, current_date);
  v_sub_pct  numeric := (u ->> 'subida_pct')::numeric;
  v_sub_alta numeric := (u ->> 'subida_alta_pct')::numeric;
  v_ref_d    int := (u ->> 'subida_ref_dias')::int;
  v_vig_d    int := (u ->> 'subida_vigencia_dias')::int;
  v_relev    numeric := (u ->> 'gasto_relevante_eur')::numeric;
  v_otro_pct numeric := (u ->> 'otro_proveedor_pct')::numeric;
  v_otro_d   int := (u ->> 'otro_proveedor_dias')::int;
  v_otro_n   int := (u ->> 'otro_proveedor_compras')::int;
  v_otro_max numeric := (u ->> 'otro_proveedor_max_pct')::numeric;
  v_ahorro   numeric := (u ->> 'ahorro_minimo_eur')::numeric;
  v_ahorro_a numeric := (u ->> 'ahorro_alto_eur')::numeric;
  v_fam_pct  numeric := (u ->> 'familia_pct')::numeric;
  v_fam_m    int := (u ->> 'familia_meses')::int;
  v_fam_min  numeric := (u ->> 'familia_media_min_eur')::numeric;
  v_fam_ext  numeric := (u ->> 'familia_extra_min_eur')::numeric;
  v_fam_dia  int := (u ->> 'familia_dia_minimo')::int;
  v_alb_d    int := (u ->> 'albaran_dias')::int;
  v_alb_a    numeric := (u ->> 'albaran_alto_eur')::numeric;
  v_nuevo_d  int := (u ->> 'proveedor_nuevo_dias')::int;
  v_inu_f    numeric := (u ->> 'importe_inusual_factor')::numeric;
  v_inu_min  numeric := (u ->> 'importe_inusual_min_eur')::numeric;
  v_av_d     int := (u ->> 'avisos_dias')::int;
  v_mes_hoy  date := date_trunc('month', coalesce(p_hoy, current_date))::date;
  v_dias_mes int := extract(day from (date_trunc('month', coalesce(p_hoy, current_date)) + interval '1 month - 1 day'))::int;
  v_inicio   date;
begin
  -- Líneas de precio: lo justo para referencia + vigencia (y el margen de la mediana).
  v_inicio := v_hoy - greatest(v_ref_d + v_vig_d, v_otro_d);

  return query
  with
  fuera as (
    select c.id from categorias_producto c
     where c.padre_id is null and c.nombre in ('Servicios', 'Menaje y equipamiento')
  ),
  -- ══ Líneas con precio (una pasada) ══
  lb as materialized (
    select pf.factura_id, fa.fecha, fa.proveedor_id,
           case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
           pf.producto_id, pf.nombre::text as nombre_linea, pc.nombre::text as producto_nombre,
           coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
           lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as uni,
           pf.cantidad, pf.precio_unitario, pf.total::numeric as importe,
           coalesce(c.padre_id, c.id) as fam,
           pf.unidad::text as unidad_txt, pf.contenido_cantidad, pf.contenido_unidad::text as contenido_unidad,
           pc.envase_cantidad, pc.envase_unidad::text as envase_unidad, pc.envases_por_bulto, c.nombre::text as categoria,
           -- Clave de lo que necesita volumen_linea (salvo la cantidad: el contenido por unidad no depende de ella).
           concat_ws('|', pf.nombre, pf.unidad, pf.precio_unitario, pf.contenido_cantidad, pf.contenido_unidad,
                     pc.envase_cantidad, pc.envase_unidad, pc.envases_por_bulto, c.nombre) as vkey
      from facturas fa
      join productos_factura pf on pf.factura_id = fa.id
      left join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join public.nombres_linea_no_producto np
             on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
            and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
     where fa.fecha between v_inicio and v_hoy
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and fa.total > 0
       and fa.proveedor_id is not null
       and pf.cantidad > 0 and pf.precio_unitario > 0 and pf.total > 0
       and coalesce(c.padre_id, c.id, 0) not in (select id from fuera)
       and not coalesce(np.no_producto, public.es_linea_no_producto_tablero(
             coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)),
             coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')))
  ),
  -- Litros/kilos por unidad facturada (docs/facturas/VOLUMENES.md), una vez por combinación
  -- distinta: volumen_linea es plpgsql con expresiones regulares (~0,13 ms por llamada).
  vol as materialized (
    select d.vkey, v.medida, v.por_unidad
      from (select distinct on (vkey) * from lb) d
      left join lateral public.volumen_linea(
             d.nombre_linea, d.unidad_txt, 1::numeric, d.precio_unitario,
             d.contenido_cantidad, d.contenido_unidad,
             d.envase_cantidad, d.envase_unidad, d.envases_por_bulto,
             public.volumen_max_eur_litro(d.categoria)) v on true
  ),
  l0 as (
    select lb.*, vol.medida, vol.por_unidad from lb join vol using (vkey)
  ),
  -- Precio comparable: €/l o €/kg si se sabe cuánto lleva la unidad; si no, € por unidad facturada.
  l1 as (
    select l.*,
           coalesce(l.medida, l.uni) as med,
           case when l.medida is not null and l.por_unidad > 0 then l.precio_unitario / l.por_unidad else l.precio_unitario end as precio_c,
           case when l.medida is not null and l.por_unidad > 0 then l.cantidad * l.por_unidad else l.cantidad end as cant_c
      from l0 l
  ),
  med_atip as (
    select proveedor_id, nom_n, med, (percentile_cont(0.5) within group (order by precio_c))::numeric as mediana, count(*) as n
      from l1 group by 1, 2, 3
  ),
  l2 as (
    select l.* from l1 l
      join med_atip m using (proveedor_id, nom_n, med)
     where m.n < 3 or l.precio_c between m.mediana / 3 and m.mediana * 3
  ),
  -- Un documento = una compra (varias líneas del mismo producto, precio medio ponderado).
  compras as (
    select proveedor_id, nom_n, med, factura_id, max(fecha) as fecha, max(loc) as loc,
           max(producto_id) as producto_id, max(nombre_linea) as nombre_linea, max(producto_nombre) as producto_nombre,
           max(fam) as fam, max(uni) as uni,
           sum(precio_c * cant_c) / nullif(sum(cant_c), 0) as precio,
           sum(precio_unitario * cantidad) / nullif(sum(cantidad), 0) as precio_ud,
           sum(cant_c) as cant, sum(importe) as importe,
           max(por_unidad) as por_unidad
      from l2 group by proveedor_id, nom_n, med, factura_id
  ),
  -- ══ 1. Subida de precio ══
  ultima as (
    select c.* from (
      select c.*, row_number() over (partition by proveedor_id, nom_n, med order by fecha desc, factura_id desc) as rn
        from compras c) c
     where c.rn = 1 and c.fecha >= v_hoy - v_vig_d
  ),
  -- 20261130120000: la referencia es la factura ANTERIOR a la última (regla del dueño:
  -- «el precio que vale es el de la última factura»). Antes era la mediana de 90 días y
  -- avisaba de subidas que no lo eran (piña a 1,80 € en las dos últimas facturas: «+20 %»).
  -- La mediana se queda solo como contexto («lo normal»).
  previa as (
    select x.* from (
      select c.*, row_number() over (partition by proveedor_id, nom_n, med order by fecha desc, factura_id desc) as rn
        from compras c) x
     where x.rn = 2
  ),
  ref_sube as (
    select u.proveedor_id, u.nom_n, u.med,
           p.precio as ref, p.factura_id as factura_ref, p.fecha as fecha_ref, p.precio_ud as ref_ud, p.uni as uni_ref,
           (select (percentile_cont(0.5) within group (order by c.precio))::numeric
              from compras c
             where c.proveedor_id = u.proveedor_id and c.nom_n = u.nom_n and c.med = u.med
               and c.fecha <= u.fecha and c.fecha >= u.fecha - v_ref_d and c.factura_id <> u.factura_id) as contexto,
           (select count(*)
              from compras c
             where c.proveedor_id = u.proveedor_id and c.nom_n = u.nom_n and c.med = u.med
               and c.fecha <= u.fecha and c.fecha >= u.fecha - v_ref_d and c.factura_id <> u.factura_id) as n_ref,
           (select min(c.fecha)
              from compras c
             where c.proveedor_id = u.proveedor_id and c.nom_n = u.nom_n and c.med = u.med
               and c.fecha <= u.fecha and c.fecha >= u.fecha - v_ref_d and c.factura_id <> u.factura_id) as desde_ref
      from ultima u
      join previa p on p.proveedor_id = u.proveedor_id and p.nom_n = u.nom_n and p.med = u.med
     where p.fecha >= u.fecha - v_ref_d
  ),
  gasto_90 as (
    select proveedor_id, nom_n, med, sum(importe) as importe_90, sum(cant) as cant_90
      from compras where fecha > v_hoy - 90 group by 1, 2, 3
  ),
  sube as (
    select u.*, r.ref, r.n_ref, r.desde_ref, r.factura_ref, r.fecha_ref, r.ref_ud, r.uni_ref, r.contexto,
           coalesce(g.importe_90, 0) as importe_90, coalesce(g.cant_90, 0) as cant_90,
           round((u.precio / r.ref - 1) * 100, 1) as var
      from ultima u
      join ref_sube r on r.proveedor_id = u.proveedor_id and r.nom_n = u.nom_n and r.med = u.med
      left join gasto_90 g on g.proveedor_id = u.proveedor_id and g.nom_n = u.nom_n and g.med = u.med
     where r.ref > 0
       and u.precio > r.ref * (1 + v_sub_pct / 100)
       -- Más del doble de una factura a la siguiente casi siempre es otro formato o un precio
       -- mal leído (ginebra de 3,60 a 12,86 €/l): no se avisa (20261130120000; antes ×4).
       and u.precio <= r.ref * 2
  ),
  a_sube as (
    select 'facturas_precio_sube'::text as tipo,
           case when s.var > v_sub_alta or s.importe_90 >= v_relev then 'alta' else 'normal' end as prioridad,
           left(format('Sube %s: +%s %%', coalesce(s.producto_nombre, initcap(s.nombre_linea)), facturas_alertas_num(s.var, 1)), 120) as titulo,
           -- (El texto definitivo lo pone facturas_alerta_subida_texto en facturas_generar_alertas.)
           format('%s (%s): %s €/%s en la factura del %s; en la anterior, del %s, %s €/%s. Precios sin IVA.',
                  s.nombre_linea, coalesce(pv.nombre, '?'),
                  facturas_alertas_num(s.precio, 2), s.med, to_char(s.fecha, 'DD/MM/YYYY'),
                  to_char(s.fecha_ref, 'DD/MM/YYYY'), facturas_alertas_num(s.ref, 2), s.med) as mensaje,
           format('precio_sube:%s:%s:%s:%s', s.proveedor_id, md5(s.nom_n), s.med, s.factura_id) as clave,
           (s.fecha + v_vig_d + 15)::timestamptz as caduca_en,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&doc=' || s.factura_id,
             'factura_id', s.factura_id, 'fecha', s.fecha, 'mes', to_char(s.fecha, 'YYYY-MM'),
             'desde', s.fecha, 'hasta', s.fecha, 'local', s.loc,
             'proveedor_id', s.proveedor_id, 'proveedor', pv.nombre,
             'familia_id', s.fam, 'producto_id', s.producto_id,
             'producto', s.nombre_linea, 'nombre_normalizado', s.nom_n, 'unidad', s.uni, 'medida', s.med,
             'precio', round(s.precio, 4), 'precio_ref', round(s.ref, 4),
             'precio_ud', round(s.precio_ud, 4),
             'precio_ref_ud', round(case when s.uni_ref = s.uni then s.ref_ud
                                         when s.med <> s.uni and s.por_unidad > 0 then s.ref * s.por_unidad else s.ref end, 4),
             'desde_ref', s.desde_ref, 'compras_ref', s.n_ref,
             -- 20261130120000: la factura con la que se compara (la anterior) y la mediana como contexto.
             'factura_ref_id', s.factura_ref, 'factura_otro_id', s.factura_ref, 'fecha_ref', s.fecha_ref,
             'precio_contexto', round(s.contexto, 4), 'cantidad_90', round(s.cant_90, 2), 'referencia', 'factura_anterior',
             'variacion_pct', s.var, 'importe_90', round(s.importe_90, 2), 'umbral_pct', v_sub_pct) as datos
      from sube s
      left join proveedores pv on pv.id = s.proveedor_id
  ),
  -- ══ 2. Más barato en otro proveedor (mismo producto del catálogo, €/l o €/kg) ══
  pp as (
    -- 20261130120000: el precio de cada proveedor es el de su ÚLTIMA factura (antes, la
    -- mediana de 90 días), y su factura, esa (antes, el id más alto, que no siempre es la última).
    select producto_id, med, proveedor_id,
           (array_agg(precio order by fecha desc, factura_id desc))[1] as precio,
           count(*) as n, sum(cant) as cant, max(fecha) as ultima,
           (array_agg(factura_id order by fecha desc, factura_id desc))[1] as ult_factura,
           max(loc) as loc, max(fam) as fam, max(producto_nombre) as producto_nombre
      from compras
     where producto_id is not null and med in ('l', 'kg') and fecha > v_hoy - v_otro_d
     group by 1, 2, 3
  ),
  habitual as (
    select x.* from (
      select c.producto_id, c.med, c.proveedor_id, c.fecha, c.factura_id,
             row_number() over (partition by c.producto_id, c.med order by c.fecha desc, c.factura_id desc) as rn
        from compras c
       where c.producto_id is not null and c.med in ('l', 'kg') and c.fecha > v_hoy - v_otro_d) x
     where x.rn = 1 and x.fecha >= v_hoy - v_vig_d
  ),
  mejor as (
    select h.producto_id, h.med, h.proveedor_id as prov_hab, h.factura_id as factura_hab, h.fecha as fecha_hab,
           ph.precio as precio_hab, ph.cant as cant_hab, ph.loc, ph.fam, ph.producto_nombre,
           o.proveedor_id as prov_otro, o.precio as precio_otro, o.n as n_otro, o.ultima as ultima_otro, o.ult_factura as factura_otro,
           round((1 - o.precio / ph.precio) * 100, 1) as dif,
           (ph.precio - o.precio) * ph.cant as ahorro
      from habitual h
      join pp ph on ph.producto_id = h.producto_id and ph.med = h.med and ph.proveedor_id = h.proveedor_id
      cross join lateral (
        select o.* from pp o
         where o.producto_id = h.producto_id and o.med = h.med and o.proveedor_id <> h.proveedor_id
           and o.n >= v_otro_n and o.precio < ph.precio * (1 - v_otro_pct / 100)
           -- Mucho más barato (> 45 %) casi siempre es otra calidad o formato (congelado
           -- frente a fresco, «marisco variado»): no se avisa.
           and o.precio >= ph.precio * (1 - v_otro_max / 100)
         order by o.precio limit 1) o
     where (ph.precio - o.precio) * ph.cant >= v_ahorro
  ),
  a_mejor as (
    select 'facturas_precio_mejor'::text,
           case when m.ahorro >= v_ahorro_a then 'alta' else 'normal' end,
           left(format('%s: %s %% más barato en %s', upper(left(m.producto_nombre, 1)) || substr(m.producto_nombre, 2), facturas_alertas_num(m.dif, 0), coalesce(po.nombre, '?')), 120),
           format('%s: en tu última compra, factura de %s del %s, lo pagaste a %s €/%s. %s te lo vendió a %s €/%s en su última factura, del %s: %s € menos cada %s. En %s días compraste unos %s %s: habrías ahorrado unos %s €. Antes de cambiar, mira que sea la misma calidad y el mismo formato. Precios sin IVA.',
                  m.producto_nombre, coalesce(ph.nombre, '?'), to_char(m.fecha_hab, 'DD/MM/YYYY'),
                  facturas_alertas_num(m.precio_hab, 2), m.med,
                  coalesce(po.nombre, 'Otro proveedor'), facturas_alertas_num(m.precio_otro, 2), m.med, to_char(m.ultima_otro, 'DD/MM/YYYY'),
                  facturas_alertas_num(m.precio_hab - m.precio_otro, 2), m.med,
                  v_otro_d, facturas_alertas_num(m.cant_hab, case when m.cant_hab < 10 then 1 else 0 end), m.med,
                  facturas_alertas_num(m.ahorro, 0)),
           format('precio_mejor:%s:%s:%s:%s', m.producto_id, m.med, m.prov_hab, m.prov_otro),
           (v_hoy + 30)::timestamptz,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&doc=' || m.factura_otro,
             'factura_id', m.factura_hab, 'factura_otro_id', m.factura_otro,
             'fecha', m.fecha_hab, 'mes', to_char(m.fecha_hab, 'YYYY-MM'), 'desde', v_hoy - v_otro_d, 'hasta', v_hoy,
             'local', m.loc, 'proveedor_id', m.prov_hab, 'proveedor', ph.nombre,
             'proveedor_otro_id', m.prov_otro, 'proveedor_otro', po.nombre,
             'familia_id', m.fam, 'producto_id', m.producto_id, 'producto', m.producto_nombre, 'medida', m.med,
             'precio', round(m.precio_hab, 4), 'precio_otro', round(m.precio_otro, 4),
             'fecha_otro', m.ultima_otro, 'cantidad_90', round(m.cant_hab, 2), 'referencia', 'ultima_factura',
             'diferencia_pct', m.dif, 'ahorro', round(m.ahorro, 2), 'umbral_pct', v_otro_pct)
      from mejor m
      left join proveedores ph on ph.id = m.prov_hab
      left join proveedores po on po.id = m.prov_otro
  ),
  -- ══ 3. Gasto de una familia ══
  incompletos as (
    select 'casa_tomas'::text as loc, i.mes from meses_compras_incompletos('casa_tomas') i
    union all
    select 'touza', i.mes from meses_compras_incompletos('touza') i
  ),
  fam_mes as (
    select case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
           coalesce(c.padre_id, c.id) as fam,
           date_trunc('month', fa.fecha)::date as mes,
           sum(pf.total) as importe
      from facturas fa
      join productos_factura pf on pf.factura_id = fa.id
      join productos_catalogo pc on pc.id = pf.producto_id
      join categorias_producto c on c.id = pc.categoria_id
     where fa.fecha >= (v_mes_hoy - make_interval(months => v_fam_m + 4))::date
       and fa.fecha <= v_hoy
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and coalesce(c.padre_id, c.id) not in (select id from fuera)
     group by 1, 2, 3
  ),
  -- Meses con documentos de cada local (para saber cuáles son completos).
  meses_loc as (
    select x.loc, x.mes from (
      select case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc, date_trunc('month', fa.fecha)::date as mes
        from facturas fa
       where fa.fecha >= (v_mes_hoy - make_interval(months => v_fam_m + 4))::date and fa.fecha < v_mes_hoy
         and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       group by 1, 2) x
     where not exists (select 1 from incompletos i where i.loc = x.loc and i.mes = x.mes)
  ),
  -- Mes que se evalúa: el en curso (proyectado) y el último completo de cada local.
  objetivo as (
    select l.loc, v_mes_hoy as mes, true as proyectado
      from (select distinct loc from meses_loc) l
     where extract(day from v_hoy) >= v_fam_dia
    union all
    select loc, max(mes), false from meses_loc
     group by loc
    having max(mes) >= (v_mes_hoy - interval '2 months')::date
  ),
  ref_fam as (
    select o.loc, o.mes, o.proyectado, f.fam,
           sum(f.importe) / count(distinct r.mes)::numeric as media_raw,
           count(distinct r.mes) as meses_ref
      from objetivo o
      join lateral (select m.mes from meses_loc m where m.loc = o.loc and m.mes < o.mes order by m.mes desc limit v_fam_m) r on true
      left join fam_mes f on f.loc = o.loc and f.mes = r.mes
     where f.fam is not null
     group by o.loc, o.mes, o.proyectado, f.fam
  ),
  ref_fam2 as (
    -- La media cuenta también los meses SIN compras de esa familia (valen 0).
    select r.*, r.media_raw * r.meses_ref / nullif(t.meses, 0) as media, t.meses as meses_total
      from ref_fam r
      join lateral (select count(*) as meses from (
             select m.mes from meses_loc m where m.loc = r.loc and m.mes < r.mes order by m.mes desc limit v_fam_m) z) t on true
  ),
  fam_alerta as (
    select r.loc, r.mes, r.proyectado, r.fam, r.media, r.meses_ref, r.meses_total,
           coalesce(f.importe, 0) as actual,
           case when r.proyectado then coalesce(f.importe, 0) * v_dias_mes / extract(day from v_hoy) else coalesce(f.importe, 0) end as valor
      from ref_fam2 r
      left join fam_mes f on f.loc = r.loc and f.mes = r.mes and f.fam = r.fam
     where r.meses_total >= 3 and r.meses_ref >= 3
       and r.media >= v_fam_min
  ),
  fam_ok as (
    select a.*, round((a.valor / a.media - 1) * 100, 1) as var, c.nombre as familia
      from fam_alerta a
      join categorias_producto c on c.id = a.fam
     where a.valor > a.media * (1 + v_fam_pct / 100)
       and a.valor - a.media >= v_fam_ext
       and (not a.proyectado or a.actual >= a.media * 0.5)
  ),
  a_fam as (
    select 'facturas_familia_gasto'::text,
           case when f.var > 2 * v_fam_pct then 'alta' else 'normal' end,
           left(case when f.proyectado
                     then format('%s: este mes va a +%s %%', f.familia, facturas_alertas_num(f.var, 0))
                     else format('%s: +%s %% en %s', f.familia, facturas_alertas_num(f.var, 0), facturas_alertas_mes(f.mes, false)) end
                || case when f.loc = 'touza' then ' (Touza)' else '' end, 120),
           case when f.proyectado
                then format('%s%s: llevas %s € (sin IVA) a día %s; a este ritmo el mes acabaría en unos %s €, frente a una media de %s € en los %s meses completos anteriores.',
                            f.familia, case when f.loc = 'touza' then ' en Touza' else '' end,
                            facturas_alertas_num(f.actual, 0), extract(day from v_hoy)::int, facturas_alertas_num(f.valor, 0),
                            facturas_alertas_num(f.media, 0), f.meses_total)
                else format('%s%s: %s € (sin IVA) en %s, frente a una media de %s € en los %s meses completos anteriores.',
                            f.familia, case when f.loc = 'touza' then ' en Touza' else '' end,
                            facturas_alertas_num(f.valor, 0), facturas_alertas_mes(f.mes), facturas_alertas_num(f.media, 0), f.meses_total) end,
           format('familia:%s:%s:%s:%s', f.loc, f.fam, to_char(f.mes, 'YYYY-MM'), case when f.proyectado then 'p' else 'c' end),
           case when f.proyectado then ((f.mes + interval '1 month')::date + 10)::timestamptz
                else ((f.mes + interval '1 month')::date + 75)::timestamptz end,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&mes=' || to_char(f.mes, 'YYYY-MM') || case when f.loc = 'touza' then '&local=touza' else '' end,
             'mes', to_char(f.mes, 'YYYY-MM'), 'desde', f.mes, 'hasta', ((f.mes + interval '1 month')::date - 1),
             'local', f.loc, 'familia_id', f.fam, 'familia', f.familia,
             'proyectado', f.proyectado, 'importe', round(f.actual, 2), 'valor', round(f.valor, 2),
             'media', round(f.media, 2), 'meses_ref', f.meses_total, 'variacion_pct', f.var, 'umbral_pct', v_fam_pct)
      from fam_ok f
  ),
  -- ══ 4. Albaranes sin factura ══
  alb as (
    select fa.proveedor_id, count(*) as n, sum(coalesce(fa.total, 0)) as importe,
           min(fa.fecha) as desde, max(fa.fecha) as hasta, max(fa.id) as max_id, min(fa.id) as min_id,
           max(case when fa.local = 'touza' then 'touza' else 'casa_tomas' end) as loc,
           bool_or(fa.local = 'touza') as hay_touza, bool_or(coalesce(fa.local, '') <> 'touza') as hay_ct
      from facturas fa
     where fa.tipo = 'albaran' and fa.facturado_en_id is null
       and fa.fecha <= v_hoy - v_alb_d and fa.fecha > v_hoy - 365
       -- La factura de un albarán suele llegar el mes siguiente: si ese mes está
       -- incompleto (faltan facturas por subir) no se avisa todavía.
       and not exists (select 1 from incompletos i
                        where i.loc = (case when fa.local = 'touza' then 'touza' else 'casa_tomas' end)
                          and i.mes = (date_trunc('month', fa.fecha) + interval '1 month')::date)
     group by fa.proveedor_id
  ),
  a_alb as (
    select 'facturas_albaran_sin_factura'::text,
           case when a.importe >= v_alb_a then 'alta' else 'normal' end,
           left(format('%s: %s sin factura', coalesce(pv.nombre, 'Proveedor sin identificar'),
                       case when a.n = 1 then '1 albarán' else a.n || ' albaranes' end), 120),
           format('%s de %s sin factura desde hace más de %s días (%s; el más antiguo, del %s). Pide la factura o vincúlalo si ya está.',
                  case when a.n = 1 then '1 albarán' else a.n || ' albaranes' end, coalesce(pv.nombre, 'un proveedor sin identificar'),
                  v_alb_d, case when a.importe = 0 then 'sin importe' else facturas_alertas_num(a.importe, 2) || ' € con IVA' end,
                  to_char(a.desde, 'DD/MM/YYYY')),
           format('albaranes:%s:%s:%s', coalesce(a.proveedor_id::text, 'x'), a.n, a.max_id),
           (v_hoy + 30)::timestamptz,
           jsonb_build_object(
             'enlace', case when a.proveedor_id is not null then '?tab=compras&modo=proveedores&prov=' || a.proveedor_id
                            else '?tab=compras&modo=documentos&doc=' || a.min_id end,
             'factura_id', a.min_id, 'mes', to_char(a.desde, 'YYYY-MM'), 'desde', a.desde, 'hasta', a.hasta,
             'local', case when a.hay_touza and a.hay_ct then null else a.loc end,
             'proveedor_id', a.proveedor_id, 'proveedor', pv.nombre,
             'albaranes', a.n, 'importe', round(a.importe, 2), 'dias', v_alb_d)
      from alb a
      left join proveedores pv on pv.id = a.proveedor_id
  ),
  -- ══ 5. Proveedor nuevo e importe inusual ══
  docs as (
    select fa.id, fa.fecha, fa.tipo::text as tipo, fa.total, fa.proveedor_id,
           case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
           exists (select 1 from facturas x where x.facturado_en_id = fa.id) as agrupa
      from facturas fa
     where fa.proveedor_id is not null
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
  ),
  primero as (
    select d.* from (
      select d.*, row_number() over (partition by d.proveedor_id order by d.fecha, d.id) as rn,
             count(*) over (partition by d.proveedor_id) as n_docs,
             sum(coalesce(d.total, 0)) over (partition by d.proveedor_id) as importe_prov
        from docs d) d
     where d.rn = 1 and d.fecha > v_hoy - v_nuevo_d and d.fecha <= v_hoy
  ),
  a_nuevo as (
    select 'facturas_proveedor_nuevo'::text, 'normal'::text,
           left(format('Proveedor nuevo: %s', coalesce(pv.nombre, '?')), 120),
           format('Primer documento de %s el %s (%s)%s. Comprueba sus datos y que no sea otro proveedor con otro nombre.',
                  coalesce(pv.nombre, '?'), to_char(p.fecha, 'DD/MM/YYYY'),
                  case when coalesce(p.total, 0) = 0 then 'sin importe' else facturas_alertas_num(p.total, 2) || ' € con IVA' end,
                  case when p.n_docs > 1 then format('; ya lleva %s documentos y %s €', p.n_docs, facturas_alertas_num(p.importe_prov, 2)) else '' end),
           format('proveedor_nuevo:%s', p.proveedor_id),
           (p.fecha + v_nuevo_d + 15)::timestamptz,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=proveedores&prov=' || p.proveedor_id,
             'factura_id', p.id, 'fecha', p.fecha, 'mes', to_char(p.fecha, 'YYYY-MM'), 'desde', p.fecha, 'hasta', p.fecha,
             'local', p.loc, 'proveedor_id', p.proveedor_id, 'proveedor', pv.nombre,
             'importe', round(p.total, 2), 'documentos', p.n_docs)
      from primero p
      left join proveedores pv on pv.id = p.proveedor_id
  ),
  inusual as (
    select d.*, r.media, r.n
      from docs d
      cross join lateral (
        select avg(x.total) as media, count(*) as n
          from docs x
         where x.proveedor_id = d.proveedor_id and x.tipo = d.tipo and x.total > 0
           and not x.agrupa and (x.fecha, x.id) < (d.fecha, d.id)) r
     where d.fecha > v_hoy - v_nuevo_d and d.fecha <= v_hoy
       and not d.agrupa and d.total >= v_inu_min
       and r.n >= 3 and r.media > 0 and d.total > v_inu_f * r.media
       -- Luz, agua, alquiler, portes…: varían por temporada y no son «compras raras».
       and coalesce((
             select sum(pf.total) filter (where coalesce(c.padre_id, c.id) in (select s.id from categorias_producto s where s.padre_id is null and s.nombre = 'Servicios')
                                             or coalesce(np.no_producto, false))
                    / nullif(sum(pf.total), 0)
               from productos_factura pf
               left join productos_catalogo pc on pc.id = pf.producto_id
               left join categorias_producto c on c.id = pc.categoria_id
               left join public.nombres_linea_no_producto np
                      on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
                     and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
              where pf.factura_id = d.id), 0) < 0.5
  ),
  a_inusual as (
    select 'facturas_importe_inusual'::text,
           case when i.total > 2 * v_inu_f * i.media then 'alta' else 'normal' end,
           left(format('%s: %s de %s €', coalesce(pv.nombre, '?'), case when i.tipo = 'albaran' then 'albarán' else 'factura' end,
                       facturas_alertas_num(i.total, 0)), 120),
           format('%s de %s del %s por %s € con IVA: %s veces su media (%s € en %s documentos anteriores). Comprueba que el importe esté bien leído.',
                  case when i.tipo = 'albaran' then 'Albarán' else 'Factura' end, coalesce(pv.nombre, '?'), to_char(i.fecha, 'DD/MM/YYYY'),
                  facturas_alertas_num(i.total, 2), facturas_alertas_num(i.total / i.media, 1), facturas_alertas_num(i.media, 2), i.n),
           format('importe_inusual:%s', i.id),
           (i.fecha + v_nuevo_d + 15)::timestamptz,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&doc=' || i.id,
             'factura_id', i.id, 'fecha', i.fecha, 'mes', to_char(i.fecha, 'YYYY-MM'), 'desde', i.fecha, 'hasta', i.fecha,
             'local', i.loc, 'proveedor_id', i.proveedor_id, 'proveedor', pv.nombre,
             'importe', round(i.total, 2), 'media', round(i.media, 2), 'veces', round(i.total / i.media, 1))
      from inusual i
      left join proveedores pv on pv.id = i.proveedor_id
  ),
  -- ══ 6. Revisión: duplicados probables y avisos sin revisar ══
  dnum as (
    select fa.id, fa.fecha, fa.total, fa.tipo::text as tipo,
           coalesce(fa.proveedor_id::text, 'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
           nullif(regexp_replace(upper(coalesce(fa.numero_documento, '')), '[^A-Z0-9]', '', 'g'), '') as num
      from facturas fa
     where not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and fa.fecha > v_hoy - 400
  ),
  dup as (
    select distinct b.id, b.fecha
      from dnum a
      join dnum b on b.prov_k = a.prov_k and b.tipo = a.tipo and b.id > a.id
     where (a.num is not null and a.num = b.num and length(a.num) >= 3 and a.num not like 'SN%')
        or ((a.num is null or b.num is null) and a.fecha = b.fecha and a.total = b.total and coalesce(a.total, 0) <> 0)
  ),
  a_dup as (
    select 'facturas_revision'::text, 'normal'::text,
           format('%s posibles duplicados', count(*)),
           format('%s documentos repiten proveedor, tipo y número (o día y total sin número) con otro. Ábrelos y borra el que sobre: los duplicados suman dos veces.', count(*)),
           format('duplicados:%s:%s', count(*), max(d.id)),
           (v_hoy + 30)::timestamptz,
           jsonb_build_object('enlace', '?tab=compras&modo=documentos&doc=' || min(d.id),
                              'factura_id', min(d.id),
                              'documentos', (select jsonb_agg(z.id order by z.id) from (select id from dup order by id limit 20) z),
                              'cuantos', count(*), 'resumen', 'duplicados')
      from dup d
    having count(*) > 0
  ),
  avisos as (
    select fa.id, fa.created_at
      from facturas fa
     where not coalesce(fa.verificada, false)
       and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))
       and jsonb_typeof(fa.alertas_validacion) = 'array'
       and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a
                    where coalesce(a ->> 'codigo', '') <> 'extraccion_historica')
  ),
  a_avisos as (
    select 'facturas_revision'::text, 'normal'::text,
           format('%s documentos con avisos sin revisar', count(*)),
           format('%s documentos tienen avisos de lectura (importes, IVA, precios raros…) sin revisar desde hace más de %s días. Revísalos y márcalos como verificados.', count(*), v_av_d),
           format('avisos:%s:%s', count(*), max(a.id)),
           (v_hoy + 30)::timestamptz,
           jsonb_build_object('enlace', '?tab=compras&modo=documentos&doc=' || min(a.id),
                              'factura_id', min(a.id),
                              'documentos', (select jsonb_agg(z.id order by z.id) from (select id from avisos order by id limit 20) z),
                              'cuantos', count(*), 'resumen', 'avisos')
      from avisos a
    having count(*) > 0
  )
  select * from a_sube
  union all select * from a_mejor
  union all select * from a_fam
  union all select * from a_alb
  union all select * from a_nuevo
  union all select * from a_inusual
  union all select * from a_dup
  union all select * from a_avisos;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.facturas_alertas_tras_verificar(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 20261130140000_facturas_avisos_al_verificar. p_ids: documentos recién
-- verificados (null = todos los verificados).
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := current_date;
  v_nuevo_d int := coalesce((u ->> 'proveedor_nuevo_dias')::int, 45);
  v_av_d    int := coalesce((u ->> 'avisos_dias')::int, 7);
  v_inu     int := 0;
  v_sil     int := 0;
  v_rev     int := 0;
  v_n       int;
  v_max     bigint;
  v_min     bigint;
  v_docs    jsonb;
  v_clave   text;
begin
  -- ── 1. Importe inusual de documentos verificados a mano ─────────────────────
  -- Silencio por clave ANTES de que exista el aviso (si se verifica antes del cron)
  -- y también si ya existe. Solo documentos recientes: el cron solo mira esos.
  insert into facturas_alertas_silencios (tipo, clave)
  select 'facturas_importe_inusual', 'importe_inusual:' || f.id
    from facturas f
   where coalesce(f.verificada, false) and f.verificacion_origen = 'manual'
     and (p_ids is null or f.id = any(p_ids))
     and (f.fecha > v_hoy - v_nuevo_d - 30
          or exists (select 1 from notificaciones_dashboard n
                      where n.clave = 'importe_inusual:' || f.id
                        and (n.caduca_en is null or n.caduca_en > now() or not n.leida)))
     and not exists (select 1 from facturas_alertas_silencios s where s.clave = 'importe_inusual:' || f.id);
  get diagnostics v_sil = row_count;

  update notificaciones_dashboard n
     set caduca_en = least(coalesce(n.caduca_en, now()), now()), leida = true
    from facturas f
   where n.tipo = 'facturas_importe_inusual'
     and n.clave = 'importe_inusual:' || f.id
     and coalesce(f.verificada, false) and f.verificacion_origen = 'manual'
     and (p_ids is null or f.id = any(p_ids))
     and (n.caduca_en is null or n.caduca_en > now() or not n.leida);
  get diagnostics v_inu = row_count;

  -- ── 2. «N documentos con avisos sin revisar», al día ────────────────────────
  -- Misma regla que facturas_alertas_candidatas (a_avisos).
  select count(*), max(fa.id), min(fa.id)
    into v_n, v_max, v_min
    from facturas fa
   where not coalesce(fa.verificada, false)
     and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))
     and jsonb_typeof(fa.alertas_validacion) = 'array'
     and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a
                  where coalesce(a ->> 'codigo', '') <> 'extraccion_historica');

  if v_n = 0 then
    update notificaciones_dashboard n
       set caduca_en = now(), leida = true
     where n.tipo = 'facturas_revision' and n.datos ->> 'resumen' = 'avisos'
       and (n.caduca_en is null or n.caduca_en > now());
    get diagnostics v_rev = row_count;
  else
    v_clave := format('avisos:%s:%s', v_n, v_max);
    select jsonb_agg(z.id order by z.id) into v_docs
      from (select fa.id
              from facturas fa
             where not coalesce(fa.verificada, false)
               and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))
               and jsonb_typeof(fa.alertas_validacion) = 'array'
               and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a
                            where coalesce(a ->> 'codigo', '') <> 'extraccion_historica')
             order by fa.id limit 20) z;
    -- Solo si han BAJADO (se han verificado): si suben, que lo diga el cron con un aviso nuevo.
    update notificaciones_dashboard n
       set clave = v_clave,
           titulo = format('%s documentos con avisos sin revisar', v_n),
           mensaje = format('%s documentos tienen avisos de lectura (importes, IVA, precios raros…) sin revisar desde hace más de %s días. Revísalos y márcalos como verificados.', v_n, v_av_d),
           datos = n.datos || jsonb_build_object('enlace', '?tab=compras&modo=documentos&doc=' || v_min,
                                                 'factura_id', v_min, 'documentos', v_docs, 'cuantos', v_n)
     where n.tipo = 'facturas_revision' and n.datos ->> 'resumen' = 'avisos'
       and (n.caduca_en is null or n.caduca_en > now())
       and n.clave is distinct from v_clave
       and coalesce((n.datos ->> 'cuantos')::int, 0) > v_n
       and not exists (select 1 from notificaciones_dashboard x where x.clave = v_clave);
    get diagnostics v_rev = row_count;
  end if;

  return jsonb_build_object('inusuales_archivados', v_inu, 'silencios', v_sil,
                            'resumen_actualizado', v_rev, 'sin_revisar', v_n);
end;
$function$
;

commit;
