set client_encoding = 'UTF8';
-- ===========================================================================
-- chat-facturas · presupuestos: tabla completa y ahorro sin duplicar (16/11/2026)
-- ---------------------------------------------------------------------------
-- Auditoría de la tarifa real del dueño (2.669 artículos, 15 % de descuento):
--   - el resultado se cortaba en 40 líneas y luego en 14.000 caracteres, y el
--     modelo de chat solo enseñaba 4 ofertas («el resultado es un extracto»).
--     Ahora devuelve TODAS las líneas; la tabla la monta la Edge Function
--     (tabla.ts) y al modelo solo le llega el resumen;
--   - la tarifa trae el mismo producto en varias referencias (C6, C12, N/REF,
--     ROSCA): cada una sumaba el consumo de 12 meses y el ahorro salía
--     multiplicado (Beefeater 70 cl, 5 veces). Ahora el ahorro se cuenta una
--     vez por producto (la mejor línea) y las demás llevan otra_referencia;
--   - si el último precio pagado se aleja más de un 60 % de la media de 12
--     meses (caja guardada como unidad en el historial), la línea va a
--     «Revisar» con motivo referencia_dudosa en vez de prometer un ahorro.
--   - referencias_precio_agente: «botella», «lata», «bote»… cuentan como «ud»
--     y cada línea se pasa a kg/l por su cuenta. Antes, con la tarifa real,
--     el Johnnie Walker de Gambín (en «botella», sin contenido en algunas
--     líneas) no contaba y el último precio era una factura de Campoluz de
--     hacía un año: −40 % en vez de −15 %;
--   - los paquetes (P6, 24U…) se comparan por envase cuando el historial va
--     por unidades (línea `envases` que guarda la Edge Function).
-- Las firmas no cambian.
--
-- Vuelta atrás: supabase/rollbacks/20261206130000_presupuestos_tabla_completa_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create or replace function public.referencias_precio_agente(
  p_producto_id bigint, p_unidad1 text, p_unidad2 text, p_hoy date default null)
 returns table(
   unidad text, unidades_historial text[],
   ultimo_precio numeric, ultimo_fecha date, ultimo_proveedor text, ultimo_numero text,
   media_12m numeric, compras_12m integer, consumo_12m numeric,
   mejor_precio numeric, mejor_proveedor text, mejor_fecha date)
 language sql
 stable
 set search_path to 'public'
as $f$
  -- 20261206130000: «botella», «lata», «bote», «frasco»… son la misma unidad
  -- que «ud» (antes el Johnnie Walker de Gambín, en «botella», no contaba y el
  -- último precio salía de otra factura de hacía un año) y cada línea se pasa
  -- a kg/l por su cuenta (antes, si UNA línea no tenía contenido, ninguna).
  with hoy as (select coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date) as d),
  raw as (
    select r.id, r.factura_id, r.fecha, r.proveedor, r.prov_n, r.numero, r.precio, r.cantidad,
           case when unidad_agente(r.unidad) in ('ud', 'botella', 'botellas', 'botellin', 'botellín', 'lata', 'latas',
                                                  'bote', 'botes', 'frasco', 'tarro', 'brik', 'pieza', 'garrafa', 'envase')
                then 'ud' else unidad_agente(r.unidad) end as u_env,
           bl.unidad_base, bl.factor
      from lineas_precio_agente(p_producto_id, null, false) r
      join productos_factura pf on pf.id = r.id
      left join productos_catalogo pc on pc.id = pf.producto_id
     cross join lateral base_linea_agente(pf.unidad, coalesce(pf.contenido_cantidad, pc.contenido_cantidad),
                                          case when pf.contenido_cantidad is not null then pf.contenido_unidad
                                               else pc.contenido_unidad end) bl
  ),
  rl as (
    select id, factura_id, fecha, proveedor, prov_n, numero, unidad_base as u,
           round(precio / factor, 4) as precio, cantidad * factor as cantidad
      from raw where unidad_base is not null and factor > 0
    union all
    select id, factura_id, fecha, proveedor, prov_n, numero, u_env as u, precio, cantidad
      from raw where u_env is distinct from unidad_base
  ),
  -- De las dos unidades pedidas, la que tenga la compra más reciente (empate: la primera).
  u as (
    select x.u from (values (1, p_unidad1), (2, p_unidad2)) x(prio, u)
      join lateral (select max(rl.fecha) as f from rl where rl.u = x.u) m on m.f is not null
     order by m.f desc, x.prio limit 1
  ),
  l as (select rl.* from rl join u on u.u = rl.u),
  ult as (select * from l order by fecha desc, factura_id desc, id desc limit 1),
  d12 as (select l.* from l, hoy where l.fecha >= hoy.d - 365 and l.fecha <= hoy.d),
  prov as (select distinct on (prov_n) * from d12 order by prov_n, fecha desc, factura_id desc, id desc),
  mej as (select * from prov order by precio asc, fecha desc limit 1)
  select (select u from u),
         (select array_agg(distinct rl.u order by rl.u) from rl),
         (select precio from ult), (select fecha from ult), (select proveedor from ult), (select numero from ult),
         (select coalesce(sum(precio * cantidad) filter (where cantidad > 0)
                          / nullif(sum(cantidad) filter (where cantidad > 0), 0), avg(precio)) from d12),
         (select count(distinct factura_id)::integer from d12),
         (select sum(cantidad) filter (where cantidad > 0) from d12),
         (select precio from mej), (select proveedor from mej), (select fecha from mej)
