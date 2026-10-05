set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005100000_chatbot_facturas_ranking_sin_total.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005100000_chatbot_facturas_ranking_sin_total_ROLLBACK.sql
--
-- 1. Devuelve estadisticas_globales_agente, resumen_periodo_agente,
--    buscar_facturas_agente y buscar_productos_agente a las definiciones
--    EXACTAS de producción del 05/10/2026 (pg_get_functiondef copiado tal
--    cual; md5 comprobado al final) y a sus comentarios anteriores.
-- 2. Borra las funciones nuevas: consulta_flexible_agente,
--    detalle_documento_agente, filtrar_documentos_agente, ranking_agente,
--    buscar_productos_texto_agente, docs_sin_total_agente,
--    documento_compacto_agente, fecha_dudosa_agente, alertas_resumen_agente
--    y es_linea_servicio_agente.
-- No toca datos. Los permisos de las 4 funciones restauradas no cambian
-- (CREATE OR REPLACE conserva el ACL).
-- ANTES de ejecutarlo: volver a desplegar la chat-facturas ANTERIOR (la
-- nueva llama a ranking/filtrar/detalle/consulta_flexible y se quedaría sin
-- ellas). La chat-facturas anterior funciona con las definiciones restauradas.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- estadisticas_globales_agente(): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.estadisticas_globales_agente()
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_docs          int := (select count(*) from facturas);
  v_proveedores   int := (select count(distinct proveedor_normalizado) from facturas);
  v_meses         int := (select count(*) from vista_gastos_mensuales);
begin
  return json_build_object(

    'sin_datos', (v_docs = 0),
    'aviso_sin_datos', case when v_docs = 0 then
      'No hay ningun documento cargado en la base de datos. Los importes de 0,00 € significan '
      || '"no hay datos cargados", NUNCA "no se gasto nada".' end,

    'resumen_general', json_build_object(
      'total_facturas',              (select count(*) from facturas where tipo = 'factura'),
      'total_albaranes',             (select count(*) from facturas where tipo = 'albaran'),
      'total_productos',             (select count(*) from productos_factura),
      'gasto_total_facturado',       (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'factura'),
      'base_imponible_total',        (select round(coalesce(sum(subtotal), 0)::numeric, 2) from facturas where tipo = 'factura'),
      'valor_albaranes',             (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'albaran'),
      'nota_albaranes',              'valor_albaranes son entregas recibidas, NO gasto facturado. Nunca sumar ambas cifras.',
      'nota_iva',                    'gasto_total_facturado lleva el IVA incluido; base_imponible_total es sin IVA. Di cual estas dando.',
      'fecha_primera_factura',       (select min(fecha) from facturas),
      'fecha_ultima_factura',        (select max(fecha) from facturas),
      'documentos_sin_verificar',    (select count(*) from facturas where coalesce(verificada, false) = false),
      'documentos_con_alertas_pendientes', (select count(*) from facturas where coalesce(jsonb_array_length(alertas_validacion), 0) > 0),
      'nota_alertas', 'documentos_con_alertas_pendientes son documentos donde el sistema detecto importes que no cuadran al cargarlos (posible error de OCR, ej. un precio con un cero de mas). No trates sus cifras como fiables sin avisar.'
    ),

    'gastos_mensuales', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_gastos_mensuales limit 6) t
    ),
    'gastos_mensuales_truncado', (v_meses > 6),

    'top_proveedores', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select coalesce(max(proveedor), proveedor_normalizado)                             as proveedor,
               count(*) filter (where tipo = 'factura')                                    as num_facturas,
               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto_facturado,
               count(*) filter (where tipo = 'albaran')                                    as num_albaranes,
               round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2)  as valor_albaranes,
               min(fecha) as primera_compra,
               max(fecha) as ultima_compra
        from facturas
        group by proveedor_normalizado
        order by gasto_facturado desc
        limit 8
      ) x
    ),
    'top_proveedores_truncado', (v_proveedores > 8),

    'productos_mas_comprados', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_productos_top limit 10) t
    ),

    'ultimos_documentos', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_ultimos_documentos limit 5) t
    ),

    'aviso_topes',
      'LISTAS PARCIALES: gastos_mensuales son los ultimos 6 meses, top_proveedores los 8 de mayor '
      || 'gasto (de ' || v_proveedores || ' en total), productos_mas_comprados los 10 mayores y '
      || 'ultimos_documentos los 5 mas recientes. Son extractos, no el conjunto: no los sumes para '
      || 'dar totales (usa resumen_general) ni afirmes que algo no existe porque no aparezca aqui.'

  );
