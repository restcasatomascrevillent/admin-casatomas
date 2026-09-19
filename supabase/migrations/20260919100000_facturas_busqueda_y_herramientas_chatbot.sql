-- ============================================================================
--  Facturas y albaranes · Busqueda vectorial utilizable + herramientas del
--  chatbot contable
-- ----------------------------------------------------------------------------
--  T2  Indice HNSW sobre la columna que SI tiene datos (`facturas.embedding`)
--      y RPC de busqueda que puede aprovecharlo.
--  T3  Herramientas nuevas para el agente: consulta determinista por numero de
--      documento/proveedor/fecha, evolucion de precios y resumen por periodo.
--
--  Idempotente: se puede aplicar mas de una vez sin efectos secundarios.
--  NO toca ningun dato de negocio.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 1 · T2 — Indices vectoriales
-- ────────────────────────────────────────────────────────────────────────────
--  `idx_facturas_embedding` era HNSW sobre `embedding_observaciones`, columna
--  NULL en el 100 % de las filas, mientras los vectores viven en `embedding`.
--  Ademas la RPC ordenaba por `COALESCE(embedding, embedding_observaciones)`,
--  una expresion que ningun indice del esquema cubre: ni siquiera con
--  `enable_seqscan = off` el planificador podia evitar el Seq Scan + Sort.
--
--  Verificado en produccion (2026-09-19):
--    ANTES  ->  Sort  ->  Seq Scan on facturas
--    AHORA  ->  Index Scan using idx_facturas_embedding_hnsw
--                 Order By: (embedding <=> $1)
--
--  Con 5 documentos el tiempo es identico; la diferencia es O(n) frente a
--  O(log n) en cuanto entren cientos o miles de facturas.
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists idx_facturas_embedding_hnsw
  on public.facturas using hnsw (embedding vector_cosine_ops);

-- Indice inservible: columna vacia, solo coste de escritura y de almacenamiento.
drop index if exists public.idx_facturas_embedding;


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 2 · T2/T3 — buscar_facturas_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Cambios:
--   1. ORDER BY / WHERE sobre `f.embedding` directamente -> usa el indice HNSW.
--      Es equivalente al COALESCE anterior porque `embedding_observaciones`
--      esta vacia en el 100 % de las filas (verificado: 5/5 con `embedding`,
--      0/5 con `embedding_observaciones`).
--   2. Parametro `p_tipo` opcional ('factura' | 'albaran') para que el agente
--      pueda acotar la busqueda a un solo tipo de documento. El dueño gestiona
--      facturas y albaranes de forma distinta y hasta ahora el modelo no tenia
--      forma de filtrar: recibia los dos mezclados y tenia que descartarlos el.
--   3. Se añade `verificada` al resultado para que el asistente pueda avisar de
--      que un dato no esta revisado.
--
--  Se usa DROP + CREATE (no CREATE OR REPLACE) porque cambia la aridad.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.buscar_facturas_agente(vector, integer, double precision);
drop function if exists public.buscar_facturas_agente(vector, integer, double precision, text);

