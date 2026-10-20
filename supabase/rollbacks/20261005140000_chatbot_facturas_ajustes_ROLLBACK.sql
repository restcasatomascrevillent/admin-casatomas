set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005140000_chatbot_facturas_ajustes.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005140000_chatbot_facturas_ajustes_ROLLBACK.sql
--
-- Devuelve estadisticas_globales_agente, resumen_periodo_agente,
-- filtrar_documentos_agente, ranking_agente, consulta_flexible_agente e
-- historial_precios_agente a las definiciones EXACTAS de producción del
-- 05/10/2026 tras aplicar 20261005100000 (pg_get_functiondef copiado tal
-- cual; md5 comprobado al final) y a sus comentarios. No borra nada ni toca
-- datos ni permisos. La chat-facturas que use count_con_total o
-- primero_por_unidad sigue funcionando (la RPC devolverá {error} para
-- count_con_total y el modelo lo verá), pero conviene volver a desplegar la
-- versión anterior (v58).
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
  v_docs  int := (select count(*) from facturas);
  v_prov  int := (select count(distinct proveedor_normalizado) from facturas);
  v_meses int := (select count(distinct to_char(fecha, 'YYYY-MM')) from facturas);
begin
  if v_docs = 0 then
    return json_build_object(
      'sin_datos', true,
      'aviso', 'No hay ningun documento cargado: 0 significa "sin datos", nunca "no se gasto nada".');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'facturas', (select jsonb_build_object(
                   'n',         count(*),
                   'gasto',     round(coalesce(sum(total), 0)::numeric, 2),
                   'base',      round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',       round(coalesce(sum(iva), 0)::numeric, 2),
                   'sin_total', nullif(count(*) filter (where total is null), 0))
                   from facturas where tipo = 'factura'),
    'albaranes', (select jsonb_build_object(
                   'n',         count(*),
                   'valor',     round(coalesce(sum(total), 0)::numeric, 2),
                   'sin_total', nullif(count(*) filter (where total is null), 0))
                   from facturas where tipo = 'albaran'),
    'documentos_sin_total', docs_sin_total_agente(null, null, null),
    'primera_fecha', (select min(fecha) from facturas),
    'ultima_fecha',  (select max(fecha) from facturas),
    'sin_verificar', (select count(*) from facturas where not coalesce(verificada, false)),
    'con_alertas', (select jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor,
                                                        'alertas', alertas_resumen_agente(f.alertas_validacion))
                                     order by f.fecha, f.id)
                      from facturas f where alertas_resumen_agente(f.alertas_validacion) is not null),
    -- Todos los meses CON documentos (nunca meses vacíos), con año, del más
    -- antiguo al más reciente. Cuenta también los documentos sin total.
    'meses', (select jsonb_agg(to_jsonb(m) order by m.mes)
                from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                             count(*) filter (where tipo = 'factura')                                    as facturas,
                             round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto,
                             nullif(count(*) filter (where tipo = 'factura' and total is null), 0)       as sin_total,
                             nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes,
                             nullif(count(*) filter (where fecha_dudosa_agente(alertas_validacion)), 0)  as fecha_dudosa
                        from facturas
                       group by 1
                       order by 1 desc
                       limit 24) m),
    'meses_truncado', case when v_meses > 24 then true end,
    'top_proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                          from (select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
                                       nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                       round((sum(total) filter (where tipo = 'factura'))::numeric, 2)              as gasto,
                                       nullif(count(*) filter (where tipo = 'factura' and total is null), 0)        as sin_total,
                                       nullif(count(*) filter (where tipo = 'albaran'), 0)                          as albaranes,
                                       round((sum(total) filter (where tipo = 'albaran'))::numeric, 2)              as valor_albaranes
                                  from facturas
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

comment on function public.estadisticas_globales_agente() is
  'Chatbot de facturas: foto global compacta (facturas/albaranes con sin_total, documentos_sin_total, con_alertas, todos los meses con datos y año, top 8 proveedores, 3 últimos documentos con fecha_dudosa).';

