set client_encoding = 'UTF8';
-- ============================================================================
-- 20261128140000_margenes_ultima_factura — Márgenes con el precio de la ÚLTIMA
-- factura (13/11/2026, petición del dueño)
-- ----------------------------------------------------------------------------
-- «Tiene que dar información exacta e importante: que siempre salga la última
-- factura aunque luego salgan más datos. Medianas y cálculos están bien, pero
-- importante y recalcando el precio y cosas de la última factura.»
--
-- 1. margenes_carta_ultima(ids, hoy, días) (interna): por producto, la ÚLTIMA línea de
--    compra (fecha de la factura, y a igualdad la línea más nueva: fecha desc,
--    productos_factura.id desc) con las MISMAS reglas que margenes_carta_costes:
--    solo Casa Tomás (local distinto de 'touza'), sin albaranes ya facturados,
--    sin abonos ni líneas a 0, fecha <= hoy. Dos filas por producto:
--      · tipo 'base': la última línea con precio por kg o por litro
--        (volumen_linea: envase del catálogo o texto de la línea);
--      · tipo 'ud':   la última línea con precio por unidad de compra (caja,
--        botella, cubeta…; las que no son a granel).
--    De cada una: el precio, la factura (id, fecha, proveedor, número, enlace
--    al original, cantidad, unidad y precio tal como se compró), el IVA de ESA
--    línea, el precio de la última factura de hace 6 meses y el de la factura
--    anterior (para contexto). Y la MEDIANA de los últimos `días` (la regla de
--    margenes_carta_costes), calculada en la misma pasada: volumen_linea, lo
--    caro, se calcula una vez (margenes_carta tarda lo mismo que antes, ~0,4 s en la demo).
-- 2. margenes_carta_datos(hoy): el COSTE de cada vino, ingrediente y artículo
--    al peso es el de su última factura, convertido como hasta ahora al formato
--    de la carta:
--      · ingrediente en g/ml → última línea con €/kg o €/l; en ud → última línea
--        por unidad de compra;
--      · vino → la última línea con €/l × litros de la carta; si ninguna trae
--        el volumen, la última por botella × litros carta ÷ litros producto;
--      · al peso → la última línea con €/kg.
--    El margen, el % de coste (coste sin IVA ÷ venta sin IVA) y el multiplicador
--    salen de ese coste. La MEDIANA de `dias_referencia` días (90) se sigue
--    calculando y se devuelve aparte (eur_mediana, coste_mediana,
--    compra_kg_mediana…) como contexto.
--    «Hace 6 meses» = la última factura que había hace 6 meses (la más nueva con
--    fecha <= hoy − 6 meses), comparada con la última de hoy: la bandera
--    'sube_coste' (y el aviso) compara factura con factura, igual que lo que se
--    enseña. Sigue sin saltar si el precio de la carta se ha tocado en 6 meses
--    (historial_ajustes_precios), como antes.
--    El coste con IVA usa el IVA de la línea de esa factura (si no lo trae, el
--    general de su factura; si tampoco, 10 % supuesto).
-- 3. margenes_generar_avisos: el aviso «Margen bajo» de un PLATO se explica con
--    el % sobre el precio de venta («de cada 100 € que cobras, 41 € se van en
--    ingredientes»). Título y mensaje del panel; datos.texto_telegram NO cambia
--    (el dueño ha dejado Telegram fuera). Vinos y al peso, igual que antes.
-- 4. Estado de los avisos al día SIN avisar (margenes_generar_avisos(hoy, true)):
--    al pasar de la mediana a la última factura cambian los costes de golpe, y
--    eso no debe inundar Avisos con «margen bajo».
--
-- Cuerpos de partida: los de la demo (pg_get_functiondef, 13/11/2026), iguales a
-- 20261125100000_margenes_sin_iva_tienda y 20261125110000_avisos_margen_bajo.
-- margenes_carta_costes y margenes_carta_iva no cambian (margenes_carta_datos ya no las usa).
-- Rollback: supabase/rollbacks/20261128140000_margenes_ultima_factura_ROLLBACK.sql
-- Tests:    npm run test:margenes-ultima-factura:db (PGlite)
--           supabase/tests/margenes_ultima_factura_test.sql (contra la demo)
-- ============================================================================
set lock_timeout = '5s';

