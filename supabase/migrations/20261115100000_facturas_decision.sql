set client_encoding = 'UTF8';
-- ============================================================================
-- 20261115100000_facturas_decision — «Gráficas de decisión» de Facturas ›
-- Análisis y avisos de precio nuevos (15/11/2026)
-- ----------------------------------------------------------------------------
-- Maqueta aprobada por el dueño: cuatro preguntas (¿en qué se va el dinero?,
-- ¿qué me están subiendo?, ¿cómo van los precios de lo que más compro?,
-- ¿dónde puedo ahorrar?) y avisos de precio por EUROS, no por porcentaje.
--
-- QUÉ AÑADE (sobre 20261107300000_facturas_alertas, que no se toca)
--   1. facturas_alertas_silencios: «Visto» (esa alerta, por clave, para
--      siempre) y «Es normal» (ese producto + tipo, 90 días). La generación
--      diaria los respeta. RLS de lectura con (select can_read_section(...)).
--   2. facturas_precios_pactados: precio pactado por proveedor + línea
--      (nombre normalizado, unidad). RLS igual. Se escribe por RPC.
--   3. facturas_alertas_umbrales(): claves nuevas (campana_impacto_min_eur 10,
--      proveedor_subidas_min 3, proveedor_dias 7, baja_pct 10, baja_compras 3,
--      pactado_pct 1, silencio_dias 90). Se pueden cambiar en
--      configuracion_facturas.alertas como las de siempre.
--   4. facturas_alertas_compras(desde, hasta): las compras con precio
--      comparable (la misma pasada que facturas_alertas_candidatas).
--   5. facturas_alertas_candidatas_extra(hoy): facturas_precio_baja (producto
--      comprado ≥ 3 veces en 90 días que baja > 10 % sobre la mediana de los 90
--      días anteriores) y facturas_precio_pactado (una compra posterior al
--      pacto con el precio por unidad cambiado ≥ 1 %).
--   6. facturas_generar_alertas(hoy) (se redefine): además de lo de siempre,
--        · datos.impacto_mes en facturas_precio_sube y _baja:
--          (precio − ref) / precio × importe_90 / 3 (€ al mes que cuesta o
--          ahorra la subida o bajada con lo que se compra);
--        · datos.campana = false cuando el impacto es < campana_impacto_min_eur:
--          sale en la tarjeta de Análisis, NO en la campana (se inserta ya
--          leída y el panel la filtra de la campana);
--        · facturas_precio_proveedor: un proveedor que sube ≥ 3 productos en
--          7 días, en un solo aviso; esas subidas sueltas no van a la campana;
--        · silencios: lo silenciado no se genera (y lo vigente caduca).
--   7. facturas_alertas_activas (se redefine): también los tipos nuevos.
--   8. RPC del panel (SECURITY DEFINER, can_read_section / can_edit_section):
--        facturas_decision(desde, hasta, local)   todo lo de las 4 tarjetas;
--        facturas_alerta_visto(id), facturas_alerta_es_normal(id, dias);
--        facturas_precio_pactado_marcar(...), facturas_precio_pactado_quitar(...).
-- Reglas: gasto con IVA de los documentos; base sin IVA de las líneas; los
-- albaranes ya facturados no suman; local NULL = Casa Tomás; abonos = total < 0
-- (restan); meses incompletos (meses_compras_incompletos, < 40 % de la mediana)
-- no se usan como referencia.
-- Test: supabase/tests/facturas_decision_test.sql
-- Deshacer: supabase/rollbacks/20261115100000_facturas_decision_ROLLBACK.sql
-- ============================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Silencios («Visto» y «Es normal») ───────────────────────────────────
create table if not exists public.facturas_alertas_silencios (
  id          bigserial primary key,
  tipo        text not null,
  clave       text,
  objeto      text,
  hasta       date,
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint facturas_alertas_silencios_algo check (clave is not null or objeto is not null)
);
create index if not exists facturas_alertas_silencios_clave_idx on public.facturas_alertas_silencios (clave) where clave is not null;
create index if not exists facturas_alertas_silencios_objeto_idx on public.facturas_alertas_silencios (tipo, objeto) where objeto is not null;
comment on table public.facturas_alertas_silencios is
  '20261115100000: alertas de Facturas silenciadas. clave = «Visto» (esa alerta); tipo + objeto hasta una fecha = «Es normal».';

alter table public.facturas_alertas_silencios enable row level security;
drop policy if exists facturas_alertas_silencios_leer on public.facturas_alertas_silencios;
create policy facturas_alertas_silencios_leer on public.facturas_alertas_silencios
  for select to authenticated using ((select public.can_read_section('facturas')));
revoke all on public.facturas_alertas_silencios from public, anon, authenticated;
grant select on public.facturas_alertas_silencios to authenticated;
grant all on public.facturas_alertas_silencios to service_role;

-- ─── 2. Precios pactados ────────────────────────────────────────────────────
create table if not exists public.facturas_precios_pactados (
  id                  bigserial primary key,
  proveedor_id        bigint not null references public.proveedores(id) on delete cascade,
  nombre_normalizado  text not null,
  unidad              text,
  producto            text,
  precio              numeric(14, 4) not null check (precio > 0),
  creado_por          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint facturas_precios_pactados_uq unique (proveedor_id, nombre_normalizado)
);
comment on table public.facturas_precios_pactados is
  '20261115100000: precio pactado por proveedor y línea (nombre normalizado). Aviso facturas_precio_pactado si una compra posterior lo cambia ≥ pactado_pct.';

alter table public.facturas_precios_pactados enable row level security;
drop policy if exists facturas_precios_pactados_leer on public.facturas_precios_pactados;
create policy facturas_precios_pactados_leer on public.facturas_precios_pactados
  for select to authenticated using ((select public.can_read_section('facturas')));
revoke all on public.facturas_precios_pactados from public, anon, authenticated;
grant select on public.facturas_precios_pactados to authenticated;
grant all on public.facturas_precios_pactados to service_role;