-- resumen_periodo_agente(date, date): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.resumen_periodo_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_desde date := p_desde;
  v_hasta date := p_hasta;
  v_docs  int;
  v_prov  int;
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

  select count(*), count(distinct proveedor_normalizado) into v_docs, v_prov
    from facturas where fecha between v_desde and v_hasta;

  return jsonb_strip_nulls(jsonb_build_object(
    'periodo', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'sin_datos', case when v_docs = 0 then true end,
    'aviso', case when v_docs = 0 then
      'No hay documentos cargados entre ' || v_desde || ' y ' || v_hasta
      || ': 0 significa "sin datos", nunca "no se gasto nada".' end,
    'facturas', (select jsonb_build_object(
                   'n',         count(*),
                   'gasto',     round(coalesce(sum(total), 0)::numeric, 2),
                   'base',      round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',       round(coalesce(sum(iva), 0)::numeric, 2),
                   'sin_total', nullif(count(*) filter (where total is null), 0))
                   from facturas where tipo = 'factura' and fecha between v_desde and v_hasta),
    'albaranes', (select jsonb_build_object(
                   'n',         count(*),
                   'valor',     round(coalesce(sum(total), 0)::numeric, 2),
                   'sin_total', nullif(count(*) filter (where total is null), 0))
                   from facturas where tipo = 'albaran' and fecha between v_desde and v_hasta),
    'documentos_sin_total', docs_sin_total_agente(null, v_desde, v_hasta),
    'con_alertas', (select jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor,
                                                        'alertas', alertas_resumen_agente(f.alertas_validacion))
                                     order by f.fecha, f.id)
                      from facturas f
                     where f.fecha between v_desde and v_hasta
                       and alertas_resumen_agente(f.alertas_validacion) is not null),
    -- Solo si el rango abarca más de un mes.
    'meses', case when to_char(v_desde, 'YYYY-MM') <> to_char(v_hasta, 'YYYY-MM') then
               (select jsonb_agg(to_jsonb(m) order by m.mes)
                  from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                               count(*) filter (where tipo = 'factura')                                    as facturas,
                               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto,
                               nullif(count(*) filter (where tipo = 'factura' and total is null), 0)       as sin_total,
                               nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes
                          from facturas where fecha between v_desde and v_hasta
                         group by 1) m)
             end,
    'proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                      from (select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
                                   nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                   round((sum(total) filter (where tipo = 'factura'))::numeric, 2)              as gasto,
                                   nullif(count(*) filter (where tipo = 'factura' and total is null), 0)        as sin_total,
                                   nullif(count(*) filter (where tipo = 'albaran'), 0)                          as albaranes,
                                   round((sum(total) filter (where tipo = 'albaran'))::numeric, 2)              as valor_albaranes
                              from facturas where fecha between v_desde and v_hasta
                             group by proveedor_normalizado
                             order by 3 desc nulls last, 2 desc nulls last, 1
                             limit 10) x),
    'total_proveedores', v_prov,
    'proveedores_truncado', case when v_prov > 10 then true end,
    -- Productos de mayor importe de línea (SIN IVA), sin servicios.
    'productos', (select jsonb_agg(to_jsonb(q) order by q.importe desc nulls last, q.producto)
                    from (select max(pf.nombre)                              as producto,
                                 f.tipo,
                                 count(*)                                    as veces,
                                 round(sum(pf.cantidad)::numeric, 2)         as cantidad,
                                 max(pf.unidad)                              as unidad,
                                 round(sum(pf.total)::numeric, 2)            as importe
                            from productos_factura pf
                            join facturas f on f.id = pf.factura_id
                           where f.fecha between v_desde and v_hasta
                             and not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
                           group by coalesce(pf.nombre_normalizado, lower(pf.nombre)), f.tipo
                           order by 6 desc nulls last, 1
                           limit 8) q),
    'productos_total', (select count(*) from (
                          select 1 from productos_factura pf join facturas f on f.id = pf.factura_id
                           where f.fecha between v_desde and v_hasta
                             and not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
                           group by coalesce(pf.nombre_normalizado, lower(pf.nombre)), f.tipo) s)
  ))::json;
end;
$function$;