-- ─── 1. Última factura (y mediana) de cada producto (interna) ──────────────
-- Una sola pasada por las líneas (volumen_linea es lo caro): la mediana de
-- contexto sale de las mismas líneas, con la regla de margenes_carta_costes.
create or replace function public.margenes_carta_ultima(p_ids bigint[], p_hoy date, p_dias integer)
returns table (
  producto_id bigint,
  -- Mediana de los últimos p_dias días (sin compras en ellos, las 3 últimas): contexto.
  mediana_eur_base numeric,       -- €/kg o €/l
  mediana_medida text,            -- 'kg' | 'l'
  mediana_eur_ud numeric,         -- € por unidad de compra
  mediana_unidad_compra text,
  lineas integer,                 -- líneas que entran en la mediana
  ultima date,                    -- fecha de la compra más nueva (de cualquier tipo)
  -- La última línea con precio por kg o litro ('base') …
  base_eur numeric, base_medida text, base_factura jsonb, base_iva_pct numeric, base_iva_origen text,
  base_eur_6m numeric, base_fecha_6m date, base_eur_anterior numeric, base_fecha_anterior date, base_proveedor_anterior text,
  -- … y la última con precio por unidad de compra ('ud': caja, botella, cubeta…).
  ud_eur numeric, ud_medida text, ud_factura jsonb, ud_iva_pct numeric, ud_iva_origen text,
  ud_eur_6m numeric, ud_fecha_6m date, ud_eur_anterior numeric, ud_fecha_anterior date, ud_proveedor_anterior text
)
language sql
stable
set search_path = public
as $$
  -- 20261128140000_margenes_ultima_factura. Mismas líneas que margenes_carta_costes.
  with l as materialized (
    select pf.producto_id, pf.id, fa.id as factura_id, fa.fecha, pf.total as importe, pf.cantidad,
           coalesce(unidad_agente(pf.unidad::text), 'ud') as u, v.medida as med, v.cantidad_base,
           pf.nombre::text as nombre_linea, pf.unidad::text as unidad_linea,
           coalesce(pr.nombre, fa.proveedor::text, 'Sin proveedor') as proveedor, fa.proveedor_id,
           fa.numero_documento::text as numero,
           case when fa.tipo = 'albaran' then 'albaran' else 'factura' end as tipo_doc,
           fa.total as total_doc, fa.drive_url, fa.archivo_path,
           case when pf.iva_pct is not null then 'linea'
                when fa.subtotal > 0 and fa.iva >= 0 then 'factura'
                else 'supuesto' end as origen_iva,
           coalesce(pf.iva_pct::numeric,
                    case when fa.subtotal > 0 and fa.iva >= 0 then round(fa.iva / fa.subtotal * 100, 1) end,
                    10) as pct_iva
      from productos_factura pf
      join facturas fa on fa.id = pf.factura_id
      join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join proveedores pr on pr.id = fa.proveedor_id
      left join lateral volumen_linea(pf.nombre::text, pf.unidad::text, pf.cantidad,
             coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)),
             pf.contenido_cantidad, pf.contenido_unidad, pc.envase_cantidad, pc.envase_unidad,
             pc.envases_por_bulto, volumen_max_eur_litro(c.nombre)) v on true
     where pf.producto_id = any(p_ids)
       and fa.fecha is not null and fa.fecha <= p_hoy
       and fa.local is distinct from 'touza'
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and coalesce(fa.total, 0) >= 0
       and pf.total > 0 and pf.cantidad > 0
  ),
  -- Mediana (margenes_carta_costes, referencia de hoy).
  s as (
    select l.producto_id, l.fecha, l.importe, l.cantidad, l.cantidad_base, l.med, l.u,
           row_number() over (partition by l.producto_id order by l.fecha desc, l.id desc) as rn,
           count(*) filter (where l.fecha > p_hoy - p_dias) over (partition by l.producto_id) as n_vent
      from l
  ),
  m as (
    select s.producto_id,
           percentile_cont(0.5) within group (order by s.importe / s.cantidad_base)
             filter (where s.med is not null and s.cantidad_base > 0) as eur_base,
           mode() within group (order by s.med) filter (where s.med is not null) as medida,
           percentile_cont(0.5) within group (order by s.importe / s.cantidad)
             filter (where s.u not in ('kg', 'l')) as eur_ud,
           mode() within group (order by s.u) filter (where s.u not in ('kg', 'l')) as unidad_compra,
           count(*)::int as n, max(s.fecha) as ultima
      from s
     where (s.n_vent > 0 and s.fecha > p_hoy - p_dias) or (s.n_vent = 0 and s.rn <= 3)
     group by s.producto_id
  ),
  -- Última factura: por kg o litro (base) y por unidad de compra (ud).
  k as (
    select 'base'::text as clase, l.*, l.importe / l.cantidad_base as precio, l.med as medida_clase
      from l where l.med is not null and l.cantidad_base > 0
    union all
    select 'ud'::text, l.*, l.importe / l.cantidad, l.u
      from l where l.u not in ('kg', 'l')
  ),
  r as (
    select k.*, row_number() over (partition by k.producto_id, k.clase order by k.fecha desc, k.id desc) as rn
      from k
  ),
  r6 as (
    select distinct on (k.producto_id, k.clase) k.producto_id, k.clase, k.precio, k.fecha
      from k
     where k.fecha <= (p_hoy - interval '6 months')::date
     order by k.producto_id, k.clase, k.fecha desc, k.id desc
  ),
  x as (
    select a.producto_id, a.clase, round(a.precio, 4) as eur, a.medida_clase as medida,
           jsonb_build_object(
             'linea_id', a.id, 'id', a.factura_id, 'fecha', a.fecha, 'proveedor', a.proveedor,
             'proveedor_id', a.proveedor_id, 'numero_documento', a.numero, 'tipo', a.tipo_doc,
             'local', 'casa_tomas', 'total', a.total_doc, 'drive_url', a.drive_url, 'archivo_path', a.archivo_path,
             'nombre_linea', a.nombre_linea, 'cantidad', a.cantidad, 'unidad', a.unidad_linea,
             'unidad_compra', a.u, 'importe', a.importe, 'precio_unidad', round(a.importe / a.cantidad, 4),
             'medida', a.med,
             'eur_base', case when a.med is not null and a.cantidad_base > 0 then round(a.importe / a.cantidad_base, 4) end,
             'iva_pct', a.pct_iva, 'iva_origen', a.origen_iva) as factura,
           a.pct_iva, a.origen_iva,
           round(s6.precio, 4) as eur_6m, s6.fecha as fecha_6m,
           round(p.precio, 4) as eur_ant, p.fecha as fecha_ant, p.proveedor as prov_ant
      from r a
      left join r6 s6 on s6.producto_id = a.producto_id and s6.clase = a.clase
      left join r p on p.producto_id = a.producto_id and p.clase = a.clase and p.rn = 2
     where a.rn = 1
  )
  select m.producto_id,
         round(m.eur_base::numeric, 4), m.medida, round(m.eur_ud::numeric, 4), m.unidad_compra, m.n, m.ultima,
         b.eur, b.medida, b.factura, b.pct_iva, b.origen_iva, b.eur_6m, b.fecha_6m, b.eur_ant, b.fecha_ant, b.prov_ant,
         d.eur, d.medida, d.factura, d.pct_iva, d.origen_iva, d.eur_6m, d.fecha_6m, d.eur_ant, d.fecha_ant, d.prov_ant
    from m
    left join x b on b.producto_id = m.producto_id and b.clase = 'base'
    left join x d on d.producto_id = m.producto_id and d.clase = 'ud'