-- ─── 3. Umbrales (los de siempre + los nuevos) ──────────────────────────────
create or replace function public.facturas_alertas_umbrales()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (claves nuevas)
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
           'avisos_dias',              7,
           'campana_impacto_min_eur',  10,
           'proveedor_subidas_min',    3,
           'proveedor_dias',           7,
           'baja_pct',                 10,
           'baja_compras',             3,
           'pactado_pct',              1,
           'silencio_dias',            90)
         || coalesce((select c.alertas from configuracion_facturas c where c.id), '{}'::jsonb)
         || coalesce((select jsonb_build_object('subida_pct', c.umbral_subida_precio_pct)
                        from configuracion_facturas c where c.id), '{}'::jsonb)
$$;

-- Qué se silencia con «Es normal»: el producto (proveedor + línea), el producto
-- del catálogo frente a otro proveedor, el proveedor o la familia.
create or replace function public.facturas_alerta_objeto(p_tipo text, p_datos jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_tipo in ('facturas_precio_sube', 'facturas_precio_baja', 'facturas_precio_pactado') then
             'pv:' || coalesce(p_datos ->> 'proveedor_id', '?') || ':'
                   || coalesce(p_datos ->> 'nombre_normalizado', lower(p_datos ->> 'producto'), '?')
           when p_tipo = 'facturas_precio_mejor' then
             'cat:' || coalesce(p_datos ->> 'producto_id', '?') || ':' || coalesce(p_datos ->> 'proveedor_otro_id', '?')
           when p_tipo = 'facturas_familia_gasto' then
             'fam:' || coalesce(p_datos ->> 'familia_id', '?') || ':' || coalesce(p_datos ->> 'local', '')
           else 'prov:' || coalesce(p_datos ->> 'proveedor_id', '?')
         end
$$;

-- ─── 4. Compras con precio comparable (la pasada de facturas_alertas_candidatas) ─
create or replace function public.facturas_alertas_compras(p_desde date, p_hasta date)
returns table (proveedor_id bigint, nom_n text, med text, factura_id bigint, fecha date, loc text,
               producto_id bigint, nombre_linea text, producto_nombre text, fam bigint, uni text,
               precio numeric, precio_ud numeric, cant numeric, importe numeric, por_unidad numeric)
language plpgsql
stable
security invoker
set search_path = public
set enable_nestloop = off
as $$
#variable_conflict use_column
-- 20261115100000_facturas_decision: copia exacta de lb … compras de
-- facturas_alertas_candidatas (20261107300000), con el periodo como parámetro.
begin
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
     where fa.fecha between p_desde and p_hasta
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
  )
  select c.proveedor_id::bigint, c.nom_n::text, c.med::text, c.factura_id::bigint, c.fecha::date, c.loc::text,
         c.producto_id::bigint, c.nombre_linea::text, c.producto_nombre::text, c.fam::bigint, c.uni::text,
         c.precio::numeric, c.precio_ud::numeric, c.cant::numeric, c.importe::numeric, c.por_unidad::numeric
    from compras c;
end;
$$;