comment on function public.resumen_periodo_agente(date, date) is
  'Chatbot de facturas: resumen compacto de un rango (facturas/albaranes con sin_total alineado con estadisticas_globales_agente, documentos_sin_total, con_alertas, meses si abarca varios, top 10 proveedores, top 8 productos sin servicios).';

-- filtrar_documentos_agente(text, text, text, date, date, text, integer): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.filtrar_documentos_agente(p_filtro text DEFAULT 'todos'::text, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'fecha_desc'::text, p_limite integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_filtros constant text[] := array['todos', 'sin_total', 'sin_verificar', 'con_alertas', 'fecha_dudosa'];
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
begin
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
                            'total',     round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2),
                            'sin_total', nullif(count(*) filter (where tipo = 'factura' and total is null), 0)) end,
              'albaranes', case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'albaran'),
                            'valor',     round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2),
                            'sin_total', nullif(count(*) filter (where tipo = 'albaran' and total is null), 0)) end))
       from m),
    (select jsonb_build_object('n', count(*),
              'docs', jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero_documento,
                                                   'proveedor', proveedor, 'fecha', fecha) order by fecha, id))
       from m where total is null having count(*) > 0)
  into v_total, v_filas, v_sumas, v_sint;

  return (jsonb_build_object(
            'criterio', format('filtro=%s%s%s%s%s; orden=%s', v_filtro,
                               case when v_texto is not null then '; texto=' || v_texto else '' end,
                               case when v_tipo is not null then '; tipo=' || v_tipo else '' end,
                               case when p_desde is not null then '; desde=' || p_desde else '' end,
                               case when p_hasta is not null then '; hasta=' || p_hasta else '' end,
                               v_orden),
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim,
            'sumas',       coalesce(v_sumas, '{}'::jsonb))
          -- La lista solo si hay documentos sin total que NO se ven en las filas.
          || case when v_sint is not null and v_filtro <> 'sin_total' and v_total > v_lim
                  then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
         )::json;
end;
$function$;

comment on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) is
  'Chatbot de facturas: documentos por filtro (todos|sin_total|sin_verificar|con_alertas|fecha_dudosa), texto (número, proveedor o CIF), tipo y fechas; sumas de TODO lo filtrado y documentos_sin_total.';