$$;
revoke all on function public.margenes_carta_ultima(bigint[], date, integer) from public, anon, authenticated;
grant execute on function public.margenes_carta_ultima(bigint[], date, integer) to service_role;

-- ─── 2. Márgenes de la carta con la última factura (interna, sin permisos) ──
create or replace function public.margenes_carta_datos(p_hoy date default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
-- 20261128140000_margenes_ultima_factura (base: 20261125100000_margenes_sin_iva_tienda).
-- Coste = última factura; la mediana de `dias_referencia` días va aparte (*_mediana).
declare
  v_hoy date := coalesce(p_hoy, current_date);
  c public.margenes_carta_config%rowtype;
  v_ids bigint[];
  v_iva numeric;
  v_iva_t numeric;
  v_t_activa boolean;
  v_t_desc numeric;
  v_t_excl text[];
  v_res jsonb;
begin
  select * into c from public.margenes_carta_config where id;
  if not found then
    c.coste_max_plato_pct := 35; c.multiplicador_min_vino := 2.3; c.subida_coste_pct := 10;
    c.iva_pct := 10; c.dias_referencia := 90; c.multiplicador_min_peso := 2;
    c.iva_tienda_pct := 21; c.multiplicador_min_tienda := 1.5;
  end if;
  v_iva := 1 + c.iva_pct / 100;
  v_iva_t := 1 + coalesce(c.iva_tienda_pct, 21) / 100;
  select t.activa, t.descuento_pct, t.vinos_excluidos into v_t_activa, v_t_desc, v_t_excl
    from public.configuracion_tienda t where t.id;
  v_t_activa := coalesce(v_t_activa, false);
  v_t_desc := coalesce(v_t_desc, 30);
  v_t_excl := coalesce(v_t_excl, '{}');

  select coalesce(array_agg(distinct x.producto_id), '{}') into v_ids
    from (select e.producto_id from escandallo_platos e union select vp.producto_id from vino_producto vp) x;

  with k as materialized (
    -- Por producto: la última factura (base: €/kg o €/l; ud: por unidad de compra) y la
    -- mediana de los últimos `dias_referencia` días (contexto).
    select * from margenes_carta_ultima(v_ids, v_hoy, c.dias_referencia)
  ),
  ajustes as (
    select distinct h.tipo_carta, e->>'id' as id
      from historial_ajustes_precios h
      cross join lateral jsonb_array_elements(case when jsonb_typeof(h.snapshot) = 'array' then h.snapshot else '[]'::jsonb end) e
     where h.fecha > v_hoy - interval '6 months'
  ),
  rev as (
    select * from margenes_carta_revision
  ),
  -- PLATOS ------------------------------------------------------------------
  pl as (
    select p.id, p.nombre, p.categoria, p.precio_eur::numeric as precio, p.unidad, p.orden,
           margenes_gramos_venta(p.unidad) as gramos_venta
      from "Platos" p
     where p.activado and p.restaurante
  ),
  ing as (
    select e.plato_id, e.id, e.producto_id, pc.nombre as producto, e.cantidad, e.unidad, e.origen, e.nota, e.orden,
           coalesce(k.base_medida, k.mediana_medida) as medida, coalesce(k.ud_medida, k.mediana_unidad_compra) as unidad_compra,
           k.lineas, k.ultima,
           x.eur, x.eur_6m, x.fecha_6m, x.eur_anterior, x.fecha_anterior, x.proveedor_anterior,
           x.factura, x.iva_pct, x.iva_origen,
           case when e.unidad = 'ud' then k.mediana_eur_ud else k.mediana_eur_base end as eur_mediana
      from escandallo_platos e
      join pl on pl.id = e.plato_id
      join productos_catalogo pc on pc.id = e.producto_id
      left join k on k.producto_id = e.producto_id
      -- g/ml: la última factura con €/kg o €/l; ud: la última por unidad de compra.
      left join lateral (
        select case when e.unidad = 'ud' then k.ud_eur else k.base_eur end as eur,
               case when e.unidad = 'ud' then k.ud_eur_6m else k.base_eur_6m end as eur_6m,
               case when e.unidad = 'ud' then k.ud_fecha_6m else k.base_fecha_6m end as fecha_6m,
               case when e.unidad = 'ud' then k.ud_eur_anterior else k.base_eur_anterior end as eur_anterior,
               case when e.unidad = 'ud' then k.ud_fecha_anterior else k.base_fecha_anterior end as fecha_anterior,
               case when e.unidad = 'ud' then k.ud_proveedor_anterior else k.base_proveedor_anterior end as proveedor_anterior,
               case when e.unidad = 'ud' then k.ud_factura else k.base_factura end as factura,
               case when e.unidad = 'ud' then k.ud_iva_pct else k.base_iva_pct end as iva_pct,
               case when e.unidad = 'ud' then k.ud_iva_origen else k.base_iva_origen end as iva_origen
      ) x on true
  ),
  ing2 as (
    select ing.*,
           round(case when unidad = 'ud' then cantidad * eur else cantidad / 1000 * eur end, 4) as coste,
           round(case when unidad = 'ud' then cantidad * eur_6m else cantidad / 1000 * eur_6m end, 4) as coste_6m,
           round(case when unidad = 'ud' then cantidad * eur_mediana else cantidad / 1000 * eur_mediana end, 4) as coste_mediana
      from ing
  ),
  pp as (
    select plato_id,
           sum(coste) as coste, sum(coste_6m) as coste_6m, sum(coste_mediana) as coste_mediana,
           round(sum(coste * (1 + coalesce(iva_pct, 10) / 100)), 4) as coste_iva,
           bool_or(coste is not null and coalesce(iva_origen, 'supuesto') <> 'linea') as iva_supuesto,
           count(*) as n, count(coste) as n_con, count(coste_6m) as n_6m, count(coste_mediana) as n_med,
           bool_or(origen = 'manual') as manual,
           (array_agg(producto order by coste desc nulls last))[1] as principal,
           (array_agg(coste order by coste desc nulls last))[1] as principal_coste,
           (array_agg(factura order by coste desc nulls last))[1] as principal_factura,
           min((factura->>'fecha')::date) as factura_mas_vieja,
           jsonb_agg(jsonb_build_object(
             'id', id, 'producto_id', producto_id, 'producto', producto,
             'cantidad', cantidad, 'unidad', unidad, 'origen', origen, 'nota', nota,
             'medida', medida, 'unidad_compra', unidad_compra, 'eur', eur, 'eur_6m', eur_6m,
             'coste', coste, 'coste_6m', coste_6m, 'lineas', lineas, 'ultima', ultima,
             'eur_mediana', eur_mediana, 'coste_mediana', coste_mediana,
             'fecha_6m', fecha_6m, 'eur_anterior', eur_anterior, 'fecha_anterior', fecha_anterior,
             'proveedor_anterior', proveedor_anterior, 'factura', factura,
             'iva_pct', iva_pct, 'iva_origen', iva_origen,
             'eur_iva', round(eur * (1 + coalesce(iva_pct, 10) / 100), 4),
             'coste_iva', round(coste * (1 + coalesce(iva_pct, 10) / 100), 4)
           ) order by orden, id) as ingredientes
      from ing2
     group by plato_id
  ),
  pc1 as (
    select pl.*, pp.coste, pp.coste_6m, pp.coste_mediana, pp.coste_iva, pp.iva_supuesto, pp.n, pp.n_con, pp.n_6m, pp.n_med,
           pp.manual, pp.principal, pp.principal_coste, pp.principal_factura, pp.factura_mas_vieja, pp.ingredientes,
           case when pl.precio > 0 then round(pl.precio / v_iva, 4) end as venta,
           r.revisado, r.sin_mapear_motivo
      from pl
      left join pp on pp.plato_id = pl.id
      left join rev r on r.tipo = 'plato' and r.articulo_id = pl.id
  ),
  pc2 as (
    select pc1.*,
           case when venta > 0 and n_con > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and n_con > 0 then round(venta - coste, 2) end as margen,
           case when venta > 0 and n_med = n and n > 0 then round(coste_mediana / venta * 100, 2) end as pct_mediana,
           case when n_6m = n and n > 0 and coste_6m > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'platos' and a.id = pc1.id) as precio_ajustado
      from pc1
  ),
  pc3 as (
    select pc2.*,
           array_remove(array[
             case when n is null then 'sin_mapear' end,
             case when n > 0 and n_con = 0 then 'sin_datos' end,
             case when n_con > 0 and n_con < n then 'incompleto' end,
             case when venta is null then 'sin_precio' end,
             case when pct > c.coste_max_plato_pct then 'coste_alto' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from pc2
  ),
  -- VINOS -------------------------------------------------------------------
  vi as (
    select v.id, v.nombre, v.categoria, v.precio_eur::numeric as precio, v.precio_copa_eur::numeric as precio_copa, v.orden,
           vp.producto_id, pc.nombre as producto, vp.origen, vp.nota,
           -- Formato de la CARTA (nombre del vino: «Magnum» = 1,5 l); si no se lee, el del
           -- producto comprado, salvo que sea mayor de 75 cl; en último caso 0,75 l.
           coalesce(lc.volumen, case when lp.litros > 0.75 then 0.75 else lp.litros end, 0.75) as litros,
           lp.litros as litros_producto,
           lc.volumen as litros_carta,
           k.mediana_eur_base as med_base, k.mediana_eur_ud as med_ud, k.lineas, k.ultima,
           k.base_eur as ult_base, k.base_eur_6m as ult_base_6m, k.base_eur_anterior as ant_base,
           k.ud_eur as ult_ud, k.ud_eur_6m as ult_ud_6m, k.ud_eur_anterior as ant_ud,
           -- La factura que da el coste: la última con €/l; si ninguna lo trae, la última por botella.
           case when k.base_eur is not null then k.base_factura else k.ud_factura end as factura,
           case when k.base_eur is not null then k.base_fecha_6m else k.ud_fecha_6m end as fecha_6m,
           case when k.base_eur is not null then k.base_fecha_anterior else k.ud_fecha_anterior end as fecha_anterior,
           case when k.base_eur is not null then k.base_proveedor_anterior else k.ud_proveedor_anterior end as proveedor_anterior,
           case when k.base_eur is not null then k.base_iva_pct else k.ud_iva_pct end as iva_pct,
           case when k.base_eur is not null then k.base_iva_origen else k.ud_iva_origen end as iva_origen,
           coalesce(k.base_medida, k.ud_medida, k.mediana_unidad_compra) as unidad_compra,
           r.revisado, r.sin_mapear_motivo,
           -- A la venta en la tienda (20261103150000): activado, restaurante IS TRUE, precio > 0, no excluido.
           (v.precio_eur > 0 and not (v.id = any(v_t_excl))) as en_tienda
      from "Vinos" v
      left join vino_producto vp on vp.vino_id = v.id
      left join productos_catalogo pc on pc.id = vp.producto_id
      left join lateral (
        select coalesce(case when pc.envase_unidad = 'l' and pc.envase_cantidad > 0 then pc.envase_cantidad end,
                        (select et.volumen from envase_texto(pc.nombre::text) et
                          where et.unidad = 'l' and et.volumen > 0 limit 1)) as litros
      ) lp on true
      left join lateral (
        select et.volumen from envase_texto(v.nombre::text) et where et.unidad = 'l' and et.volumen > 0 limit 1
      ) lc on true
      left join k on k.producto_id = vp.producto_id
      left join rev r on r.tipo = 'vino' and r.articulo_id = v.id
     where v.activado and v.restaurante and v.precio_eur is not null
  ),
  vi1 as (
    select vi.*,
           coalesce(litros_producto is not null and abs(litros - litros_producto) > 0.01, false) as formato_distinto,
           case when litros_producto > 0 then litros / litros_producto else 1 end as escala_ud
      from vi
  ),
  vi2 as (
    select vi1.*,
           round(coalesce(ult_base * litros, ult_ud * escala_ud), 4) as coste,
           round(coalesce(ult_base_6m * litros, ult_ud_6m * escala_ud), 4) as coste_6m,
           round(coalesce(ant_base * litros, ant_ud * escala_ud), 4) as coste_anterior,
           round(coalesce(med_base * litros, med_ud * escala_ud), 4) as coste_mediana,
           case when precio > 0 then round(precio / v_iva, 4) end as venta,
           case when en_tienda then tienda_precio_venta(precio, v_t_desc) end as precio_tienda
      from vi1
  ),
  vi3 as (
    select vi2.*,
           round(coste * (1 + coalesce(iva_pct, 10) / 100), 4) as coste_iva,
           case when precio_tienda > 0 then round(precio_tienda / v_iva_t, 4) end as venta_tienda,
           -- Multiplicador SIN IVA ÷ SIN IVA: «me cuesta 10 y la vendo a 30 (27,27 sin IVA)» = 2,73×.
           case when venta > 0 and coste > 0 then round(venta / coste, 2) end as multiplicador,
           case when venta > 0 and coste > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and coste > 0 then round(venta - coste, 2) end as margen,
           case when venta > 0 and coste_mediana > 0 then round(venta / coste_mediana, 2) end as multiplicador_mediana,
           case when coste_6m > 0 and coste > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'vinos' and a.id = vi2.id) as precio_ajustado
      from vi2
  ),
  vi3b as (
    select vi3.*,
           case when venta_tienda > 0 and coste > 0 then round(venta_tienda / coste, 2) end as multiplicador_tienda,
           case when venta_tienda > 0 and coste > 0 then round(coste / venta_tienda * 100, 2) end as pct_tienda,
           case when venta_tienda > 0 and coste > 0 then round(venta_tienda - coste, 2) end as margen_tienda
      from vi3
  ),
  vi4 as (
    select vi3b.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and coste is null then 'sin_datos' end,
             case when venta is null then 'sin_precio' end,
             case when producto_id is not null and formato_distinto then 'formato_distinto' end,
             case when multiplicador < c.multiplicador_min_vino then 'multiplicador_bajo' end,
             case when multiplicador_tienda < c.multiplicador_min_tienda then 'tienda_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from vi3b
  ),
  -- POR PESO (20261115410000) ------------------------------------------------
  pe as (
    select pl.id, pl.nombre, pl.categoria, pl.precio, pl.unidad, pl.orden, pl.gramos_venta,
           e.producto_id, pc.nombre as producto, e.origen,
           k.mediana_eur_base as med_base, k.mediana_medida as med_medida, k.lineas, k.ultima,
           k.base_eur as ult_base, k.base_medida as medida, k.base_eur_6m as ult_base_6m, k.base_eur_anterior as ant_base,
           k.base_fecha_6m as fecha_6m, k.base_fecha_anterior as fecha_anterior, k.base_proveedor_anterior as proveedor_anterior,
           -- La factura del €/kg; si ninguna compra trae el peso, la última compra (para decir cuál es).
           coalesce(k.base_factura, k.ud_factura) as factura,
           k.base_iva_pct as iva_pct, k.base_iva_origen as iva_origen,
           r.revisado, r.sin_mapear_motivo
      from pl
      left join lateral (
        select e.producto_id, e.origen from escandallo_platos e
         where e.plato_id = pl.id order by e.orden, e.id limit 1
      ) e on true
      left join productos_catalogo pc on pc.id = e.producto_id
      left join k on k.producto_id = e.producto_id
      left join rev r on r.tipo = 'plato' and r.articulo_id = pl.id
     where pl.gramos_venta is not null
  ),
  pe2 as (
    select pe.*,
           case when precio > 0 then round(precio / gramos_venta * 1000, 2) end as venta_kg_iva,
           case when precio > 0 then round(precio / gramos_venta * 1000 / v_iva, 2) end as venta_kg,
           case when medida = 'kg' then round(ult_base, 2) end as compra_kg,
           case when medida = 'kg' then round(ult_base * (1 + coalesce(iva_pct, 10) / 100), 2) end as compra_kg_iva,
           case when medida = 'kg' then round(ult_base_6m, 2) end as compra_kg_6m,
           case when medida = 'kg' then round(ant_base, 2) end as compra_kg_anterior,
           case when med_medida = 'kg' then round(med_base, 2) end as compra_kg_mediana,
           factura ->> 'proveedor' as ultimo_proveedor, (factura ->> 'fecha')::date as ultima_fecha
      from pe
  ),
  pe3 as (
    select pe2.*,
           case when venta_kg > 0 and compra_kg > 0 then round(venta_kg / compra_kg, 2) end as multiplicador,
           case when venta_kg > 0 and compra_kg > 0 then round(compra_kg / venta_kg * 100, 2) end as pct,
           case when venta_kg > 0 and compra_kg_mediana > 0 then round(venta_kg / compra_kg_mediana, 2) end as multiplicador_mediana,
           case when compra_kg_6m > 0 and compra_kg > 0 and compra_kg_6m <> compra_kg then round((compra_kg / compra_kg_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'platos' and a.id = pe2.id) as precio_ajustado,
           case
             when producto_id is null then coalesce(sin_mapear_motivo, 'Sin producto de compra asociado')
             when lineas is null then 'No hay compras de «' || producto || '»'
             when medida is distinct from 'kg' then 'Las compras de «' || producto || '» no traen el peso (se compran por pieza o unidad)'
           end as motivo_sin_datos
      from pe2
  ),
  pe4 as (
    select pe3.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and compra_kg is null then 'sin_datos' end,
             case when venta_kg is null then 'sin_precio' end,
             case when multiplicador < c.multiplicador_min_peso then 'multiplicador_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from pe3
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    -- De dónde sale el coste (para que el panel y el chatbot lo digan).
    'coste_desde', 'ultima_factura',
    'config', jsonb_build_object(
      'coste_max_plato_pct', c.coste_max_plato_pct, 'multiplicador_min_vino', c.multiplicador_min_vino,
      'subida_coste_pct', c.subida_coste_pct, 'iva_pct', c.iva_pct, 'dias_referencia', c.dias_referencia,
      'multiplicador_min_peso', c.multiplicador_min_peso,
      'iva_tienda_pct', c.iva_tienda_pct, 'multiplicador_min_tienda', c.multiplicador_min_tienda),
    'tienda', jsonb_build_object('activa', v_t_activa, 'descuento_pct', v_t_desc),
    'resumen', jsonb_build_object(
      'platos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where pct is not null),
          'food_cost_medio', round(avg(pct), 1),
          'food_cost_mediana', round((percentile_cont(0.5) within group (order by pct))::numeric, 1),
          'en_rojo', count(*) filter (where 'coste_alto' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where pct is null),
          'incompletos', count(*) filter (where 'incompleto' = any(banderas)),
          'revisados', count(*) filter (where revisado))
        from pc3),
      'vinos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where multiplicador is not null),
          'multiplicador_medio', round(avg(multiplicador), 2),
          'multiplicador_mediana', round((percentile_cont(0.5) within group (order by multiplicador))::numeric, 2),
          'en_rojo', count(*) filter (where 'multiplicador_bajo' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where multiplicador is null),
          'revisados', count(*) filter (where revisado),
          'en_tienda', count(*) filter (where en_tienda),
          'multiplicador_tienda_mediana', round((percentile_cont(0.5) within group (order by multiplicador_tienda))::numeric, 2),
          'tienda_en_rojo', count(*) filter (where 'tienda_bajo' = any(banderas)))
        from vi4)),
    'platos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta', venta, 'coste', coste, 'coste_6m', case when n_6m = n then coste_6m end,
        'coste_mediana', case when n_med = n then coste_mediana end, 'pct_mediana', pct_mediana,
        'coste_iva', case when n_con > 0 then coste_iva end, 'iva_supuesto', coalesce(iva_supuesto, false),
        'pct', pct, 'margen', margen, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'principal', principal, 'principal_coste', principal_coste, 'factura', principal_factura,
        'factura_mas_vieja', factura_mas_vieja,
        'origen', case when n is null then null when manual then 'manual' else 'estimado' end,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas), 'ingredientes', coalesce(ingredientes, '[]'::jsonb)
      ) order by categoria, orden, nombre) from pc3), '[]'::jsonb),
    'vinos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'precio_copa', precio_copa,
        'venta', venta, 'producto_id', producto_id, 'producto', producto, 'litros', litros,
        'litros_producto', litros_producto, 'formato_distinto', formato_distinto,
        'coste', coste, 'coste_6m', coste_6m, 'coste_iva', coste_iva,
        'coste_mediana', coste_mediana, 'multiplicador_mediana', multiplicador_mediana,
        'coste_anterior', coste_anterior, 'fecha_anterior', fecha_anterior, 'proveedor_anterior', proveedor_anterior,
        'fecha_6m', fecha_6m, 'factura', factura, 'unidad_compra', unidad_compra,
        'iva_compra_pct', case when coste is not null then iva_pct end,
        'iva_origen', case when coste is not null then iva_origen end,
        'multiplicador', multiplicador, 'pct', pct, 'margen', margen,
        'en_tienda', en_tienda, 'precio_tienda', precio_tienda, 'venta_tienda', venta_tienda,
        'multiplicador_tienda', multiplicador_tienda, 'pct_tienda', pct_tienda, 'margen_tienda', margen_tienda,
        'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'lineas', lineas, 'ultima', ultima, 'origen', origen, 'nota', nota,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from vi4), '[]'::jsonb),
    'peso', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta_kg_iva', venta_kg_iva, 'venta_kg', venta_kg,
        'producto_id', producto_id, 'producto', producto, 'compra_kg', compra_kg, 'compra_kg_6m', compra_kg_6m,
        'compra_kg_iva', compra_kg_iva, 'compra_kg_mediana', compra_kg_mediana,
        'multiplicador_mediana', multiplicador_mediana,
        'compra_kg_anterior', compra_kg_anterior, 'fecha_anterior', fecha_anterior, 'proveedor_anterior', proveedor_anterior,
        'fecha_6m', fecha_6m, 'factura', factura,
        'iva_compra_pct', case when compra_kg is not null then iva_pct end,
        'iva_origen', case when compra_kg is not null then iva_origen end,
        'medida', medida, 'lineas', lineas, 'ultima', ultima,
        'ultimo_proveedor', ultimo_proveedor, 'ultima_fecha', ultima_fecha,
        'multiplicador', multiplicador, 'pct', pct, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'origen', origen, 'revisado', coalesce(revisado, false), 'motivo', motivo_sin_datos,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from pe4), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.margenes_carta_datos(date) from public, anon, authenticated;
