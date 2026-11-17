set client_encoding = 'UTF8';
-- Vuelta atrás de 20261209120000_informe_subidas_envases_tallas: deja el informe «Subidas y
-- proveedor» como lo dejó 20261207110000 (sin contenido manual en cajas, sin control de envases
-- ni de tallas mezcladas). No toca datos.
begin;
set local lock_timeout = '5s';

drop function if exists public.informe_precios_compras(date, text);
drop function if exists public.informe_precios_motivo_tallas(numeric, numeric, text);
drop function if exists public.informe_precios_motivo_envase(numeric, text, text, numeric, text, text);
drop function if exists public.informe_precios_envases_distintos(numeric, text, text, numeric, text, text);
drop function if exists public.informe_precios_envase_txt(numeric, text, text);

-- Copia literal de 20261207110000_informe_subidas_proveedor (desde «Base común»).
-- ─── Base común ─────────────────────────────────────────────────────────────
create or replace function public.informe_precios_compras(p_hoy date default null, p_local text default null)
returns table (
  producto_id bigint, producto text, fam_id bigint, familia text,
  proveedor_id bigint, med text, factura_id bigint, fecha date, numero text,
  uni text, nom_n text, nombre_linea text,
  precio numeric, cant numeric, importe numeric,
  pack_ud boolean, convertido boolean,
  nn integer, np integer, disp numeric, generico boolean, motivo_generico text)