$f$;

create or replace function public.comparar_presupuesto_agente(
  p_presupuesto_id uuid, p_descuento_pct numeric, p_descuento_importe numeric, p_proveedor text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $f$
declare
  v_row      chat_presupuestos%rowtype;
  v_hoy      date := (now() at time zone 'Europe/Madrid')::date;
  v_total    numeric;
  v_pct      numeric := 0;
  v_desc     jsonb;
  v_sin_cant boolean;
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

  select sum((o.l->>'precio')::numeric * coalesce(nullif(o.l->>'cantidad', '')::numeric, 1)),
         bool_or(nullif(o.l->>'cantidad', '') is null)
    into v_total, v_sin_cant
    from jsonb_array_elements(v_row.lineas) o(l);

  if p_descuento_pct is not null then
    if p_descuento_pct < 0 or p_descuento_pct >= 100 then
      return jsonb_build_object('error', 'Parametro descuento: el porcentaje debe estar entre 0 y 100.');
    end if;
    v_pct := p_descuento_pct;
    v_desc := jsonb_build_object('tipo', 'porcentaje', 'pct', v_pct);
  elsif p_descuento_importe is not null then
    if p_descuento_importe < 0 or v_total is null or v_total <= 0 or p_descuento_importe >= v_total then
      return jsonb_build_object('error', 'Parametro descuento: el importe debe ser positivo y menor que el total del presupuesto ('
        || coalesce(round(v_total, 2)::text, '?') || ' EUR sin IVA).');
    end if;
    v_pct := round(p_descuento_importe / v_total * 100, 4);
    v_desc := jsonb_strip_nulls(jsonb_build_object(
      'tipo', 'importe', 'importe', p_descuento_importe, 'total_presupuesto', round(v_total, 2), 'pct_equivalente', round(v_pct, 2),
      'aviso', case when v_sin_cant then 'El presupuesto no trae todas las cantidades: el total cuenta 1 unidad en esas lineas' end));
  else
    v_desc := jsonb_build_object('tipo', 'ninguno', 'pct', 0);
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
  -- Las referencias, UNA vez por (producto, unidad): una tarifa grande trae
  -- varios formatos del mismo producto.
  claves as (select distinct pid, unidad_base, u_raw from ofe where pid is not null),
  refs as (
    select k.pid as k_pid, k.unidad_base as k_ub, k.u_raw as k_ur, r.*
      from claves k
     cross join lateral referencias_precio_agente(k.pid, k.unidad_base, k.u_raw, v_hoy) r
  ),
  cmp as (
    select o.*, r.unidad as u_usada, r.unidades_historial, r.ultimo_precio, r.ultimo_fecha, r.ultimo_proveedor,
           r.ultimo_numero, r.media_12m, r.compras_12m, r.consumo_12m, r.mejor_precio, r.mejor_proveedor, r.mejor_fecha,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio * (1 - v_pct / 100) / o.factor
                when r.unidad = 'ud' and o.u_raw = 'ud' then o.precio * (1 - v_pct / 100) / o.envases
                else o.precio * (1 - v_pct / 100) end as p_dto,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio / o.factor
                when r.unidad = 'ud' and o.u_raw = 'ud' then o.precio / o.envases
                else o.precio end as p_bruto
      from ofe o
      left join refs r on o.pid is not null and r.k_pid = o.pid
                      and r.k_ub is not distinct from o.unidad_base and r.k_ur is not distinct from o.u_raw
  ),
  ver as (
    select c.*,
           (c.pid is not null and c.u_usada is not null and c.ultimo_precio > 0
            and c.confianza is distinct from 'formato_distinto') as comparable,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) end as dif_eur,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) / c.ultimo_precio * 100 end as dif_pct,
           (v_prov_n is not null and c.ultimo_proveedor is not null
             and (lower(c.ultimo_proveedor) like '%' || v_prov_n || '%' or v_prov_n like '%' || lower(c.ultimo_proveedor) || '%')) as mismo_prov
      from cmp c
  ),
  fin as (
    select v.*,
           case
             when not v.comparable then 'Revisar'
             when v.compras_12m = 0 then 'Revisar'
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
             when v.confianza is distinct from 'alta' then 'coincidencia_dudosa'
             when abs(v.dif_pct) > 60 then 'diferencia_sospechosa'
             when v.media_12m > 0 and (v.ultimo_precio / v.media_12m > 1.6 or v.ultimo_precio / v.media_12m < 0.625) then 'referencia_dudosa'
             when v.dif_pct <= -2 and not (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'hay_mejor_proveedor'
             when v.dif_pct > -2 and v.dif_pct < 2 then 'precio_similar'
           end as motivo,
           case when v.comparable and v.consumo_12m > 0 then round((v.ultimo_precio - v.p_dto) * v.consumo_12m, 2) end as ahorro
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
        'nota', f.nota,
        'ya_se_lo_compras', case when f.mismo_prov then true end,
        'otra_referencia', case when f.rango > 1 then true end
      )) order by f.prio, f.ahorro desc nulls last, f.ord), '[]'::jsonb)
       from (select rk.*, case rk.veredicto when 'Interesa' then 1 when 'No interesa' then 2 else 3 end as prio
               from rk) f),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'producto', s.producto,
        'unidad', s.u_raw,
        'precio_con_descuento', round(s.precio * (1 - v_pct / 100), case when abs(s.precio) < 1 then 4 else 2 end)
      ) order by s.ord), '[]'::jsonb) from (select * from ofe where pid is null order by ord limit 25) s),
    (select jsonb_build_object(
        'lineas_total', (select count(*) from src) + coalesce(v_row.lineas_sin_compra, 0),
        'lineas_que_compras', (select count(*) from fin),
        'comparables', (select count(*) from fin where comparable),
        'interesa', (select count(*) from fin where veredicto = 'Interesa'),
        'no_interesa', (select count(*) from fin where veredicto = 'No interesa'),
        'revisar', (select count(*) from fin where veredicto = 'Revisar'),
        'no_los_compras', (select count(*) from src where pid is null) + coalesce(v_row.lineas_sin_compra, 0),
        'productos_interesa', (select count(distinct pid) from fin where veredicto = 'Interesa'),
        'ahorro_anual_interesa', (select coalesce(round(sum(m), 2), 0)
                                    from (select max(ahorro) m from fin where veredicto = 'Interesa' group by pid) x),
        'ahorro_anual_neto', (select coalesce(round(sum(m), 2), 0)
                                from (select max(ahorro) m from fin where comparable group by pid) x),
        'truncado', false
      ))
   into v_lineas, v_no, v_res;

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
      || '(consumo de los ultimos 12 meses). motivo referencia_dudosa = el ultimo precio pagado se aleja mas de un 60 % de la media de 12 meses (dato del historial a revisar).'
  ));
end;
$f$;

revoke all on function public.referencias_precio_agente(bigint, text, text, date) from public, anon, authenticated;
grant execute on function public.referencias_precio_agente(bigint, text, text, date) to service_role;
revoke all on function public.comparar_presupuesto_agente(uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.comparar_presupuesto_agente(uuid, numeric, numeric, text) to service_role;

commit;
