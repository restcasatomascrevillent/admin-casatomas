set client_encoding = 'UTF8';
-- ===========================================================================
-- chatbot_gasto_como_el_panel · 20261106140000 · 2026-11-06
-- ===========================================================================
--
-- Fallo 4 de QA: el chatbot de Facturas no daba las cifras del panel.
--
--   · resumen_periodo_agente y estadisticas_globales_agente: el gasto mensual
--     solo sumaba facturas (octubre 2026: 19.322,06 € frente a 30.225,87 € del
--     panel) y los albaranes se contaban todos, también los ya facturados.
--     Ahora, con la regla del panel: gasto_total y meses.gasto = facturas +
--     albaranes SIN factura; el albarán ya facturado no suma (sale aparte en
--     albaranes.ya_facturados). facturas.gasto sigue siendo solo lo facturado.
--     Los proveedores y los productos tampoco cuentan los albaranes ya facturados.
--   · filtrar_documentos_agente: decía (en su COMMENT y en el error) que no hay
--     relación albarán-factura; la hay (facturado_en_id). Nuevos filtros
--     sin_factura y facturados, y sumas.gasto_total.
--   · consulta_flexible_agente: fuera los albaranes ya facturados.
--   · ficha_proveedor_agente, compras_producto_agente, gasto_categorias_agente:
--     importe de línea = solo pf.total (una línea sin importe leído no suma),
--     como Productos y Análisis (20261106120000).
--   · variacion_precios_agente: sin_clasificar sin albaranes ya facturados.
--   · ranking_agente, historial_precios_agente, serie_precios_agente,
--     lineas_precio_agente, ficha_proveedor_agente: ya excluían el albarán
--     facturado; no cambian.
--
-- «Albarán ya facturado» en el chatbot = albaranes_facturados_agente()
-- (facturado_en_id, o factura del mismo proveedor que cita su número; nunca si
-- el albarán es posterior). En la demo (2026-11-06) da exactamente los mismos
-- 2 albaranes que facturado_en_id, así que el chatbot y el panel cuadran al
-- céntimo (lo comprueba el test).
--
-- Firmas, SECURITY INVOKER, search_path y permisos no cambian.
-- Idempotente. Test: supabase/tests/chatbot_gasto_como_el_panel_test.sql
-- Rollback: supabase/rollbacks/20261106140000_chatbot_gasto_como_el_panel_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resumen_periodo_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: el gasto es el del panel (Facturas › Análisis):
-- facturas + albaranes SIN factura; el albarán ya facturado (albaranes_facturados_agente:
-- facturado_en_id o cita de su número) no suma, está dentro de su factura.
declare
  v_desde date := p_desde;
  v_hasta date := p_hasta;
  v_docs  int;
  v_prov  int;
  v_fact  bigint[];
  v_productos       jsonb;
  v_productos_total int;
begin
  if v_desde is null or v_hasta is null then
    return json_build_object(
      'error',
      'resumen_periodo_agente necesita las dos fechas (desde y hasta) en formato AAAA-MM-DD. '
      || 'No se asume ningun periodo por defecto. Vuelve a llamarla con el primer y el ultimo dia '
      || 'del periodo, o usa estadisticas_globales si la pregunta no tiene periodo.',
      'periodo_solicitado', json_build_object('desde', p_desde, 'hasta', p_hasta));
  end if;

  if v_desde > v_hasta then
    return json_build_object(
      'error', 'El rango es invalido: "desde" (' || v_desde || ') es posterior a "hasta" (' || v_hasta || ').',
      'periodo_solicitado', json_build_object('desde', p_desde, 'hasta', p_hasta));
  end if;

  v_fact := array(select albaran_id from albaranes_facturados_agente());

  select count(*), count(distinct proveedor_normalizado) into v_docs, v_prov
    from facturas where fecha between v_desde and v_hasta;

  -- Productos de mayor importe de línea (SIN IVA), sin servicios ni líneas de
  -- albaranes ya facturados. Una sola pasada para la lista y el total.
  with q as (
    select max(pf.nombre)                              as producto,
           f.tipo,
           count(*)                                    as veces,
           round(sum(pf.cantidad)::numeric, 2)         as cantidad,
           max(pf.unidad)                              as unidad,
           round(sum(pf.total)::numeric, 2)            as importe
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where f.fecha between v_desde and v_hasta
       and not (f.tipo = 'albaran' and f.id = any(v_fact))
       and not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
     group by coalesce(pf.nombre_normalizado, lower(pf.nombre)), f.tipo
  )
  select (select jsonb_agg(to_jsonb(x) order by x.importe desc nulls last, x.producto)
            from (select * from q order by importe desc nulls last, producto limit 8) x),
         (select count(*) from q)
    into v_productos, v_productos_total;

  return jsonb_strip_nulls(jsonb_build_object(
    'periodo', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'sin_datos', case when v_docs = 0 then true end,
    'aviso', case when v_docs = 0 then
      'No hay documentos cargados entre ' || v_desde || ' y ' || v_hasta
      || ': 0 significa "sin datos", nunca "no se gasto nada".' end,
    'criterio', 'gasto_total (con IVA) = facturas + albaranes sin factura, la cifra del panel; el albaran ya facturado '
                || 'no suma (esta dentro de su factura). facturas.gasto = solo lo facturado.',
    -- La cifra de gasto del periodo (la misma que Facturas › Análisis).
    'gasto_total', (select jsonb_build_object(
                     'importe',                  round(coalesce(sum(total), 0)::numeric, 2),
                     'en_facturas',              round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2),
                     'en_albaranes_sin_factura', round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2),
                     'documentos',               count(*))
                     from facturas
                    where fecha between v_desde and v_hasta
                      and not (tipo = 'albaran' and id = any(v_fact))),
    'facturas', (select jsonb_build_object(
                   'n',     count(*),
                   'gasto', round(coalesce(sum(total), 0)::numeric, 2),
                   'base',  round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',   round(coalesce(sum(iva), 0)::numeric, 2),
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('factura', v_desde, v_hasta),
                                        'deducidos', docs_deducidos_agente('factura', v_desde, v_hasta),
                                        'sin_iva',   docs_sin_iva_agente('factura', v_desde, v_hasta))), '{}'::jsonb))
                   from facturas where tipo = 'factura' and fecha between v_desde and v_hasta),
    -- Albaranes que SUMAN (sin factura); los ya facturados, aparte y sin sumar.
    'albaranes', (select jsonb_build_object(
                   'n',     count(*) filter (where not id = any(v_fact)),
                   'valor', round(coalesce(sum(total) filter (where not id = any(v_fact)), 0)::numeric, 2),
                   'ya_facturados', case when count(*) filter (where id = any(v_fact)) > 0 then jsonb_build_object(
                                      'n',     count(*) filter (where id = any(v_fact)),
                                      'valor', round(coalesce(sum(total) filter (where id = any(v_fact)), 0)::numeric, 2),
                                      'nota',  'ya estan dentro de su factura: no sumar') end,
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('albaran', v_desde, v_hasta),
                                        'deducidos', docs_deducidos_agente('albaran', v_desde, v_hasta))), '{}'::jsonb))
                   from facturas where tipo = 'albaran' and fecha between v_desde and v_hasta),
    'con_alertas', (select jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor,
                                                        'alertas', alertas_resumen_agente(f.alertas_validacion))
                                     order by f.fecha, f.id)
                      from facturas f
                     where f.fecha between v_desde and v_hasta
                       and alertas_resumen_agente(f.alertas_validacion) is not null),
    -- Solo si el rango abarca más de un mes. gasto = facturas + albaranes sin factura.
    'meses', case when to_char(v_desde, 'YYYY-MM') <> to_char(v_hasta, 'YYYY-MM') then
               (select jsonb_agg(to_jsonb(m) order by m.mes)
                  from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                               count(*) filter (where tipo = 'factura')                                    as facturas,
                               round(coalesce(sum(total), 0)::numeric, 2)                                  as gasto,
                               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as en_facturas,
                               nullif(round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2), 0) as en_albaranes_sin_factura,
                               nullif(count(*) filter (where total is null), 0)                            as sin_total,
                               nullif(count(*) filter (where total_origen = 'deducido'), 0)                as deducidos,
                               nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes
                          from facturas
                         where fecha between v_desde and v_hasta
                           and not (tipo = 'albaran' and id = any(v_fact))
                         group by 1) m)
             end,
    -- gasto = facturas + albaranes sin factura del proveedor.
    'proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                      from (select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
                                   nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                   round(sum(total)::numeric, 2)                                                as gasto,
                                   nullif(count(*) filter (where total is null), 0)                             as sin_total,
                                   nullif(count(*) filter (where total_origen = 'deducido'), 0)                 as deducidos,
                                   nullif(count(*) filter (where tipo = 'albaran'), 0)                          as albaranes,
                                   round((sum(total) filter (where tipo = 'albaran'))::numeric, 2)              as valor_albaranes
                              from facturas
                             where fecha between v_desde and v_hasta
                               and not (tipo = 'albaran' and id = any(v_fact))
                             group by proveedor_normalizado
                             order by 3 desc nulls last, 2 desc nulls last, 1
                             limit 10) x),
    'total_proveedores', v_prov,
    'proveedores_truncado', case when v_prov > 10 then true end,
    'productos', v_productos,
    'productos_total', v_productos_total
  ))::json;