-- ─── 5. Candidatas nuevas: bajadas y precios pactados ───────────────────────
create or replace function public.facturas_alertas_candidatas_extra(p_hoy date default current_date)
returns table (tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb)
language plpgsql
stable
security invoker
set search_path = public
set enable_nestloop = off
as $$
#variable_conflict use_column
-- 20261115100000_facturas_decision
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
  ref as (
    select u.proveedor_id, u.nom_n, u.med,
           (percentile_cont(0.5) within group (order by c.precio))::numeric as ref, count(*) as n_ref, min(c.fecha) as desde_ref
      from ultima u
      join c on c.proveedor_id = u.proveedor_id and c.nom_n = u.nom_n and c.med = u.med
     where c.fecha < u.fecha and c.fecha >= u.fecha - v_ref_d
     group by 1, 2, 3
  ),
  g90 as (
    select proveedor_id, nom_n, med, sum(importe) as importe_90, count(*) as compras_90
      from c where fecha > v_hoy - 90 group by 1, 2, 3
  ),
  baja as (
    select u.*, r.ref, r.n_ref, r.desde_ref, g.importe_90, g.compras_90,
           round((u.precio / r.ref - 1) * 100, 1) as var,
           round((r.ref - u.precio) / r.ref * g.importe_90 / 3, 2) as impacto
      from ultima u
      join ref r on r.proveedor_id = u.proveedor_id and r.nom_n = u.nom_n and r.med = u.med
      join g90 g on g.proveedor_id = u.proveedor_id and g.nom_n = u.nom_n and g.med = u.med
     where r.n_ref >= 2 and r.ref > 0 and g.compras_90 >= v_baja_n
       and u.precio < r.ref * (1 - v_baja / 100)
       -- Menos de un cuarto suele ser otro formato con la misma unidad, no una bajada.
       and u.precio >= r.ref / 4
  ),
  a_baja as (
    select 'facturas_precio_baja'::text as tipo, 'normal'::text as prioridad,
           left(format('Baja %s: %s %%', coalesce(b.producto_nombre, initcap(b.nombre_linea)), facturas_alertas_num(b.var, 1)), 120) as titulo,
           format('%s (%s): %s €/%s el %s frente a %s €/%s de referencia (mediana de %s compras en los %s días anteriores). Lo compras a menudo (%s veces en 90 días): buen momento para hacer acopio. Precios sin IVA.',
                  b.nombre_linea, coalesce(pv.nombre, '?'),
                  facturas_alertas_num(b.precio, case when b.precio < 10 then 3 else 2 end), b.med, to_char(b.fecha, 'DD/MM/YYYY'),
                  facturas_alertas_num(b.ref, case when b.ref < 10 then 3 else 2 end), b.med, b.n_ref, v_ref_d, b.compras_90) as mensaje,
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
$$;

-- ─── 6. Generación diaria (redefinida) ──────────────────────────────────────
create or replace function public.facturas_generar_alertas(p_hoy date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (impacto, campana,
-- proveedor, bajadas, pactados, silencios)
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := coalesce(p_hoy, current_date);
  v_min     numeric := (u ->> 'campana_impacto_min_eur')::numeric;
  v_prov_n  int := (u ->> 'proveedor_subidas_min')::int;
  v_prov_d  int := (u ->> 'proveedor_dias')::int;
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor',
                            'facturas_precio_pactado'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_sil     int;
  v_total   int;
  v_por     jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(v_hoy);
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas_extra(v_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- € al mes que cuesta la subida: (precio − ref) / precio × lo comprado en 90 días / 3.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('impacto_mes',
           round(((a.datos ->> 'precio')::numeric - (a.datos ->> 'precio_ref')::numeric)
                 / nullif((a.datos ->> 'precio')::numeric, 0)
                 * coalesce((a.datos ->> 'importe_90')::numeric, 0) / 3, 2))
   where a.tipo = 'facturas_precio_sube';

  -- Silencios: «Visto» (esa clave) y «Es normal» (ese tipo y objeto hasta su fecha).
  delete from _alertas_hoy a
   where exists (select 1 from facturas_alertas_silencios s
                  where (s.clave is not null and s.clave = a.clave)
                     or (s.objeto is not null and s.tipo = a.tipo
                         and s.objeto = public.facturas_alerta_objeto(a.tipo, a.datos)
                         and (s.hasta is null or s.hasta >= v_hoy)));
  get diagnostics v_sil = row_count;

  -- Un proveedor que sube varias cosas a la vez: un solo aviso.
  insert into _alertas_hoy
  select 'facturas_precio_proveedor',
         case when g.impacto >= v_min * 3 then 'alta' else 'normal' end,
         left(format('%s ha subido %s %s esta semana (+%s %% de media)', g.proveedor, g.n,
                     case when g.n_fam = 1 and g.familia is not null then lower(g.familia) else 'productos' end,
                     facturas_alertas_num(g.media, 0)), 120),
         format('%s: %s. Te cuestan unos %s € más al mes con lo que compras. Precios sin IVA.',
                g.proveedor, g.lista, facturas_alertas_num(g.impacto, 0)),
         format('precio_proveedor:%s:%s', g.proveedor_id, g.semana),
         (v_hoy + 30)::timestamptz,
         jsonb_build_object(
           'enlace', '?tab=compras&modo=proveedores&prov=' || g.proveedor_id,
           'proveedor_id', g.proveedor_id, 'proveedor', g.proveedor, 'local', g.loc,
           'desde', g.desde, 'hasta', g.hasta, 'mes', to_char(g.hasta, 'YYYY-MM'),
           'familia_id', case when g.n_fam = 1 then g.fam end, 'familia', case when g.n_fam = 1 then g.familia end,
           'productos', g.n, 'variacion_pct', round(g.media, 1), 'impacto_mes', round(g.impacto, 2),
           'claves', g.claves, 'factura_id', g.factura_id)
    from (
      select (a.datos ->> 'proveedor_id')::bigint as proveedor_id,
             max(a.datos ->> 'proveedor') as proveedor,
             case when count(distinct a.datos ->> 'local') = 1 then max(a.datos ->> 'local') end as loc,
             count(*) as n,
             count(distinct a.datos ->> 'familia_id') as n_fam,
             max((a.datos ->> 'familia_id')::bigint) as fam,
             max(cp.nombre::text) as familia,
             avg((a.datos ->> 'variacion_pct')::numeric) as media,
             sum(greatest(coalesce((a.datos ->> 'impacto_mes')::numeric, 0), 0)) as impacto,
             min((a.datos ->> 'fecha')::date) as desde, max((a.datos ->> 'fecha')::date) as hasta,
             to_char(max((a.datos ->> 'fecha')::date), 'IYYY-IW') as semana,
             max((a.datos ->> 'factura_id')::bigint) as factura_id,
             string_agg(format('%s +%s %%', a.datos ->> 'producto', facturas_alertas_num((a.datos ->> 'variacion_pct')::numeric, 0)),
                        ', ' order by (a.datos ->> 'variacion_pct')::numeric desc) as lista,
             jsonb_agg(a.clave) as claves
        from _alertas_hoy a
        left join categorias_producto cp on cp.id = (a.datos ->> 'familia_id')::bigint
       where a.tipo = 'facturas_precio_sube'
         and (a.datos ->> 'fecha')::date > v_hoy - v_prov_d
         and a.datos ->> 'proveedor_id' is not null
       group by 1
      having count(*) >= v_prov_n) g
   where not exists (select 1 from facturas_alertas_silencios s
                      where s.tipo = 'facturas_precio_proveedor' and s.objeto = 'prov:' || g.proveedor_id
                        and (s.hasta is null or s.hasta >= v_hoy))
     and not exists (select 1 from facturas_alertas_silencios s
                      where s.clave = format('precio_proveedor:%s:%s', g.proveedor_id, g.semana));

  -- A la campana, solo lo que pesa: las subidas agrupadas por proveedor van en su aviso,
  -- y las subidas o bajadas de menos de campana_impacto_min_eur al mes se quedan en Análisis.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false, 'agrupada', true)
   where a.tipo = 'facturas_precio_sube'
     and exists (select 1 from _alertas_hoy g where g.tipo = 'facturas_precio_proveedor' and g.datos -> 'claves' ? a.clave);
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo in ('facturas_precio_sube', 'facturas_precio_baja')
     and coalesce((a.datos ->> 'impacto_mes')::numeric, 0) < v_min
     and not (a.datos ? 'campana');
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', true)
   where not (a.datos ? 'campana');

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca (salvo que deje de ir
  -- a la campana: entonces queda leída, para que no cuente en el número rojo).
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en,
         leida = n.leida or (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en, n.leida or (a.datos ->> 'campana') = 'false')
         is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en, n.leida);
  get diagnostics v_act = row_count;

  -- Las que no van a la campana entran ya leídas (no suman en el número rojo).
  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos,
         (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (o se ha silenciado) caduca ya, y queda leído.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;
  -- Los «Es normal» vencidos ya no sirven.
  delete from facturas_alertas_silencios s where s.hasta is not null and s.hasta < v_hoy - 30;

  select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'silenciadas', v_sil,
                            'campana', (select count(*) from _alertas_hoy a where a.datos ->> 'campana' = 'true'),
                            'por_tipo', v_por);
end;
$$;

comment on function public.facturas_generar_alertas(date) is
  'Genera las alertas de Facturas en notificaciones_dashboard (sin duplicar por clave; caduca las que ya no se cumplen; respeta los silencios; datos.campana=false = solo en Análisis). SECURITY DEFINER, solo service_role (cron facturas-alertas). 20261107300000 · 20261115100000.';

-- ─── 7. Lectura para el panel (redefinida: tipos nuevos) ────────────────────
create or replace function public.facturas_alertas_activas(
  p_desde date default null, p_hasta date default null, p_local text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (tipos nuevos)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'tipo', n.tipo, 'prioridad', n.prioridad, 'titulo', n.titulo, 'mensaje', n.mensaje,
           'leida', n.leida, 'creada', n.created_at, 'caduca', n.caduca_en, 'datos', n.datos)
         order by (n.prioridad = 'alta') desc, n.leida, n.created_at desc, n.id), '[]'::jsonb)
    from notificaciones_dashboard n
   where (select can_read_section('facturas'))
     and n.tipo in ('facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                    'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                    'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor',
                    'facturas_precio_pactado')
     and (n.caduca_en is null or n.caduca_en > now())
     and (p_desde is null or coalesce((n.datos ->> 'hasta')::date, p_desde) >= p_desde)
     and (p_hasta is null or coalesce((n.datos ->> 'desde')::date, p_hasta) <= p_hasta)
     and (nullif(p_local, '') is null or n.datos ->> 'local' is null or n.datos ->> 'local' = p_local)