language plpgsql
stable
set search_path = public, pg_temp
set enable_nestloop = off
set jit = off
as $f$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_ini date := (coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date) - interval '27 months')::date;
begin
  return query
  with
  fuera as (
    select c.id from categorias_producto c
     where c.padre_id is null and c.nombre in ('Servicios', 'Menaje y equipamiento')
  ),
  lb as materialized (
    select pf.factura_id, fa.fecha, fa.proveedor_id, fa.numero_documento::text as numero,
           pf.producto_id, pc.nombre::text as producto, pf.nombre::text as nombre_linea,
           coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
           lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as uni,
           pf.cantidad, pf.precio_unitario, pf.total::numeric as importe,
           coalesce(c.padre_id, c.id) as fam,
           pf.unidad::text as unidad_txt, pf.contenido_cantidad, pf.contenido_unidad::text as contenido_unidad,
           pc.envase_cantidad, pc.envase_unidad::text as envase_unidad, pc.envases_por_bulto, c.nombre::text as categoria,
           concat_ws('|', coalesce(pf.nombre::text, '~'), coalesce(pf.unidad::text, '~'), coalesce(pf.precio_unitario::text, '~'),
                     coalesce(pf.contenido_cantidad::text, '~'), coalesce(pf.contenido_unidad::text, '~'),
                     coalesce(pc.envase_cantidad::text, '~'), coalesce(pc.envase_unidad::text, '~'),
                     coalesce(pc.envases_por_bulto::text, '~'), coalesce(c.nombre::text, '~')) as vkey
      from facturas fa
      join productos_factura pf on pf.factura_id = fa.id
      join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join public.nombres_linea_no_producto np
             on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
            and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
     where fa.fecha between v_ini and v_hoy
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and fa.total > 0                                   -- los abonos, fuera
       and fa.proveedor_id is not null
       and pf.cantidad > 0 and pf.precio_unitario > 0 and pf.total > 0   -- abonos y regalos a 0 €
       and coalesce(pf.descuento_pct, 0) < 100            -- línea bonificada
       and (p_local is null or (case when fa.local = 'touza' then 'touza' else 'casa_tomas' end) = p_local)
       and coalesce(c.padre_id, c.id, 0) not in (select id from fuera)
       and not coalesce(np.no_producto, public.es_linea_no_producto_tablero(
             coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)),
             coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')))
  ),
  -- Litros/kilos por unidad facturada, una vez por combinación distinta (volumen_linea es cara).
  vol as materialized (
    select d.vkey, v.medida, v.por_unidad
      from (select distinct on (vkey) * from lb) d
      left join lateral public.volumen_linea(
             d.nombre_linea, d.unidad_txt, 1::numeric, d.precio_unitario,
             d.contenido_cantidad, d.contenido_unidad,
             d.envase_cantidad, d.envase_unidad, d.envases_por_bulto,
             public.volumen_max_eur_litro(d.categoria)) v on true
  ),
  -- Un producto que SIEMPRE se factura en la misma unidad (botella, barril, caja) se compara en
  -- esa unidad: «Aalto 75 cl» a 30,10 € la botella, no a 40,13 €/l. Solo se pasa a €/l o €/kg
  -- cuando hay formatos distintos que igualar (caja y lata, bolsa y kg).
  un as (select producto_id, count(distinct uni) as n_uni from lb group by 1),
  l1 as (
    select l.*,
           case when x.conv then v.medida else l.uni end as med,
           case when x.conv then l.precio_unitario / v.por_unidad else l.precio_unitario end as precio_c,
           case when x.conv then l.cantidad * v.por_unidad else l.cantidad end as cant_c,
           x.conv
      from lb l
      join vol v using (vkey)
      join un using (producto_id)
      cross join lateral (select (un.n_uni > 1 and v.medida is not null and v.por_unidad > 0 and v.medida <> l.uni) as conv) x
  ),
  med_atip as (
    select producto_id, proveedor_id, med,
           (percentile_cont(0.5) within group (order by precio_c))::numeric as mediana, count(*) as n
      from l1 group by 1, 2, 3
  ),
  l2 as (
    select l.*,
           -- «Crepe (C/50 U)» a 39,60 € la «unidad»: el nombre dice caja o pack y la unidad es suelta.
           (l.uni in ('ud', 'u', 'unidad', 'unidades', 'uds') and l.med = l.uni
            and l.nombre_linea ~* '(\mc/\s*\d+|\mcajas?\M|\mpack\M|\mestuche\M|\d+\s*x\s*\d+|\d+\s*(u|ud|uds|unid|unidades)\M)') as pack
      from l1 l
      join med_atip m using (producto_id, proveedor_id, med)
     where m.n < 3 or l.precio_c between m.mediana / 3 and m.mediana * 3
  ),
  -- Un documento = una compra (varias líneas del mismo producto: precio medio ponderado).
  compras as (
    select l.producto_id, l.proveedor_id, l.med, l.factura_id,
           max(l.fecha) as fecha, max(l.numero) as numero, max(l.producto) as producto, max(l.fam) as fam,
           max(l.uni) as uni, max(l.nom_n) as nom_n, max(l.nombre_linea) as nombre_linea,
           sum(l.precio_c * l.cant_c) / nullif(sum(l.cant_c), 0) as precio,
           sum(l.cant_c) as cant, sum(l.importe) as importe,
           bool_or(l.pack) as pack_ud, bool_or(l.conv) as convertido
      from l2 l group by 1, 2, 3, 4
  ),
  -- ══ Cajones genéricos: se miden con las líneas de los últimos 12 meses ══
  st_med as (
    select l.producto_id, l.med, count(*) as n,
           (percentile_cont(0.9) within group (order by l.precio_c)
              / nullif(percentile_cont(0.1) within group (order by l.precio_c), 0))::numeric as r
      from l2 l where l.fecha > v_hoy - 365 group by 1, 2
  ),
  st as (
    select l.producto_id, max(l.producto) as producto,
           count(distinct l.nom_n)::int as nn, count(distinct l.proveedor_id)::int as np
      from l2 l where l.fecha > v_hoy - 365 group by 1
  ),
  st2 as (
    select s.producto_id, s.producto, s.nn, s.np, round(max(m.r) filter (where m.n >= 4), 2) as disp
      from st s left join st_med m using (producto_id) group by 1, 2, 3, 4
  ),
  gen as (
    select s.producto_id, s.nn, s.np, s.disp,
           case
             when s.producto ~* '^\s*(macruros|perciformes|cefal[oó]podos|gadiformes|pleuronectiformes|clupeiformes|escorpeniformes|rajiformes|crust[aá]ceos|moluscos|(pescado|marisco)s? variados?)\M'
               then 'Cajón de la lonja: la nota de venta no dice la especie'
             -- Calibrado con producción (16/11/2026): «Mejillones» (7 nombres, 6 proveedores, de 1 a 1,6) es un
             -- cajón; «Quisquilla» (6 nombres, 4 proveedores, de 1 a 1,6) no: se queda, con confianza media.
             when s.nn >= 6 and s.disp >= 2
               then format('Agrupa %s líneas con nombres distintos y precios que van de 1 a %s', s.nn, replace(round(s.disp, 1)::text, '.', ','))
             when s.np >= 6 and s.disp >= 1.8
               then format('Lo venden %s proveedores a precios que van de 1 a %s: no es un solo artículo', s.np, replace(round(s.disp, 1)::text, '.', ','))
             when s.nn >= 6 and s.np >= 6 and s.disp >= 1.5
               then format('Agrupa %s nombres de línea de %s proveedores, con precios que van de 1 a %s', s.nn, s.np, replace(round(s.disp, 1)::text, '.', ','))
           end as motivo
      from st2 s
  )
  select c.producto_id, c.producto, c.fam, f.nombre::text,
         c.proveedor_id, c.med, c.factura_id, c.fecha, c.numero,
         c.uni, c.nom_n, c.nombre_linea,
         c.precio::numeric, c.cant::numeric, c.importe::numeric,
         c.pack_ud, c.convertido,
         coalesce(g.nn, 0), coalesce(g.np, 0), g.disp, (g.motivo is not null), g.motivo
    from compras c
    left join gen g on g.producto_id = c.producto_id
    left join categorias_producto f on f.id = c.fam
   where c.precio > 0 and c.cant > 0;
