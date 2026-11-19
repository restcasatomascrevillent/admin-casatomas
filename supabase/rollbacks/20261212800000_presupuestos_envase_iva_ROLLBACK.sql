set client_encoding = 'UTF8';
-- Vuelta atrás de 20261212800000_presupuestos_envase_iva: repone comparar_presupuesto_agente tal como
-- estaba en 20261212300000_presupuestos_revision_produccion (sin envase, unidad_tarifa, iva_pct ni precio_envase).
begin;
set local lock_timeout = '5s';

create or replace function public.comparar_presupuesto_agente(
  p_presupuesto_id uuid, p_descuento_pct numeric, p_descuento_importe numeric, p_proveedor text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_row      chat_presupuestos%rowtype;
  v_hoy      date := (now() at time zone 'Europe/Madrid')::date;
  v_base_ped numeric;     -- total del pedido, solo si TODAS las líneas traen cantidad
  v_pct_in   numeric := 0;
  v_modo     text := 'ninguno';
  v_pct      numeric;     -- el porcentaje que se aplica (el pedido o el equivalente del importe)
  v_base     numeric;     -- sobre qué se reparte el importe
  v_desc     jsonb;
  v_lineas   jsonb;
  v_no       jsonb;
  v_res      jsonb;
  v_prov     text;
  v_prov_n   text;
begin
  select * into v_row from chat_presupuestos where id = p_presupuesto_id;
  if not found then
    return jsonb_build_object('error', 'No hay ningun presupuesto adjunto en esta conversacion: pide al usuario que lo adjunte.');
  end if;
  -- Proveedor: el del fichero o, si no lo decía, el que contesta el usuario.
  v_prov := coalesce(nullif(btrim(p_proveedor), ''), v_row.proveedor);
  v_prov_n := nullif(lower(btrim(coalesce(normalizar_nombre_producto(v_prov), v_prov))), '');
  if p_descuento_pct is not null and p_descuento_importe is not null then
    return jsonb_build_object('error', 'Parametro descuento: manda un porcentaje O un importe, no los dos.');
  end if;

  -- Total del pedido: solo con cantidades en TODAS las líneas (PDF o foto con cantidades).
  select case when bool_and(nullif(o.l->>'cantidad', '') is not null)
              then sum((o.l->>'precio')::numeric * (o.l->>'cantidad')::numeric) end
    into v_base_ped
    from jsonb_array_elements(v_row.lineas) o(l);

  if p_descuento_pct is not null then
    if p_descuento_pct < 0 or p_descuento_pct >= 100 then
      return jsonb_build_object('error', 'Parametro descuento: el porcentaje debe estar entre 0 y 100.');
    end if;
    v_pct_in := p_descuento_pct;
    v_modo := 'porcentaje';
  elsif p_descuento_importe is not null then
    if p_descuento_importe < 0 then
      return jsonb_build_object('error', 'Parametro descuento: el importe debe ser positivo.');
    end if;
    v_modo := 'importe';
  end if;

  with src as (
    select o.ord::int as ord,
           o.l->>'producto' as producto,
           o.l->>'producto_catalogo' as catalogo,
           nullif(o.l->>'producto_id', '')::bigint as pid,
           o.l->>'confianza' as confianza,
           o.l->>'nota' as nota,
           o.l->>'metodo' as metodo,
           (o.l->>'precio')::numeric as precio,
           o.l->>'unidad' as unidad,
           nullif(o.l->>'contenido_cantidad', '')::numeric as cc,
           greatest(coalesce(nullif(o.l->>'envases', '')::numeric, 1), 1) as envases,
           nullif(o.l->>'contenido_unidad', '') as cu
      from jsonb_array_elements(v_row.lineas) with ordinality o(l, ord)
  ),
  ofe as (
    select s.*, bl.unidad_base, bl.factor,
           unidad_agente(coalesce(nullif(btrim(s.unidad), ''), 'ud')) as u_raw
      from src s
     cross join lateral base_linea_agente(s.unidad, s.cc, s.cu) bl
  ),
  -- Las referencias de TODOS los productos en una sola pasada (antes, una llamada por producto y unidad).
  lote as materialized (
    select * from referencias_precio_lote_agente(
      coalesce((select array_agg(distinct pid) from ofe where pid is not null), '{}'::bigint[]), v_hoy)
  ),
  uh as (select l.producto_id as k_pid, array_agg(l.unidad order by l.unidad) as unidades_historial from lote l group by 1),
  claves as (select distinct pid, unidad_base, u_raw from ofe where pid is not null),
  -- De las dos unidades de la línea, la de la compra más reciente (empate: la base).
  refs as (
    select distinct on (k.pid, k.unidad_base, k.u_raw)
           k.pid as k_pid, k.unidad_base as k_ub, k.u_raw as k_ur, x.*
      from claves k
      join lote x on x.producto_id = k.pid and (x.unidad is not distinct from k.unidad_base or x.unidad = k.u_raw)
     order by k.pid, k.unidad_base, k.u_raw, x.ultimo_fecha desc, (x.unidad is not distinct from k.unidad_base) desc
  ),
  cmp0 as (
    select o.*, r.unidad as u_usada, h.unidades_historial, r.ultimo_precio, r.ultimo_fecha, r.ultimo_proveedor,
           r.ultimo_numero, r.ultimo_nombre, r.media_12m, r.compras_12m, r.consumo_12m, r.mejor_precio, r.mejor_proveedor, r.mejor_fecha,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio / o.factor
                when r.unidad = 'ud' and o.u_raw = 'ud' then o.precio / o.envases
                else o.precio end as p_bruto
      from ofe o
      left join refs r on o.pid is not null and r.k_pid = o.pid
                      and r.k_ub is not distinct from o.unidad_base and r.k_ur is not distinct from o.u_raw
      left join uh h on h.k_pid = o.pid
  ),
  -- Envase de la tarifa frente al de la última compra de referencia (solo las que se pueden comparar).
  cmp as (
    select c.*,
           (c.pid is not null and c.u_usada is not null and c.ultimo_precio > 0
            and c.confianza is distinct from 'formato_distinto') as comparable,
           e.det as det_envase,
           coalesce(e.distinto, false) as envase_distinto
      from cmp0 c
      left join lateral (
        select x.det, x.distinto
          from (select et.volumen as tv, et.unidad as tu, et.unidades as tn, presupuesto_material_agente(c.producto) as tm,
                       eh.volumen as hv, eh.unidad as hu, eh.unidades as hn, presupuesto_material_agente(c.ultimo_nombre) as hm
                  from (select 1) d
                  left join lateral presupuesto_envase_agente(c.producto) et on true
                  left join lateral presupuesto_envase_agente(c.ultimo_nombre) eh on true) y
         cross join lateral (select
                   (coalesce(y.tv > 0 and y.hv > 0 and (y.tu is distinct from y.hu or abs(y.tv / y.hv - 1) > 0.04), false)
                    or coalesce(y.tm <> y.hm, false)
                    or coalesce(c.u_raw = 'caja' and y.tn is not null and y.hn is not null and y.tn <> y.hn, false)) as distinto,
                   format('la tarifa trae %s y lo que compras (%s) trae %s',
                          coalesce(presupuesto_envase_txt(y.tv, y.tu, y.tm), 'otro envase'), c.ultimo_nombre,
                          coalesce(presupuesto_envase_txt(y.hv, y.hu, y.hm), 'otro envase')) as det) x
      ) e on c.pid is not null and c.u_usada is not null and c.ultimo_precio > 0
  ),
  -- Descuento: porcentaje tal cual; importe → porcentaje equivalente sobre el pedido (si hay cantidades)
  -- o sobre el gasto de los últimos 12 meses de los productos comparables (una vez por producto).
  gst as (
    select sum(m) as g
      from (select max(c.p_bruto * c.consumo_12m) as m
              from cmp c
             where c.comparable and not c.envase_distinto and c.confianza = 'alta' and c.consumo_12m > 0
             group by c.pid) x
  ),
  dto as (
    select case when v_modo = 'importe' then coalesce(v_base_ped, (select g from gst)) end as base,
           case when v_modo <> 'importe' then v_pct_in
                else round(p_descuento_importe / nullif(coalesce(v_base_ped, (select g from gst)), 0) * 100, 4) end as pct
  ),
  ver as (
    select c.*,
           c.p_bruto * (1 - coalesce((select pct from dto), 0) / 100) as p_dto,
           case when c.ultimo_precio > 0 then (c.p_bruto * (1 - coalesce((select pct from dto), 0) / 100) - c.ultimo_precio) end as dif_eur,
           case when c.ultimo_precio > 0
                then (c.p_bruto * (1 - coalesce((select pct from dto), 0) / 100) - c.ultimo_precio) / c.ultimo_precio * 100 end as dif_pct,
           (v_prov_n is not null and c.ultimo_proveedor is not null
             and (lower(c.ultimo_proveedor) like '%' || v_prov_n || '%' or v_prov_n like '%' || lower(c.ultimo_proveedor) || '%')) as mismo_prov
      from cmp c
  ),
  fin as (
    select v.*,
           case
             when not v.comparable then 'Revisar'
             when v.compras_12m = 0 then 'Revisar'
             when v.envase_distinto then 'Revisar'
             when v.confianza is distinct from 'alta' then 'Revisar'
             when abs(v.dif_pct) > 60 then 'Revisar'
             when v.media_12m > 0 and (v.ultimo_precio / v.media_12m > 1.6 or v.ultimo_precio / v.media_12m < 0.625) then 'Revisar'
             when v.mismo_prov and v.dif_pct <= -2 then 'Interesa'
             when v.dif_pct <= -2 and (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'Interesa'
             when v.dif_pct <= -2 then 'Revisar'
             when v.dif_pct >= 2 then 'No interesa'
             else 'Revisar' end as veredicto,
           case
             when v.confianza = 'formato_distinto' then 'formato_distinto'
             when not v.comparable and v.u_usada is null and v.unidades_historial is not null then 'unidades_distintas'
             when not v.comparable then 'sin_historial'
             when v.compras_12m = 0 then 'sin_compras_12m'
             when v.envase_distinto then 'envase_distinto'
             when v.confianza is distinct from 'alta' then 'coincidencia_dudosa'
             when abs(v.dif_pct) > 60 then 'diferencia_sospechosa'
             when v.media_12m > 0 and (v.ultimo_precio / v.media_12m > 1.6 or v.ultimo_precio / v.media_12m < 0.625) then 'referencia_dudosa'
             when v.dif_pct <= -2 and not (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'hay_mejor_proveedor'
             when v.dif_pct > -2 and v.dif_pct < 2 then 'precio_similar'
           end as motivo,
           case when v.comparable and not v.envase_distinto and v.consumo_12m > 0 then round((v.ultimo_precio - v.p_dto) * v.consumo_12m, 2) end as ahorro
      from ver v
     where v.pid is not null
  ),
  rk as (
    select f.*,
           row_number() over (partition by f.pid
                              order by (f.veredicto = 'Interesa') desc, f.ahorro desc nulls last, f.p_dto, f.ord) as rango
      from fin f
  )
  select
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'producto', f.producto,
        'coincide_con', f.catalogo,
        'coincidencia', f.metodo,
        'confianza', f.confianza,
        'unidad', f.u_usada,
        'unidades_en_historial', case when not f.comparable then to_jsonb(f.unidades_historial) end,
        'oferta_sin_descuento', case when f.comparable then round(f.p_bruto, case when abs(f.p_bruto) < 1 then 4 else 2 end) end,
        'oferta', case when f.comparable then round(f.p_dto, case when abs(f.p_dto) < 1 then 4 else 2 end) end,
        'ultimo', case when f.ultimo_precio is not null and f.comparable then jsonb_strip_nulls(jsonb_build_object(
            'precio', round(f.ultimo_precio, case when abs(f.ultimo_precio) < 1 then 4 else 2 end),
            'fecha', f.ultimo_fecha, 'proveedor', f.ultimo_proveedor, 'numero', f.ultimo_numero)) end,
        'media_12m', case when f.comparable and f.media_12m is not null then jsonb_build_object(
            'precio', round(f.media_12m, case when abs(f.media_12m) < 1 then 4 else 2 end), 'compras', f.compras_12m) end,
        'mejor_actual', case when f.comparable and f.mejor_precio is not null then jsonb_build_object(
            'precio', round(f.mejor_precio, case when abs(f.mejor_precio) < 1 then 4 else 2 end),
            'proveedor', f.mejor_proveedor, 'fecha', f.mejor_fecha) end,
        'dif_eur', case when f.comparable then round(f.dif_eur, 4) end,
        'dif_pct', case when f.comparable then round(f.dif_pct, 1) end,
        'dif_media_pct', case when f.comparable and f.media_12m > 0 then round((f.p_dto - f.media_12m) / f.media_12m * 100, 1) end,
        'dif_mejor_pct', case when f.comparable and f.mejor_precio > 0 then round((f.p_dto - f.mejor_precio) / f.mejor_precio * 100, 1) end,
        'consumo_12m', case when f.comparable then round(f.consumo_12m, 2) end,
        'ahorro_anual', f.ahorro,
        'veredicto', f.veredicto,
        'motivo', f.motivo,
        'nota', case when f.motivo = 'envase_distinto' then f.det_envase else f.nota end,
        'ya_se_lo_compras', case when f.mismo_prov then true end,
        'otra_referencia', case when f.rango > 1 then true end
      )) order by f.prio, f.ahorro desc nulls last, f.ord), '[]'::jsonb)
       from (select rk.*, case rk.veredicto when 'Interesa' then 1 when 'No interesa' then 2 else 3 end as prio
               from rk) f),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'producto', s.producto,
        'unidad', s.u_raw,
        'precio_con_descuento', round(s.precio * (1 - coalesce((select pct from dto), 0) / 100), case when abs(s.precio) < 1 then 4 else 2 end)
      ) order by s.ord), '[]'::jsonb) from (select * from ofe where pid is null order by ord limit 25) s),
    (select jsonb_build_object(
        'lineas_total', (select count(*) from src) + coalesce(v_row.lineas_sin_compra, 0),
        'lineas_que_compras', (select count(*) from fin),
        'comparables', (select count(*) from fin where comparable),
        'interesa', (select count(*) from fin where veredicto = 'Interesa'),
        'no_interesa', (select count(*) from fin where veredicto = 'No interesa'),
        'revisar', (select count(*) from fin where veredicto = 'Revisar'),
        'revisar_envase', (select count(*) from fin where motivo = 'envase_distinto'),
        'no_los_compras', (select count(*) from src where pid is null) + coalesce(v_row.lineas_sin_compra, 0),
        'productos_interesa', (select count(distinct pid) from fin where veredicto = 'Interesa'),
        'ahorro_anual_interesa', (select coalesce(round(sum(m), 2), 0)
                                    from (select max(ahorro) m from fin where veredicto = 'Interesa' group by pid) x),
        'ahorro_anual_neto', (select coalesce(round(sum(m), 2), 0)
                                from (select max(ahorro) m from fin where comparable group by pid) x),
        'truncado', false
      )),
    (select pct from dto), (select base from dto)
   into v_lineas, v_no, v_res, v_pct, v_base;

  if v_modo = 'importe' then
    if v_base is null or v_base <= 0 or p_descuento_importe >= v_base then
      return jsonb_build_object('error', 'Parametro descuento: el importe debe ser menor que '
        || case when v_base_ped is not null then 'el total del pedido' else 'el gasto de los ultimos 12 meses de los productos que se comparan' end
        || ' (' || coalesce(round(v_base, 2)::text, '?') || ' EUR sin IVA). Dime mejor el descuento como porcentaje.');
    end if;
    v_desc := jsonb_build_object('tipo', 'importe', 'importe', p_descuento_importe,
      'base', case when v_base_ped is not null then 'total_pedido' else 'gasto_anual_estimado' end,
      'total_base', round(v_base, 2), 'pct_equivalente', round(v_pct, 2),
      'aviso', case when v_base_ped is null
                    then 'El importe fijo se ha repartido en proporcion al gasto de los ultimos 12 meses de los productos que se comparan: equivale a ese porcentaje sobre todos los precios. Si es un descuento sobre el total de un pedido concreto, el ahorro real depende de ese pedido.' end);
    -- Con el porcentaje equivalente ya calculado (v_pct) las ofertas de arriba son las del importe.
  elsif v_modo = 'porcentaje' then
    v_desc := jsonb_build_object('tipo', 'porcentaje', 'pct', v_pct_in);
  else
    v_desc := jsonb_build_object('tipo', 'ninguno', 'pct', 0);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'proveedor', v_prov,
    'archivo', v_row.nombre_archivo,
    'fecha_presupuesto', v_row.fecha_documento,
    'hoy', v_hoy,
    'descuento', v_desc,
    'precios', 'sin IVA, en la unidad indicada en cada linea',
    'lineas', v_lineas,
    'no_los_compras', v_no,
    'resumen', v_res,
    'como_leer', 'Todas las lineas, ordenadas: Interesa, No interesa y Revisar (por ahorro). Las cifras ya vienen calculadas. '
      || 'otra_referencia = el mismo producto sale en otra linea mejor: su ahorro no se suma. resumen.ahorro_anual_interesa cuenta cada producto una vez '
      || '(consumo de los ultimos 12 meses). motivo referencia_dudosa = el ultimo precio pagado se aleja mas de un 60 % de la media de 12 meses (dato del historial a revisar). '
      || 'motivo envase_distinto = la tarifa y la ultima compra son de otro envase (lata frente a vidrio, otro tamano): no se compara.'
  ));
end;
$function$;

commit;