end;
$function$;
revoke all on function public.resumen_periodo_agente(date, date) from public, anon;
grant execute on function public.resumen_periodo_agente(date, date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.estadisticas_globales_agente()
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: el gasto es el del panel (Facturas › Análisis):
-- facturas + albaranes SIN factura; el albarán ya facturado (albaranes_facturados_agente:
-- facturado_en_id o cita de su número) no suma, está dentro de su factura.
declare
  v_docs  int := (select count(*) from facturas);
  v_prov  int := (select count(distinct proveedor_normalizado) from facturas);
  v_meses int := (select count(distinct to_char(fecha, 'YYYY-MM')) from facturas);
  v_fact  bigint[] := array(select albaran_id from albaranes_facturados_agente());
begin
  if v_docs = 0 then
    return json_build_object(
      'sin_datos', true,
      'aviso', 'No hay ningun documento cargado: 0 significa "sin datos", nunca "no se gasto nada".');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'criterio', 'gasto_total y meses.gasto (con IVA) = facturas + albaranes sin factura, la cifra del panel; el albaran '
                || 'ya facturado no suma (esta dentro de su factura). facturas.gasto = solo lo facturado.',
    'gasto_total', (select jsonb_build_object(
                     'importe',                  round(coalesce(sum(total), 0)::numeric, 2),
                     'en_facturas',              round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2),
                     'en_albaranes_sin_factura', round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2),
                     'documentos',               count(*))
                     from facturas
                    where not (tipo = 'albaran' and id = any(v_fact))),
    -- Los avisos de importe van aparte del conteo (si_das_importes): en una
    -- pregunta de «cuántas» el modelo los colaba en la respuesta.
    'facturas', (select jsonb_build_object(
                   'n',     count(*),
                   'gasto', round(coalesce(sum(total), 0)::numeric, 2),
                   'base',  round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',   round(coalesce(sum(iva), 0)::numeric, 2),
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('factura', null, null),
                                        'deducidos', docs_deducidos_agente('factura', null, null),
                                        'sin_iva',   docs_sin_iva_agente('factura', null, null))), '{}'::jsonb))
                   from facturas where tipo = 'factura'),
    -- Albaranes que SUMAN (sin factura); los ya facturados, aparte y sin sumar.
    'albaranes', (select jsonb_build_object(
                   'n',     count(*) filter (where not id = any(v_fact)),
                   'valor', round(coalesce(sum(total) filter (where not id = any(v_fact)), 0)::numeric, 2),
                   'ya_facturados', case when count(*) filter (where id = any(v_fact)) > 0 then jsonb_build_object(
                                      'n',     count(*) filter (where id = any(v_fact)),
                                      'valor', round(coalesce(sum(total) filter (where id = any(v_fact)), 0)::numeric, 2),
                                      'nota',  'ya estan dentro de su factura: no sumar') end,
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('albaran', null, null),
                                        'deducidos', docs_deducidos_agente('albaran', null, null))), '{}'::jsonb))
                   from facturas where tipo = 'albaran'),
    'primera_fecha', (select min(fecha) from facturas),
    'ultima_fecha',  (select max(fecha) from facturas),
    'sin_verificar', (select count(*) from facturas where not coalesce(verificada, false)),
    'con_alertas', (select jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor,
                                                        'alertas', alertas_resumen_agente(f.alertas_validacion))
                                     order by f.fecha, f.id)
                      from facturas f where alertas_resumen_agente(f.alertas_validacion) is not null),
    -- Todos los meses CON documentos (nunca meses vacíos), con año, del más
    -- antiguo al más reciente. gasto = facturas + albaranes sin factura (el panel).
    'meses', (select jsonb_agg(to_jsonb(m) order by m.mes)
                from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                             count(*) filter (where tipo = 'factura')                                    as facturas,
                             round(coalesce(sum(total), 0)::numeric, 2)                                  as gasto,
                             round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as en_facturas,
                             nullif(round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2), 0) as en_albaranes_sin_factura,
                             nullif(count(*) filter (where total is null), 0)                            as sin_total,
                             nullif(count(*) filter (where total_origen = 'deducido'), 0)                as deducidos,
                             nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes,
                             nullif(count(*) filter (where fecha_dudosa_agente(alertas_validacion)), 0)  as fecha_dudosa
                        from facturas
                       where not (tipo = 'albaran' and id = any(v_fact))
                       group by 1
                       order by 1 desc
                       limit 24) m),
    'meses_truncado', case when v_meses > 24 then true end,
    -- gasto = facturas + albaranes sin factura del proveedor.
    'top_proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                          from (select coalesce(max((select pv.nombre from proveedores pv where pv.id = facturas.proveedor_id)),
                                                max(proveedor), proveedor_normalizado)                      as proveedor,
                                       nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                       round(sum(total)::numeric, 2)                                                as gasto,
                                       nullif(count(*) filter (where total is null), 0)                             as sin_total,
                                       nullif(count(*) filter (where total_origen = 'deducido'), 0)                 as deducidos,
                                       nullif(count(*) filter (where tipo = 'albaran'), 0)                          as albaranes,
                                       round((sum(total) filter (where tipo = 'albaran'))::numeric, 2)              as valor_albaranes
                                  from facturas
                                 where not (tipo = 'albaran' and id = any(v_fact))
                                 group by proveedor_normalizado
                                 order by 3 desc nulls last, 2 desc nulls last, 1
                                 limit 8) x),
    'total_proveedores', v_prov,
    'top_proveedores_truncado', case when v_prov > 8 then true end,
    'ultimos', (select jsonb_agg(documento_compacto_agente(f) order by f.fecha desc, f.id desc)
                  from (select id from facturas order by fecha desc, id desc limit 3) u
                  join facturas f on f.id = u.id)
  ))::json;
end;
$function$;
revoke all on function public.estadisticas_globales_agente() from public, anon;
grant execute on function public.estadisticas_globales_agente() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.filtrar_documentos_agente(p_filtro text DEFAULT 'todos'::text, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'fecha_desc'::text, p_limite integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: filtros sin_factura y facturados (la relación albarán → factura existe); sumas.gasto_total como el panel.
declare
  c_filtros constant text[] := array['todos', 'sin_total', 'sin_verificar', 'con_alertas', 'fecha_dudosa', 'sin_factura', 'facturados'];
  c_ordenes constant text[] := array['fecha_desc', 'fecha_asc', 'total_desc', 'total_asc'];
  v_filtro text := lower(trim(coalesce(nullif(p_filtro, ''), 'todos')));
  v_orden  text := lower(trim(coalesce(nullif(p_orden, ''), 'fecha_desc')));
  v_texto  text := nullif(trim(coalesce(p_texto, '')), '');
  v_tipo   text := lower(trim(coalesce(p_tipo, '')));
  v_lim    int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_num    text;
  v_prov   text;
  v_total  int;
  v_filas  json;
  v_sumas  jsonb;
  v_sint   jsonb;
  v_ded    jsonb;
  v_cuenta boolean;
  v_fact   bigint[];
begin
  -- «Sin factura», «sin facturar», «albaranes sin factura»…: no es un filtro de
  -- esta herramienta (albaranes_sin_factura). Se dice claro en vez de dejar que
  -- el modelo lo confunda con sin_total (prueba del 05/10, q19).
  -- La relación albarán → factura SÍ está guardada (facturado_en_id, o la factura del
  -- proveedor que cita su número: albaranes_facturados_agente): «sin factura» y «ya
  -- facturados» son filtros de verdad. Lo que no existe es el estado de pago.
  if v_filtro ~ '(pagad|pago)' then
    return json_build_object(
      'error', 'No hay estado de pago: no se sabe que esta pagado. Para albaranes sin factura o ya facturados usa el filtro sin_factura o facturados (o la herramienta albaranes_sin_factura). sin_total NO significa sin factura.');
  end if;
  if v_filtro ~ '(sin|pendient|no)[ _-]*(de[ _-]*)?factur' then
    v_filtro := 'sin_factura';
  elsif v_filtro ~ '(facturad|vincul|relacion)' then
    v_filtro := 'facturados';
  end if;
  if not v_filtro = any(c_filtros) then
    return json_build_object('error', format('Filtro "%s" no valido.', p_filtro), 'permitidos', to_json(c_filtros));
  end if;
  if not v_orden = any(c_ordenes) then
    return json_build_object('error', format('Orden "%s" no valido.', p_orden), 'permitidos', to_json(c_ordenes));
  end if;
  v_tipo := case when v_tipo like 'albar%' then 'albaran'
                 when v_tipo like 'factura%' then 'factura'
                 when v_tipo in ('', 'ambos', 'todos') then null
                 else '#' end;
  if v_tipo = '#' then
    return json_build_object('error', format('Tipo "%s" no valido.', p_tipo), 'permitidos', json_build_array('factura', 'albaran', null));
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- Un filtro de estado (sin_total, sin_verificar, con_alertas, fecha_dudosa)
  -- responde a «cuántos/cuáles»: solo cuenta, sin importes ni avisos de cifra
  -- parcial (prueba del 06/10: q12 y q13 sumaban sin que se pidiera).
  v_cuenta := v_filtro not in ('todos', 'sin_factura', 'facturados');
  v_fact := array(select albaran_id from albaranes_facturados_agente());

  if v_texto is not null then
    v_num  := nullif(regexp_replace(regexp_replace(lower(v_texto), '[^a-z0-9]', '', 'g'), '^0+', ''), '');
    v_prov := nullif(normalizar_proveedor(v_texto), '');
  end if;

  with m as (
    select f.*
      from facturas f
     where (v_tipo is null or f.tipo = v_tipo)
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_texto is null
            or f.numero_documento ilike '%' || v_texto || '%'
            or (v_num is not null
                and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '')
                    like '%' || v_num || '%')
            or (v_prov is not null and coalesce(f.proveedor_normalizado, '') like '%' || v_prov || '%')
            or lower(coalesce(f.cif, '')) like '%' || lower(v_texto) || '%')
       and case v_filtro
             when 'todos'         then true
             when 'sin_total'     then f.total is null
             when 'sin_verificar' then not coalesce(f.verificada, false)
             when 'con_alertas'   then alertas_resumen_agente(f.alertas_validacion) is not null
             when 'fecha_dudosa'  then fecha_dudosa_agente(f.alertas_validacion)
             when 'sin_factura'   then f.tipo = 'albaran' and not f.id = any(v_fact)
             when 'facturados'    then f.tipo = 'albaran' and f.id = any(v_fact)
           end
  ),
  o as (
    select m.id,
           row_number() over (order by case when v_orden = 'fecha_desc' then m.fecha end desc nulls last,
                                       case when v_orden = 'fecha_asc'  then m.fecha end asc,
                                       case when v_orden = 'total_desc' then m.total end desc nulls last,
                                       case when v_orden = 'total_asc'  then m.total end asc nulls last,
                                       m.fecha desc, m.id desc) as n
      from m
  )
  select
    (select count(*) from m),
    (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
       from o join facturas f on f.id = o.id where o.n <= v_lim),
    (select jsonb_strip_nulls(jsonb_build_object(
              'facturas', case when count(*) filter (where tipo = 'factura') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'factura'),
                            'total',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) end) end,
              'albaranes', case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'albaran'),
                            'valor',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total_origen = 'deducido'), 0) end,
                            -- Los ya facturados están dentro de su factura: valor_sin_factura es lo que suma.
                            'ya_facturados', nullif(count(*) filter (where tipo = 'albaran' and id = any(v_fact)), 0),
                            'valor_sin_factura', case when not v_cuenta and count(*) filter (where tipo = 'albaran' and id = any(v_fact)) > 0
                                                      then round(coalesce(sum(total) filter (where tipo = 'albaran' and not id = any(v_fact)), 0)::numeric, 2) end) end,
              -- Gasto como el panel: facturas + albaranes sin factura.
              'gasto_total', case when not v_cuenta and count(*) > 0
                                  then round(coalesce(sum(total) filter (where not (tipo = 'albaran' and id = any(v_fact))), 0)::numeric, 2) end))
       from m),
    (select jsonb_build_object('n', count(*),
              'docs', jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero_documento,
                                                   'proveedor', proveedor, 'fecha', fecha) order by fecha, id))
       from m where total is null having count(*) > 0),
    (select jsonb_build_object('n', count(*),
              'docs', jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero_documento,
                                                   'proveedor', proveedor, 'fecha', fecha, 'iva_conocido', iva is not null)
                                order by fecha, id))
       from m where total_origen = 'deducido' and total is not null having count(*) > 0)
  into v_total, v_filas, v_sumas, v_sint, v_ded;

  return (jsonb_build_object(
            'criterio', format('filtro=%s%s%s%s%s; orden=%s', v_filtro,
                               case when v_texto is not null then '; texto=' || v_texto else '' end,
                               case when v_tipo is not null then '; tipo=' || v_tipo else '' end,
                               case when p_desde is not null then '; desde=' || p_desde else '' end,
                               case when p_hasta is not null then '; hasta=' || p_hasta else '' end,
                               v_orden)
                        || case when v_cuenta then '; solo conteo: para importes usa consulta_flexible' else '' end
                        || case when v_filtro in ('sin_factura', 'facturados')
                                then '; albaran ya facturado = facturado_en_id o factura del proveedor que cita su numero' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim,
            'sumas',       coalesce(v_sumas, '{}'::jsonb))
          || case when v_filtro = 'sin_total'
                  then jsonb_build_object('nota', 'sin_total = no se leyo el importe total del documento. NO significa sin factura ni sin pagar.')
                  else '{}'::jsonb end
          -- Las listas solo si hay documentos que NO se ven en las filas (las
          -- filas ya dicen sin_total / total_origen) y solo con importes.
          || case when v_sint is not null and not v_cuenta and v_total > v_lim
                  then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null and not v_cuenta and v_total > v_lim
                  then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
         )::json;