end;
$f$;

revoke all on function public.informe_precios_compras(date, text) from public, anon, authenticated;
grant execute on function public.informe_precios_compras(date, text) to service_role;

-- El documento como lo espera el visor de Análisis (DocumentoCifra).
create or replace function public.informe_precios_doc(p_id bigint)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $f$
  select jsonb_build_object(
           'id', d.id, 'fecha', d.fecha, 'proveedor', coalesce(pv.nombre, d.proveedor), 'proveedor_id', d.proveedor_id,
           'numero', d.numero_documento, 'tipo', d.tipo,
           'local', case when d.local = 'touza' then 'touza' else 'casa_tomas' end,
           'total', d.total, 'drive_url', d.drive_url, 'archivo_path', d.archivo_path)
    from facturas d
    left join proveedores pv on pv.id = d.proveedor_id
   where d.id = p_id;
$f$;

revoke all on function public.informe_precios_doc(bigint) from public, anon, authenticated;
grant execute on function public.informe_precios_doc(bigint) to service_role;

-- Versión corta para el chat de Facturas (p_compacto): sin los documentos del visor ni las
-- opciones de los filtros, y con la pauta de lectura.
create or replace function public.informe_precios_compacto(r jsonb, p_como_leer text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $f$
  select (r - 'proveedores' - 'familias' - 'desde' - 'limite') || jsonb_build_object(
    'filas', coalesce((
      select jsonb_agg(
               (x - 'id' - 'doc' - 'doc_ref' - 'doc_barato' - 'nombre_normalizado' - 'producto_id' - 'familia_id'
                  - 'proveedor_id' - 'proveedor_barato_id' - 'gasto_12m')
               || jsonb_strip_nulls(jsonb_build_object(
                    'factura', x -> 'doc' ->> 'numero',
                    'factura_ref', x -> 'doc_ref' ->> 'numero',
                    'factura_barato', x -> 'doc_barato' ->> 'numero'))
             order by o)
        from jsonb_array_elements(r -> 'filas') with ordinality t(x, o)), '[]'::jsonb),
    'excluidos', jsonb_build_object(
      'n_genericos', r -> 'excluidos' -> 'n_genericos',
      'gasto_genericos', r -> 'excluidos' -> 'gasto_genericos',
      'genericos', coalesce((
        select jsonb_agg(g ->> 'producto' order by o)
          from jsonb_array_elements(r -> 'excluidos' -> 'genericos') with ordinality t(g, o) where o <= 6), '[]'::jsonb)),
    'truncado', coalesce((r ->> 'total_filas')::int, 0) > jsonb_array_length(coalesce(r -> 'filas', '[]'::jsonb)),
    'como_leer', p_como_leer);
$f$;

revoke all on function public.informe_precios_compacto(jsonb, text) from public, anon, authenticated;
grant execute on function public.informe_precios_compacto(jsonb, text) to service_role;

-- ─── Bloque 1 · Subidas de precio ───────────────────────────────────────────
create or replace function public.informe_subidas_precio(
  p_meses integer default 12, p_proveedor_id bigint default null, p_familia_id bigint default null,
  p_local text default null, p_hoy date default null, p_limite integer default 200, p_desde integer default 0,
  p_compacto boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set enable_nestloop = off
set jit = off
as $f$
declare
  v_hoy   date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_meses int := coalesce(p_meses, 12);
  v_local text := nullif(btrim(coalesce(p_local, '')), '');
  v_lim   int := least(greatest(coalesce(p_limite, 200), 1), 1000);
  v_off   int := greatest(coalesce(p_desde, 0), 0);
  r       jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.can_read_section('facturas'), false) then
    raise exception 'Sin permiso para ver Facturas' using errcode = '42501';
  end if;
  if v_meses not in (3, 6, 12) then
    raise exception 'meses debe ser 3, 6 o 12' using errcode = '22023';
  end if;
  if v_local is not null and v_local not in ('casa_tomas', 'touza') then
    raise exception 'local debe ser casa_tomas, touza o null' using errcode = '22023';
  end if;

  with
  c as materialized (select * from public.informe_precios_compras(v_hoy, v_local)),
  g as (
    select c.producto_id, c.proveedor_id, c.med,
           count(*) filter (where c.fecha > v_hoy - 365) as n_12m,
           coalesce(sum(c.cant) filter (where c.fecha > v_hoy - 365), 0) as cant_12m,
           coalesce(sum(c.importe) filter (where c.fecha > v_hoy - 365), 0) as gasto_12m,
           (percentile_cont(0.9) within group (order by c.precio) filter (where c.fecha > v_hoy - 365)
              / nullif(percentile_cont(0.1) within group (order by c.precio) filter (where c.fecha > v_hoy - 365), 0))::numeric as disp_g
      from c group by 1, 2, 3
  ),
  gm as (
    select c.producto_id, c.proveedor_id, count(distinct c.med) as n_meds, string_agg(distinct c.med, ', ') as meds
      from c where c.fecha > v_hoy - 365 group by 1, 2
  ),
  ult as (
    select distinct on (c.producto_id, c.proveedor_id, c.med) c.*
      from c order by c.producto_id, c.proveedor_id, c.med, c.fecha desc, c.factura_id desc
  ),
  -- La compra de «hace N meses»: la más reciente entre N y N+3 meses antes de la última.
  refs as (
    select distinct on (u.producto_id, u.proveedor_id, u.med, m.meses)
           u.producto_id, u.proveedor_id, u.med, m.meses,
           x.precio, x.fecha, x.factura_id, x.uni, x.nom_n, x.pack_ud
      from ult u
      cross join (values (3), (6), (12)) m(meses)
      join c x on x.producto_id = u.producto_id and x.proveedor_id = u.proveedor_id and x.med = u.med
     where x.fecha <= (u.fecha - make_interval(months => m.meses))::date
       and x.fecha > (u.fecha - make_interval(months => m.meses + 3))::date
     order by u.producto_id, u.proveedor_id, u.med, m.meses, x.fecha desc, x.factura_id desc
  ),
  base as (
    select u.producto_id, u.producto, u.fam_id, u.familia, u.proveedor_id, u.med, u.factura_id, u.fecha,
           u.uni, u.nom_n, u.precio, u.pack_ud,
           g.n_12m, g.cant_12m, g.gasto_12m, case when g.n_12m >= 4 then round(g.disp_g, 2) end as disp_g,
           coalesce(gm.n_meds, 1) as n_meds, gm.meds,
           r3.precio as p3, r3.fecha as f3, r3.factura_id as d3,
           r6.precio as p6, r6.fecha as f6, r6.factura_id as d6,
           r12.precio as p12, r12.fecha as f12, r12.factura_id as d12,
           rs.precio as ref, rs.fecha as ref_fecha, rs.factura_id as ref_doc, rs.uni as ref_uni, rs.nom_n as ref_nom, rs.pack_ud as ref_pack
      from ult u
      join g on g.producto_id = u.producto_id and g.proveedor_id = u.proveedor_id and g.med = u.med
      left join gm on gm.producto_id = u.producto_id and gm.proveedor_id = u.proveedor_id
      left join refs r3 on r3.producto_id = u.producto_id and r3.proveedor_id = u.proveedor_id and r3.med = u.med and r3.meses = 3
      left join refs r6 on r6.producto_id = u.producto_id and r6.proveedor_id = u.proveedor_id and r6.med = u.med and r6.meses = 6
      left join refs r12 on r12.producto_id = u.producto_id and r12.proveedor_id = u.proveedor_id and r12.med = u.med and r12.meses = 12
      left join refs rs on rs.producto_id = u.producto_id and rs.proveedor_id = u.proveedor_id and rs.med = u.med and rs.meses = v_meses
     where u.fecha >= v_hoy - 120          -- se sigue comprando
       and not u.generico
       and (p_proveedor_id is null or u.proveedor_id = p_proveedor_id)
       and (p_familia_id is null or u.fam_id = p_familia_id)
  ),
  cal as (
    select b.*,
           round((b.precio / b.ref - 1) * 100, 1) as var,
           round((b.precio - b.ref) * b.cant_12m, 2) as impacto,
           ((b.pack_ud or coalesce(b.ref_pack, false))
             and (b.nom_n is distinct from b.ref_nom or abs(b.precio / b.ref - 1) > 0.3)) as pack_grave
      from base b
     where b.ref is not null and b.ref > 0
  ),
  mot as (
    select k.*,
           array_remove(array[
             case when abs(k.precio / k.ref - 1) > 0.6 then 'Diferencia de más del 60 %: seguramente es otro formato o un precio mal leído' end,
             case when k.pack_grave then 'El nombre dice caja o pack y está guardado como unidad suelta' end,
             case when k.disp_g >= 1.6 then format('El precio cambia mucho de una compra a otra (de 1 a %s en 12 meses)', replace(round(k.disp_g, 1)::text, '.', ',')) end,
             case when k.n_12m < 2 then 'Una sola compra en los últimos 12 meses' end
           ], null) as m_baja,
           array_remove(array[
             case when k.n_12m between 2 and 3 then format('Pocas compras: %s en 12 meses', k.n_12m) end,
             case when k.n_meds > 1 then format('Este proveedor lo factura en varias unidades (%s)', k.meds) end,
             case when k.uni is distinct from k.ref_uni then format('Formatos distintos pasados a €/%s (%s y %s)', k.med, k.ref_uni, k.uni) end,
             case when k.disp_g >= 1.3 and k.disp_g < 1.6 then 'Precio variable entre compras' end,
             case when (k.pack_ud or coalesce(k.ref_pack, false)) and not k.pack_grave then 'El nombre dice caja o pack y está guardado como unidad: comprueba que es el mismo formato' end,
             case when k.nom_n is distinct from k.ref_nom and not (k.pack_ud or coalesce(k.ref_pack, false)) then 'El texto de la línea no es igual en las dos facturas' end
           ], null) as m_media
      from cal k
  ),
  niv as (
    select m.*,
           case when cardinality(m.m_baja) > 0 then 'baja' when cardinality(m.m_media) > 0 then 'media' else 'alta' end as confianza,
           case when cardinality(m.m_baja) > 0 then array_to_string(m.m_baja, '. ')
                when cardinality(m.m_media) > 0 then array_to_string(m.m_media, '. ')
                else format('Mismo proveedor y misma unidad; %s compras en 12 meses', m.n_12m) end as motivo
      from mot m
  ),
  sub as (select * from niv where var >= 1),
  pag as (
    select * from sub
     order by (confianza = 'baja'), impacto desc, producto_id, proveedor_id, med
     limit v_lim offset v_off
  ),
  gen as (
    select c.producto_id, max(c.producto) as producto, max(c.motivo_generico) as motivo,
           round(sum(c.importe), 2) as gasto, count(distinct c.proveedor_id) as proveedores
      from c
     where c.generico and c.fecha > v_hoy - 365
       and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
       and (p_familia_id is null or c.fam_id = p_familia_id)
     group by 1
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'meses', v_meses, 'local', v_local,
    'totales', jsonb_build_object(
      'impacto_fiable', coalesce((select round(sum(impacto), 2) from sub where confianza <> 'baja'), 0),
      'n_fiable', (select count(*) from sub where confianza <> 'baja'),
      'por_confianza', (
        select jsonb_object_agg(n.nivel, jsonb_build_object(
                 'n', (select count(*) from sub s where s.confianza = n.nivel),
                 'impacto', coalesce((select round(sum(s.impacto), 2) from sub s where s.confianza = n.nivel), 0)))
          from (values ('alta'), ('media'), ('baja')) n(nivel)),
      'bajadas_fiable', jsonb_build_object(
        'n', (select count(*) from niv where var <= -1 and confianza <> 'baja'),
        'importe', coalesce((select round(sum(impacto), 2) from niv where var <= -1 and confianza <> 'baja'), 0)),
      'sin_referencia', (select count(*) from base where ref is null),
      'comparados', (select count(*) from niv)),
    'total_filas', (select count(*) from sub),
    'desde', v_off, 'limite', v_lim,
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', format('%s:%s:%s', p.producto_id, p.proveedor_id, p.med),
               'producto_id', p.producto_id, 'producto', p.producto, 'nombre_normalizado', p.nom_n,
               'familia_id', p.fam_id, 'familia', p.familia,
               'proveedor_id', p.proveedor_id, 'proveedor', pv.nombre,
               'unidad', p.med,
               'precio', round(p.precio, 4), 'fecha', p.fecha,
               'precio_ref', round(p.ref, 4), 'fecha_ref', p.ref_fecha,
               'variacion_pct', p.var,
               'hace_3', case when p.p3 is not null then jsonb_build_object('precio', round(p.p3, 4), 'fecha', p.f3, 'variacion_pct', round((p.precio / p.p3 - 1) * 100, 1)) end,
               'hace_6', case when p.p6 is not null then jsonb_build_object('precio', round(p.p6, 4), 'fecha', p.f6, 'variacion_pct', round((p.precio / p.p6 - 1) * 100, 1)) end,
               'hace_12', case when p.p12 is not null then jsonb_build_object('precio', round(p.p12, 4), 'fecha', p.f12, 'variacion_pct', round((p.precio / p.p12 - 1) * 100, 1)) end,
               'compras_12m', p.n_12m, 'cantidad_12m', round(p.cant_12m, 2), 'gasto_12m', round(p.gasto_12m, 2),
               'impacto_anual', p.impacto,
               'confianza', p.confianza, 'motivo', p.motivo,
               'doc', public.informe_precios_doc(p.factura_id),
               'doc_ref', public.informe_precios_doc(p.ref_doc))
             order by (p.confianza = 'baja'), p.impacto desc, p.producto_id, p.proveedor_id, p.med)
        from pag p left join proveedores pv on pv.id = p.proveedor_id), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.proveedor_id, 'nombre', x.nombre, 'n', x.n) order by x.nombre)
        from (select s.proveedor_id, max(pv.nombre) as nombre, count(*) as n
                from sub s left join proveedores pv on pv.id = s.proveedor_id group by 1) x), '[]'::jsonb),
    'familias', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.fam_id, 'nombre', x.familia, 'n', x.n) order by x.familia)
        from (select s.fam_id, max(s.familia) as familia, count(*) as n from sub s where s.fam_id is not null group by 1) x), '[]'::jsonb),
    'excluidos', jsonb_build_object(
      'n_genericos', (select count(*) from gen),
      'gasto_genericos', coalesce((select sum(gasto) from gen), 0),
      'genericos', coalesce((
        select jsonb_agg(jsonb_build_object('producto_id', x.producto_id, 'producto', x.producto, 'motivo', x.motivo,
                                            'gasto_12m', x.gasto, 'proveedores', x.proveedores) order by x.gasto desc)
          from (select * from gen order by gasto desc limit 15) x), '[]'::jsonb))
  ) into r;
  if coalesce(p_compacto, false) then
    r := public.informe_precios_compacto(r,
      'Subidas: última compra frente a la de hace N meses, mismo proveedor y unidad, sin IVA. impacto_anual = diferencia × cantidad_12m. '
      || 'Suma solo totales.impacto_fiable (confianza alta y media); las de confianza baja son para revisar, no las sumes. '
      || 'excluidos = productos genéricos que no se comparan.');
  end if;
  return r;