grant execute on function public.margenes_carta_datos(date) to service_role;

-- ─── 3. Aviso «Margen bajo»: el % del plato, sobre el precio de venta ───────
create or replace function public.margenes_generar_avisos(p_hoy date default current_date, p_solo_estado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261128140000_margenes_ultima_factura (base: 20261125110000_avisos_margen_bajo). Solo cambia
-- el título y el mensaje del aviso de PLATO; datos.texto_telegram queda como estaba.
declare
  v_hoy     date := coalesce(p_hoy, current_date);
  m         jsonb := public.margenes_carta_datos(v_hoy);
  cf        jsonb := m -> 'config';
  v_tienda  boolean := coalesce((m -> 'tienda' ->> 'activa')::boolean, false);
  r         record;
  v_prod    bigint;
  v_prod_n  text;
  v_eur     numeric;
  v_eur_a   numeric;
  v_med     text;
  v_fac     bigint;
  v_fecha   date;
  v_prov    text;
  v_txt     text;
  v_tg      text;
  v_tit     text;
  v_sube    text;
  v_fuente  text;
  v_nuevos  int := 0;
  v_cad     int := 0;
  v_n       int := 0;
begin
  create temp table if not exists _margenes_hoy (
    canal text, articulo_id text, nombre text, bajo boolean, valor numeric, limite numeric,
    coste numeric, producto_id bigint, producto text, detalle jsonb
  ) on commit drop;
  truncate _margenes_hoy;

  insert into _margenes_hoy
  select 'vino', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_vino')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador' is not null
  union all
  select 'tienda', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'tienda_bajo',
         (e ->> 'multiplicador_tienda')::numeric, (cf ->> 'multiplicador_min_tienda')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador_tienda' is not null and (e ->> 'en_tienda')::boolean
  union all
  select 'peso', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_peso')::numeric,
         (e ->> 'compra_kg')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'peso') e
   where e ->> 'multiplicador' is not null
  union all
  -- Platos del borrador (no al peso), solo los revisados. detalle: coste de cada ingrediente.
  select 'plato', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'coste_alto',
         (e ->> 'pct')::numeric, (cf ->> 'coste_max_plato_pct')::numeric,
         (e ->> 'coste')::numeric, null, null,
         coalesce((select jsonb_object_agg(i ->> 'producto_id', jsonb_build_object(
                     'producto', i ->> 'producto', 'eur', i -> 'eur', 'coste', i -> 'coste',
                     'medida', case when i ->> 'unidad' = 'ud' then coalesce(i ->> 'unidad_compra', 'ud') else i ->> 'medida' end))
                     from jsonb_array_elements(e -> 'ingredientes') i
                    where i ->> 'coste' is not null), '{}'::jsonb)
    from jsonb_array_elements(m -> 'platos') e
   where e ->> 'pct' is not null and (e ->> 'revisado')::boolean and e ->> 'gramos_venta' is null;

  if not p_solo_estado then
    for r in
      select h.*, s.coste as coste_antes, s.detalle as detalle_antes
        from _margenes_hoy h
        join margenes_avisos_estado s on s.canal = h.canal and s.articulo_id = h.articulo_id
       where h.bajo and not s.bajo
         and h.coste > s.coste
         and (h.canal <> 'tienda' or v_tienda)
    loop
      v_prod := r.producto_id; v_prod_n := r.producto; v_eur := r.coste; v_eur_a := r.coste_antes; v_med := null;
      if r.canal = 'plato' then
        -- El ingrediente cuyo coste más ha subido desde el último cálculo.
        select d.key::bigint, d.value ->> 'producto', (d.value ->> 'eur')::numeric, (a.value ->> 'eur')::numeric, d.value ->> 'medida'
          into v_prod, v_prod_n, v_eur, v_eur_a, v_med
          from jsonb_each(r.detalle) d
          left join jsonb_each(r.detalle_antes) a on a.key = d.key
         where (d.value ->> 'coste')::numeric > coalesce((a.value ->> 'coste')::numeric, 0)
           and a.key is not null
         order by (d.value ->> 'coste')::numeric - (a.value ->> 'coste')::numeric desc
         limit 1;
        if not found then v_prod := null; end if;
      end if;

      v_fac := null; v_fecha := null; v_prov := null;
      if v_prod is not null then
        select fa.id, fa.fecha, coalesce(pr.nombre, fa.proveedor::text)
          into v_fac, v_fecha, v_prov
          from productos_factura pf
          join facturas fa on fa.id = pf.factura_id
          left join proveedores pr on pr.id = fa.proveedor_id
         where pf.producto_id = v_prod
           and fa.fecha is not null and fa.fecha <= v_hoy
           and fa.local is distinct from 'touza'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and coalesce(fa.total, 0) >= 0
           and pf.total > 0 and pf.cantidad > 0
         order by fa.fecha desc, pf.id desc
         limit 1;
      end if;
      v_fuente := case when v_fac is not null
                       then format(', según la factura de %s del %s', coalesce(v_prov, 'proveedor sin nombre'), to_char(v_fecha, 'DD/MM'))
                       else '' end;

      if r.canal = 'plato' then
        v_sube := case when v_prod is not null and v_eur_a is not null
                       then format('sube %s de %s a %s € %s%s', v_prod_n, facturas_alertas_num(v_eur_a, 2), facturas_alertas_num(v_eur, 2),
                                   case v_med when 'kg' then 'el kilo' when 'l' then 'el litro' when 'ud' then 'la unidad'
                                              when null then 'la unidad' else 'la ' || v_med end,
                                   v_fuente) end;
        -- Panel (13/11/2026): el % es del precio de VENTA sin IVA, dicho en sencillo.
        v_tit := left(format('Margen bajo: %s (coste: %s %% de lo que cobras)', r.nombre, margenes_num(r.valor, 0)), 120);
        v_txt := format('El coste del plato «%s» ya es el %s %% de su precio de venta sin IVA (límite %s %%): '
                        || 'de cada 100 € que cobras, %s € se van en ingredientes.',
                        r.nombre, margenes_num(r.valor, 0), margenes_num(r.limite, 0), margenes_num(r.valor, 0))
                 || case when v_sube is not null then ' ' || upper(left(v_sube, 1)) || substr(v_sube, 2) || '.' else '' end;
        -- Telegram: el texto de siempre (20261125110000), sin cambios.
        v_tg := format('El coste del plato «%s» es ya el %s %% del precio (límite %s %%)',
                       r.nombre, margenes_num(r.valor, 0), margenes_num(r.limite, 0))
                || case when v_sube is not null then ': ' || v_sube else '' end || '.';
      else
        v_tit := left(format('Margen bajo: %s%s (%s×)', r.nombre, case r.canal when 'tienda' then ' en la tienda' else '' end,
                             margenes_num(r.valor, 2)), 120);
        v_txt := format('%s ha bajado a %s× (límite %s×): %s te cuesta ahora %s € (antes %s €)%s.',
                        case r.canal
                          when 'vino' then format('El vino «%s»', r.nombre)
                          when 'tienda' then format('En la tienda, el vino «%s»', r.nombre)
                          else format('«%s» (al peso)', r.nombre) end,
                        margenes_num(r.valor, 2), margenes_num(r.limite, 2),
                        case when r.canal = 'peso' then format('el kilo de %s', coalesce(r.producto, 'compra')) else 'la botella' end,
                        facturas_alertas_num(r.coste, 2), facturas_alertas_num(r.coste_antes, 2), v_fuente);
        v_tg := v_txt;
      end if;

      insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
      values ('facturas_margen_bajo', v_tit, v_txt || ' Precios sin IVA.', 'facturas_alerta', 'alta',
              format('margen_bajo:%s:%s:%s', r.canal, r.articulo_id, v_hoy), (v_hoy + 30)::timestamptz,
              jsonb_build_object(
                'enlace', case when v_fac is not null then '?tab=compras&modo=documentos&doc=' || v_fac
                               else '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                    || ':' || r.articulo_id end,
                'enlace_margenes', '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                   || ':' || r.articulo_id,
                'canal', r.canal, 'articulo_id', r.articulo_id, 'nombre', r.nombre,
                'valor', r.valor, 'limite', r.limite, 'coste', r.coste, 'coste_antes', r.coste_antes,
                'producto_id', v_prod, 'producto', v_prod_n, 'eur', v_eur, 'eur_antes', v_eur_a,
                'factura_id', v_fac, 'fecha', v_fecha, 'proveedor', v_prov,
                'desde', v_hoy, 'hasta', v_hoy, 'mes', to_char(v_hoy, 'YYYY-MM'), 'local', 'casa_tomas',
                'campana', true, 'texto_telegram', v_tg),
              false)
      on conflict (clave) where clave is not null do nothing;
      get diagnostics v_n = row_count;
      v_nuevos := v_nuevos + v_n;
    end loop;

    -- Ya no está por debajo: su aviso caduca (y queda leído).
    update notificaciones_dashboard n
       set caduca_en = now(), leida = true
     where n.tipo = 'facturas_margen_bajo'
       and (n.caduca_en is null or n.caduca_en > now())
       and exists (select 1 from _margenes_hoy h
                    where h.canal = n.datos ->> 'canal' and h.articulo_id = n.datos ->> 'articulo_id' and not h.bajo);
    get diagnostics v_cad = row_count;
    delete from notificaciones_dashboard n
     where n.tipo = 'facturas_margen_bajo' and n.caduca_en < now() - interval '90 days';
  end if;

  insert into margenes_avisos_estado (canal, articulo_id, bajo, valor, coste, detalle, updated_at)
  select canal, articulo_id, bajo, valor, coste, detalle, now() from _margenes_hoy
  on conflict (canal, articulo_id) do update
     set bajo = excluded.bajo, valor = excluded.valor, coste = excluded.coste,
         detalle = excluded.detalle, updated_at = excluded.updated_at;
  delete from margenes_avisos_estado where updated_at < now() - interval '180 days';

  return jsonb_build_object('articulos', (select count(*) from _margenes_hoy),
                            'por_debajo', (select count(*) from _margenes_hoy where bajo),
                            'nuevos', v_nuevos, 'caducados', v_cad, 'solo_estado', p_solo_estado);
end;
$$;
revoke all on function public.margenes_generar_avisos(date, boolean) from public, anon, authenticated;
grant execute on function public.margenes_generar_avisos(date, boolean) to service_role;

-- ─── 4. Estado de los avisos con los costes nuevos, SIN avisar ──────────────
select public.margenes_generar_avisos(current_date, true);

select 'margenes_ultima_factura: aplicada' as resultado;
