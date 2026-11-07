set client_encoding = 'UTF8';
-- ============================================================================
-- 20261107300000_facturas_alertas — Alertas de Facturas en la campana y en las
-- gráficas de Análisis (07/11/2026)
-- ----------------------------------------------------------------------------
-- Petición del dueño: «que las gráficas generen alertas, p. ej. lo que ha
-- subido de precio»; las gráficas solas le parecen demasiado generales.
--
-- QUÉ AÑADE
--   1. notificaciones_dashboard + clave (deduplicación, única si no es NULL),
--      caduca_en (pasada esa hora el aviso no se enseña) y datos (jsonb: cifras,
--      enlace del panel, mes, familia, proveedor, producto… para marcar las
--      gráficas). Solo columnas NUEVAS y NULL: nada de lo que ya hay cambia.
--   2. configuracion_facturas.alertas (jsonb): umbrales. Lo que no esté, por
--      defecto (facturas_alertas_umbrales). El % de subida de precio es el
--      umbral_subida_precio_pct de siempre (Facturas › Productos).
--   3. facturas_alertas_candidatas(p_hoy): las alertas que tocan HOY, en una
--      pasada por conjuntos (ventanas, sin funciones fila a fila salvo
--      volumen_linea sobre las líneas de los últimos ~6 meses). Tipos:
--        facturas_precio_sube      última compra > umbral (10 %) sobre la
--                                  MEDIANA de los 90 días anteriores (mismo
--                                  proveedor, mismo texto de línea, misma
--                                  medida: €/l o €/kg si se conoce el envase,
--                                  si no la unidad facturada). Sin atípicos
--                                  (> 3× o < 1/3 de la mediana), sin albaranes
--                                  facturados, sin servicios/portes/envases/
--                                  energía (nombres_linea_no_producto) ni las
--                                  familias Servicios y Menaje. Alta si > 25 %
--                                  o el producto pesa ≥ 500 € en 90 días.
--        facturas_precio_mejor     el mismo producto del CATÁLOGO, en €/l o
--                                  €/kg, > 15 % más barato en otro proveedor
--                                  (90 días, ≥ 2 compras del más barato) que en
--                                  el de la última compra; ahorro ≥ 20 €.
--        facturas_familia_gasto    gasto (base sin IVA, por líneas) de una
--                                  familia en el mes en curso PROYECTADO (desde
--                                  el día 10 y con ≥ 50 % ya gastado) o en el
--                                  último mes completo > 25 % sobre su media de
--                                  los 6 meses COMPLETOS anteriores
--                                  (meses_compras_incompletos), con media
--                                  ≥ 150 € y ≥ 200 € de más. Sin Servicios ni
--                                  Menaje (luz, alquiler, compras sueltas).
--        facturas_albaran_sin_factura  por proveedor: albaranes sin factura de
--                                  más de 35 días (último año).
--        facturas_proveedor_nuevo  primer documento de un proveedor en los
--                                  últimos 45 días.
--        facturas_importe_inusual  documento de los últimos 45 días > 3× la
--                                  media del proveedor (mismo tipo, ≥ 3
--                                  anteriores, ≥ 300 €; no cuenta la factura
--                                  que agrupa albaranes).
--        facturas_revision         resumen: duplicados probables (mismo
--                                  proveedor, tipo y número; o mismo día y
--                                  total sin número) y documentos con avisos
--                                  de lectura sin revisar de más de 7 días
--                                  (no cuenta la nota «extraccion_historica»
--                                  de la importación).
--   4. facturas_generar_alertas(p_hoy): SECURITY DEFINER, solo service_role
--      (cron). Inserta lo nuevo (sin duplicar por clave), actualiza el texto
--      de lo que sigue vigente (sin tocar «leída»), caduca lo que ya no se
--      cumple y borra lo caducado hace > 90 días. Devuelve el recuento.
--   5. facturas_alertas_activas(p_desde, p_hasta, p_local): RPC del panel
--      (INVOKER, pasa por la RLS): las alertas vigentes, por prioridad.
--   6. cron «facturas-alertas» todos los días a las 06:15 (UTC).
-- Test: supabase/tests/facturas_alertas_test.sql
-- Deshacer: supabase/rollbacks/20261107300000_facturas_alertas_ROLLBACK.sql
-- ============================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Columnas nuevas de la campana ───────────────────────────────────────
alter table public.notificaciones_dashboard
  add column if not exists clave text,
  add column if not exists caduca_en timestamptz,
  add column if not exists datos jsonb;