end;
$f$;

revoke all on function public.informe_subidas_precio(integer, bigint, bigint, text, date, integer, integer, boolean) from public, anon;
grant execute on function public.informe_subidas_precio(integer, bigint, bigint, text, date, integer, integer, boolean) to authenticated, service_role;

-- ─── Bloque 2 · Proveedor más barato ────────────────────────────────────────
create or replace function public.informe_proveedor_mas_barato(
  p_proveedor_id bigint default null, p_familia_id bigint default null,
  p_local text default null, p_hoy date default null, p_limite integer default 200, p_desde integer default 0,
  p_compacto boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set enable_nestloop = off
set jit = off
as $f$
declare
  v_hoy   date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_local text := nullif(btrim(coalesce(p_local, '')), '');
  v_lim   int := least(greatest(coalesce(p_limite, 200), 1), 1000);
  v_off   int := greatest(coalesce(p_desde, 0), 0);
  r       jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.can_read_section('facturas'), false) then
    raise exception 'Sin permiso para ver Facturas' using errcode = '42501';
  end if;
  if v_local is not null and v_local not in ('casa_tomas', 'touza') then
    raise exception 'local debe ser casa_tomas, touza o null' using errcode = '22023';
  end if;

  with
  c as materialized (
    select * from public.informe_precios_compras(v_hoy, v_local) x where x.fecha > v_hoy - 365
  ),
  -- Cada proveedor de cada producto y unidad: su ÚLTIMA factura es su precio.
  pp as (
    select c.producto_id, c.med, c.proveedor_id,
           (array_agg(c.precio order by c.fecha desc, c.factura_id desc))[1] as precio,
           (array_agg(c.factura_id order by c.fecha desc, c.factura_id desc))[1] as doc,
           (array_agg(c.uni order by c.fecha desc, c.factura_id desc))[1] as uni,
           max(c.fecha) as fecha, count(*)::int as n, sum(c.cant) as cant, sum(c.importe) as gasto,
           bool_or(c.pack_ud) as pack_ud,
           case when count(*) >= 4 then round((percentile_cont(0.9) within group (order by c.precio)
                  / nullif(percentile_cont(0.1) within group (order by c.precio), 0))::numeric, 2) end as disp_g,
           max(c.producto) as producto, max(c.nom_n) as nom_n, max(c.fam_id) as fam_id, max(c.familia) as familia, max(c.nn) as nn
      from c
     where not c.generico
     group by 1, 2, 3
  ),
  varios as (select producto_id, med from pp group by 1, 2 having count(*) >= 2),
  habitual as (
    select distinct on (producto_id, med) producto_id, med, proveedor_id
      from pp order by producto_id, med, fecha desc, doc desc
  ),
  -- Para cada proveedor al que se le sigue comprando, el más barato de los otros
  -- (primero los que tienen 2 compras o más, recientes y no «demasiado» baratos).
  par as (
    select distinct on (a.producto_id, a.med, a.proveedor_id)
           a.*, b.proveedor_id as prov_b, b.precio as precio_b, b.doc as doc_b, b.uni as uni_b,
           b.fecha as fecha_b, b.n as n_b, b.pack_ud as pack_b, b.disp_g as disp_b
      from pp a
      join pp b on b.producto_id = a.producto_id and b.med = a.med
     where b.proveedor_id <> a.proveedor_id
       and b.precio < a.precio * 0.97
       and a.fecha > v_hoy - 183
     order by a.producto_id, a.med, a.proveedor_id,
              (b.n >= 2 and b.fecha > v_hoy - 183 and b.precio >= a.precio * 0.4) desc, b.precio asc
  ),
  cal as (
    select p.*, round((1 - p.precio_b / p.precio) * 100, 1) as dif,
           round((p.precio - p.precio_b) * p.cant, 2) as ahorro,
           (h.proveedor_id is not null) as es_habitual
      from par p
      left join habitual h on h.producto_id = p.producto_id and h.med = p.med and h.proveedor_id = p.proveedor_id
     where (p.precio - p.precio_b) * p.cant >= 10
       and (p_proveedor_id is null or p.proveedor_id = p_proveedor_id or p.prov_b = p_proveedor_id)
       and (p_familia_id is null or p.fam_id = p_familia_id)
  ),
  mot as (
    select k.*,
           array_remove(array[
             case when k.dif > 60 then 'Más de un 60 % más barato: seguramente es otro formato u otra calidad' end,
             case when k.pack_ud or k.pack_b then 'El nombre dice caja o pack y está guardado como unidad suelta' end,
             case when k.n < 2 or k.n_b < 2 then 'Una sola compra a uno de los dos proveedores' end,
             case when k.fecha_b <= v_hoy - 183 then 'El precio barato es de hace más de 6 meses' end,
             case when greatest(coalesce(k.disp_g, 1), coalesce(k.disp_b, 1)) >= 1.6 then 'El precio de uno de los dos cambia mucho de una compra a otra' end
           ], null) as m_baja,
           array_remove(array[
             case when k.familia in ('Pescado y marisco', 'Frutas y verduras') then 'Pescado, marisco, fruta o verdura: el tamaño y la calidad pueden no ser iguales' end,
             case when k.dif > 30 and k.dif <= 60 then 'Diferencia de más del 30 %: comprueba que es la misma calidad' end,
             case when (k.n between 2 and 2) or (k.n_b between 2 and 2) then 'Pocas compras a uno de los dos (2 en 12 meses)' end,
             case when k.uni is distinct from k.uni_b then format('Formatos distintos pasados a €/%s (%s y %s)', k.med, k.uni, k.uni_b) end,
             case when k.med not in ('kg', 'l', 'ud', 'botella', 'docena') then format('Se compara por «%s»: comprueba que las dos son del mismo tamaño', k.med) end,
             case when k.fecha_b <= v_hoy - 92 and k.fecha_b > v_hoy - 183 then 'El precio barato es de hace más de 3 meses' end,
             case when k.nn >= 4 then format('El producto agrupa %s nombres de línea distintos', k.nn) end,
             case when greatest(coalesce(k.disp_g, 1), coalesce(k.disp_b, 1)) >= 1.3
                   and greatest(coalesce(k.disp_g, 1), coalesce(k.disp_b, 1)) < 1.6 then 'Precio variable entre compras' end
           ], null) as m_media
      from cal k
  ),
  niv as (
    select m.*,
           case when cardinality(m.m_baja) > 0 then 'baja' when cardinality(m.m_media) > 0 then 'media' else 'alta' end as confianza,
           case when cardinality(m.m_baja) > 0 then array_to_string(m.m_baja, '. ')
                when cardinality(m.m_media) > 0 then array_to_string(m.m_media, '. ')
                else format('Mismo producto y misma unidad; %s y %s compras en 12 meses', m.n, m.n_b) end as motivo
      from mot m
  ),
  pag as (
    select * from niv
     order by (confianza = 'baja'), ahorro desc, producto_id, proveedor_id, med
     limit v_lim offset v_off
  ),
  gen as (
    select c.producto_id, max(c.producto) as producto, max(c.motivo_generico) as motivo,
           round(sum(c.importe), 2) as gasto, count(distinct c.proveedor_id) as proveedores
      from c
     where c.generico
       and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
       and (p_familia_id is null or c.fam_id = p_familia_id)
     group by 1
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'local', v_local,
    'totales', jsonb_build_object(
      'ahorro_fiable', coalesce((select round(sum(ahorro), 2) from niv where confianza <> 'baja'), 0),
      'n_fiable', (select count(*) from niv where confianza <> 'baja'),
      'por_confianza', (
        select jsonb_object_agg(n.nivel, jsonb_build_object(
                 'n', (select count(*) from niv s where s.confianza = n.nivel),
                 'ahorro', coalesce((select round(sum(s.ahorro), 2) from niv s where s.confianza = n.nivel), 0)))
          from (values ('alta'), ('media'), ('baja')) n(nivel)),
      'productos_varios_proveedores', (select count(*) from varios)),
    'total_filas', (select count(*) from niv),
    'desde', v_off, 'limite', v_lim,
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', format('%s:%s:%s', p.producto_id, p.proveedor_id, p.med),
               'producto_id', p.producto_id, 'producto', p.producto, 'nombre_normalizado', p.nom_n,
               'familia_id', p.fam_id, 'familia', p.familia,
               'unidad', p.med,
               'proveedor_id', p.proveedor_id, 'proveedor', pa.nombre,
               'precio', round(p.precio, 4), 'fecha', p.fecha, 'compras_12m', p.n,
               'cantidad_12m', round(p.cant, 2), 'gasto_12m', round(p.gasto, 2), 'es_habitual', p.es_habitual,
               'proveedor_barato_id', p.prov_b, 'proveedor_barato', pb.nombre,
               'precio_barato', round(p.precio_b, 4), 'fecha_barato', p.fecha_b, 'compras_barato_12m', p.n_b,
               'diferencia_pct', p.dif, 'ahorro_anual', p.ahorro,
               'confianza', p.confianza, 'motivo', p.motivo,
               'doc', public.informe_precios_doc(p.doc),
               'doc_barato', public.informe_precios_doc(p.doc_b))
             order by (p.confianza = 'baja'), p.ahorro desc, p.producto_id, p.proveedor_id, p.med)
        from pag p
        left join proveedores pa on pa.id = p.proveedor_id
        left join proveedores pb on pb.id = p.prov_b), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'n', x.n) order by x.nombre)
        from (select pv.id, max(pv.nombre) as nombre, count(*) as n
                from niv s join proveedores pv on pv.id in (s.proveedor_id, s.prov_b) group by 1) x), '[]'::jsonb),
    'familias', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.fam_id, 'nombre', x.familia, 'n', x.n) order by x.familia)
        from (select s.fam_id, max(s.familia) as familia, count(*) as n from niv s where s.fam_id is not null group by 1) x), '[]'::jsonb),
    'excluidos', jsonb_build_object(
      'n_genericos', (select count(*) from gen),
      'gasto_genericos', coalesce((select sum(gasto) from gen), 0),
      'genericos', coalesce((
        select jsonb_agg(jsonb_build_object('producto_id', x.producto_id, 'producto', x.producto, 'motivo', x.motivo,
                                            'gasto_12m', x.gasto, 'proveedores', x.proveedores) order by x.gasto desc)
          from (select * from gen order by gasto desc limit 15) x), '[]'::jsonb))
  ) into r;
  if coalesce(p_compacto, false) then
    r := public.informe_precios_compacto(r,
      'Proveedor más barato: última factura de cada proveedor, mismo producto y unidad, sin IVA. ahorro_anual = diferencia × cantidad_12m comprada al caro. '
      || 'Suma solo totales.ahorro_fiable (confianza alta y media); las de confianza baja son para revisar, no las sumes. '
      || 'Di siempre el motivo de la confianza: puede no ser la misma calidad.');
  end if;
  return r;
end;
$f$;

revoke all on function public.informe_proveedor_mas_barato(bigint, bigint, text, date, integer, integer, boolean) from public, anon;
grant execute on function public.informe_proveedor_mas_barato(bigint, bigint, text, date, integer, integer, boolean) to authenticated, service_role;

comment on function public.informe_subidas_precio(integer, bigint, bigint, text, date, integer, integer, boolean) is
  '20261207110000 · Informe «Subidas de precio»: última compra frente a la de hace 3, 6 y 12 meses (mismo proveedor y unidad), impacto anual y confianza. Totales solo con confianza alta y media.';
comment on function public.informe_proveedor_mas_barato(bigint, bigint, text, date, integer, integer, boolean) is
  '20261207110000 · Informe «Proveedor más barato»: productos comprados a 2 o más proveedores en 12 meses, misma unidad, ahorro anual y confianza. Totales solo con confianza alta y media.';

commit;
