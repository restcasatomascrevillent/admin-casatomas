set client_encoding = 'UTF8';
-- ============================================================================
-- 20261130120000_decidir_ultima_factura · Facturas › Análisis › «Qué decidir hoy»
-- ----------------------------------------------------------------------------
-- Queja del dueño (14/11/2026): «se equivoca mucho, las facturas no dicen nada».
-- Causa: las subidas, bajadas y «más barato en otro proveedor» comparaban con la
-- MEDIANA de 90 días, no con la última factura. Ejemplos de la demo: piña a 1,80 €/kg
-- en las dos últimas facturas salía «+20 %»; percebe a 140 € frente a 119 € de la
-- factura anterior salía «+29 %».
-- Regla de negocio: el precio de referencia es el de la ÚLTIMA factura registrada de
-- ese producto; las anteriores solo dan contexto.
--   1. facturas_alertas_candidatas: subida = última factura frente a la ANTERIOR del
--      mismo proveedor y producto (datos.factura_ref_id / fecha_ref / factura_otro_id,
--      para «Comparar facturas»); más barato en otro proveedor = última factura de cada
--      uno (antes, la mediana) y su factura de verdad (antes, el id más alto).
--   2. facturas_alertas_candidatas_extra: las bajadas, igual que las subidas.
--   3. facturas_alerta_subida_texto: texto en frases cortas (qué ha pasado, cuánto al
--      mes, qué hacer).
-- No toca facturas_decision ni facturas_generar_alertas (compartidas con el chatbot).
-- Después de aplicarla: select public.facturas_generar_alertas(); rehace los avisos.
-- Rollback: supabase/rollbacks/20261130120000_decidir_ultima_factura_ROLLBACK.sql
-- ============================================================================
begin;

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

