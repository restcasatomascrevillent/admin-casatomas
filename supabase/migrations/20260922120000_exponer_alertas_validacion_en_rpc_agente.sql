-- ============================================================================
--  Facturas y albaranes · Exponer alertas_validacion en las RPC del chatbot
-- ----------------------------------------------------------------------------
--  GAP detectado en revision tecnica (2026-09-22): ninguna de las RPC
--  `*_agente` que usa `chat-facturas` cruza `facturas.alertas_validacion`
--  (columna anadida por T5, migracion 20260919110000, rellenada por
--  `validar_cordura_factura`). El chatbot puede citar el precio del albaran
--  38 (Joselito, 12 jamones a 9.316,67 €/ud, 120.580 € -- casi seguro un x10
--  de OCR) sin decir en ningun momento que ese documento tiene 3 alertas de
--  severidad alta. Solo lo ve quien abre el documento en el panel.
--
--  Anade DOS campos compactos por documento/linea -- NO el array
--  `alertas_validacion` completo (que lleva un `detalle` jsonb anidado por
--  alerta), para no inflar el tamano de los resultados que ya recorta
--  `MAX_CHARS_RESULTADO_TOOL` (6000 caracteres) en
--  supabase/functions/chat-facturas/index.ts:
--
--    alertas_pendientes      integer  -- cuantas alertas tiene el documento (0 = ninguna)
--    alertas_severidad_alta  boolean  -- true si alguna de esas alertas es 'alta'
--
--  Mismo criterio que ya se uso para `verificada` en la migracion
--  20260919100000: un campo corto que el modelo pueda leer y mencionar, no
--  el objeto entero.
--
--  Se tocan las 6 RPC que consume `chat-facturas` (ejecutarTool()):
--    buscar_facturas_agente, buscar_documentos_agente, buscar_productos_agente,
--    historial_precios_agente, resumen_periodo_agente, estadisticas_globales_agente.
--
--  Ninguna cambia de aridad (mismos parametros): CREATE OR REPLACE basta, no
--  hace falta DROP. Los GRANT/REVOKE de la migracion anterior sobreviven a un
--  REPLACE (a diferencia de un DROP+CREATE), pero se repiten aqui igualmente
--  por el mismo motivo defensivo que ya usan las migraciones previas.
--
--  De regalo, `buscar_productos_agente` (fuera del alcance de la migracion
--  20260919100000 y por tanto la unica de las 6 que aun no lo tenia) recibe
--  tambien `verificada`, con la misma logica que las otras cinco.
--
--  PENDIENTE, FUERA DEL ALCANCE DE ESTA MIGRACION: el `systemPrompt()` de
--  `supabase/functions/chat-facturas/index.ts` (regla 8) le dice al modelo
--  que mencione `verificada: false` cuando sea relevante, pero no dice nada
--  de `alertas_pendientes`/`alertas_severidad_alta`. Sin ese aviso explicito
--  el dato llega al modelo pero nada garantiza que lo use. Añadir algo como:
--
--    "8b. Si un documento trae "alertas_severidad_alta": true o
--    "alertas_pendientes" mayor que 0, el sistema detecto importes que no
--    cuadran al cargarlo (posible error de OCR). Avisalo con la misma
--    naturalidad que el punto 8, especialmente si vas a citar ese importe."
--
--  Editar ese fichero (Edge Function, fuera de src/ y de supabase/migrations)
--  queda fuera del permiso de escritura de esta revision.
--
--  Idempotente. NO toca ningun dato de negocio, solo el SELECT de las RPC.
--  NO APLICADA: escrita para revision. No se ha podido ejecutar ni probar
--  contra la base de datos real -- el acceso a Supabase (MCP) devuelve
--  Unauthorized en el momento de escribir esto. Revisar con cuidado antes de
--  aplicarla (`supabase db push` o pegarla en el SQL editor).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · buscar_facturas_agente
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.buscar_facturas_agente(
  embedding_query vector,
  limite          integer          default 8,
  umbral          double precision default 0.25,
  p_tipo          text             default null
)
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
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

revoke all on function public.buscar_facturas_agente(vector, integer, double precision, text) from public, anon;
grant execute on function public.buscar_facturas_agente(vector, integer, double precision, text) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · buscar_documentos_agente
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.buscar_documentos_agente(
  p_texto  text    default null,
  p_tipo   text    default null,
  p_desde  date    default null,
  p_hasta  date    default null,
  p_limite integer default 20
)
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  resultado json;
  v_tipo    text := nullif(lower(trim(coalesce(p_tipo, ''))), '');
  v_texto   text := nullif(trim(coalesce(p_texto, '')), '');
  v_num     text;
  v_limite  integer := least(greatest(coalesce(p_limite, 20), 1), 100);