create unique index if not exists notificaciones_dashboard_clave_uq
  on public.notificaciones_dashboard (clave) where clave is not null;
create index if not exists notificaciones_dashboard_tipo_idx
  on public.notificaciones_dashboard (tipo, created_at desc);

comment on column public.notificaciones_dashboard.clave is
  '20261107300000: clave de deduplicación (alertas de Facturas). Única cuando no es NULL.';
comment on column public.notificaciones_dashboard.caduca_en is
  '20261107300000: pasada esta hora el aviso ya no se enseña (NULL = no caduca).';
comment on column public.notificaciones_dashboard.datos is
  '20261107300000: datos de la alerta (enlace del panel, cifras, mes, familia, proveedor, producto) para la campana y las gráficas.';

-- ─── 2. Umbrales ────────────────────────────────────────────────────────────
alter table public.configuracion_facturas
  add column if not exists alertas jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'configuracion_facturas_alertas_obj') then
    alter table public.configuracion_facturas
      add constraint configuracion_facturas_alertas_obj check (jsonb_typeof(alertas) = 'object');
  end if;
end $$;

comment on column public.configuracion_facturas.alertas is
  '20261107300000: umbrales de las alertas de Facturas (lo que falte, por defecto: ver facturas_alertas_umbrales()).';

insert into public.configuracion_facturas (id) values (true) on conflict (id) do nothing;

create or replace function public.facturas_alertas_umbrales()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas
  select jsonb_build_object(
           'subida_pct',               10,
           'subida_alta_pct',          25,
           'subida_ref_dias',          90,
           'subida_vigencia_dias',     45,
           'gasto_relevante_eur',      500,
           'otro_proveedor_pct',       15,
           'otro_proveedor_dias',      90,
           'otro_proveedor_compras',   2,
           'otro_proveedor_max_pct',   45,
           'ahorro_minimo_eur',        20,
           'ahorro_alto_eur',          150,
           'familia_pct',              25,
           'familia_meses',            6,
           'familia_media_min_eur',    150,
           'familia_extra_min_eur',    200,
           'familia_dia_minimo',       10,
           'albaran_dias',             35,
           'albaran_alto_eur',         1000,
           'proveedor_nuevo_dias',     45,
           'importe_inusual_factor',   3,
           'importe_inusual_min_eur',  300,
           'avisos_dias',              7)
         || coalesce((select c.alertas from configuracion_facturas c where c.id), '{}'::jsonb)
         || coalesce((select jsonb_build_object('subida_pct', c.umbral_subida_precio_pct)
                        from configuracion_facturas c where c.id), '{}'::jsonb)
$$;

-- Números y fechas en español para los textos («1.234,50», «21/10/2026»).
create or replace function public.facturas_alertas_num(p numeric, p_dec int default 2)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p is null then '—'
           when abs(p) >= 10000 then translate(to_char(round(p, p_dec),
                  case when p_dec = 0 then 'FM999,999,990' else 'FM999,999,990.' || repeat('0', p_dec) end), ',.', '.,')
           else translate(to_char(round(p, p_dec),
                  case when p_dec = 0 then 'FM9990' else 'FM9990.' || repeat('0', p_dec) end), '.', ',')
         end
$$;

create or replace function public.facturas_alertas_mes(p date, p_anio boolean default true)
returns text
language sql
immutable
set search_path = public
as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])
           [extract(month from p)::int]
         || case when p_anio then ' de ' || extract(year from p)::int else '' end
$$;