CREATE OR REPLACE FUNCTION public.facturas_alertas_candidatas_extra(p_hoy date DEFAULT CURRENT_DATE)
 RETURNS TABLE(tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamp with time zone, datos jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
#variable_conflict use_column
-- 20261115100000_facturas_decision · 20261130120000_decidir_ultima_factura (referencia = factura anterior)
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := coalesce(p_hoy, current_date);
  v_ref_d   int := (u ->> 'subida_ref_dias')::int;
  v_vig_d   int := (u ->> 'subida_vigencia_dias')::int;
  v_baja    numeric := (u ->> 'baja_pct')::numeric;
  v_baja_n  int := (u ->> 'baja_compras')::int;
  v_pac     numeric := (u ->> 'pactado_pct')::numeric;
begin
  return query
  with
  c as materialized (
    select * from public.facturas_alertas_compras(v_hoy - (v_ref_d + v_vig_d), v_hoy)
  ),
  ultima as (
    select x.* from (
      select c.*, row_number() over (partition by c.proveedor_id, c.nom_n, c.med order by c.fecha desc, c.factura_id desc) as rn
        from c) x
     where x.rn = 1 and x.fecha >= v_hoy - v_vig_d
  ),
  -- 20261130120000: la referencia es la factura ANTERIOR a la última (antes, la mediana de 90 días).
  previa as (
    select x.* from (
      select c.*, row_number() over (partition by c.proveedor_id, c.nom_n, c.med order by c.fecha desc, c.factura_id desc) as rn
        from c) x
     where x.rn = 2
  ),
  ref as (
    select u.proveedor_id, u.nom_n, u.med, p.precio as ref, p.factura_id as factura_ref, p.fecha as fecha_ref,
           (select count(*) from c c2 where c2.proveedor_id = u.proveedor_id and c2.nom_n = u.nom_n and c2.med = u.med
               and c2.fecha <= u.fecha and c2.fecha >= u.fecha - v_ref_d and c2.factura_id <> u.factura_id) as n_ref,
           (select min(c2.fecha) from c c2 where c2.proveedor_id = u.proveedor_id and c2.nom_n = u.nom_n and c2.med = u.med
               and c2.fecha <= u.fecha and c2.fecha >= u.fecha - v_ref_d and c2.factura_id <> u.factura_id) as desde_ref
      from ultima u
      join previa p on p.proveedor_id = u.proveedor_id and p.nom_n = u.nom_n and p.med = u.med
     where p.fecha >= u.fecha - v_ref_d
  ),
  g90 as (
    select proveedor_id, nom_n, med, sum(importe) as importe_90, count(*) as compras_90, sum(cant) as cant_90
      from c where fecha > v_hoy - 90 group by 1, 2, 3
  ),
  baja as (
    select u.*, r.ref, r.n_ref, r.desde_ref, r.factura_ref, r.fecha_ref, g.importe_90, g.compras_90, g.cant_90,
           round((u.precio / r.ref - 1) * 100, 1) as var,
           round((r.ref - u.precio) / r.ref * g.importe_90 / 3, 2) as impacto
      from ultima u
      join ref r on r.proveedor_id = u.proveedor_id and r.nom_n = u.nom_n and r.med = u.med
      join g90 g on g.proveedor_id = u.proveedor_id and g.nom_n = u.nom_n and g.med = u.med
     where r.ref > 0 and g.compras_90 >= v_baja_n
       and u.precio < r.ref * (1 - v_baja / 100)
       -- Menos de la mitad suele ser otro formato o un precio mal leído (20261130120000; antes /4).
       and u.precio >= r.ref / 2
  ),
  a_baja as (
    select 'facturas_precio_baja'::text as tipo, 'normal'::text as prioridad,
           left(format('Baja %s: %s %%', coalesce(b.producto_nombre, initcap(b.nombre_linea)), facturas_alertas_num(b.var, 1)), 120) as titulo,
           format('%s de %s ha bajado: en la factura del %s lo pagaste a %s €/%s y en la anterior, del %s, a %s €/%s (%s € menos cada %s). Lo compras a menudo (%s veces en 90 días): puede ser buen momento para comprar más. Precios sin IVA.',
                  coalesce(b.producto_nombre, initcap(b.nombre_linea)), coalesce(pv.nombre, '?'), to_char(b.fecha, 'DD/MM/YYYY'),
                  facturas_alertas_num(b.precio, 2), b.med, to_char(b.fecha_ref, 'DD/MM/YYYY'), facturas_alertas_num(b.ref, 2), b.med,
                  facturas_alertas_num(b.ref - b.precio, 2), b.med, b.compras_90) as mensaje,
           format('precio_baja:%s:%s:%s:%s', b.proveedor_id, md5(b.nom_n), b.med, b.factura_id) as clave,
           (b.fecha + v_vig_d)::timestamptz as caduca_en,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&doc=' || b.factura_id,
             'factura_id', b.factura_id, 'fecha', b.fecha, 'mes', to_char(b.fecha, 'YYYY-MM'),
             'desde', b.fecha, 'hasta', b.fecha, 'local', b.loc,
             'proveedor_id', b.proveedor_id, 'proveedor', pv.nombre, 'familia_id', b.fam, 'producto_id', b.producto_id,
             'producto', b.nombre_linea, 'nombre_normalizado', b.nom_n, 'unidad', b.uni, 'medida', b.med,
             'precio', round(b.precio, 4), 'precio_ref', round(b.ref, 4), 'precio_ud', round(b.precio_ud, 4),
             'desde_ref', b.desde_ref, 'compras_ref', b.n_ref, 'compras_90', b.compras_90,
             'factura_ref_id', b.factura_ref, 'factura_otro_id', b.factura_ref, 'fecha_ref', b.fecha_ref,
             'cantidad_90', round(b.cant_90, 2), 'referencia', 'factura_anterior',
             'variacion_pct', b.var, 'importe_90', round(b.importe_90, 2), 'impacto_mes', b.impacto,
             'umbral_pct', v_baja) as datos
      from baja b
      left join proveedores pv on pv.id = b.proveedor_id
  ),
  -- Precio pactado: cualquier compra posterior al pacto (y de los últimos 45 días) con otro precio por unidad.
  pac as (
    select p.id as pacto_id, p.precio as pactado, p.unidad as pacto_unidad, p.producto as pacto_producto, x.*,
           round((x.precio_ud / p.precio - 1) * 100, 1) as var
      from facturas_precios_pactados p
      join c x on x.proveedor_id = p.proveedor_id and x.nom_n = p.nombre_normalizado
                and (p.unidad is null or x.uni = lower(btrim(p.unidad)))
     where x.fecha >= greatest(p.created_at::date, v_hoy - v_vig_d)
       and abs(x.precio_ud / p.precio - 1) * 100 >= v_pac
  ),
  a_pac as (
    select 'facturas_precio_pactado'::text, 'alta'::text,
           left(format('Precio pactado roto: %s (%s%s %%)', coalesce(p.pacto_producto, p.producto_nombre, initcap(p.nombre_linea)),
                       case when p.var > 0 then '+' else '' end, facturas_alertas_num(p.var, 1)), 120),
           format('%s (%s): %s € por %s el %s; el precio pactado es %s €. Revisa la factura y reclama si no está justificado.',
                  p.nombre_linea, coalesce(pv.nombre, '?'), facturas_alertas_num(p.precio_ud, 2), p.uni,
                  to_char(p.fecha, 'DD/MM/YYYY'), facturas_alertas_num(p.pactado, 2)),
           format('precio_pactado:%s:%s', p.pacto_id, p.factura_id),
           (p.fecha + v_vig_d)::timestamptz,
           jsonb_build_object(
             'enlace', '?tab=compras&modo=documentos&doc=' || p.factura_id,
             'factura_id', p.factura_id, 'fecha', p.fecha, 'mes', to_char(p.fecha, 'YYYY-MM'),
             'desde', p.fecha, 'hasta', p.fecha, 'local', p.loc,
             'proveedor_id', p.proveedor_id, 'proveedor', pv.nombre, 'familia_id', p.fam, 'producto_id', p.producto_id,
             'producto', p.nombre_linea, 'nombre_normalizado', p.nom_n, 'unidad', p.uni, 'medida', p.med,
             'precio', round(p.precio_ud, 4), 'precio_ref', p.pactado, 'precio_ud', round(p.precio_ud, 4),
             'precio_pactado', p.pactado, 'pacto_id', p.pacto_id, 'variacion_pct', p.var, 'umbral_pct', v_pac)
      from pac p
      left join proveedores pv on pv.id = p.proveedor_id
  )
  select * from a_baja
  union all
  select * from a_pac;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.facturas_alerta_subida_texto(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261125110000_avisos_margen_bajo · 20261130120000_decidir_ultima_factura: el texto
-- compara la ÚLTIMA factura con la ANTERIOR (la que es la referencia), en frases cortas:
-- qué ha pasado, cuánto cuesta al mes y qué se puede hacer.
declare
  v_nombre  text;
  v_prov    text := coalesce(p ->> 'proveedor', 'su proveedor');
  v_med     text := coalesce(p ->> 'medida', 'ud');
  v_precio  numeric := (p ->> 'precio')::numeric;
  v_ref     numeric := (p ->> 'precio_ref')::numeric;
  v_fecha   date := (p ->> 'fecha')::date;
  v_fref    date := case when (p ->> 'fecha_ref') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'fecha_ref')::date end;
  v_fid_ref bigint := case when (p ->> 'factura_ref_id') ~ '^[0-9]{1,18}$' then (p ->> 'factura_ref_id')::bigint end;
  v_var     numeric := (p ->> 'variacion_pct')::numeric;
  v_imp     numeric := (p ->> 'impacto_mes')::numeric;
  v_cant    numeric := (p ->> 'cantidad_90')::numeric;
  v_usos    text[];
  v_n_usos  int;
  v_lista   text;
  v_unidad  text;
  v_cada    text;
  v_msg     text;
  v_tg      text;