$$;

comment on function public.facturas_alertas_activas(date, date, text) is
  'Facturas › Análisis: alertas vigentes (marcas en las gráficas). SECURITY INVOKER. 20261107300000 · 20261115100000.';

-- ─── 8. La pantalla: facturas_decision ──────────────────────────────────────
create or replace function public.facturas_decision(
  p_desde date default null, p_hasta date default null, p_local text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set enable_nestloop = off
-- Sin JIT: la primera llamada de cada conexión compilaba ~1,2 s para ahorrar nada.
set jit = off
as $$
-- 20261115100000_facturas_decision. Todo lo de las cuatro tarjetas en una llamada:
--   familias  base sin IVA de las líneas del periodo frente a la media mensual de los
--             N meses COMPLETOS anteriores (escalada a la duración del periodo);
--   cambios   alertas de precio vigentes (sube, baja, mejor, proveedor, pactado) con su
--             documento, ordenadas por € al mes / ahorro; otros = el resto de alertas;
--   top       precio mediano por mes (6 meses) de los 6 productos con más gasto en
--             los 90 días hasta el fin del periodo (sin los de unidades mezcladas,
--             que salen en revisar_unidades).
declare
  u          jsonb := public.facturas_alertas_umbrales();
  v_local    text := nullif(p_local, '');
  v_hasta    date := coalesce(p_hasta, current_date);
  v_desde    date := coalesce(p_desde, date_trunc('month', coalesce(p_hasta, current_date))::date);
  v_mes_ini  date;
  v_fam_m    int := (u ->> 'familia_meses')::int;
  v_fam_pct  numeric := (u ->> 'familia_pct')::numeric;
  v_fam_min  numeric := (u ->> 'familia_media_min_eur')::numeric;
  v_fam_ext  numeric := (u ->> 'familia_extra_min_eur')::numeric;
  v_en_curso boolean;
  v_enteros  boolean;
  v_meq      numeric;
  v_ref      date[];
  v_inc      date[];
  v_top_ini  date;
  v_gasto    numeric;
  v_docs     int;
  r_fam      jsonb;
  r_cam      jsonb;
  r_top      jsonb;
  r_rev      jsonb;
begin
  if not coalesce(public.can_read_section('facturas'), false) then
    raise exception 'Sin permiso para ver Facturas' using errcode = '42501';
  end if;
  if v_local is not null and v_local not in ('casa_tomas', 'touza') then
    raise exception 'local debe ser casa_tomas, touza o null' using errcode = '22023';
  end if;
  if v_desde > v_hasta then
    raise exception 'desde no puede ser posterior a hasta' using errcode = '22023';
  end if;
  v_mes_ini := date_trunc('month', v_desde)::date;

  -- Duración del periodo en meses: meses enteros si lo son; si es el periodo en curso,
  -- hasta hoy; si no, días / 30,44.
  v_en_curso := current_date between v_desde and v_hasta;
  v_enteros := v_desde = v_mes_ini and (v_hasta + 1) = date_trunc('month', v_hasta + 1)::date;
  v_meq := case
             when v_en_curso then (current_date - v_desde + 1) / 30.4375
             when v_enteros then (extract(year from age(v_hasta + 1, v_desde)) * 12 + extract(month from age(v_hasta + 1, v_desde)))::numeric
             else (v_hasta - v_desde + 1) / 30.4375
           end;

  select coalesce(array_agg(i.mes order by i.mes), '{}') into v_inc from public.meses_compras_incompletos(v_local) i;

  -- Meses de referencia: los v_fam_m meses anteriores con documentos y completos.
  select coalesce(array_agg(x.mes order by x.mes), '{}') into v_ref
    from (select date_trunc('month', f.fecha)::date as mes
            from facturas f
           where f.fecha >= (v_mes_ini - make_interval(months => v_fam_m + 6))::date and f.fecha < v_mes_ini
             and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
             and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
           group by 1
          having not (date_trunc('month', min(f.fecha))::date = any(v_inc))
           order by 1 desc
           limit v_fam_m) x;

  -- Gasto con IVA de los documentos (abonos restan; albaranes facturados no suman).
  select coalesce(sum(coalesce(f.total, 0)), 0), count(*) into v_gasto, v_docs
    from facturas f
   where f.fecha between v_desde and v_hasta
     and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
     and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local);

  -- ══ 1. Familias ══
  with lin as (
    select coalesce(c.padre_id, c.id) as fam, fa.fecha >= v_desde as en_periodo, pf.total::numeric as importe
      from facturas fa
      join productos_factura pf on pf.factura_id = fa.id
      left join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
     where (fa.fecha between v_desde and v_hasta
            or (cardinality(v_ref) > 0 and fa.fecha >= v_ref[1] and fa.fecha < v_mes_ini
                and date_trunc('month', fa.fecha)::date = any(v_ref)))
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and (v_local is null or (case when fa.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
       and pf.total is not null
  ),
  agg as (
    select l.fam,
           coalesce(sum(l.importe) filter (where l.en_periodo), 0) as importe,
           coalesce(sum(l.importe) filter (where not l.en_periodo), 0) / nullif(cardinality(v_ref), 0) as media_mes
      from lin l group by l.fam
  ),
  fx as (
    select a.*, cp.nombre::text as nombre, cp.orden,
           a.media_mes * v_meq as referencia,
           cp.nombre in ('Servicios', 'Menaje y equipamiento') as fuera_aviso
      from agg a left join categorias_producto cp on cp.id = a.fam
     where a.importe <> 0 or coalesce(a.media_mes, 0) <> 0
  ),
  al as (
    select distinct on ((n.datos ->> 'familia_id')) n.datos ->> 'familia_id' as fam, n.id, n.titulo
      from notificaciones_dashboard n
     where n.tipo = 'facturas_familia_gasto' and (n.caduca_en is null or n.caduca_en > now())
       and (v_local is null or n.datos ->> 'local' is null or n.datos ->> 'local' = v_local)
     order by (n.datos ->> 'familia_id'), n.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.fam, 'familia', coalesce(f.nombre, 'Sin clasificar'),
           'importe', round(f.importe, 2), 'media_mes', round(f.media_mes, 2), 'referencia', round(f.referencia, 2),
           'variacion_pct', case when f.referencia > 0 then round((f.importe / f.referencia - 1) * 100, 1) end,
           'aviso', f.fam is not null and not coalesce(f.fuera_aviso, false) and f.referencia > 0
                    and f.media_mes >= v_fam_min
                    and f.importe > f.referencia * (1 + v_fam_pct / 100)
                    and f.importe - f.referencia >= v_fam_ext * least(v_meq, 1),
           'alerta', case when al.id is not null then jsonb_build_object('id', al.id, 'titulo', al.titulo) end)
         order by f.importe desc, f.nombre), '[]'::jsonb)
    into r_fam
    from fx f left join al on al.fam = f.fam::text;

  -- ══ 2. Cambios de precio y otros avisos (las alertas vigentes) ══
  with n as (
    select n.*,
           coalesce((n.datos ->> 'impacto_mes')::numeric,
                    case when n.tipo = 'facturas_precio_sube' then
                      round(((n.datos ->> 'precio')::numeric - (n.datos ->> 'precio_ref')::numeric)
                            / nullif((n.datos ->> 'precio')::numeric, 0) * coalesce((n.datos ->> 'importe_90')::numeric, 0) / 3, 2) end) as impacto,
           coalesce((n.datos ->> 'campana')::boolean,
                    case when n.tipo = 'facturas_precio_sube' then
                      coalesce(((n.datos ->> 'precio')::numeric - (n.datos ->> 'precio_ref')::numeric)
                               / nullif((n.datos ->> 'precio')::numeric, 0) * coalesce((n.datos ->> 'importe_90')::numeric, 0) / 3, 0)
                        >= (u ->> 'campana_impacto_min_eur')::numeric
                         else true end) as campana
      from notificaciones_dashboard n
     where n.tipo like 'facturas\_%'
       and n.tipo in ('facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                      'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                      'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor', 'facturas_precio_pactado')
       and (n.caduca_en is null or n.caduca_en > now())
       and (v_local is null or n.datos ->> 'local' is null or n.datos ->> 'local' = v_local)
  ),
  it as (
    select n.tipo, n.prioridad, n.impacto, n.created_at,
           coalesce((n.datos ->> 'ahorro')::numeric, 0) as ahorro,
           jsonb_build_object(
             'id', n.id, 'tipo', n.tipo, 'prioridad', n.prioridad, 'titulo', n.titulo, 'mensaje', n.mensaje,
             'leida', n.leida, 'creada', n.created_at, 'campana', n.campana, 'impacto_mes', n.impacto, 'datos', n.datos,
             'doc', case when d.id is not null then jsonb_build_object(
                      'id', d.id, 'fecha', d.fecha, 'proveedor', coalesce(pv.nombre, d.proveedor), 'proveedor_id', d.proveedor_id,
                      'numero', d.numero_documento, 'tipo', d.tipo,
                      'local', case when d.local = 'touza' then 'touza' else 'casa_tomas' end,
                      'total', d.total, 'drive_url', d.drive_url, 'archivo_path', d.archivo_path) end,
             'doc_otro', case when d2.id is not null then jsonb_build_object(
                      'id', d2.id, 'fecha', d2.fecha, 'proveedor', coalesce(pv2.nombre, d2.proveedor), 'proveedor_id', d2.proveedor_id,
                      'numero', d2.numero_documento, 'tipo', d2.tipo,
                      'local', case when d2.local = 'touza' then 'touza' else 'casa_tomas' end,
                      'total', d2.total, 'drive_url', d2.drive_url, 'archivo_path', d2.archivo_path) end) as j
      from n
      left join facturas d on d.id = case when (n.datos ->> 'factura_id') ~ '^[0-9]{1,18}$' then (n.datos ->> 'factura_id')::bigint end
      left join proveedores pv on pv.id = d.proveedor_id
      left join facturas d2 on d2.id = case when (n.datos ->> 'factura_otro_id') ~ '^[0-9]{1,18}$' then (n.datos ->> 'factura_otro_id')::bigint end
      left join proveedores pv2 on pv2.id = d2.proveedor_id
  )
  select jsonb_build_object(
           'sube',      coalesce(jsonb_agg(it.j order by it.impacto desc nulls last, it.created_at desc) filter (where it.tipo = 'facturas_precio_sube'), '[]'),
           'baja',      coalesce(jsonb_agg(it.j order by it.impacto desc nulls last, it.created_at desc) filter (where it.tipo = 'facturas_precio_baja'), '[]'),
           'mejor',     coalesce(jsonb_agg(it.j order by it.ahorro desc, it.created_at desc) filter (where it.tipo = 'facturas_precio_mejor'), '[]'),
           'proveedor', coalesce(jsonb_agg(it.j order by it.impacto desc nulls last) filter (where it.tipo = 'facturas_precio_proveedor'), '[]'),
           'pactado',   coalesce(jsonb_agg(it.j order by it.created_at desc) filter (where it.tipo = 'facturas_precio_pactado'), '[]'),
           'familia',   coalesce(jsonb_agg(it.j order by it.created_at desc) filter (where it.tipo = 'facturas_familia_gasto'), '[]'),
           'otros',     coalesce(jsonb_agg(it.j order by (it.prioridad = 'alta') desc, it.created_at desc)
                                   filter (where it.tipo in ('facturas_albaran_sin_factura', 'facturas_proveedor_nuevo',
                                                             'facturas_importe_inusual', 'facturas_revision')), '[]'))
    into r_cam
    from it;

  -- ══ 3. Precio de lo que más se compra ══
  v_top_ini := (date_trunc('month', v_hasta) - interval '5 months')::date;
  create temp table if not exists _dec_l (
    k text, producto_id bigint, nom_n text, nombre text, producto_nombre text, uni text,
    proveedor_id bigint, fecha date, mes date, precio numeric, importe numeric) on commit drop;
  truncate _dec_l;
  insert into _dec_l
  select coalesce('c:' || pf.producto_id, 'n:' || coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))),
         pf.producto_id, coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)),
         pf.nombre::text, pc.nombre::text,
         lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')),
         fa.proveedor_id, fa.fecha, date_trunc('month', fa.fecha)::date, pf.precio_unitario, pf.total
    from facturas fa
    join productos_factura pf on pf.factura_id = fa.id
    left join productos_catalogo pc on pc.id = pf.producto_id
    left join public.nombres_linea_no_producto np
           on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
          and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
   where fa.fecha between v_top_ini and v_hasta
     and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
     and fa.total > 0
     and (v_local is null or (case when fa.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
     and pf.cantidad > 0 and pf.precio_unitario > 0 and pf.total > 0
     and not coalesce(np.no_producto, public.es_linea_no_producto_tablero(
           coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)),
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')));

  with
  g90 as (
    select k, uni, sum(importe) as imp from _dec_l where fecha > v_hasta - 90 group by 1, 2
  ),
  gu as (
    select g.*, sum(g.imp) over (partition by g.k) as tot_k,
           row_number() over (partition by g.k order by g.imp desc) as rn
      from g90 g
  ),
  gk as (
    select k, max(tot_k) as tot,
           count(*) filter (where imp >= 0.1 * tot_k) as n_uni,
           max(uni) filter (where rn = 1) as uni
      from gu group by k
  ),
  top as (
    select gk.*, row_number() over (order by tot desc, k) as pos from gk where n_uni = 1 order by tot desc, k limit 6
  ),
  corte as (select coalesce(min(tot), 0) as c from top),
  -- Proveedor y línea principales (para el precio pactado).
  prov as (
    select distinct on (l.k) l.k, l.proveedor_id, l.nom_n, sum(l.importe) as imp
      from _dec_l l join top t on t.k = l.k and l.uni = t.uni
     where l.fecha > v_hasta - 90 and l.proveedor_id is not null
     group by l.k, l.proveedor_id, l.nom_n
     order by l.k, sum(l.importe) desc
  ),
  meses as (
    select t.k, m.mes::date as mes,
           (select (percentile_cont(0.5) within group (order by l.precio))::numeric
              from _dec_l l where l.k = t.k and l.uni = t.uni and l.mes = m.mes) as precio
      from top t
      cross join generate_series(v_top_ini, date_trunc('month', v_hasta)::date, interval '1 month') m(mes)
  ),
  nombres as (
    select l.k, max(l.producto_nombre) as pn, mode() within group (order by l.nombre) as ln,
           max(l.producto_id) as producto_id, array_agg(distinct l.nom_n) as noms
      from _dec_l l join top t on t.k = l.k group by l.k
  ),
  alertas as (
    select t.k, jsonb_agg(jsonb_build_object('id', n.id, 'mes', n.datos ->> 'mes', 'titulo', n.titulo,
                                             'variacion_pct', n.datos -> 'variacion_pct') order by n.datos ->> 'mes') as a
      from top t
      join nombres nm on nm.k = t.k
      join notificaciones_dashboard n
        on n.tipo = 'facturas_precio_sube' and (n.caduca_en is null or n.caduca_en > now())
       and ((nm.producto_id is not null and n.datos ->> 'producto_id' = nm.producto_id::text)
            or n.datos ->> 'nombre_normalizado' = any(nm.noms))
       and (v_local is null or n.datos ->> 'local' is null or n.datos ->> 'local' = v_local)
     group by t.k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', t.k, 'producto', coalesce(nm.pn, initcap(nm.ln)), 'producto_id', nm.producto_id,
           'unidad', t.uni, 'importe_90', round(t.tot, 2),
           'proveedor_id', p.proveedor_id, 'proveedor', pv.nombre, 'nombre_normalizado', p.nom_n, 'linea', nm.ln,
           'meses', (select jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'), 'precio', round(m.precio, 4)) order by m.mes)
                       from meses m where m.k = t.k),
           'alertas', coalesce(a.a, '[]'::jsonb),
           'pactado', case when pp.id is not null then jsonb_build_object('id', pp.id, 'precio', pp.precio, 'unidad', pp.unidad, 'desde', pp.created_at) end)
         order by t.pos), '[]'::jsonb)
    into r_top
    from top t
    join nombres nm on nm.k = t.k
    left join prov p on p.k = t.k
    left join proveedores pv on pv.id = p.proveedor_id
    left join alertas a on a.k = t.k
    left join facturas_precios_pactados pp on pp.proveedor_id = p.proveedor_id and pp.nombre_normalizado = p.nom_n;

  -- Unidades mezcladas entre los que entrarían en el top: «Revisar unidades».
  with
  g90 as (select k, uni, sum(importe) as imp from _dec_l where fecha > v_hasta - 90 group by 1, 2),
  gu as (select g.*, sum(g.imp) over (partition by g.k) as tot_k from g90 g),
  gk as (select k, max(tot_k) as tot, count(*) filter (where imp >= 0.1 * tot_k) as n_uni from gu group by k),
  top as (select tot from gk where n_uni = 1 order by tot desc limit 6),
  rev as (
    select gk.* from gk
     where gk.n_uni > 1 and gk.tot >= coalesce((select min(tot) from top), 0)
     order by gk.tot desc limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', r.k,
           'producto', (select coalesce(max(l.producto_nombre), initcap(max(l.nombre))) from _dec_l l where l.k = r.k),
           'importe_90', round(r.tot, 2),
           'unidades', (select jsonb_agg(jsonb_build_object('unidad', x.uni, 'precio', round(x.p, 2), 'importe_90', round(x.imp, 2)) order by x.imp desc)
                          from (select l.uni, (percentile_cont(0.5) within group (order by l.precio))::numeric as p,
                                       sum(l.importe) filter (where l.fecha > v_hasta - 90) as imp
                                  from _dec_l l where l.k = r.k group by l.uni
                                 having sum(l.importe) filter (where l.fecha > v_hasta - 90) > 0) x))
         order by r.tot desc), '[]'::jsonb)
    into r_rev
    from rev r;

  return jsonb_build_object(
    'periodo', jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'local', v_local,
                                  'meses_equivalentes', round(v_meq, 2), 'en_curso', v_en_curso,
                                  'meses_incompletos', (select coalesce(jsonb_agg(to_char(m, 'YYYY-MM') order by m), '[]'::jsonb)
                                                          from unnest(v_inc) m where m between v_mes_ini and v_hasta)),
    'referencia', jsonb_build_object('meses', (select coalesce(jsonb_agg(to_char(m, 'YYYY-MM') order by m), '[]'::jsonb) from unnest(v_ref) m),
                                     'desde', v_ref[1], 'hasta', (v_ref[cardinality(v_ref)] + interval '1 month - 1 day')::date),
    'resumen', jsonb_build_object('gasto', round(v_gasto, 2), 'documentos', v_docs,
                                  'base', (select round(coalesce(sum((f ->> 'importe')::numeric), 0), 2) from jsonb_array_elements(r_fam) f),
                                  'base_referencia', (select round(coalesce(sum((f ->> 'referencia')::numeric), 0), 2) from jsonb_array_elements(r_fam) f)),
    'familias', r_fam,
    'cambios', r_cam,
    'top', r_top,
    'revisar_unidades', r_rev,
    'top_desde', v_top_ini,
    'umbrales', jsonb_build_object('familia_pct', v_fam_pct, 'campana_impacto_min_eur', (u ->> 'campana_impacto_min_eur')::numeric,
                                   'subida_pct', (u ->> 'subida_pct')::numeric, 'baja_pct', (u ->> 'baja_pct')::numeric,
                                   'silencio_dias', (u ->> 'silencio_dias')::int),
    'generado', now());