-- ─── 3. Candidatas: las alertas que tocan hoy ───────────────────────────────
create or replace function public.facturas_alertas_candidatas(p_hoy date default current_date)
returns table (tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb)
language plpgsql
stable
security invoker
set search_path = public
-- Las CTE no tienen estadísticas: el planificador cruzaba compras × últimas compras con
-- bucles anidados (1,6 M comparaciones, ~0,25 s). Con hash, toda la función < 0,6 s.
set enable_nestloop = off
as $$
#variable_conflict use_column
-- 20261107300000_facturas_alertas
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
  -- Referencia: mediana de las compras de los 90 días ANTERIORES a la última (sin ella).
  ref_sube as (
    select u.proveedor_id, u.nom_n, u.med,
           (percentile_cont(0.5) within group (order by c.precio))::numeric as ref, count(*) as n_ref, min(c.fecha) as desde_ref
      from ultima u
      join compras c on c.proveedor_id = u.proveedor_id and c.nom_n = u.nom_n and c.med = u.med
     where c.fecha < u.fecha and c.fecha >= u.fecha - v_ref_d
     group by 1, 2, 3
  ),
  gasto_90 as (
    select proveedor_id, nom_n, med, sum(importe) as importe_90
      from compras where fecha > v_hoy - 90 group by 1, 2, 3
  ),
  sube as (
    select u.*, r.ref, r.n_ref, r.desde_ref, coalesce(g.importe_90, 0) as importe_90,
           round((u.precio / r.ref - 1) * 100, 1) as var
      from ultima u
      join ref_sube r on r.proveedor_id = u.proveedor_id and r.nom_n = u.nom_n and r.med = u.med
      left join gasto_90 g on g.proveedor_id = u.proveedor_id and g.nom_n = u.nom_n and g.med = u.med
     where r.n_ref >= 2 and r.ref > 0
       and u.precio > r.ref * (1 + v_sub_pct / 100)
       -- Más de ×4 suele ser un cambio de formato con la misma unidad, no una subida.
       and u.precio <= r.ref * 4
  ),
  a_sube as (
    select 'facturas_precio_sube'::text as tipo,
           case when s.var > v_sub_alta or s.importe_90 >= v_relev then 'alta' else 'normal' end as prioridad,
           left(format('Sube %s: +%s %%', coalesce(s.producto_nombre, initcap(s.nombre_linea)), facturas_alertas_num(s.var, 1)), 120) as titulo,
           format('%s (%s): %s €/%s el %s frente a %s €/%s de referencia (mediana de %s compras en los %s días anteriores). Precios sin IVA.%s',
                  s.nombre_linea, coalesce(pv.nombre, '?'),
                  facturas_alertas_num(s.precio, case when s.precio < 10 then 3 else 2 end), s.med, to_char(s.fecha, 'DD/MM/YYYY'),
                  facturas_alertas_num(s.ref, case when s.ref < 10 then 3 else 2 end), s.med, s.n_ref, v_ref_d,
                  case when s.importe_90 >= v_relev then format(' Llevas %s € en 90 días.', facturas_alertas_num(s.importe_90, 0)) else '' end) as mensaje,
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
             'precio_ref_ud', round(case when s.med <> s.uni and s.por_unidad > 0 then s.ref * s.por_unidad else s.ref end, 4),
             'desde_ref', s.desde_ref, 'compras_ref', s.n_ref,
             'variacion_pct', s.var, 'importe_90', round(s.importe_90, 2), 'umbral_pct', v_sub_pct) as datos
      from sube s
      left join proveedores pv on pv.id = s.proveedor_id
  ),
  -- ══ 2. Más barato en otro proveedor (mismo producto del catálogo, €/l o €/kg) ══
  pp as (
    select producto_id, med, proveedor_id,
           (percentile_cont(0.5) within group (order by precio))::numeric as precio,
           count(*) as n, sum(cant) as cant, max(fecha) as ultima, max(factura_id) as ult_factura,
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
           format('%s: %s €/%s en %s (%s compras en %s días) frente a %s €/%s en %s, donde compraste el %s. Con lo comprado en ese tiempo serían unos %s € menos. Precios sin IVA; comprueba que es la misma calidad.',
                  m.producto_nombre, facturas_alertas_num(m.precio_otro, 2), m.med, coalesce(po.nombre, '?'), m.n_otro, v_otro_d,
                  facturas_alertas_num(m.precio_hab, 2), m.med, coalesce(ph.nombre, '?'), to_char(m.fecha_hab, 'DD/MM/YYYY'),
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
$$;

comment on function public.facturas_alertas_candidatas(date) is
  'Alertas de Facturas que tocan el día p_hoy (subida de precio, más barato en otro proveedor, gasto de familia, albaranes sin factura, proveedor nuevo, importe inusual, revisión). SECURITY INVOKER. 20261107300000.';

-- ─── 4. Generación (cron) ───────────────────────────────────────────────────
create or replace function public.facturas_generar_alertas(p_hoy date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261107300000_facturas_alertas
declare
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_total   int;
  v_por     jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(p_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca.
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en) is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en);
  get diagnostics v_act = row_count;

  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (precio corregido, albarán facturado, duplicado borrado…) caduca ya.
  -- Caducada = también «leída»: el número rojo de «Avisos» (cuenta las no leídas) no la cuenta.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  -- Limpieza: caducadas hace más de 90 días (su clave ya no puede volver: las reglas miran fechas recientes).
  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;

  select count(*), coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_total, v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'por_tipo', v_por);
end;
$$;

comment on function public.facturas_generar_alertas(date) is
  'Genera las alertas de Facturas en notificaciones_dashboard (sin duplicar por clave; caduca las que ya no se cumplen). SECURITY DEFINER, solo service_role (cron facturas-alertas). 20261107300000.';

-- ─── 5. Lectura para el panel ───────────────────────────────────────────────
create or replace function public.facturas_alertas_activas(
  p_desde date default null, p_hasta date default null, p_local text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas. Vigentes, de más a menos importante. Con
  -- periodo: las que tocan ese periodo (datos.desde … datos.hasta). Con local:
  -- las de ese local y las de los dos.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'tipo', n.tipo, 'prioridad', n.prioridad, 'titulo', n.titulo, 'mensaje', n.mensaje,
           'leida', n.leida, 'creada', n.created_at, 'caduca', n.caduca_en, 'datos', n.datos)
         order by (n.prioridad = 'alta') desc, n.leida, n.created_at desc, n.id), '[]'::jsonb)
    from notificaciones_dashboard n
   where (select can_read_section('facturas'))
     and n.tipo in ('facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                    'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                    'facturas_revision')
     and (n.caduca_en is null or n.caduca_en > now())
     and (p_desde is null or coalesce((n.datos ->> 'hasta')::date, p_desde) >= p_desde)
     and (p_hasta is null or coalesce((n.datos ->> 'desde')::date, p_hasta) <= p_hasta)
     and (nullif(p_local, '') is null or n.datos ->> 'local' is null or n.datos ->> 'local' = p_local)