create function public.buscar_facturas_agente(
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
  -- Normaliza sinonimos que el modelo puede enviar.
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
  'Busqueda semantica de documentos para el chatbot de facturas. Ordena por distancia coseno sobre facturas.embedding para poder usar el indice HNSW. p_tipo acota a factura o albaran.';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 3 · T3 — buscar_documentos_agente  (herramienta nueva)
-- ────────────────────────────────────────────────────────────────────────────
--  POR QUE: la busqueda semantica no sirve para preguntas exactas. El dueño
--  tiene un papel en la mano y pregunta "¿que tengo de la factura F/25011959?"
--  o "enseñame todo lo de Candela de enero". Un embedding del resumen no
--  encuentra de forma fiable un numero de documento ni acota un mes: el modelo
--  acababa respondiendo con el documento "mas parecido", que es justo el tipo
--  de respuesta inventada que hay que evitar.
--
--  Esta herramienta es DETERMINISTA: no usa embeddings (y por tanto tampoco
--  gasta una llamada extra a OpenAI por consulta).
--
--  El texto se busca en numero de documento (tolerando ceros a la izquierda y
--  separadores), proveedor normalizado y CIF.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.buscar_documentos_agente(text, text, date, date, integer);

create function public.buscar_documentos_agente(
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

  -- Numero "desnudo": sin ceros a la izquierda ni separadores, para que "8"
  -- encuentre "00008" y "25011959" encuentre "F/25011959".
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
  'Consulta exacta de documentos por numero, proveedor o CIF, con filtro opcional de tipo y rango de fechas. Sin embeddings: complementa a buscar_facturas_agente cuando la pregunta es concreta.';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 4 · T3 — historial_precios_agente  (herramienta nueva)
-- ────────────────────────────────────────────────────────────────────────────
--  POR QUE: "¿ha subido el jamon?" / "¿cuanto pagaba antes por los calamares?"
--  es la pregunta mas natural del dueño de un restaurante y hoy NO se puede
--  contestar: `buscar_productos_agente` devuelve lineas sueltas ordenadas por
--  similitud, sin serie temporal ni variacion.
--
--  FUENTE DE DATOS: se lee `productos_factura` + `facturas`, NO la tabla
--  `historial_precios`. Motivo: el trigger `actualizar_historial_precios()` es
--  AFTER INSERT, asi que si alguien corrige un precio desde el panel la tabla
--  queda desfasada; ademas solo registra facturas, nunca albaranes, y el dueño
--  tambien recibe precios en albaran. `productos_factura` es el dato vivo.
--  (`historial_precios` sigue existiendo y llenandose: 26 filas hoy. El informe
--   HISTORIAL_PRECIOS_ANALISIS.md que dice que se elimino es FALSO.)
--
--  Agrupa por producto normalizado + proveedor y devuelve la serie de compras
--  mas el resumen de variacion.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.historial_precios_agente(text, integer);

create function public.historial_precios_agente(
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
    return json_build_object('error', 'Falta el nombre del producto', 'compras', '[]'::json);
  end if;

  with compras as (
    select
      pf.nombre,
      pf.nombre_normalizado,
      f.proveedor,
      f.tipo                              as tipo_documento,
      f.numero_documento,
      f.fecha,
      pf.cantidad,
      pf.unidad,
      round(pf.precio_unitario::numeric, 4) as precio_unitario,
      round(pf.total::numeric, 2)           as total_linea
    from productos_factura pf
    join facturas f on f.id = pf.factura_id
    where pf.precio_unitario is not null
      and pf.nombre_normalizado like '%' || v_busq || '%'
    order by f.fecha asc, pf.id asc
    limit v_limite
  )
  select json_build_object(
    'producto_consultado', p_producto,
    'compras_encontradas', (select count(*) from compras),
    -- Resumen por proveedor: permite responder "¿quien me lo vende mas barato?"
    'por_proveedor', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select
          proveedor,
          tipo_documento,
          count(*)                             as veces,
          round(min(precio_unitario), 4)       as precio_min,
          round(max(precio_unitario), 4)       as precio_max,
          round(avg(precio_unitario), 4)       as precio_medio,
          min(fecha)                           as primera_compra,
          max(fecha)                           as ultima_compra
        from compras
        group by proveedor, tipo_documento
        order by precio_medio asc
      ) x
    ),
    -- Variacion entre la compra mas antigua y la mas reciente.
    'variacion', (
      select case when count(*) < 2 then null else json_build_object(
        'precio_inicial',  round(min(precio_unitario) filter (where fecha = (select min(fecha) from compras)), 4),
        'fecha_inicial',   (select min(fecha) from compras),
        'precio_actual',   round(max(precio_unitario) filter (where fecha = (select max(fecha) from compras)), 4),
        'fecha_actual',    (select max(fecha) from compras)
      ) end
      from compras
    ),
    'compras', (select coalesce(json_agg(row_to_json(compras)), '[]'::json) from compras)
  ) into resultado;

  return coalesce(resultado, json_build_object('compras', '[]'::json));
end;
$function$;

comment on function public.historial_precios_agente(text, integer) is
  'Evolucion del precio unitario de un producto a lo largo del tiempo y comparativa entre proveedores. Lee productos_factura (dato vivo), no la tabla historial_precios (insert-only, se desfasa al editar).';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 5 · T3 — resumen_periodo_agente  (herramienta nueva)
-- ────────────────────────────────────────────────────────────────────────────
--  POR QUE: "¿cuanto gaste en enero?", "¿que compre el mes pasado?",
--  "¿que proveedor me costo mas este trimestre?". Hoy solo existe
--  `estadisticas_globales_agente`, que es GLOBAL y sin parametros: devuelve
--  6 meses fijos de `vista_gastos_mensuales` y nada acotable. El modelo no
--  podia responder por periodo sin inventarse el filtrado.
--
--  Separa SIEMPRE facturas de albaranes: un albaran no es un gasto facturado y
--  sumarlos juntos es justo el error que hace que el albaran 38 (120.580 €,
--  fallo de OCR) domine cualquier ranking.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.resumen_periodo_agente(date, date);

create function public.resumen_periodo_agente(
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
  v_desde date := coalesce(p_desde, (select min(fecha) from facturas));
  v_hasta date := coalesce(p_hasta, (select max(fecha) from facturas));
begin
  with docs as (
    select * from facturas
    where fecha between v_desde and v_hasta
  ),
  lineas as (
    select pf.*, d.tipo as tipo_documento, d.proveedor, d.fecha as fecha_doc
    from productos_factura pf
    join docs d on d.id = pf.factura_id
  )
  select json_build_object(
    'periodo', json_build_object('desde', v_desde, 'hasta', v_hasta),
    'facturas', json_build_object(
      'num_documentos', (select count(*) from docs where tipo = 'factura'),
      'gasto_total',    (select round(coalesce(sum(total), 0)::numeric, 2) from docs where tipo = 'factura'),
      'ticket_medio',   (select round(coalesce(avg(total), 0)::numeric, 2) from docs where tipo = 'factura')
    ),
    -- Los albaranes se informan APARTE y nunca se suman al gasto: son entregas,
    -- no importes facturados, y facturarlos dos veces falsearia la cifra.
    'albaranes', json_build_object(
      'num_documentos',  (select count(*) from docs where tipo = 'albaran'),
      'valor_declarado', (select round(coalesce(sum(total), 0)::numeric, 2) from docs where tipo = 'albaran'),
      'nota', 'Valor de las entregas recibidas. NO es gasto facturado: no sumar a gasto_total.'
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
    'por_proveedor', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select coalesce(max(proveedor), proveedor_normalizado)                as proveedor,
               count(*) filter (where tipo = 'factura')                       as num_facturas,
               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2) as gasto_facturado,
               count(*) filter (where tipo = 'albaran')                       as num_albaranes,
               round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2) as valor_albaranes
        from docs group by proveedor_normalizado
        order by gasto_facturado desc
        limit 15
      ) x
    ),
    'productos_mas_comprados', (
      select coalesce(json_agg(row_to_json(x)), '[]'::json)
      from (
        select max(nombre)                                as producto,
               tipo_documento,
               count(*)                                   as veces,
               round(coalesce(sum(cantidad), 0)::numeric, 3) as cantidad_total,
               max(unidad)                                as unidad,
               round(avg(precio_unitario)::numeric, 4)    as precio_medio,
               round(coalesce(sum(total), 0)::numeric, 2) as importe_total
        from lineas
        group by nombre_normalizado, tipo_documento
        order by importe_total desc nulls last
        limit 15
      ) x
    )
  ) into resultado;

  return coalesce(resultado, '{}'::json);
