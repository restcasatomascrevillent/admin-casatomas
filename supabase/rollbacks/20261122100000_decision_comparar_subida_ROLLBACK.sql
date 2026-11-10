-- ROLLBACK de 20261122100000_decision_comparar_subida: vuelve a facturas_decision tal como
-- quedó en 20261116100000_chatbot_margenes_alertas (doc_otro solo con datos.factura_otro_id).
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
-- 20261115100000_facturas_decision · 20261115300000_facturas_decision_periodo_largo.
-- Todo lo de las cuatro tarjetas en una llamada:
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
  -- 20261115300000: tramo que se compara en familias y cómo (ver más abajo).
  v_cmp_ini  date;
  v_cmp_fin  date;
  v_meq_fam  numeric;
  v_modo     text := 'anteriores';
  v_dentro   date[];
  v_inc      date[];
  v_top_ini  date;
  v_gasto    numeric;
  v_docs     int;
  r_fam      jsonb;
  r_cam      jsonb;
  r_top      jsonb;
  r_rev      jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.can_read_section('facturas'), false) then
    raise exception 'Sin permiso para ver Facturas' using errcode = '42501';
  end if;
  if v_local is not null and v_local not in ('casa_tomas', 'touza') then
    raise exception 'local debe ser casa_tomas, touza o null' using errcode = '22023';
  end if;
  if v_desde > v_hasta then
    raise exception 'desde no puede ser posterior a hasta' using errcode = '22023';
  end if;
  -- 20261115300000: «Todo» (sin desde) es desde el primer documento, no el mes en curso.
  if p_desde is null then
    v_desde := coalesce((select min(f.fecha) from facturas f
                          where f.fecha <= v_hasta
                            and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)), v_desde);
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

  -- 20261115300000 (bug del dueño: con «Año» o «Todo» no había meses completos
  -- ANTERIORES y la tarjeta no comparaba). Si no hay referencia anterior y el periodo
  -- tiene ≥ 2 meses completos, se compara su ÚLTIMO mes completo con la media de los
  -- (hasta v_fam_m) meses completos anteriores DEL PROPIO periodo: «septiembre frente a
  -- la media de marzo–agosto». periodo.comparado lo dice (modo «ultimo_mes»).
  v_cmp_ini := v_desde;
  v_cmp_fin := v_hasta;
  v_meq_fam := v_meq;
  if cardinality(v_ref) = 0 then
    select coalesce(array_agg(x.mes order by x.mes), '{}') into v_dentro
      from (select date_trunc('month', f.fecha)::date as mes
              from facturas f
             where f.fecha between v_desde and v_hasta
               and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
               and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
             group by 1) x
     where x.mes >= v_desde
       and (x.mes + interval '1 month - 1 day')::date <= v_hasta
       and (x.mes + interval '1 month - 1 day')::date < current_date
       and not (x.mes = any(v_inc));
    if cardinality(v_dentro) >= 2 then
      v_modo := 'ultimo_mes';
      v_cmp_ini := v_dentro[cardinality(v_dentro)];
      v_cmp_fin := (v_cmp_ini + interval '1 month - 1 day')::date;
      v_ref := v_dentro[greatest(1, cardinality(v_dentro) - v_fam_m):cardinality(v_dentro) - 1];
      v_meq_fam := 1;
    end if;
  end if;

  -- Gasto con IVA de los documentos (abonos restan; albaranes facturados no suman).
  select coalesce(sum(coalesce(f.total, 0)), 0), count(*) into v_gasto, v_docs
    from facturas f
   where f.fecha between v_desde and v_hasta
     and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
     and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local);

  -- ══ 1. Familias ══
  with lin as (
    select coalesce(c.padre_id, c.id) as fam, fa.fecha between v_cmp_ini and v_cmp_fin as en_periodo, pf.total::numeric as importe
      from facturas fa
      join productos_factura pf on pf.factura_id = fa.id
      left join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
     where (fa.fecha between v_cmp_ini and v_cmp_fin
            or (cardinality(v_ref) > 0 and fa.fecha >= v_ref[1] and fa.fecha < v_cmp_ini
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
           a.media_mes * v_meq_fam as referencia,
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
                    and f.importe - f.referencia >= v_fam_ext * least(v_meq_fam, 1),
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
                                  -- 20261115300000: el tramo de «familias» (todo el periodo o su último mes completo).
                                  'comparado', jsonb_build_object('modo', v_modo, 'desde', v_cmp_ini, 'hasta', v_cmp_fin),
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
revoke all on function public.facturas_decision(date, date, text) from public, anon;
grant execute on function public.facturas_decision(date, date, text) to authenticated, service_role;