$$;

comment on function public.facturas_alertas_activas(date, date, text) is
  'Facturas › Análisis: alertas vigentes (tarjeta «Requiere atención» y marcas en las gráficas). SECURITY INVOKER. 20261107300000.';

-- ─── Permisos ───────────────────────────────────────────────────────────────
revoke all on function public.facturas_alertas_umbrales() from public, anon;
revoke all on function public.facturas_alertas_num(numeric, int) from public, anon;
revoke all on function public.facturas_alertas_mes(date, boolean) from public, anon;
revoke all on function public.facturas_alertas_candidatas(date) from public, anon, authenticated;
revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;
revoke all on function public.facturas_alertas_activas(date, date, text) from public, anon;
grant execute on function public.facturas_alertas_umbrales() to authenticated, service_role;
grant execute on function public.facturas_alertas_num(numeric, int) to authenticated, service_role;
grant execute on function public.facturas_alertas_mes(date, boolean) to authenticated, service_role;
grant execute on function public.facturas_alertas_candidatas(date) to service_role;
grant execute on function public.facturas_generar_alertas(date) to service_role;
grant execute on function public.facturas_alertas_activas(date, date, text) to authenticated, service_role;

-- ─── 6. Cron diario ─────────────────────────────────────────────────────────
select cron.unschedule('facturas-alertas')
 where exists (select 1 from cron.job where jobname = 'facturas-alertas');
select cron.schedule('facturas-alertas', '15 6 * * *',
  $cron$ select public.facturas_generar_alertas(); $cron$);

-- ─── Comprobación final ─────────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from cron.job where jobname = 'facturas-alertas') <> 1 then
    v_malos := v_malos || 'el cron facturas-alertas no quedó instalado una vez'::text;
  end if;
  if has_function_privilege('authenticated', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('anon', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_candidatas(date)', 'execute')
     or has_function_privilege('anon', 'public.facturas_alertas_activas(date,date,text)', 'execute') then
    v_malos := v_malos || 'permisos de ejecución de más'::text;
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.facturas_generar_alertas(date)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.facturas_alertas_activas(date,date,text)'::regprocedure) then
    v_malos := v_malos || 'SECURITY DEFINER/INVOKER al revés'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'facturas_alertas: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

select 'facturas_alertas: aplicada | ' || public.facturas_generar_alertas()::text as resultado;