begin
  if v_tipo in ('albaran', 'albarán', 'albaranes') then
    v_tipo := 'albaran';
  elsif v_tipo in ('factura', 'facturas', 'invoice') then
    v_tipo := 'factura';
  else
    v_tipo := null;
  end if;

  v_num := nullif(regexp_replace(lower(coalesce(v_texto, '')), '[^a-z0-9]', '', 'g'), '');
  v_num := nullif(regexp_replace(v_num, '^0+', ''), '');

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into resultado
  from (
    select
      f.id,
      f.tipo,
      f.proveedor,
      f.cif,
      f.numero_documento,
      f.fecha,
      to_char(f.fecha, 'YYYY-MM')        as mes,
      f.subtotal,
      f.iva,
      round(f.total::numeric, 2)         as total,
      f.observaciones,
      f.resumen,
      f.verificada,
      f.drive_url,
      coalesce(jsonb_array_length(f.alertas_validacion), 0)    as alertas_pendientes,
      exists (
        select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
        where a ->> 'severidad' = 'alta'
      )                                                        as alertas_severidad_alta,
      (select count(*) from productos_factura pf where pf.factura_id = f.id) as num_lineas
    from facturas f
    where (v_tipo is null or f.tipo = v_tipo)
      and (p_desde is null or f.fecha >= p_desde)
      and (p_hasta is null or f.fecha <= p_hasta)
      and (
        v_texto is null
        or f.numero_documento ilike '%' || v_texto || '%'
        or (v_num is not null
            and regexp_replace(regexp_replace(lower(f.numero_documento), '[^a-z0-9]', '', 'g'), '^0+', '')
                like '%' || v_num || '%')
        or normalizar_proveedor(coalesce(f.proveedor, '')) like '%' || normalizar_texto(v_texto) || '%'
        or lower(coalesce(f.cif, '')) like '%' || lower(v_texto) || '%'
      )
    order by f.fecha desc, f.id desc
    limit v_limite
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

comment on function public.buscar_documentos_agente(text, text, date, date, integer) is
  'Consulta exacta de documentos por numero, proveedor o CIF, con filtro opcional de tipo y rango de fechas. Sin embeddings: complementa a buscar_facturas_agente cuando la pregunta es concreta. alertas_pendientes/alertas_severidad_alta resumen facturas.alertas_validacion (T5).';

revoke all on function public.buscar_documentos_agente(text, text, date, date, integer) from public, anon;
grant execute on function public.buscar_documentos_agente(text, text, date, date, integer) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · buscar_productos_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Unica de las 6 que hasta ahora no devolvia ni `verificada` ni ninguna
--  senal de `alertas_validacion`: quedo fuera del alcance de 20260919100000
--  ("se revisan aparte"). Se anaden ambas cosas aqui, con el mismo criterio
--  que las otras cinco.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.buscar_productos_agente(
  embedding_query vector(1536),
  limite          int   default 12,
  umbral          float default 0.25
)
returns json
language plpgsql
stable
set search_path to 'public'
as $function$
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

comment on function public.buscar_productos_agente(vector, int, float) is
  'Busqueda semantica de lineas de producto, con el documento de origen. verificada/alertas_pendientes/alertas_severidad_alta describen el documento PADRE (facturas), no la linea: una linea puede venir de un documento con importes marcados como sospechosos por validar_cordura_factura (T5).';

revoke all on function public.buscar_productos_agente(vector, int, float) from public, anon;
grant execute on function public.buscar_productos_agente(vector, int, float) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · historial_precios_agente
-- ────────────────────────────────────────────────────────────────────────────
--  El caso que motiva esta migracion entera: "¿ha subido el jamon?" contra el
--  albaran 38 (Joselito, x10 de OCR) debe poder avisar de que esa compra en
--  concreto esta marcada, no solo listar el precio disparatado como un dato
--  mas de la serie.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.historial_precios_agente(
  p_producto text,
  p_limite   integer default 30
)
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
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

revoke all on function public.historial_precios_agente(text, integer) from public, anon;
grant execute on function public.historial_precios_agente(text, integer) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  5 · resumen_periodo_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Se anade `documentos_con_alertas` dentro de `facturas` Y de `albaranes`:
--  el albaran 38 es un ALBARAN, no una factura, y una version que solo
--  avisara del lado `facturas` seguiria sin decir nada de el aqui.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.resumen_periodo_agente(
  p_desde date default null,
  p_hasta date default null
)
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
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

revoke all on function public.resumen_periodo_agente(date, date) from public, anon;
grant execute on function public.resumen_periodo_agente(date, date) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
--  6 · estadisticas_globales_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Se anade `documentos_con_alertas_pendientes` junto a `documentos_sin_verificar`,
--  contando sobre TODOS los documentos (facturas y albaranes), igual que ese.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.estadisticas_globales_agente()
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
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

revoke all on function public.estadisticas_globales_agente() from public, anon;
grant execute on function public.estadisticas_globales_agente() to authenticated, service_role;