end;
$function$;

comment on function public.estadisticas_globales_agente() is
  'Foto global del negocio sin filtros, con facturas y albaranes separados. documentos_con_alertas_pendientes (junto a documentos_sin_verificar) cuenta documentos con facturas.alertas_validacion no vacio (T5): importes marcados como sospechosos al cargarlos.';

-- resumen_periodo_agente(date, date): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.resumen_periodo_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
  v_desde date := p_desde;
  v_hasta date := p_hasta;
  v_docs  int;
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

  select count(*) into v_docs from facturas where fecha between v_desde and v_hasta;

  with docs as (
    select * from facturas
    where fecha between v_desde and v_hasta
  ),
  lineas as (
    select pf.*, d.tipo as tipo_documento, d.proveedor, d.fecha as fecha_doc
    from productos_factura pf
    join docs d on d.id = pf.factura_id
  ),
  prov as (
    select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
           count(*) filter (where tipo = 'factura')                                       as num_facturas,
           round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)     as gasto_facturado,
           count(*) filter (where tipo = 'albaran')                                       as num_albaranes,
           round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2)     as valor_albaranes,
           count(*) over ()                                                               as total_proveedores
    from docs group by proveedor_normalizado
    order by gasto_facturado desc
    limit 15
  ),
  prod as (
    select max(nombre)                                    as producto,
           tipo_documento,
           count(*)                                       as veces,
           round(coalesce(sum(cantidad), 0)::numeric, 3)  as cantidad_total,
           max(unidad)                                    as unidad,
           round(avg(precio_unitario)::numeric, 4)        as precio_medio,
           round(coalesce(sum(total), 0)::numeric, 2)     as importe_total,
           count(*) over ()                               as total_productos
    from lineas
    group by nombre_normalizado, tipo_documento
    order by importe_total desc nulls last
    limit 15
  )
  select json_build_object(
    'periodo', json_build_object('desde', v_desde, 'hasta', v_hasta, 'confirmado', true),
    'sin_datos', (v_docs = 0),
    'aviso_sin_datos', case when v_docs = 0 then
      'No hay NINGUN documento cargado entre ' || v_desde || ' y ' || v_hasta || '. '
      || 'Los importes de 0,00 € significan "no hay datos cargados de ese periodo", '
      || 'NUNCA "no se gasto nada". Dilo asi.' end,
    'facturas', json_build_object(
      'num_documentos',        (select count(*) from docs where tipo = 'factura'),
      'gasto_total',           (select round(coalesce(sum(total), 0)::numeric, 2) from docs where tipo = 'factura'),
      'base_imponible',        (select round(coalesce(sum(subtotal), 0)::numeric, 2) from docs where tipo = 'factura'),
      'iva_total',             (select round(coalesce(sum(iva), 0)::numeric, 2) from docs where tipo = 'factura'),
      'ticket_medio',          (select round(coalesce(avg(total), 0)::numeric, 2) from docs where tipo = 'factura'),
      'documentos_con_alertas', (select count(*) from docs where tipo = 'factura' and coalesce(jsonb_array_length(alertas_validacion), 0) > 0),
      'nota_iva', 'gasto_total es el importe TOTAL con IVA incluido. base_imponible es sin IVA. Di siempre cual de los dos estas dando.'
    ),
    'albaranes', json_build_object(
      'num_documentos',        (select count(*) from docs where tipo = 'albaran'),
      'valor_declarado',       (select round(coalesce(sum(total), 0)::numeric, 2) from docs where tipo = 'albaran'),
      'documentos_con_alertas', (select count(*) from docs where tipo = 'albaran' and coalesce(jsonb_array_length(alertas_validacion), 0) > 0),
      'nota', 'Valor de las entregas recibidas. NO es gasto facturado: no sumar a gasto_total. documentos_con_alertas son entregas con importes marcados como sospechosos al cargarlas (posible error de OCR): no des ese valor por bueno sin decirlo.'
    ),
    'por_mes', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select to_char(fecha, 'YYYY-MM') as mes,
               count(*) filter (where tipo = 'factura')                       as num_facturas,
               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2) as gasto_facturado,
               count(*) filter (where tipo = 'albaran')                       as num_albaranes
        from docs group by 1 order by 1
      ) x
    ),
    'por_proveedor', (select coalesce(json_agg(row_to_json(p)), '[]'::json)
                      from (select proveedor, num_facturas, gasto_facturado, num_albaranes, valor_albaranes from prov) p),
    'por_proveedor_truncado', (select coalesce(max(total_proveedores), 0) > 15 from prov),
    'aviso_por_proveedor', (
      select case when max(total_proveedores) > 15 then
        'RESULTADO PARCIAL: hay ' || max(total_proveedores) || ' proveedores en el periodo y solo se '
        || 'listan los 15 de mayor gasto. No sumes esta lista para dar el gasto total: usa gasto_total.'
      end from prov),
    'productos_mas_comprados', (select coalesce(json_agg(row_to_json(q)), '[]'::json)
                                from (select producto, tipo_documento, veces, cantidad_total, unidad,
                                             precio_medio, importe_total from prod) q),
    'productos_truncado', (select coalesce(max(total_productos), 0) > 15 from prod),
    'aviso_productos', (
      select case when max(total_productos) > 15 then
        'RESULTADO PARCIAL: hay ' || max(total_productos) || ' productos distintos en el periodo y solo '
        || 'se listan los 15 de mayor importe. Que un producto NO aparezca aqui no significa que no se '
        || 'comprara: significa que no esta entre los 15 mayores. No afirmes ausencias a partir de esta lista.'
      end from prod)
  ) into resultado;

  return coalesce(resultado, '{}'::json);