end;
$function$;
revoke all on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) from public, anon;
grant execute on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consulta_flexible_agente(p jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: fuera los albaranes ya facturados (como el panel).

declare
  c_claves   constant text[] := array['fuente', 'metricas', 'agrupar', 'filtros', 'orden_por', 'orden_dir', 'limite'];
  c_filtros  constant text[] := array['desde', 'hasta', 'proveedor', 'tipo', 'numero', 'producto', 'con_total',
                                      'verificada', 'con_alertas', 'excluir_servicios', 'importe_min', 'importe_max'];
  c_agrupar  constant text[] := array['proveedor', 'mes', 'anio', 'tipo', 'producto', 'unidad', 'verificada', 'alerta', 'dia_semana', 'iva_pct'];
  c_met_doc  constant text[] := array['count_documentos', 'count_con_total',
                                      'sum_total', 'avg_total', 'min_total', 'max_total',
                                      'sum_subtotal', 'avg_subtotal', 'min_subtotal', 'max_subtotal',
                                      'sum_iva', 'avg_iva', 'min_iva', 'max_iva'];
  c_met_lin  constant text[] := array['count_lineas', 'count_documentos',
                                      'sum_cantidad', 'avg_cantidad', 'min_cantidad', 'max_cantidad',
                                      'sum_precio_unitario', 'avg_precio_unitario', 'min_precio_unitario', 'max_precio_unitario',
                                      'sum_total_linea', 'avg_total_linea', 'min_total_linea', 'max_total_linea'];
  v_fuente   text;
  v_f        jsonb;
  v_lim      int := 10;
  v_dir      text;
  v_orden    text;
  v_metricas text[] := '{}';
  v_agrupar  text[] := '{}';
  v_sel      text[] := '{}';
  v_grp      text[] := '{}';
  v_where    text[] := array['true'];
  v_fact     bigint[];
  v_from     text;
  v_alerta   boolean := false;
  v_ivap     boolean := false;
  -- Tipo de IVA de la línea o, si falta, el del documento cuando es uno solo
  -- (iva/subtotal = 0, 4, 5, 10 o 21 %; con tipos mezclados queda null).
  c_tipo_iva constant text := 'coalesce(l.iva_pct, case when round(f.iva / nullif(f.subtotal, 0) * 100, 1) in (0, 4, 5, 10, 21) then round(f.iva / nullif(f.subtotal, 0) * 100, 1) end)';
  k          text;
  v_val      jsonb;
  v_expr     text;
  v_func     text;
  v_col      text;
  v_sql      text;
  v_filas    json;
  v_total    int;
  v_sint     json;
  v_lsin     int;
  v_import   boolean := false;
  v_lin_nul  text[] := '{}';
  v_ncon     text[] := '{}';
  v_fdud     json;
  v_iva      boolean := false;
  v_ded      json;
  v_siva     json;
  v_fila     text := 'to_jsonb(g)';
  f_desde date; f_hasta date; f_prov text; f_tipo text; f_num text; f_prod text;
  f_con_total boolean; f_verif boolean; f_alertas boolean; f_excl boolean; f_min numeric; f_max numeric;
begin
  -- Estructura y claves ----------------------------------------------------
  if p is null or jsonb_typeof(p) <> 'object' then
    return json_build_object('error', 'La consulta tiene que ser un objeto JSON.', 'permitidos', to_json(c_claves));
  end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any(c_claves) then
      return json_build_object('error', format('Clave "%s" no permitida.', k), 'permitidos', to_json(c_claves));
    end if;
  end loop;

  v_fuente := lower(coalesce(nullif(p ->> 'fuente', ''), 'documentos'));
  if v_fuente not in ('documentos', 'lineas') then
    return json_build_object('error', format('Fuente "%s" no permitida.', p ->> 'fuente'), 'permitidos', json_build_array('documentos', 'lineas'));
  end if;
  -- IVA por tipo: el tipo está en las líneas; la fuente es lineas aunque pidan documentos.
  if jsonb_typeof(p -> 'agrupar') = 'array' and (p -> 'agrupar') ? 'iva_pct' then
    v_ivap := true;
    v_fuente := 'lineas';
  end if;

  -- Métricas ----------------------------------------------------------------
  v_val := p -> 'metricas';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'metricas tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      continue when v_ivap and not k = any(c_met_lin);   -- base y cuota_iva van siempre
      if not k = any(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end) then
        return json_build_object('error', format('Metrica "%s" no permitida con fuente %s.', k, v_fuente),
                                 'permitidos', to_json(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end));
      end if;
      if not k = any(v_metricas) then v_metricas := v_metricas || k; end if;
    end loop;
  end if;
  if cardinality(v_metricas) = 0 then
    v_metricas := array[case when v_fuente = 'documentos' then 'count_documentos' else 'count_lineas' end];
  end if;
  if cardinality(v_metricas) > 4 then
    return json_build_object('error', 'Como maximo 4 metricas.');
  end if;

  -- Agrupaciones ------------------------------------------------------------
  v_val := p -> 'agrupar';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'agrupar tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      if not k = any(c_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" no permitida.', k), 'permitidos', to_json(c_agrupar));
      end if;
      if k in ('producto', 'unidad') and v_fuente <> 'lineas' then
        return json_build_object('error', format('Agrupar por "%s" solo con fuente lineas.', k));
      end if;
      if k = any(v_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" repetida.', k));
      end if;
      if k = any(v_metricas) then
        return json_build_object('error', 'Una agrupacion no puede llamarse igual que una metrica.');
      end if;
      v_agrupar := v_agrupar || k;
    end loop;
  end if;
  if cardinality(v_agrupar) > 3 then
    return json_build_object('error', 'Como maximo 3 agrupaciones.');
  end if;

  -- Filtros (valores tipados; solo se usan como parámetros) -----------------
  v_f := coalesce(p -> 'filtros', '{}'::jsonb);
  if jsonb_typeof(v_f) = 'null' then v_f := '{}'::jsonb; end if;
  if jsonb_typeof(v_f) <> 'object' then
    return json_build_object('error', 'filtros tiene que ser un objeto.', 'permitidos', to_json(c_filtros));
  end if;
  for k, v_val in select key, value from jsonb_each(v_f) loop
    if not k = any(c_filtros) then
      return json_build_object('error', format('Filtro "%s" no permitido.', k), 'permitidos', to_json(c_filtros));
    end if;
    continue when jsonb_typeof(v_val) = 'null';

    if k in ('desde', 'hasta') then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        return json_build_object('error', format('Filtro "%s": fecha AAAA-MM-DD.', k));
      end if;
      begin
        if k = 'desde' then f_desde := (v_val #>> '{}')::date; else f_hasta := (v_val #>> '{}')::date; end if;
      exception when others then
        return json_build_object('error', format('Filtro "%s": "%s" no es una fecha real.', k, v_val #>> '{}'));
      end;
    elsif k in ('proveedor', 'numero', 'producto', 'tipo') then
      if jsonb_typeof(v_val) <> 'string' or length(trim(v_val #>> '{}')) = 0 or length(v_val #>> '{}') > 100 then
        return json_build_object('error', format('Filtro "%s": texto de 1 a 100 caracteres.', k));
      end if;
      case k
        when 'proveedor' then f_prov := trim(v_val #>> '{}');
        when 'numero'    then f_num  := trim(v_val #>> '{}');
        when 'producto'  then f_prod := trim(v_val #>> '{}');
        else
          f_tipo := case when lower(v_val #>> '{}') like 'albar%' then 'albaran'
                         when lower(v_val #>> '{}') like 'factura%' then 'factura' end;
          if f_tipo is null then
            return json_build_object('error', 'Filtro "tipo": factura o albaran.');
          end if;
      end case;
    elsif k in ('con_total', 'verificada', 'con_alertas', 'excluir_servicios') then
      if jsonb_typeof(v_val) <> 'boolean' then
        return json_build_object('error', format('Filtro "%s": true o false.', k));
      end if;
      case k
        when 'con_total'   then f_con_total := (v_val #>> '{}')::boolean;
        when 'verificada'  then f_verif     := (v_val #>> '{}')::boolean;
        when 'con_alertas' then f_alertas   := (v_val #>> '{}')::boolean;
        else                    f_excl      := (v_val #>> '{}')::boolean;
      end case;
    else  -- importe_min / importe_max
      if jsonb_typeof(v_val) <> 'number' then
        return json_build_object('error', format('Filtro "%s": numero.', k));
      end if;
      if k = 'importe_min' then f_min := (v_val #>> '{}')::numeric; else f_max := (v_val #>> '{}')::numeric; end if;
    end if;
  end loop;

  if v_fuente = 'documentos' and (f_prod is not null or f_excl is not null) then
    return json_build_object('error', 'Los filtros producto y excluir_servicios solo valen con fuente lineas.');
  end if;
  if f_desde is not null and f_hasta is not null and f_desde > f_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', f_desde, f_hasta));
  end if;

  -- Orden y límite ----------------------------------------------------------
  v_orden := nullif(lower(trim(coalesce(p ->> 'orden_por', ''))), '');
  if v_orden is null then
    v_orden := case when v_ivap then 'base' else v_metricas[1] end;
  elsif not (v_orden = any(v_metricas) or v_orden = any(v_agrupar) or (v_ivap and v_orden in ('base', 'cuota_iva'))) then
    return json_build_object('error', format('orden_por "%s" tiene que ser una de las metricas o agrupaciones pedidas.', p ->> 'orden_por'),
                             'permitidos', to_json(v_metricas || v_agrupar));
  end if;
  v_dir := lower(coalesce(nullif(p ->> 'orden_dir', ''), 'desc'));
  if v_dir not in ('asc', 'desc') then
    return json_build_object('error', 'orden_dir: asc o desc.');
  end if;
  if p ? 'limite' and jsonb_typeof(p -> 'limite') <> 'null' then
    if jsonb_typeof(p -> 'limite') <> 'number' then
      return json_build_object('error', 'limite tiene que ser un numero.');
    end if;
    v_lim := least(greatest(floor((p ->> 'limite')::numeric)::int, 1), 50);
  end if;

  -- El albarán ya facturado no cuenta (está dentro de su factura): la misma regla
  -- que el resto del chatbot y que el panel. $13 = sus ids.
  v_fact := array(select albaran_id from albaranes_facturados_agente());
  v_where := v_where || 'not (f.tipo = ''albaran'' and f.id = any($13))'::text;

  -- Construcción (solo fragmentos constantes) -------------------------------
  v_from := case when v_fuente = 'documentos'
                 then 'facturas f'
                 else 'productos_factura l join facturas f on f.id = l.factura_id' end;
  if 'alerta' = any(v_agrupar) then
    v_alerta := true;
    v_from := v_from || ' left join lateral jsonb_array_elements(case when jsonb_typeof(f.alertas_validacion) = ''array'''
                     || ' then f.alertas_validacion else ''[]''::jsonb end) a(el) on true';
  end if;

  foreach k in array v_agrupar loop
    case k
      when 'proveedor'  then v_grp := v_grp || 'f.proveedor_normalizado'::text;
                             v_sel := v_sel || format('coalesce(max((select pv.nombre from proveedores pv where pv.id = f.proveedor_id)), max(f.proveedor), f.proveedor_normalizado) as %I', k);
      when 'mes'        then v_grp := v_grp || 'to_char(f.fecha, ''YYYY-MM'')'::text;
                             v_sel := v_sel || format('to_char(f.fecha, ''YYYY-MM'') as %I', k);
      when 'anio'       then v_grp := v_grp || 'extract(year from f.fecha)::int'::text;
                             v_sel := v_sel || format('extract(year from f.fecha)::int as %I', k);
      when 'tipo'       then v_grp := v_grp || 'f.tipo'::text;
                             v_sel := v_sel || format('f.tipo as %I', k);
      when 'producto'   then v_grp := v_grp || 'coalesce(l.nombre_normalizado, lower(l.nombre))'::text;
                             v_sel := v_sel || format('max(l.nombre) as %I', k);
      when 'unidad'     then v_grp := v_grp || 'l.unidad'::text;
                             v_sel := v_sel || format('l.unidad as %I', k);
      when 'verificada' then v_grp := v_grp || 'coalesce(f.verificada, false)'::text;
                             v_sel := v_sel || format('coalesce(f.verificada, false) as %I', k);
      when 'alerta'     then v_grp := v_grp || 'coalesce(a.el ->> ''codigo'', ''sin_alertas'')'::text;
                             v_sel := v_sel || format('coalesce(a.el ->> ''codigo'', ''sin_alertas'') as %I', k);
      when 'dia_semana' then v_grp := v_grp || '(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int]'::text;
                             v_sel := v_sel || format('(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int] as %I', k);
      when 'iva_pct'    then v_grp := v_grp || c_tipo_iva;
                             v_sel := v_sel || format('trim_scale(%s) as %I', c_tipo_iva, k);
    end case;
  end loop;

  foreach k in array v_metricas loop
    if k = 'count_documentos' then
      v_expr := 'count(distinct f.id)';
    elsif k = 'count_con_total' then
      v_expr := 'count(distinct f.id) filter (where f.total is not null)';
    elsif k = 'count_lineas' then
      v_expr := 'count(l.id)';
    else
      v_func := case split_part(k, '_', 1) when 'sum' then 'sum' when 'avg' then 'avg' when 'min' then 'min' when 'max' then 'max' end;
      v_col := case substr(k, length(split_part(k, '_', 1)) + 2)
                 when 'total'           then 'f.total'
                 when 'subtotal'        then 'f.subtotal'
                 when 'iva'             then 'f.iva'
                 when 'cantidad'        then 'l.cantidad'
                 when 'precio_unitario' then 'l.precio_unitario'
                 when 'total_linea'     then 'l.total'
               end;
      if v_func is null or v_col is null then
        return json_build_object('error', format('Metrica "%s" no permitida.', k));
      end if;
      v_expr := format('round(%s(%s)::numeric, 2)', v_func, v_col);
      if v_col like 'f.%' then v_import := true; end if;
      if v_col = 'f.iva' then v_iva := true; end if;
      if v_col like 'l.%' and not v_col = any(v_lin_nul) then v_lin_nul := v_lin_nul || v_col; end if;
      -- Toda media lleva al lado cuantas filas entran en ella (n_con_total…):
      -- el modelo dividia por su cuenta entre TODOS los documentos.
      if v_func = 'avg' and not ('n_con_' || substr(k, 5)) = any(v_ncon) then
        v_ncon := v_ncon || ('n_con_' || substr(k, 5));
        v_sel := v_sel || format('count(%s) as %I', v_col, 'n_con_' || substr(k, 5));
      end if;
    end if;
    v_sel := v_sel || format('%s as %I', v_expr, k);
  end loop;

  -- IVA por tipo: base (suma de líneas SIN IVA) y cuota (base x tipo).
  if v_ivap then
    v_sel := v_sel || 'round(sum(l.total)::numeric, 2) as base'::text
                   || format('round(sum(l.total * %s / 100)::numeric, 2) as cuota_iva', c_tipo_iva)
                   || 'nullif(count(*) filter (where l.iva_pct is null), 0) as lineas_tipo_del_documento'::text;
    if not 'l.total' = any(v_lin_nul) then v_lin_nul := v_lin_nul || 'l.total'::text; end if;
  end if;

  -- Importes de documentos: cada fila dice cuantos de sus documentos no
  -- tienen total o lo tienen deducido (solo si > 0). Prueba del 06/10, n1: la
  -- fila de Garre llegaba con sum_total null y el modelo la omitia.
  if v_fuente = 'documentos' and v_import then
    v_sel := v_sel || 'nullif(count(distinct f.id) filter (where f.total is null), 0) as sin_total'::text
                   || 'nullif(count(distinct f.id) filter (where f.total_origen = ''deducido''), 0) as deducidos'::text;
    v_fila := '(to_jsonb(g) - array_remove(array[case when g.sin_total is null then ''sin_total'' end,'
              || ' case when g.deducidos is null then ''deducidos'' end], null::text))';
  end if;

  if f_desde is not null     then v_where := v_where || 'f.fecha >= $1'::text; end if;
  if f_hasta is not null     then v_where := v_where || 'f.fecha <= $2'::text; end if;
  if f_prov is not null      then v_where := v_where ||
       '(coalesce(f.proveedor_normalizado, '''') like ''%'' || coalesce(normalizar_proveedor($3), '''') || ''%'' or f.proveedor ilike ''%'' || $3 || ''%'')'::text; end if;
  if f_tipo is not null      then v_where := v_where || 'f.tipo = $4'::text; end if;
  if f_num is not null       then v_where := v_where ||
       ('(f.numero_documento ilike ''%'' || $5 || ''%'' or (length(regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')) > 0'
        || ' and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '''')), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')'
        || ' like ''%'' || regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''') || ''%''))')::text; end if;
  if f_prod is not null      then v_where := v_where ||
       'coalesce(l.nombre_normalizado, lower(l.nombre)) like ''%'' || coalesce(normalizar_nombre_producto($6), '''') || ''%'''::text; end if;
  if f_con_total is not null then v_where := v_where || '((f.total is not null) = $7)'::text; end if;
  if f_verif is not null     then v_where := v_where || '(coalesce(f.verificada, false) = $8)'::text; end if;
  if f_alertas is not null   then v_where := v_where || '((alertas_resumen_agente(f.alertas_validacion) is not null) = $9)'::text; end if;
  if f_excl                  then v_where := v_where || 'not es_linea_servicio_agente(coalesce(l.nombre_normalizado, l.nombre))'::text; end if;
  if f_min is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total >= $11' else 'l.total >= $11' end)::text; end if;
  if f_max is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total <= $12' else 'l.total <= $12' end)::text; end if;

  v_sql := format(
    'select coalesce(json_agg(t.fila order by t.ord), ''[]''::json), coalesce(max(t.n), 0)::int'
    || ' from (select %8$s as fila, row_number() over (order by g.%1$I %2$s nulls last) as ord, count(*) over () as n'
    || ' from (select %3$s from %4$s where %5$s %6$s) g) t'
    || ' where t.ord <= %7$s',
    v_orden,
    case when v_dir = 'asc' then 'asc' else 'desc' end,
    array_to_string(v_sel, ', '),
    v_from,
    array_to_string(v_where, ' and '),
    case when cardinality(v_grp) > 0 then 'group by ' || array_to_string(v_grp, ', ') else '' end,
    v_lim,
    v_fila);

  begin
    execute v_sql into v_filas, v_total
      using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;

    -- Avisos de cifras parciales en el mismo ámbito filtrado (solo con
    -- importes: un conteo no lleva ninguno).
    if v_fuente = 'documentos' and v_import then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total is null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_sint
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;
      -- Totales deducidos (calculados desde las lineas, no leidos).
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha, ''iva_conocido'', f.iva is not null)'
        || ' order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total_origen = ''deducido'' and f.total is not null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_ded
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;
      -- Con IVA: documentos con total pero sin IVA (no entran en la suma de IVA).
      if v_iva then
        execute format(
          'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
          || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
          || ' from facturas f where %s and f.iva is null and f.total is not null having count(*) > 0',
          array_to_string(v_where, ' and '))
          into v_siva
          using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;
      end if;
    elsif v_fuente = 'lineas' and cardinality(v_lin_nul) > 0 then
      execute format(
        'select count(*)::int from productos_factura l join facturas f on f.id = l.factura_id where %s and (%s)',
        array_to_string(v_where, ' and '),
        array_to_string(array(select c || ' is null' from unnest(v_lin_nul) c), ' or '))
        into v_lsin
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;
    end if;

    -- Agrupar por fecha (mes, año, dia de la semana) con documentos cuya
    -- fecha es la de subida (alerta fecha_ausente): se dicen cuales.
    if v_agrupar && array['mes', 'anio', 'dia_semana'] then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', d.id, ''numero'', d.numero_documento,'
        || ' ''proveedor'', d.proveedor, ''fecha'', d.fecha) order by d.fecha, d.id))'
        || ' from (select distinct f.id, f.numero_documento, f.proveedor, f.fecha from %s where %s'
        || ' and fecha_dudosa_agente(f.alertas_validacion)) d having count(*) > 0',
        case when v_fuente = 'documentos' then 'facturas f' else 'productos_factura l join facturas f on f.id = l.factura_id' end,
        array_to_string(v_where, ' and '))
        into v_fdud
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max, v_fact;
    end if;
  exception
    when query_canceled then
      return json_build_object('error', 'La consulta ha tardado demasiado. Acotala (fechas, proveedor) o usa una herramienta especifica.');
    when others then
      return json_build_object('error', 'No se ha podido ejecutar la consulta: ' || sqlerrm);
  end;

  return (jsonb_build_object(
            'criterio', format('%s de %s%s; filtros %s; orden %s %s',
                               array_to_string(v_metricas, ', '), v_fuente,
                               case when cardinality(v_agrupar) > 0 then ' por ' || array_to_string(v_agrupar, ', ') else '' end,
                               jsonb_strip_nulls(v_f)::text, v_orden, v_dir)
                        || '; sin albaranes ya facturados (estan dentro de su factura)'
                        || case when v_ivap
                                then '; base = suma de lineas SIN IVA, cuota_iva = base x iva_pct; iva_pct de la linea o, si falta, el del documento con un solo tipo (lineas_tipo_del_documento); null = tipos mezclados o sin IVA'
                                when v_fuente = 'lineas' and cardinality(v_lin_nul) > 0
                                then '; precios e importes de linea SIN IVA'
                                when v_import and v_ded is not null and (v_ded::jsonb -> 'docs') @> '[{"iva_conocido": false}]'::jsonb
                                then '; total con IVA salvo documentos_deducidos sin IVA conocido, subtotal sin IVA'
                                when v_import and v_ded is not null
                                then '; total con IVA (documentos_deducidos: calculado desde las lineas, con IVA), subtotal sin IVA'
                                when v_import then '; total con IVA, subtotal sin IVA' else '' end
                        || case when v_alerta then '; un documento con varias alertas cuenta en cada una' else '' end
                        || case when cardinality(v_ncon) > 0 then '; cada media se calcula solo sobre n_con_*' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
          || case when v_siva is not null then jsonb_build_object('documentos_sin_iva', v_siva) else '{}'::jsonb end
          || case when coalesce(v_lsin, 0) > 0 then jsonb_build_object('lineas_sin_dato', v_lsin) else '{}'::jsonb end
          || case when v_fdud is not null then jsonb_build_object('fechas_dudosas', v_fdud) else '{}'::jsonb end
         )::json;
end;
$function$;
revoke all on function public.consulta_flexible_agente(jsonb) from public, anon;
grant execute on function public.consulta_flexible_agente(jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ficha_proveedor_agente(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
declare
  v_n     text := nullif(normalizar_proveedor_base(coalesce(p_texto, '')), '');
  v_id    bigint;
  v_otros jsonb;
  resultado jsonb;
begin
  if v_n is null then
    return json_build_object('error', 'Falta el nombre del proveedor.');
  end if;

  with c as (
    select p.id, p.nombre::text as nombre,
           case when p.nombre_normalizado = v_n
                  or normalizar_proveedor_base(p.nombre_comercial) = v_n
                  or exists (select 1 from proveedores_alias a where a.proveedor_id = p.id and a.alias_normalizado = v_n)
                then 1
                when length(v_n) >= 3
                 and (position(v_n in p.nombre_normalizado) > 0
                      or position(v_n in coalesce(normalizar_proveedor_base(p.nombre_comercial), '')) > 0
                      or exists (select 1 from proveedores_alias a
                                  where a.proveedor_id = p.id and position(v_n in a.alias_normalizado) > 0))
                then 2 end as pri,
           (select count(*) from facturas f where f.proveedor_id = p.id) as docs
      from proveedores p
  ),
  o as (
    select *, row_number() over (order by pri, docs desc, nombre) as rn from c where pri is not null
  )
  select (select id from o where rn = 1),
         (select jsonb_agg(nombre order by rn) from o where rn between 2 and 4)
    into v_id, v_otros;

  if v_id is null then
    return json_build_object('buscado', p_texto, 'sin_datos', true,
                             'nota', 'Ningun proveedor se llama asi (nombre, alias ni nombre comercial).');
  end if;

  with d as (
    select f.* from facturas f
     where f.proveedor_id = v_id
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
  ),
  fechas as (select count(distinct fecha) as n, min(fecha) as primera, max(fecha) as ultima from d),
  l as (
    select coalesce(pc.nombre, pf.nombre::text) as producto,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as k,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           pf.total as imp,   -- solo el importe leído (una línea sin importe no suma)
           d.fecha, d.id as doc
      from productos_factura pf
      join d on d.id = pf.factura_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
  ),
  top as (
    select min(producto) as producto, unidad, sum(imp) as imp,
           (array_agg(precio order by fecha desc nulls last, doc desc) filter (where precio > 0))[1] as ult_precio,
           max(fecha) as ult_fecha
      from l
     group by k, unidad
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'proveedor', (select nombre from proveedores where id = v_id),
    'otros_parecidos', v_otros,
    'docs', (select count(*) from d),
    'primera', (select primera from fechas),
    'ultima', (select ultima from fechas),
    'intervalo_medio_dias', (select case when n >= 2 then round((ultima - primera)::numeric / (n - 1), 0) end from fechas),
    'gasto', (select trim_scale(round(coalesce(sum(total), 0), 2)) from d),
    'reparto', (select case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                  'en_facturas', trim_scale(round(coalesce(sum(total) filter (where tipo = 'factura'), 0), 2)),
                  'en_albaranes_sin_factura', trim_scale(round(coalesce(sum(total) filter (where tipo = 'albaran'), 0), 2))) end
                  from d),
    'sin_total', (select nullif(count(*) filter (where total is null), 0) from d),
    'nota', 'gasto con IVA; precios de linea SIN IVA',
    'top_productos', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'producto',      t.producto,
               'unidad',        t.unidad,
               'ultimo_precio', trim_scale(round(t.ult_precio, case when t.ult_precio < 1 then 4 else 2 end)),
               'ultima_fecha',  t.ult_fecha))
             order by t.imp desc nulls last, t.producto)
        from (select * from top order by imp desc nulls last, producto limit 8) t)
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.ficha_proveedor_agente(text) from public, anon;
grant execute on function public.ficha_proveedor_agente(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
declare
  c_max_variantes constant int := 15;
  c_sim_semantica constant float8 := 0.5;   -- sugerencias por embedding: parecido mínimo
  c_sim_texto     constant float8 := 0.5;   -- sugerencias por texto: frase y primera palabra
  c_dif_variantes constant numeric := 1.15; -- precios de variantes «distintos»: más de un 15 %
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_uni    text := unidad_agente(p_unidad);
  v_tipo   text;
  v_pal    text[];
  v_frase  text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_aprox  boolean;
  v_sug    jsonb;
  v_sem    boolean;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  if v_orden not in ('importe', 'cantidad', 'precio') then
    return json_build_object('error', 'orden debe ser importe, cantidad o precio.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  select h.ids, h.metodo, h.subproductos, h.palabras
    into v_ids, v_met, v_subs, v_pal
    from lineas_producto_agente(p_texto, p_excluir) h;
  if coalesce(cardinality(v_pal), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_frase := array_to_string(v_pal, ' ');
  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- ── Nada: solo subproductos, o sugerencias (semánticas si hay embedding) ──
  if v_ids is null then
    if v_subs is not null then
      return jsonb_build_object(
        'buscado',      p_texto,
        'coincidencia', 'solo_subproductos',
        'sin_datos',    true,
        'subproductos', to_jsonb(v_subs),
        'nota', 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto: dilo y pregunta si es eso.')::json;
    end if;
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)
      into v_sug, v_sem
      from (
        select min(nombre) as nombre, min(pri) as pri, max(s) as s
          from (
            select pf.nombre::text as nombre, 1 as pri, max(1 - (pf.embedding <=> p_embedding)) as s
              from productos_factura pf
             where p_embedding is not null and pf.embedding is not null
             group by pf.nombre
            having max(1 - (pf.embedding <=> p_embedding)) >= c_sim_semantica
            union all
            select pf.nombre::text, 2,
                   max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' ')))
              from productos_factura pf
             group by pf.nombre
            having max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
               and max(extensions.strict_word_similarity(v_pal[1], array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
          ) x
         group by array_to_string(palabras_producto_agente(nombre), ' ')
         order by min(pri), max(s) desc
         limit 5
      ) y;

    return jsonb_strip_nulls(jsonb_build_object(
      'buscado',      p_texto,
      'coincidencia', case when v_sem then 'semantica' else 'ninguna' end,
      'sin_datos',    true,
      'sugerencias',  v_sug,
      'nota',         case when v_sug is not null then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados: pregunta si es alguno.'
                      else 'No hay compras de ese producto ni nada parecido: dilo asi, sin sugerir otros productos.' end
    ))::json;
  end if;

  -- ── Agregación ──
  with base0 as (
    select pf.id, pf.nombre::text as nombre,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.total::numeric as imp,   -- solo el importe leído: sin importe = sin_importe, sin precio
           f.id as doc, f.tipo, f.fecha,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,   -- nombre canónico
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal or palabras_producto_agente(pc.nombre) @> v_pal as exacta,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(v_ids)
       and pf.total is distinct from 0   -- líneas a 0 €: fuera
  ),
  -- Albarán ya facturado (vínculo guardado o factura del proveedor que cita su número): fuera,
  -- salvo que se pidan solo albaranes.
  base as (
    select * from base0 where not fact or v_tipo = 'albaran'
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
       and (v_uni is null or unidad = v_uni)
  ),
  -- Albaranes ya facturados que se han dejado fuera (solo para el aviso).
  ya_facturados as (
    select b.id from base0 b
     where b.fact and v_tipo is null
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (v_uni is null or b.unidad = v_uni)
  ),
  c as (
    select *, case when imp > 0 and cant > 0 then imp / cant end as pu
      from filtrada
  ),
  -- Variantes con su propio precio (por unidad). «Distintas» = dos variantes de la misma
  -- unidad con más de un 15 % de diferencia: entonces no se da una media global.
  var_u as (
    select mode() within group (order by nombre) as nombre, unidad,
           sum(cant) as cant, sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
           count(distinct doc) as compras, max(fecha) as ultima,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' '), unidad
  ),
  var_dist as (
    select exists (select 1 from var_u a join var_u b on a.unidad = b.unidad
                    and b.precio > 0 and a.precio > b.precio * c_dif_variantes) as ok
  ),
  var_pu as (
    select prov_n, unidad, array_to_string(palabras_producto_agente(nombre), ' ') as k,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio
      from c group by 1, 2, 3
  ),
  prov_multi as (
    select a.prov_n, a.unidad from var_pu a join var_pu b
      on a.prov_n = b.prov_n and a.unidad = b.unidad and b.precio > 0 and a.precio > b.precio * c_dif_variantes
     group by 1, 2
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           count(*) as lineas,
           count(distinct doc) as compras
      from c
     group by unidad
  ),
  por_prov as (
    select prov_n, unidad,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
           min(pu) as p_min,
           max(pu) as p_max,
           count(distinct doc) as compras,
           min(fecha) as primera,
           max(fecha) as ultima,
           case when bool_and(tipo = 'albaran') then 'albaran'
                when bool_or(tipo = 'albaran') then 'factura+albaran' end as tipo
      from c
     group by prov_n, unidad
  ),
  ordenada as (
    select p.*,
           exists (select 1 from prov_multi pm where pm.prov_n = p.prov_n and pm.unidad = p.unidad) as multi,
           row_number() over (
             order by u.imp desc nulls last, u.cant desc nulls last, p.unidad,
                      case when v_orden = 'cantidad' then p.cant end desc nulls last,
                      case when v_orden = 'precio' then p.precio end asc nulls last,
                      p.imp desc nulls last, p.cant desc nulls last, p.proveedor) as rn,
           count(*) over () as n
      from por_prov p
      join por_unidad u using (unidad)
  ),
  -- Variantes agrupadas por sus palabras («20% nata» = «20%nata»).
  variantes as (
    select mode() within group (order by nombre) as nombre,
           count(*) as lineas, bool_and(exacta) as exacta, max(fecha) as ultima
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' ')
  ),
  marco as (
    select count(*) as lineas,
           count(distinct doc) as compras,
           count(distinct prov_n) as proveedores,
           count(distinct unidad) as unidades,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where cant is null or cant = 0) as sin_cantidad,
           count(distinct doc) filter (where fd) as fecha_dudosa,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           coalesce(bool_and(exacta), false) as todas_exactas,
           coalesce(bool_or(exacta), false) as alguna_exacta
      from c
  ),
  -- Precio comparable: solo si TODAS las líneas con precio se pueden pasar a la
  -- misma unidad base (kg, l, ud) y alguna es un envase (caja, cubo, bote...).
  cmp_marco as (
    select min(unidad_base) as ub,
           coalesce(bool_and(unidad_base is not null) and min(unidad_base) = max(unidad_base) and bool_or(conv), false) as ok
      from c
     where pu is not null
  ),
  cmp_prov as (
    select prov_n,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(imp) / nullif(sum(cant * factor), 0) as precio,
           (array_agg(pu / factor order by fecha desc nulls last, doc desc))[1] as ult_precio,
           min(pu / factor) as p_min,
           max(pu / factor) as p_max,
           count(distinct doc) as compras,
           max(fecha) as ultima,
           string_agg(distinct ctxt, ' / ') filter (where conv) as desde,
           row_number() over (order by sum(imp) / nullif(sum(cant * factor), 0), (array_agg(proveedor))[1]) as rn
      from c
     where pu is not null
     group by prov_n
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'buscado',  p_texto,
    'excluido', nullif(trim(coalesce(p_excluir, '')), ''),
    'unidad',   v_uni,
    'periodo',  case when p_desde is not null or p_hasta is not null
                     then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                     else to_jsonb('todo el historico'::text) end,
    'tipo',     v_tipo,
    'coincidencia', (
      select case when v_aprox then 'aproximada'
                  when m.lineas = 0 then null
                  when m.todas_exactas then 'exacta'
                  when m.alguna_exacta then 'exacta+raiz'
                  else 'raiz' end
        from marco m),
    'productos_coincidentes', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', v.nombre,
               'lineas', v.lineas,
               'coincidencia', case when not v_aprox and m.alguna_exacta and not m.todas_exactas and not v.exacta
                                    then 'raiz' end))
             order by v.lineas desc, v.ultima desc nulls last, v.nombre)
        from (select * from variantes order by lineas desc, ultima desc nulls last, nombre limit c_max_variantes) v
       cross join marco m),
    'variantes_total', (select case when count(*) > c_max_variantes then count(*) end from variantes),
    'por_variante', (
      select case when (select ok from var_dist) then (
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'nombre',        v.nombre,
                        'unidad',        v.unidad,
                        'cantidad',      trim_scale(round(v.cant, 3)),
                        'importe',       trim_scale(round(v.imp, 2)),
                        'precio_medio',  trim_scale(round(v.precio, case when v.precio < 1 then 4 else 2 end)),
                        'ultimo_precio', trim_scale(round(v.ult_precio, case when v.ult_precio < 1 then 4 else 2 end)),
                        'compras',       v.compras,
                        'ultima',        v.ultima,
                        'proveedor',     v.proveedor))
                      order by v.imp desc nulls last, v.nombre)
                 from (select * from var_u order by imp desc nulls last, nombre limit 8) v) end),
    'nota_variantes', (
      select case when ok then 'Variantes con precios distintos: da CADA variante con su precio (por_variante), no una media.' end from var_dist),
    'subproductos_excluidos', to_jsonb(v_subs),
    'total', (
      select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
               'importe',     trim_scale(round(m.imp, 2)),
               'en_facturas', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
               'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
               'lineas',      m.lineas,
               'compras',     m.compras,
               'proveedores', m.proveedores)) end
        from marco m),
    'por_unidad', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'unidad',       u.unidad,
               'cantidad',     trim_scale(round(u.cant, 3)),
               'importe',      trim_scale(round(u.imp, 2)),
               'precio_medio', case when (select ok from var_dist) then null
                                    else trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)) end,
               'lineas',       u.lineas,
               'compras',      u.compras))
             order by u.imp desc nulls last, u.cant desc nulls last, u.unidad)
        from por_unidad u),
    'por_proveedor', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',     o.proveedor,
               'unidad',        o.unidad,
               'cantidad',      trim_scale(round(o.cant, 3)),
               'importe',       trim_scale(round(o.imp, 2)),
               'precio_medio',  case when o.multi then null else trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)) end,
               'ultimo_precio', case when o.multi then null else trim_scale(round(o.ult_precio, case when o.ult_precio < 1 then 4 else 2 end)) end,
               'precio_min',    case when o.multi then null else trim_scale(round(o.p_min, case when o.p_min < 1 then 4 else 2 end)) end,
               'precio_max',    case when o.multi then null else trim_scale(round(o.p_max, case when o.p_max < 1 then 4 else 2 end)) end,
               'varias_variantes', case when o.multi then true end,
               'compras',       o.compras,
               'primera',       o.primera,
               'ultima',        o.ultima,
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'precio_comparable', (
      select case when cm.ok and not (select ok from var_dist) then jsonb_build_object(
               'unidad_base', cm.ub,
               'criterio', 'Todo convertido a €/' || cm.ub || ' dividiendo el precio del envase por su contenido (convertido_desde). '
                           || 'Compara con ESTOS precios y di de donde viene la conversion.',
               'por_proveedor', (
                 select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'proveedor',      p.proveedor,
                          'precio_medio',   trim_scale(round(p.precio, case when p.precio < 1 then 4 else 2 end)),
                          'ultimo_precio',  trim_scale(round(p.ult_precio, case when p.ult_precio < 1 then 4 else 2 end)),
                          'precio_min',     trim_scale(round(p.p_min, case when p.p_min < 1 then 4 else 2 end)),
                          'precio_max',     trim_scale(round(p.p_max, case when p.p_max < 1 then 4 else 2 end)),
                          'compras',        p.compras,
                          'ultima',         p.ultima,
                          'convertido_desde', p.desde))
                        order by p.rn)
                   from cmp_prov p
                  where p.rn <= v_lim)) end
        from cmp_marco cm),
    'una_compra',  (select case when m.compras = 1 then true end from marco m),
    'truncado',    (select case when max(n) > v_lim then true end from ordenada),
    'filas_total', (select case when max(n) > v_lim then max(n) end from ordenada),
    'criterio', (
      select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta. Precios SIN IVA.' end
        from marco m),
    'avisos', (
      select nullif(jsonb_strip_nulls(jsonb_build_object(
               'sin_importe',             nullif(m.sin_importe, 0),
               'sin_cantidad',            nullif(m.sin_cantidad, 0),
               'fecha_dudosa',            nullif(m.fecha_dudosa, 0),
               'unidades_mezcladas',      case when m.unidades > 1 then true end,
               'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
        from marco m),
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'fuera_del_filtro', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'lineas',    count(*),
                        'primera',   min(b.fecha),
                        'ultima',    max(b.fecha),
                        'tipos',     string_agg(distinct b.tipo, ','),
                        'unidades',  string_agg(distinct b.unidad, ','),
                        'productos', (select jsonb_agg(distinct b2.nombre) from (select nombre from base limit 5) b2)))
                 from base b) end
        from marco m),
    -- Periodo/tipo/unidad sin nada pero sí hay histórico: la última compra.
    'ultimo_dato', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'fecha',     u.fecha,
                        'producto',  u.nombre,
                        'cantidad',  trim_scale(round(u.cant, 3)),
                        'unidad',    u.unidad,
                        'proveedor', u.proveedor,
                        'importe',   trim_scale(round(u.imp, 2)),
                        'tipo',      u.tipo))
                 from (select b.fecha, b.unidad, b.tipo, max(b.proveedor) as proveedor, min(b.nombre) as nombre,
                              sum(b.cant) as cant, sum(b.imp) as imp
                         from base b
                        where b.doc = (select b2.doc from base b2 order by b2.fecha desc nulls last, b2.doc desc limit 1)
                        group by b.fecha, b.unidad, b.tipo
                        order by sum(b.imp) desc nulls last, sum(b.cant) desc nulls last
                        limit 1) u) end
        from marco m)
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total (cuadra con Productos y Análisis).
declare
  c_top        constant int := 8;
  c_max_cruce  constant int := 60;
  v_tipo   text;
  v_agr    text;
  v_cat    categorias_producto%rowtype;
  v_madre  text;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  v_agr := case
    when nullif(trim(coalesce(p_agrupar, '')), '') is null then null
    when lower(trim(p_agrupar)) like 'mes%' then 'mes'
    when lower(trim(p_agrupar)) like 'proveedor%' then 'proveedor'
    else '?' end;
  if v_agr = '?' then
    return json_build_object('error', 'agrupar debe ser mes, proveedor o null.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object(
        'error', format('No hay ninguna categoria "%s".', p_categoria),
        'categorias', (select json_agg(c.nombre || coalesce(' (' || (
                          select string_agg(s.nombre, ', ' order by s.orden, s.nombre)
                            from categorias_producto s where s.padre_id = c.id and s.activa) || ')', '')
                          order by c.orden, c.nombre)
                         from categorias_producto c where c.padre_id is null and c.activa));
    end if;
    select nombre into v_madre from categorias_producto where id = v_cat.padre_id;
  end if;

  with base as (
    select pf.id, pf.producto_id,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.total::numeric as imp,   -- solo el importe leído (como Productos y el tablero)
           f.id as doc, f.tipo::text as tipo, f.fecha, coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv         on pv.id = f.proveedor_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán ya facturado (vínculo o factura que cita su número): fuera, salvo que se pidan solo albaranes.
  ya_facturados as (select id from base where fact and v_tipo is null),
  todo as (select * from base where not fact or v_tipo = 'albaran'),
  -- Lo que se pregunta: la categoría (con sus subcategorías) o todo.
  l as (
    select * from todo
     where v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id
  ),
  -- Fila de reparto: categoría madre y subcategoría (o sin clasificar / sin categoría).
  g as (
    select case when producto_id is null then 'Sin clasificar'
                when cat_id is null then 'Sin categoria'
                else madre end as grupo,
           case when cat_id is not null and cat_id <> madre_id then cat end as sub,
           orden, imp, id, doc,
           -- Clave del cruce y su etiqueta (el proveedor, agrupado por su nombre normalizado).
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else prov_n end as k,
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else proveedor end as etq
      from l
  ),
  marco as (
    select count(*) as lineas, count(distinct doc) as docs, count(distinct producto_id) as productos,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where tipo = 'albaran') as lin_alb
      from l
  ),
  total_periodo as (select sum(imp) as imp from todo),
  sin_clas as (
    select count(*) as lineas, sum(imp) as imp from todo where producto_id is null
  ),
  reparto as (
    select grupo, min(orden) as orden, sum(imp) as imp, count(*) as lineas,
           (select jsonb_agg(jsonb_build_object('categoria', s.sub, 'importe', trim_scale(round(s.imp, 2)), 'lineas', s.lineas)
                             order by s.imp desc nulls last, s.sub)
              from (select g2.sub, sum(g2.imp) as imp, count(*) as lineas
                      from g g2 where g2.grupo = g.grupo and g2.sub is not null group by g2.sub) s) as subs
      from g group by grupo
  ),
  top as (
    select producto, sum(imp) as imp,
           (select jsonb_object_agg(u.unidad, trim_scale(round(u.cant, 3)))
              from (select l2.unidad, sum(l2.cant) as cant from l l2 where l2.producto = l.producto group by l2.unidad) u) as cant,
           count(*) over () as n
      from l where producto is not null
     group by producto
  ),
  cruce as (
    select case when v_cat.id is null then grupo end as grupo,
           (array_agg(etq order by etq))[1] as clave,
           sum(imp) as imp, count(*) as lineas
      from g
     where v_agr is not null
     group by 1, k
  ),
  cruce_n as (
    select c.*, row_number() over (
             order by case when v_agr = 'mes' then c.clave end,
                      c.imp desc nulls last, c.grupo, c.clave) as rn,
           count(*) over () as n
      from cruce c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'categoria', case when v_cat.id is not null then v_cat.nombre end,
    'madre',     v_madre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'en_facturas',  case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
                'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end)) end
                from marco m cross join total_periodo tp),
    -- Sin categoría: madres con sus subcategorías. Con una madre: sus subcategorías.
    'categorias', case when v_cat.id is null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', r.grupo,
                 'importe',   trim_scale(round(r.imp, 2)),
                 'pct',       case when tp.imp > 0 then round(100 * r.imp / tp.imp, 1) end,
                 'lineas',    r.lineas,
                 'sub',       r.subs))
               order by r.imp desc nulls last, r.orden, r.grupo)
          from reparto r cross join total_periodo tp
         where r.grupo not in ('Sin clasificar', 'Sin categoria')) end,
    'subcategorias', case when v_cat.id is not null and v_cat.padre_id is null then (
        select r.subs from reparto r limit 1) end,
    'sin_categoria', case when v_cat.id is null then (
        select jsonb_build_object('importe', trim_scale(round(r.imp, 2)), 'lineas', r.lineas)
          from reparto r where r.grupo = 'Sin categoria') end,
    'top_productos', case when v_cat.id is not null then (
        select jsonb_agg(jsonb_build_object('producto', t.producto, 'importe', trim_scale(round(t.imp, 2)), 'cantidad', t.cant)
                         order by t.imp desc nulls last, t.producto)
          from (select * from top order by imp desc nulls last, producto limit c_top) t) end,
    'productos_total', case when v_cat.id is not null then (select case when max(n) > c_top then max(n) end from top) end,
    'cruce', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', c.grupo,
                 v_agr,        c.clave,
                 'importe',   trim_scale(round(c.imp, 2)),
                 'lineas',    c.lineas))
               order by c.rn)
          from cruce_n c where c.rn <= c_max_cruce),
    'cruce_truncado', (select case when max(n) > c_max_cruce then true end from cruce_n),
    'sin_clasificar', (select case when s.lineas > 0 then jsonb_build_object(
                         'lineas', s.lineas, 'importe', trim_scale(round(s.imp, 2))) end from sin_clas s),
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta.' end
        from marco m),
    'avisos', (select nullif(jsonb_strip_nulls(jsonb_build_object(
                 'sin_importe',             nullif(m.sin_importe, 0),
                 'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
                 from marco m),
    'nota', 'Importes de linea: base SIN IVA.',
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'ultima_compra', case when v_cat.id is not null and (select lineas from marco) = 0 then (
        select max(f.fecha)
          from productos_factura pf
          join facturas f on f.id = pf.factura_id
          join productos_catalogo p on p.id = pf.producto_id
          join categorias_producto c on c.id = p.categoria_id
         where c.id = v_cat.id or c.padre_id = v_cat.id) end
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.gasto_categorias_agente(text, date, date, text, text) from public, anon;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: sin_clasificar sin los albaranes ya facturados.
declare
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_ids     bigint[];
  v_subs    text[];
  resultado jsonb;
begin
  v_sentido := case when v_sentido like 'sub%' then 'subidas' when v_sentido like 'baj%' then 'bajadas'
                    when v_sentido in ('ambas', 'ambos', 'todas', 'todo') then 'ambas' else '?' end;
  if v_sentido = '?' then
    return json_build_object('error', 'sentido debe ser subidas, bajadas o ambas.');
  end if;
  if v_umbral < 0 or v_umbral > 1000 then
    return json_build_object('error', 'umbral_pct debe estar entre 0 y 1000.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
  end if;
  if nullif(trim(coalesce(p_producto, '')), '') is not null then
    select h.ids, h.subproductos into v_ids, v_subs from lineas_producto_agente(p_producto) h;
    v_prods := array(select distinct pf.producto_id from productos_factura pf
                      where pf.id = any(v_ids) and pf.producto_id is not null);
    if cardinality(v_prods) = 0 then
      return jsonb_strip_nulls(jsonb_build_object('buscado', p_producto, 'sin_datos', true,
        'subproductos', to_jsonb(v_subs),
        'nota', case when v_subs is not null
                     then 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto.'
                     else 'Ningun producto del catalogo se llama asi: prueba compras_producto o historial_precios.' end))::json;
    end if;
  end if;

  with l as (
    select x.*, p.nombre as producto
      from lineas_precio_agente(null, null, true) x
      join productos_catalogo p on p.id = x.producto_id
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or x.producto_id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       -- Servicios (portes, reparaciones…) fuera salvo que se pidan.
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- Última compra de cada producto y unidad dentro del periodo.
  ult_doc as (
    select distinct on (producto_id, unidad) producto_id, unidad, factura_id, fecha, tipo, proveedor, prov_n, producto
      from l
     where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)
     order by producto_id, unidad, fecha desc, factura_id desc
  ),
  ult as (
    select u.*,
           (select coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                              / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio))
              from l where l.factura_id = u.factura_id and l.producto_id = u.producto_id and l.unidad = u.unidad) as precio
      from ult_doc u
  ),
  cmp as (
    select u.*, r.precio as ref_precio, r.compras as ref_compras, r.desde as ref_desde, r.hasta as ref_hasta,
           r.proveedor as ref_proveedor, r.metodo,
           case when r.precio > 0 then round((u.precio / r.precio - 1) * 100, 1) end as var,
           r.precio is not null and not (u.prov_n = any(r.proveedores_n)) as cambio
      from ult u
      left join lateral precio_referencia_agente(u.producto_id, u.unidad, u.fecha, u.factura_id, true) r on true
  ),
  sel as (
    select c.*, row_number() over (
             order by case when v_sentido = 'bajadas' then c.var end asc nulls last,
                      case when v_sentido = 'ambas' then abs(c.var) end desc nulls last,
                      c.var desc nulls last, c.producto) as rn,
           count(*) over () as n
      from cmp c
     where c.var is not null
       and (v_prods is not null
            or (v_sentido = 'subidas' and c.var >= v_umbral)
            or (v_sentido = 'bajadas' and c.var <= -v_umbral)
            or (v_sentido = 'ambas' and abs(c.var) >= v_umbral))
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'criterio', 'Por producto y unidad: precio de la ultima compra frente a la media ponderada de las compras de los '
                || '90 dias anteriores (o de las 3 ultimas compras anteriores si en 90 dias hay menos de 2). '
                || 'Precios de linea SIN IVA.'
                || case when v_prods is not null then ' Producto pedido: todas sus unidades, sin umbral.' else '' end,
    'buscado',   p_producto,
    'categoria', v_cat.nombre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'convertido_desde', (select string_agg(distinct x.convertido_desde, ' / ') from l x
                                       where x.producto_id = s.producto_id and x.unidad = s.unidad),
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                              where f.id = s.factura_id), s.proveedor),
                 'tipo',           case when s.tipo = 'albaran' then 'albaran' end,
                 'variacion_pct',  s.var,
                 'ref_precio',     trim_scale(round(s.ref_precio, 4)),
                 'ref_compras',    s.ref_compras,
                 'ref_desde',      s.ref_desde,
                 'ref_hasta',      case when s.ref_hasta <> s.ref_desde then s.ref_hasta end,
                 'ref_proveedor',  case when s.cambio or s.ref_proveedor is distinct from s.proveedor then s.ref_proveedor end,
                 'cambio_proveedor', case when s.cambio then true end,
                 'pocas_compras',  case when s.ref_compras = 1 then true end,
                 'ref_antigua',    case when s.metodo = 'ultimas_compras' and s.ref_hasta < s.fecha - 90 then true end))
               order by s.rn)
          from sel s where s.rn <= v_lim), '[]'::jsonb),
    -- Producto pedido sin precio anterior con que comparar: su última compra
    -- (una_compra = solo hay una: no hay subida ni bajada posible).
    'sin_comparar', case when v_prods is not null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',   c.producto,
                 'unidad',     c.unidad,
                 'precio',     trim_scale(round(c.precio, 4)),
                 'fecha',      c.fecha,
                 'proveedor',  coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                          where f.id = c.factura_id), c.proveedor),
                 'una_compra', case when (select count(distinct l2.factura_id) from l l2
                                           where l2.producto_id = c.producto_id and l2.unidad = c.unidad) = 1 then true end))
               order by c.fecha desc, c.producto)
          from (select * from cmp where var is null order by fecha desc, producto limit v_lim) c) end,
    'total_productos', (select coalesce(max(n), 0) from sel),
    'truncado',  (select case when max(n) > v_lim then true end from sel),
    'comparados', (select count(*) from cmp where var is not null),
    'avisos', nullif(jsonb_strip_nulls(jsonb_build_object(
        'sin_referencia', nullif((select count(*) from cmp where var is null), 0),
        'pocas_compras',  nullif((select count(*) from sel where ref_compras = 1 and rn <= v_lim), 0),
        'cambio_proveedor', nullif((select count(*) from sel where cambio and rn <= v_lim), 0),
        'sin_clasificar', nullif((select count(*) from productos_factura pf join facturas f on f.id = pf.factura_id
                                   where pf.producto_id is null
                                     and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) to authenticated, service_role;

comment on function public.resumen_periodo_agente(date, date) is
  'Chatbot de facturas: resumen compacto de un rango. gasto_total = facturas + albaranes sin factura (la cifra del panel; el albarán ya facturado no suma); facturas = {n, gasto facturado, base, iva, si_das_importes}; albaranes = los que suman (sin factura) + ya_facturados aparte; con_alertas; meses si abarca varios (gasto = facturas + albaranes sin factura); top 10 proveedores; top 8 productos sin servicios. 20261106140000.';
comment on function public.estadisticas_globales_agente() is
  'Chatbot de facturas: foto global compacta. gasto_total y meses.gasto = facturas + albaranes sin factura (la cifra del panel; el albarán ya facturado no suma); facturas = {n, gasto facturado, base, iva, si_das_importes}; albaranes = los que suman + ya_facturados aparte; con_alertas; meses con datos y año; top 8 proveedores; 3 últimos documentos. 20261106140000.';
comment on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) is
  'Chatbot de facturas: documentos por filtro (todos|sin_total|sin_verificar|con_alertas|fecha_dudosa|sin_factura|facturados), texto (número, proveedor o CIF), tipo y fechas. Con todos/sin_factura/facturados, sumas de TODO lo filtrado (gasto_total = facturas + albaranes sin factura; albaranes.ya_facturados aparte); con los demás SOLO cuenta. La relación albarán → factura está guardada (facturado_en_id o cita del número: albaranes_facturados_agente); lo que no hay es estado de pago. sin_total NO significa sin factura. 20261106140000.';
comment on function public.consulta_flexible_agente(jsonb) is
  'Chatbot de facturas: agregados a medida con LISTA BLANCA (fuente, métricas —incl. count_con_total—, agrupaciones, filtros, orden, límite hasta 50). Sin albaranes ya facturados (están en su factura), como el panel. Cada avg_* trae n_con_*; con importes de documentos cada fila trae sin_total/deducidos y arriba documentos_sin_total/documentos_deducidos (+ documentos_sin_iva con IVA); los conteos no llevan avisos; al agrupar por fecha avisa de fechas_dudosas. Valores como parámetros de EXECUTE … USING; lo no permitido devuelve {error, permitidos}. 20261106140000.';

commit;