end;
$function$;

comment on function public.resumen_periodo_agente(date, date) is
  'Gasto, proveedores y productos de un rango de fechas, con facturas y albaranes SIEMPRE separados. Complementa a estadisticas_globales_agente, que es global y sin parametros.';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 6 · T3 — estadisticas_globales_agente: separar factura de albaran
-- ────────────────────────────────────────────────────────────────────────────
--  `top_proveedores` salia de `vista_proveedores_resumen`, que suma facturas Y
--  albaranes en el mismo importe. Con el albaran 38 (120.580 € por un error de
--  OCR) el ranking de proveedores queda completamente falseado y el asistente
--  respondia que Joselito es, con diferencia, el mayor proveedor del negocio.
--  Se calcula aqui, con las dos cifras separadas. La vista NO se modifica.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.estadisticas_globales_agente()
returns json
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
begin
  return json_build_object(

    'resumen_general', json_build_object(
      'total_facturas',          (select count(*) from facturas where tipo = 'factura'),
      'total_albaranes',         (select count(*) from facturas where tipo = 'albaran'),
      'total_productos',         (select count(*) from productos_factura),
      'gasto_total_facturado',   (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'factura'),
      'valor_albaranes',         (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'albaran'),
      'nota_albaranes',          'valor_albaranes son entregas recibidas, NO gasto facturado. Nunca sumar ambas cifras.',
      'fecha_primera_factura',   (select min(fecha) from facturas),
      'fecha_ultima_factura',    (select max(fecha) from facturas),
      'documentos_sin_verificar',(select count(*) from facturas where coalesce(verificada, false) = false)
    ),

    'gastos_mensuales', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_gastos_mensuales limit 6) t
    ),

    -- Top proveedores calculado aqui, con facturas y albaranes separados.
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

    'productos_mas_comprados', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_productos_top limit 10) t
    ),

    'ultimos_documentos', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_ultimos_documentos limit 5) t
    )

  );
end;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 7 · Permisos
-- ────────────────────────────────────────────────────────────────────────────
--  Las RPC `*_agente` existentes tienen EXECUTE para PUBLIC/anon desde la epoca
--  de n8n (la anon key es publica y viaja en el bundle del panel, asi que
--  cualquiera podia sacar la contabilidad entera con una llamada). Las que esta
--  migracion recrea o crea quedan restringidas a usuarios autenticados y al
--  service role, que es quien las invoca desde la Edge Function.
--
--  Las otras dos (`buscar_productos_agente`, `verificar_duplicado_factura`)
--  quedan fuera del alcance de esta migracion: se revisan aparte.
-- ────────────────────────────────────────────────────────────────────────────

revoke all on function public.buscar_facturas_agente(vector, integer, double precision, text) from public, anon;
revoke all on function public.buscar_documentos_agente(text, text, date, date, integer)        from public, anon;
revoke all on function public.historial_precios_agente(text, integer)                          from public, anon;
revoke all on function public.resumen_periodo_agente(date, date)                               from public, anon;
revoke all on function public.estadisticas_globales_agente()                                   from public, anon;

grant execute on function public.buscar_facturas_agente(vector, integer, double precision, text) to authenticated, service_role;
grant execute on function public.buscar_documentos_agente(text, text, date, date, integer)        to authenticated, service_role;
grant execute on function public.historial_precios_agente(text, integer)                          to authenticated, service_role;
grant execute on function public.resumen_periodo_agente(date, date)                               to authenticated, service_role;
grant execute on function public.estadisticas_globales_agente()                                   to authenticated, service_role;