end;
$function$;

comment on function public.resumen_periodo_agente(date, date) is
  'Gasto, proveedores y productos de un rango de fechas, con facturas y albaranes SIEMPRE separados. Las dos fechas son OBLIGATORIAS. documentos_con_alertas (en facturas Y en albaranes) cuenta los documentos con facturas.alertas_validacion no vacio (T5): importes que el sistema marco como sospechosos al cargarlos.';

-- buscar_facturas_agente(vector, integer, double precision, text): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.buscar_facturas_agente(embedding_query vector, limite integer DEFAULT 8, umbral double precision DEFAULT 0.25, p_tipo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
  v_tipo    text := nullif(lower(trim(coalesce(p_tipo, ''))), '');
begin
  if v_tipo in ('albaran', 'albarán', 'albaranes', 'albaranés') then
    v_tipo := 'albaran';
  elsif v_tipo in ('factura', 'facturas', 'invoice') then
    v_tipo := 'factura';
  elsif v_tipo in ('ambos', 'todos', 'todo', 'cualquiera') then
    v_tipo := null;
  end if;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into resultado
  from (
    select
      f.id,
      f.tipo,
      f.proveedor,
      f.proveedor_normalizado,
      f.cif,
      f.numero_documento,
      f.fecha,
      to_char(f.fecha, 'YYYY-MM')                              as mes,
      f.subtotal,
      f.iva,
      round(f.total::numeric, 2)                               as total,
      f.observaciones,
      f.resumen,
      f.verificada,
      f.drive_url,
      coalesce(jsonb_array_length(f.alertas_validacion), 0)    as alertas_pendientes,
      exists (
        select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
        where a ->> 'severidad' = 'alta'
      )                                                        as alertas_severidad_alta,
      round((1 - (f.embedding <=> embedding_query))::numeric, 3) as similitud
    from facturas f
    where f.embedding is not null
      and (v_tipo is null or f.tipo = v_tipo)
      and (1 - (f.embedding <=> embedding_query)) > umbral
    order by f.embedding <=> embedding_query   -- <- casa con idx_facturas_embedding_hnsw
    limit limite
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

comment on function public.buscar_facturas_agente(vector, integer, double precision, text) is
  'Busqueda semantica de documentos para el chatbot de facturas. Ordena por distancia coseno sobre facturas.embedding para poder usar el indice HNSW. p_tipo acota a factura o albaran. alertas_pendientes/alertas_severidad_alta resumen facturas.alertas_validacion (T5) para que el modelo pueda avisar de importes marcados como sospechosos.';

-- buscar_productos_agente(vector, integer, double precision): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.buscar_productos_agente(embedding_query vector, limite integer DEFAULT 12, umbral double precision DEFAULT 0.25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
begin
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into resultado
  from (
    select
      pf.id,
      pf.nombre,
      pf.nombre_normalizado,
      pf.cantidad,
      pf.unidad,
      round(pf.precio_unitario::numeric, 4)                              as precio_unitario,
      round(pf.total::numeric, 2)                                        as total,
      f.proveedor,
      f.proveedor_normalizado,
      f.numero_documento,
      f.fecha,
      to_char(f.fecha, 'YYYY-MM')                                        as mes,
      f.tipo                                                             as tipo_documento,
      f.resumen                                                          as resumen_factura,
      f.verificada,
      coalesce(jsonb_array_length(f.alertas_validacion), 0)              as alertas_pendientes,
      exists (
        select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
        where a ->> 'severidad' = 'alta'
      )                                                                  as alertas_severidad_alta,
      round(
        (1 - (pf.embedding <=> embedding_query))::numeric,
        3
      )                                                                  as similitud
    from productos_factura pf
    join facturas f on f.id = pf.factura_id
    where pf.embedding is not null
      and (1 - (pf.embedding <=> embedding_query)) > umbral
    order by pf.embedding <=> embedding_query
    limit limite
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

comment on function public.buscar_productos_agente(vector, integer, double precision) is
  'Busqueda semantica de lineas de producto, con el documento de origen. verificada/alertas_pendientes/alertas_severidad_alta describen el documento PADRE (facturas), no la linea: una linea puede venir de un documento con importes marcados como sospechosos por validar_cordura_factura (T5).';

drop function if exists public.consulta_flexible_agente(jsonb);
drop function if exists public.detalle_documento_agente(bigint, text);
drop function if exists public.filtrar_documentos_agente(text, text, text, date, date, text, integer);
drop function if exists public.ranking_agente(text, text, integer, date, date, text, boolean);
drop function if exists public.buscar_productos_texto_agente(text, integer);
drop function if exists public.docs_sin_total_agente(text, date, date);
drop function if exists public.documento_compacto_agente(public.facturas, boolean);
drop function if exists public.fecha_dudosa_agente(jsonb);
drop function if exists public.alertas_resumen_agente(jsonb);
drop function if exists public.es_linea_servicio_agente(text);

do $$
declare
  v_md5 text;
begin
  select md5(pg_get_functiondef('public.estadisticas_globales_agente()'::regprocedure)) into v_md5;
  if v_md5 <> 'e69e6fe3962c2565ccd259897a2adf57' then
    raise exception 'ROLLBACK ABORTADO: estadisticas_globales_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.resumen_periodo_agente(date,date)'::regprocedure)) into v_md5;
  if v_md5 <> '6fa4d19db2e699ece264ea3a535bccf0' then
    raise exception 'ROLLBACK ABORTADO: resumen_periodo_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.buscar_facturas_agente(vector,integer,double precision,text)'::regprocedure)) into v_md5;
  if v_md5 <> '9685f84f0f4b310d38fe4e3574e6721c' then
    raise exception 'ROLLBACK ABORTADO: buscar_facturas_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.buscar_productos_agente(vector,integer,double precision)'::regprocedure)) into v_md5;
  if v_md5 <> '8055a25809e189447bb739f786c90dae' then
    raise exception 'ROLLBACK ABORTADO: buscar_productos_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  if to_regprocedure('public.consulta_flexible_agente(jsonb)') is not null
     or to_regprocedure('public.ranking_agente(text,text,integer,date,date,text,boolean)') is not null then
    raise exception 'ROLLBACK ABORTADO: siguen existiendo funciones nuevas. No se ha cambiado nada.';
  end if;
end;
$$;

commit;

select 'chatbot_facturas_ranking_sin_total: revertida' as resultado;