-- ranking_agente(text, text, integer, date, date, text, boolean): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.ranking_agente(p_criterio text, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'desc'::text, p_incluir_servicios boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_criterios constant text[] := array['precio_unitario', 'importe_linea', 'cantidad', 'veces', 'gasto_proveedor', 'importe_documento'];
  v_crit  text := lower(trim(coalesce(p_criterio, '')));
  v_tipo  text := lower(trim(coalesce(p_tipo, '')));
  v_ord   text := lower(trim(coalesce(nullif(p_orden, ''), 'desc')));
  v_lim   int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_serv  boolean := coalesce(p_incluir_servicios, false);
  v_asc   boolean;
  v_filas json;
  v_total int;
  v_excl  json;
  v_sint  jsonb;
  v_txt   text;
begin
  if not v_crit = any(c_criterios) then
    return json_build_object('error', format('Criterio "%s" no valido.', p_criterio), 'permitidos', to_json(c_criterios));
  end if;
  v_tipo := case when v_tipo like 'albar%' then 'albaran'
                 when v_tipo like 'factura%' then 'factura'
                 when v_tipo in ('', 'ambos', 'todos') then null
                 else '#' end;
  if v_tipo = '#' then
    return json_build_object('error', format('Tipo "%s" no valido.', p_tipo), 'permitidos', json_build_array('factura', 'albaran', null));
  end if;
  if v_ord not in ('asc', 'desc') then
    return json_build_object('error', format('Orden "%s" no valido.', p_orden), 'permitidos', json_build_array('asc', 'desc'));
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  v_asc := v_ord = 'asc';

  if v_crit in ('precio_unitario', 'importe_linea') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, pf.unidad, pf.precio_unitario, pf.total,
             f.tipo, f.proveedor, f.numero_documento, f.fecha,
             case when v_crit = 'precio_unitario' then pf.precio_unitario else pf.total end as valor,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))           as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    ),
    validas as (select * from l where valor is not null and valor > 0),
    uno as (  -- una fila por producto: su línea más cara (o más barata)
      select distinct on (clave) *
        from validas
       where v_serv or not servicio
       order by clave,
                case when v_asc then valor end asc,
                case when not v_asc then valor end desc,
                fecha desc, id
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            fecha desc, id) as n,
             count(*) over () as total_filas
        from uno
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',        nombre,
                 'precio_unitario', round(precio_unitario::numeric, case when abs(precio_unitario) < 1 then 4 else 2 end),
                 'cantidad',        cantidad,
                 'unidad',          unidad,
                 'importe',         round(total::numeric, 2),
                 'proveedor',       proveedor,
                 'numero',          numero_documento,
                 'fecha',           fecha,
                 'tipo',            tipo)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'mayores', (select json_agg(json_build_object('producto', s.nombre, 'valor', round(s.valor::numeric, 2)) order by s.valor desc)
                                from (select nombre, valor from validas where servicio order by valor desc limit 3) s))
              end
         from validas where servicio)
    into v_total, v_filas, v_excl;

    v_txt := case when v_crit = 'precio_unitario'
                  then 'Precio unitario de linea SIN IVA'
                  else 'Importe de linea (cantidad x precio) SIN IVA' end
             || '; una fila por producto con su valor mas ' || case when v_asc then 'bajo' else 'alto' end
             || '; sin valores vacios ni a 0'
             || case when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit in ('cantidad', 'veces') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, pf.unidad, pf.total,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    ),
    g as (
      -- cantidad: se agrupa por producto Y unidad (no se suman kg con unidades)
      select max(nombre)                                                  as producto,
             max(unidad)                                                  as unidad,
             count(*)                                                     as veces,
             case when v_crit = 'cantidad' or count(distinct unidad) <= 1
                  then round(sum(cantidad)::numeric, 2) end              as cantidad,
             round(sum(total)::numeric, 2)                                as importe,
             case when v_crit = 'cantidad' then sum(cantidad) else count(*)::numeric end as valor
        from l
       where (v_serv or not servicio)
         and (v_crit = 'veces' or (cantidad is not null and cantidad > 0))
       group by clave, case when v_crit = 'cantidad' then unidad end
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            importe desc nulls last, producto) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto', producto, 'cantidad', cantidad, 'unidad', unidad,
                 'veces', veces, 'importe', importe)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'nombres', (select json_agg(distinct s.nombre) from (select nombre from l where servicio limit 10) s))
              end
         from l where servicio)
    into v_total, v_filas, v_excl;

    v_txt := case when v_crit = 'cantidad'
                  then 'Suma de cantidad por producto y unidad (no se mezclan kg con unidades)'
                  else 'Numero de veces (lineas) que aparece cada producto' end
             || case when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit = 'gasto_proveedor' then
    v_tipo := coalesce(v_tipo, 'factura');
    with g as (
      select coalesce(max(proveedor), proveedor_normalizado)              as proveedor,
             count(*)                                                     as documentos,
             round(coalesce(sum(total), 0)::numeric, 2)                   as importe,
             nullif(count(*) filter (where total is null), 0)             as sin_total,
             coalesce(sum(total), 0)                                      as valor
        from facturas
       where tipo = v_tipo
         and (p_desde is null or fecha >= p_desde)
         and (p_hasta is null or fecha <= p_hasta)
       group by proveedor_normalizado
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            documentos desc, proveedor) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'proveedor', proveedor, 'documentos', documentos, 'importe', importe, 'sin_total', sin_total)) order by n), '[]'::json)
         from o where n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_txt := case when v_tipo = 'factura'
                  then 'Gasto por proveedor: suma del total (IVA incluido) de sus facturas'
                  else 'Valor de albaranes por proveedor (IVA incluido; NO es gasto facturado)' end
             || '; los documentos sin total no suman';

  else  -- importe_documento
    with o as (
      select f.id, f.total,
             row_number() over (order by case when v_asc then f.total end asc,
                                         case when not v_asc then f.total end desc,
                                         f.fecha desc, f.id) as n,
             count(*) over () as total_filas
        from facturas f
       where f.total is not null
         and (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
         from o join facturas f on f.id = o.id where o.n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_txt := 'Documentos por total (IVA incluido)'
             || case when v_tipo is null then ', facturas y albaranes mezclados (mira "tipo")' else '' end
             || '; los documentos sin total no entran';
  end if;

  if p_desde is not null or p_hasta is not null then
    v_txt := v_txt || format('; fechas %s a %s', coalesce(p_desde::text, 'inicio'), coalesce(p_hasta::text, 'hoy'));
  end if;

  return (jsonb_build_object(
            'criterio',    v_txt,
            'orden',       v_ord,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_excl is not null then jsonb_build_object('servicios_excluidos', v_excl) else '{}'::jsonb end
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
         )::json;
end;
$function$;

comment on function public.ranking_agente(text, text, integer, date, date, text, boolean) is
  'Chatbot de facturas: rankings precio_unitario | importe_linea | cantidad | veces | gasto_proveedor | importe_documento. Devuelve criterio, filas, total_filas, truncado, servicios_excluidos y documentos_sin_total.';

-- consulta_flexible_agente(jsonb): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.consulta_flexible_agente(p jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_claves   constant text[] := array['fuente', 'metricas', 'agrupar', 'filtros', 'orden_por', 'orden_dir', 'limite'];
  c_filtros  constant text[] := array['desde', 'hasta', 'proveedor', 'tipo', 'numero', 'producto', 'con_total',
                                      'verificada', 'con_alertas', 'excluir_servicios', 'importe_min', 'importe_max'];
  c_agrupar  constant text[] := array['proveedor', 'mes', 'anio', 'tipo', 'producto', 'unidad', 'verificada', 'alerta', 'dia_semana'];
  c_met_doc  constant text[] := array['count_documentos',
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
  v_from     text;
  v_alerta   boolean := false;
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

  -- Métricas ----------------------------------------------------------------
  v_val := p -> 'metricas';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'metricas tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
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
    v_orden := v_metricas[1];
  elsif not (v_orden = any(v_metricas) or v_orden = any(v_agrupar)) then
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
                             v_sel := v_sel || format('coalesce(max(f.proveedor), f.proveedor_normalizado) as %I', k);
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
    end case;
  end loop;

  foreach k in array v_metricas loop
    if k = 'count_documentos' then
      v_expr := 'count(distinct f.id)';
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
      if v_col like 'l.%' and not v_col = any(v_lin_nul) then v_lin_nul := v_lin_nul || v_col; end if;
    end if;
    v_sel := v_sel || format('%s as %I', v_expr, k);
  end loop;

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
    || ' from (select to_jsonb(g) as fila, row_number() over (order by g.%1$I %2$s nulls last) as ord, count(*) over () as n'
    || ' from (select %3$s from %4$s where %5$s %6$s) g) t'
    || ' where t.ord <= %7$s',
    v_orden,
    case when v_dir = 'asc' then 'asc' else 'desc' end,
    array_to_string(v_sel, ', '),
    v_from,
    array_to_string(v_where, ' and '),
    case when cardinality(v_grp) > 0 then 'group by ' || array_to_string(v_grp, ', ') else '' end,
    v_lim);

  begin
    execute v_sql into v_filas, v_total
      using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;

    -- Avisos de cifras parciales en el mismo ámbito filtrado.
    if v_fuente = 'documentos' and v_import then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total is null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_sint
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
    elsif v_fuente = 'lineas' and cardinality(v_lin_nul) > 0 then
      execute format(
        'select count(*)::int from productos_factura l join facturas f on f.id = l.factura_id where %s and (%s)',
        array_to_string(v_where, ' and '),
        array_to_string(array(select c || ' is null' from unnest(v_lin_nul) c), ' or '))
        into v_lsin
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
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
                        || case when v_fuente = 'lineas' and cardinality(v_lin_nul) > 0
                                then '; precios e importes de linea SIN IVA'
                                when v_import then '; total con IVA, subtotal sin IVA' else '' end
                        || case when v_alerta then '; un documento con varias alertas cuenta en cada una' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when coalesce(v_lsin, 0) > 0 then jsonb_build_object('lineas_sin_dato', v_lsin) else '{}'::jsonb end
         )::json;
end;
$function$;

comment on function public.consulta_flexible_agente(jsonb) is
  'Chatbot de facturas: agregados a medida con LISTA BLANCA (fuente, métricas, agrupaciones, filtros, orden, límite ≤ 50). Los valores van como parámetros de EXECUTE … USING; lo no permitido devuelve {error, permitidos}.';

-- historial_precios_agente(text, integer): definición exacta de producción (05/10/2026)
CREATE OR REPLACE FUNCTION public.historial_precios_agente(p_producto text, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
  v_busq    text := normalizar_nombre_producto(coalesce(p_producto, ''));
  v_limite  integer := least(greatest(coalesce(p_limite, 30), 1), 100);
begin
  if v_busq is null or v_busq = '' then
    return json_build_object(
      'error', 'Falta el nombre del producto.',
      'compras', '[]'::json);
  end if;

  with recientes as (
    select
      pf.id                                   as linea_id,
      pf.nombre,
      pf.nombre_normalizado,
      f.proveedor,
      f.proveedor_normalizado,
      f.tipo                                  as tipo_documento,
      f.numero_documento,
      f.fecha,
      pf.cantidad,
      pf.unidad,
      round(pf.precio_unitario::numeric, 4)   as precio_unitario,
      round(pf.total::numeric, 2)             as total_linea,
      coalesce(jsonb_array_length(f.alertas_validacion), 0)   as alertas_pendientes,
      exists (
        select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
        where a ->> 'severidad' = 'alta'
      )                                                       as alertas_severidad_alta,
      count(*) over ()                        as lineas_totales
    from productos_factura pf
    join facturas f on f.id = pf.factura_id
    where pf.precio_unitario is not null
      and pf.nombre_normalizado like '%' || v_busq || '%'
    order by f.fecha desc, pf.id desc
    limit v_limite
  ),
  compras as (
    select * from recientes
  ),
  marco as (
    select
      count(*)::int                            as n,
      coalesce(max(lineas_totales), 0)::int    as lineas_totales,
      min(fecha)                               as f_min,
      max(fecha)                               as f_max,
      count(distinct fecha)::int               as fechas_distintas,
      count(distinct nombre_normalizado)::int  as variantes
    from compras
  ),
  extremos as (
    select
      m.n, m.f_min, m.f_max, m.fechas_distintas,
      round(avg(c.precio_unitario) filter (where c.fecha = m.f_min), 4) as precio_inicial,
      round(avg(c.precio_unitario) filter (where c.fecha = m.f_max), 4) as precio_actual,
      count(*) filter (where c.fecha = m.f_min)::int                    as lineas_inicial,
      count(*) filter (where c.fecha = m.f_max)::int                    as lineas_actual
    from compras c cross join marco m
    group by m.n, m.f_min, m.f_max, m.fechas_distintas
  )
  select json_build_object(
    'producto_consultado', p_producto,
    'compras_devueltas',   (select n from marco),
    'compras_encontradas', (select lineas_totales from marco),
    'truncado',            (select lineas_totales > n from marco),
    'aviso', (
      select case when m.lineas_totales > m.n then
        'RESULTADO PARCIAL: hay ' || m.lineas_totales || ' lineas de este producto en la base de datos y '
        || 'solo se devuelven las ' || m.n || ' MAS RECIENTES (desde ' || m.f_min || '). '
        || 'No presentes esto como el historico completo ni sumes las lineas para dar un total.'
      end from marco m),
    'rango_devuelto', (
      select json_build_object('desde', f_min, 'hasta', f_max,
                               'fechas_distintas', fechas_distintas) from marco),
    'variantes_distintas', (select variantes from marco),
    'nota_coincidencia', (
      select case when m.variantes > 1 then
        'La busqueda es por coincidencia parcial del nombre y ha mezclado ' || m.variantes
        || ' articulos distintos. Desglosa por articulo en vez de dar un unico precio medio.'
      end from marco m),
    'por_proveedor', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select
          max(proveedor)                       as proveedor,
          tipo_documento,
          count(*)                             as veces,
          round(min(precio_unitario), 4)       as precio_min,
          round(max(precio_unitario), 4)       as precio_max,
          round(avg(precio_unitario), 4)       as precio_medio,
          min(fecha)                           as primera_compra,
          max(fecha)                           as ultima_compra
        from compras
        group by proveedor_normalizado, tipo_documento
        order by precio_medio asc
      ) x
    ),
    'variacion', (
      select case
        when e.n < 2 or e.fechas_distintas < 2 then null
        else json_build_object(
          'precio_inicial',   e.precio_inicial,
          'fecha_inicial',    e.f_min,
          'lineas_inicial',   e.lineas_inicial,
          'precio_actual',    e.precio_actual,
          'fecha_actual',     e.f_max,
          'lineas_actual',    e.lineas_actual,
          'diferencia',       round(e.precio_actual - e.precio_inicial, 4),
          'variacion_pct',    case when e.precio_inicial is null or e.precio_inicial = 0 then null
                                   else round((e.precio_actual - e.precio_inicial) / e.precio_inicial * 100, 2) end,
          'metodo', 'Media del precio unitario en la fecha mas antigua frente a la media en la mas reciente del rango devuelto.'
        ) end
      from extremos e),
    'nota_variacion', (
      select case
        when e.n < 2 then
          'Solo hay una linea de compra: no hay evolucion de precio que medir.'
        when e.fechas_distintas < 2 then
          'Todas las lineas devueltas son de la misma fecha (' || e.f_min || '): '
          || 'no hay evolucion de precio que medir. Las diferencias de precio entre ellas son '
          || 'articulos o formatos distintos del mismo documento, NO una subida ni una bajada.'
      end from extremos e),
    'compras', (
      select coalesce(json_agg(row_to_json(y)), '[]'::json)
      from (
        select nombre, proveedor, tipo_documento, numero_documento, fecha,
               cantidad, unidad, precio_unitario, total_linea,
               alertas_pendientes, alertas_severidad_alta
        from compras order by fecha asc, linea_id asc
      ) y)
  ) into resultado;

  return coalesce(resultado, json_build_object('compras_encontradas', 0, 'compras', '[]'::json));
end;
$function$;

comment on function public.historial_precios_agente(text, integer) is
  'Evolucion del precio unitario de un producto y comparativa entre proveedores. Devuelve las lineas MAS RECIENTES (nunca las mas antiguas) y marca el truncado. Cada compra lleva alertas_pendientes/alertas_severidad_alta del documento del que sale (facturas.alertas_validacion, T5), para poder avisar de una compra con importes marcados como sospechosos en vez de tratarla como un dato mas de la serie. Lee productos_factura (dato vivo), no historial_precios (insert-only, se desfasa al editar).';

do $$
declare
  v_md5 text;
begin
  select md5(replace(pg_get_functiondef('public.estadisticas_globales_agente()'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '9a95d568453b584e01f68052d0f49e5d' then
    raise exception 'ROLLBACK ABORTADO: estadisticas_globales_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.resumen_periodo_agente(date,date)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '6056d34c3cd2fd42ed7cd5a5988f3ebc' then
    raise exception 'ROLLBACK ABORTADO: resumen_periodo_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.filtrar_documentos_agente(text,text,text,date,date,text,integer)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> 'f341d28debfaca0a5dfa5536bf78b8ab' then
    raise exception 'ROLLBACK ABORTADO: filtrar_documentos_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.ranking_agente(text,text,integer,date,date,text,boolean)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '5273952166174d88dc0bd52585821db0' then
    raise exception 'ROLLBACK ABORTADO: ranking_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.consulta_flexible_agente(jsonb)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '8b335f097ebe1997f07cd3af2eac232e' then
    raise exception 'ROLLBACK ABORTADO: consulta_flexible_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.historial_precios_agente(text,integer)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '31ae3c4b281ed06fa477c5309ff83004' then
    raise exception 'ROLLBACK ABORTADO: historial_precios_agente no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
end;
$$;

commit;

select 'chatbot_facturas_ajustes: revertida' as resultado;