begin
  if v_precio is null or v_ref is null or v_fecha is null then
    return null;
  end if;
  select pc.nombre::text into v_nombre from productos_catalogo pc where pc.id = (p ->> 'producto_id')::bigint;
  v_nombre := coalesce(v_nombre, initcap(p ->> 'producto'), 'El producto');
  v_unidad := case v_med when 'kg' then '€/kg' when 'l' then '€/l' else '€/' || v_med end;
  v_cada := case v_med when 'kg' then 'kilo' when 'l' then 'litro' else v_med end;

  -- Qué platos y vinos de la carta usan ese producto.
  select array_agg(x.nombre order by x.nombre), count(*)
    into v_usos, v_n_usos
    from (select distinct p2.nombre::text as nombre
            from escandallo_platos e join "Platos" p2 on p2.id = e.plato_id
           where e.producto_id = (p ->> 'producto_id')::bigint and p2.activado and p2.restaurante
          union
          select distinct v.nombre::text
            from vino_producto vp join "Vinos" v on v.id = vp.vino_id
           where vp.producto_id = (p ->> 'producto_id')::bigint and v.activado and v.restaurante) x;
  if coalesce(v_n_usos, 0) > 0 then
    v_lista := array_to_string(v_usos[1:4], ', ')
               || case when v_n_usos > 4 then format(' y %s más', v_n_usos - 4) else '' end;
  end if;

  v_msg := format('En la factura de %s del %s pagaste %s a %s %s', v_prov, to_char(v_fecha, 'DD/MM'), v_nombre,
                  facturas_alertas_num(v_precio, 2), v_unidad)
           || case when v_fref is not null
                   then format('. En la factura anterior, del %s, estaba a %s %s', to_char(v_fref, 'DD/MM'), facturas_alertas_num(v_ref, 2), v_unidad)
                   else format('. Antes estaba a %s %s', facturas_alertas_num(v_ref, 2), v_unidad) end
           || format(': %s € más por cada %s (un %s %% más).', facturas_alertas_num(v_precio - v_ref, 2), v_cada, facturas_alertas_num(v_var, 0))
           || case when v_imp >= 1 and v_cant > 0
                   then format(' Compras unos %s %s al mes, así que te cuesta unos %s € más al mes.',
                               facturas_alertas_num(v_cant / 3, case when v_cant / 3 < 10 then 1 else 0 end), v_med, facturas_alertas_num(v_imp, 0))
                   when v_imp >= 1 then format(' Con lo que compras, son unos %s € más al mes.', facturas_alertas_num(v_imp, 0))
                   else '' end
           || case when v_lista is not null then format(' Lo usa la carta en: %s.', v_lista) else '' end
           || format(' Qué puedes hacer: pregunta a %s por qué ha subido o mira si otro proveedor te lo deja más barato. Precios sin IVA.', v_prov);
  v_tg := format('%s (%s) ha subido un %s %%: %s %s en la factura del %s; en la anterior%s, %s %s.',
                 v_nombre, v_prov, facturas_alertas_num(v_var, 0), facturas_alertas_num(v_precio, 2), v_unidad,
                 to_char(v_fecha, 'DD/MM'), case when v_fref is not null then ' (' || to_char(v_fref, 'DD/MM') || ')' else '' end,
                 facturas_alertas_num(v_ref, 2), v_unidad)
          || case when v_lista is not null then format(' Lo usan: %s.', v_lista) else '' end;

  return jsonb_build_object(
    'titulo', left(format('%s sube un %s %% en %s', v_nombre, facturas_alertas_num(v_var, 0), v_prov), 120),
    'mensaje', v_msg,
    'datos', jsonb_build_object(
      'texto_telegram', v_tg,
      'compra_anterior', case when v_fid_ref is not null then jsonb_build_object(
          'factura_id', v_fid_ref, 'fecha', v_fref, 'precio', round(v_ref, 4)) end,
      'usos_carta', to_jsonb(coalesce(v_usos, '{}'::text[]))));
end;
$function$
;

revoke all on function public.facturas_alertas_candidatas(date) from public, anon, authenticated;
grant execute on function public.facturas_alertas_candidatas(date) to service_role;
revoke all on function public.facturas_alertas_candidatas_extra(date) from public, anon, authenticated;
grant execute on function public.facturas_alertas_candidatas_extra(date) to service_role;
revoke all on function public.facturas_alerta_subida_texto(jsonb) from public, anon, authenticated;
grant execute on function public.facturas_alerta_subida_texto(jsonb) to service_role;

commit;