end;
$$;

comment on function public.facturas_decision(date, date, text) is
  'Facturas › Análisis: las cuatro tarjetas de decisión (familias frente a su media, cambios de precio por € al mes, precio de lo más comprado, ahorro en otro proveedor). SECURITY DEFINER con can_read_section(facturas). 20261115100000.';

-- ─── 9. Acciones: «Visto», «Es normal», precio pactado ──────────────────────
create or replace function public.facturas_alerta_visto(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261115100000_facturas_decision: archiva esa alerta (no vuelve con esa clave).
declare
  n notificaciones_dashboard%rowtype;
begin
  if not coalesce(public.can_edit_section('facturas'), false) then
    raise exception 'Sin permiso para editar Facturas' using errcode = '42501';
  end if;
  select * into n from notificaciones_dashboard where id = p_id and tipo like 'facturas\_%' and clave is not null;
  if not found then
    raise exception 'Alerta no encontrada' using errcode = 'P0002';
  end if;
  insert into facturas_alertas_silencios (tipo, clave) values (n.tipo, n.clave);
  update notificaciones_dashboard set caduca_en = now(), leida = true where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'clave', n.clave);
end;
$$;

create or replace function public.facturas_alerta_es_normal(p_id uuid, p_dias int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261115100000_facturas_decision: silencia ese producto (o proveedor, familia) y ese tipo
-- durante p_dias (por defecto silencio_dias = 90): temporada, cambio de formato…
declare
  n        notificaciones_dashboard%rowtype;
  v_obj    text;
  v_dias   int := coalesce(p_dias, (public.facturas_alertas_umbrales() ->> 'silencio_dias')::int, 90);
  v_hasta  date;
  v_cad    int;
begin
  if not coalesce(public.can_edit_section('facturas'), false) then
    raise exception 'Sin permiso para editar Facturas' using errcode = '42501';
  end if;
  if v_dias < 1 or v_dias > 730 then
    raise exception 'dias debe estar entre 1 y 730' using errcode = '22023';
  end if;
  select * into n from notificaciones_dashboard where id = p_id and tipo like 'facturas\_%' and clave is not null;
  if not found then
    raise exception 'Alerta no encontrada' using errcode = 'P0002';
  end if;
  v_obj := public.facturas_alerta_objeto(n.tipo, coalesce(n.datos, '{}'::jsonb));
  v_hasta := current_date + v_dias;
  insert into facturas_alertas_silencios (tipo, objeto, hasta) values (n.tipo, v_obj, v_hasta);
  update notificaciones_dashboard x
     set caduca_en = now(), leida = true
   where x.tipo = n.tipo and x.clave is not null
     and (x.caduca_en is null or x.caduca_en > now())
     and public.facturas_alerta_objeto(x.tipo, coalesce(x.datos, '{}'::jsonb)) = v_obj;
  get diagnostics v_cad = row_count;
  return jsonb_build_object('ok', true, 'objeto', v_obj, 'hasta', v_hasta, 'archivadas', v_cad);
end;
$$;

create or replace function public.facturas_precio_pactado_marcar(
  p_proveedor_id bigint, p_nombre_normalizado text, p_precio numeric, p_unidad text default null, p_producto text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261115100000_facturas_decision
declare
  v_id bigint;
begin
  if not coalesce(public.can_edit_section('facturas'), false) then
    raise exception 'Sin permiso para editar Facturas' using errcode = '42501';
  end if;
  if p_proveedor_id is null or nullif(btrim(p_nombre_normalizado), '') is null or p_precio is null or p_precio <= 0
     or p_precio > 1000000 or length(p_nombre_normalizado) > 300 or length(coalesce(p_producto, '')) > 300
     or length(coalesce(p_unidad, '')) > 40 then
    raise exception 'Datos del precio pactado no válidos' using errcode = '22023';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id) then
    raise exception 'Proveedor no encontrado' using errcode = 'P0002';
  end if;
  insert into facturas_precios_pactados (proveedor_id, nombre_normalizado, unidad, producto, precio)
  values (p_proveedor_id, btrim(p_nombre_normalizado), nullif(lower(btrim(p_unidad)), ''), nullif(btrim(p_producto), ''), round(p_precio, 4))
  on conflict (proveedor_id, nombre_normalizado) do update
    set precio = excluded.precio, unidad = excluded.unidad, producto = coalesce(excluded.producto, facturas_precios_pactados.producto),
        updated_at = now(), created_at = now(), creado_por = auth.uid()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.facturas_precio_pactado_quitar(p_proveedor_id bigint, p_nombre_normalizado text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261115100000_facturas_decision: quita el pacto y caduca sus avisos.
declare
  v_ids bigint[];
begin
  if not coalesce(public.can_edit_section('facturas'), false) then
    raise exception 'Sin permiso para editar Facturas' using errcode = '42501';
  end if;
  with b as (
    delete from facturas_precios_pactados
     where proveedor_id = p_proveedor_id and nombre_normalizado = btrim(p_nombre_normalizado)
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from b;
  update notificaciones_dashboard
     set caduca_en = now(), leida = true
   where tipo = 'facturas_precio_pactado' and (caduca_en is null or caduca_en > now())
     and (datos ->> 'pacto_id')::bigint = any(v_ids);
  return jsonb_build_object('ok', true, 'quitados', cardinality(v_ids));
end;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
revoke all on function public.facturas_alertas_umbrales() from public, anon;
revoke all on function public.facturas_alerta_objeto(text, jsonb) from public, anon;
revoke all on function public.facturas_alertas_compras(date, date) from public, anon, authenticated;
revoke all on function public.facturas_alertas_candidatas_extra(date) from public, anon, authenticated;
revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;
revoke all on function public.facturas_alertas_activas(date, date, text) from public, anon;
revoke all on function public.facturas_decision(date, date, text) from public, anon;
revoke all on function public.facturas_alerta_visto(uuid) from public, anon;
revoke all on function public.facturas_alerta_es_normal(uuid, int) from public, anon;
revoke all on function public.facturas_precio_pactado_marcar(bigint, text, numeric, text, text) from public, anon;
revoke all on function public.facturas_precio_pactado_quitar(bigint, text) from public, anon;
grant execute on function public.facturas_alertas_umbrales() to authenticated, service_role;
grant execute on function public.facturas_alerta_objeto(text, jsonb) to authenticated, service_role;
grant execute on function public.facturas_alertas_compras(date, date) to service_role;
grant execute on function public.facturas_alertas_candidatas_extra(date) to service_role;
grant execute on function public.facturas_generar_alertas(date) to service_role;
grant execute on function public.facturas_alertas_activas(date, date, text) to authenticated, service_role;
grant execute on function public.facturas_decision(date, date, text) to authenticated, service_role;
grant execute on function public.facturas_alerta_visto(uuid) to authenticated, service_role;
grant execute on function public.facturas_alerta_es_normal(uuid, int) to authenticated, service_role;
grant execute on function public.facturas_precio_pactado_marcar(bigint, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.facturas_precio_pactado_quitar(bigint, text) to authenticated, service_role;

-- ─── Comprobación final ─────────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if has_function_privilege('anon', 'public.facturas_decision(date,date,text)', 'execute')
     or has_function_privilege('anon', 'public.facturas_alerta_visto(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_candidatas_extra(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_compras(date,date)', 'execute') then
    v_malos := v_malos || 'permisos de ejecución de más'::text;
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.facturas_decision(date,date,text)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.facturas_alerta_es_normal(uuid,integer)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.facturas_generar_alertas(date)'::regprocedure) then
    v_malos := v_malos || 'falta SECURITY DEFINER'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.facturas_alertas_silencios'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.facturas_precios_pactados'::regclass) then
    v_malos := v_malos || 'RLS sin activar'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'facturas_decision: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;
