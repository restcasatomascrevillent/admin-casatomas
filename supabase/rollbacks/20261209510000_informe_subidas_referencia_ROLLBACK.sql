-- Vuelta atrás de 20261209510000_informe_subidas_referencia: deja las dos funciones como en 20261209120000.
begin;
set lock_timeout = '5s';
create or replace function public.informe_precios_compras(p_hoy date default null, p_local text default null)
returns table (
  producto_id bigint, producto text, fam_id bigint, familia text,
  proveedor_id bigint, med text, factura_id bigint, fecha date, numero text,
  uni text, nom_n text, nombre_linea text,
  precio numeric, cant numeric, importe numeric,
  pack_ud boolean, convertido boolean,
  nn integer, np integer, disp numeric, generico boolean, motivo_generico text,
  tam numeric, tam_u text, mat text, p_min numeric, p_max numeric)
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
           pf.contenido_origen::text as contenido_origen,
           pc.envase_cantidad, pc.envase_unidad::text as envase_unidad, pc.envases_por_bulto, c.nombre::text as categoria,
           concat_ws('|', coalesce(pf.nombre::text, '~'), coalesce(pf.unidad::text, '~'), coalesce(pf.precio_unitario::text, '~'),
                     coalesce(pf.contenido_cantidad::text, '~'), coalesce(pf.contenido_unidad::text, '~'),
                     coalesce(pc.envase_cantidad::text, '~'), coalesce(pc.envase_unidad::text, '~'),
                     coalesce(pc.envases_por_bulto::text, '~'), coalesce(c.nombre::text, '~'),
                     coalesce(pf.contenido_origen::text, '~')) as vkey
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
  -- 20261209120000: el contenido corregido a mano (l o kg) manda sobre volumen_linea, que en
  -- las cajas usa el envase del catálogo; y se guarda el tamaño de UN envase y su material.
  vd as (
    select d.*,
           (d.contenido_origen = 'manual' and d.contenido_unidad in ('l', 'kg') and d.contenido_cantidad > 0) as man,
           coalesce(public.unidad_agente(d.unidad_txt), 'ud') as u_ag
      from (select distinct on (vkey) * from lb) d
  ),
  vol as materialized (
    select d.vkey,
           case when d.man then d.contenido_unidad else v.medida end as medida,
           case when d.man then d.contenido_cantidad else v.por_unidad end as por_unidad,
           case
             when d.u_ag in ('l', 'kg') then null
             when d.man then d.contenido_cantidad / greatest(coalesce(case when d.u_ag in ('caja', 'pack', 'fardo', 'jaula', 'estuche', 'cj', 'cja', 'bulto', 'lote', 'display', 'retractilado')
                                                                         then coalesce(e.unidades, d.envases_por_bulto) end, 1), 1)
             when v.por_unidad > 0 then v.por_unidad / greatest(coalesce(v.envases, 1), 1)
           end as tam,
           case when d.u_ag in ('l', 'kg') then null when d.man then d.contenido_unidad else v.medida end as tam_u,
           case
             when d.nombre_linea ~* '\mlatas?\M' or d.nombre_linea ~* '[a-zñ]\s+lt\M' then 'lata'
             when d.nombre_linea ~* '\m(vidrio|cristal|retornable|vdr)\M' or d.nombre_linea ~* '\me\.\s?r\.' then 'vidrio'
             when d.nombre_linea ~* '\m(pet|pl[aá]stico)\M' then 'plastico'
           end as mat
      from vd d
      left join lateral public.volumen_linea(
             d.nombre_linea, d.unidad_txt, 1::numeric, d.precio_unitario,
             d.contenido_cantidad, d.contenido_unidad,
             d.envase_cantidad, d.envase_unidad, d.envases_por_bulto,
             public.volumen_max_eur_litro(d.categoria)) v on not d.man
      left join lateral public.envase_texto(d.nombre_linea) e on d.man
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
           x.conv, v.tam, v.tam_u, v.mat
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
           bool_or(l.pack) as pack_ud, bool_or(l.conv) as convertido,
           max(l.tam) as tam, max(l.tam_u) as tam_u, max(l.mat) as mat,
           min(l.precio_c) as p_min, max(l.precio_c) as p_max
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
         coalesce(g.nn, 0), coalesce(g.np, 0), g.disp, (g.motivo is not null), g.motivo,
         c.tam::numeric, c.tam_u, c.mat, c.p_min::numeric, c.p_max::numeric
    from compras c
    left join gen g on g.producto_id = c.producto_id
    left join categorias_producto f on f.id = c.fam
   where c.precio > 0 and c.cant > 0;
end;
$f$;

revoke all on function public.informe_precios_compras(date, text) from public, anon, authenticated;
grant execute on function public.informe_precios_compras(date, text) to service_role;

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
           x.precio, x.fecha, x.factura_id, x.uni, x.nom_n, x.pack_ud,
           x.tam, x.tam_u, x.mat, x.p_min, x.p_max
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
           u.tam, u.tam_u, u.mat, u.p_min, u.p_max,
           g.n_12m, g.cant_12m, g.gasto_12m, case when g.n_12m >= 4 then round(g.disp_g, 2) end as disp_g,
           coalesce(gm.n_meds, 1) as n_meds, gm.meds,
           r3.precio as p3, r3.fecha as f3, r3.factura_id as d3,
           r6.precio as p6, r6.fecha as f6, r6.factura_id as d6,
           r12.precio as p12, r12.fecha as f12, r12.factura_id as d12,
           rs.precio as ref, rs.fecha as ref_fecha, rs.factura_id as ref_doc, rs.uni as ref_uni, rs.nom_n as ref_nom, rs.pack_ud as ref_pack,
           rs.tam as ref_tam, rs.tam_u as ref_tam_u, rs.mat as ref_mat, rs.p_min as ref_p_min, rs.p_max as ref_p_max
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
             case when k.n_12m < 2 then 'Una sola compra en los últimos 12 meses' end,
             -- 20261209120000: envases distintos y tallas mezcladas en una misma factura.
             case when public.informe_precios_envases_distintos(k.tam, k.tam_u, k.mat, k.ref_tam, k.ref_tam_u, k.ref_mat)
                  then public.informe_precios_motivo_envase(k.tam, k.tam_u, k.mat, k.ref_tam, k.ref_tam_u, k.ref_mat) end,
             case when k.p_max > k.p_min * 1.25 then public.informe_precios_motivo_tallas(k.p_min, k.p_max, k.med)
                  when k.ref_p_max > k.ref_p_min * 1.25 then public.informe_precios_motivo_tallas(k.ref_p_min, k.ref_p_max, k.med) end
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
commit;
