-- ============================================================================
--  Chatbot de facturas · Arreglo de las dos RPC que devolvian cifras falsas
-- ----------------------------------------------------------------------------
--  Supersede a `20260919100000_facturas_busqueda_y_herramientas_chatbot.sql`
--  para TRES funciones. Debe aplicarse DESPUES de ella (de ahi el timestamp):
--  si se aplicasen en orden inverso, la migracion antigua volveria a instalar
--  las versiones con bug.
--
--  B-8 · `historial_precios_agente` informaba un precio obsoleto como "actual":
--        1. `order by fecha asc limit 30` -> el CTE contenia las 30 compras MAS
--           ANTIGUAS, asi que "precio_actual" era el de la 30ª compra mas
--           antigua y las recientes se descartaban en silencio.
--        2. `min()` en el extremo inicial y `max()` en el final -> sesgo al
--           alza sistematico: cualquier producto con varias lineas el mismo dia
--           "subia" aunque no hubiera evolucion ninguna.
--        3. `compras_encontradas` contaba sobre el CTE ya truncado, asi que
--           nunca habia senal de truncado.
--
--  B-9 · `resumen_periodo_agente` convertia "el mes pasado" en el total
--        historico: `coalesce(p_desde, (select min(fecha) from facturas))`
--        sustituia una fecha nula por TODO el historico y devolvia esa cifra
--        sin marcar que el periodo no era el pedido. Una fecha que el modelo
--        no supo formatear (p. ej. "2026-03") llegaba como NULL y el dueno
--        recibia el gasto de toda la vida presentado como el de marzo.
--
--  A-4 · Ninguna de las tres marcaba el truncado de sus topes internos, asi que
--        el modelo sumaba un top-15 y lo llamaba "el total".
--  A-5 · Las tres devuelven un OBJETO, no un array, asi que el guard de "lista
--        vacia" de la Edge Function nunca disparaba y `0,00 €` se leia como
--        "no gastaste nada" en vez de "no hay datos cargados".
--  M-3 · `historial_precios_agente` agrupaba por `proveedor` en crudo, asi que
--        `CANDELA S.L.` y `Candela SL` salian como dos proveedores distintos
--        justo en la herramienta que responde "¿quien me lo vende mas barato?".
--
--  FUENTE DE DATOS (sin cambios, y a proposito): se lee `productos_factura` +
--  `facturas`, NO la tabla `historial_precios`. `historial_precios` existe y se
--  llena (26 filas hoy) con el trigger `actualizar_historial_precios()`, pero es
--  AFTER INSERT y solo de facturas: si alguien corrige un precio desde el panel
--  la tabla queda desfasada, y los precios que llegan en albaran no entran nunca.
--  `productos_factura` es el dato vivo.
--
--  Idempotente. NO toca ningun dato de negocio: solo reemplaza funciones.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 1 · B-8 — historial_precios_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Cambios:
--   1. Se toman las `p_limite` lineas MAS RECIENTES (`order by fecha desc`) y
--      se reordenan ascendentes solo para presentar la serie. El tope ya no se
--      come los datos recientes, que son los que interesan.
--   2. `count(*) over ()` se evalua antes del LIMIT: cuenta TODAS las
--      coincidencias, no las devueltas. De ahi salen `compras_encontradas`,
--      `truncado` y el `aviso`.
--   3. Extremos simetricos: `avg()` en los dos lados. Antes `min()` abajo y
--      `max()` arriba inventaban una subida a partir de dos lineas del MISMO
--      documento y el MISMO dia.
--   4. Si todas las lineas caen en la misma fecha, `variacion` es NULL y se
--      explica por que: sin dos fechas no hay evolucion que medir.
--   5. `variacion_pct` y `diferencia` se calculan en SQL para que el modelo no
--      tenga que hacer la aritmetica.
--   6. Agrupacion por `proveedor_normalizado` (M-3), mostrando `max(proveedor)`.
--   7. `variantes_distintas` + `nota_coincidencia`: `LIKE '%...%'` hace que
--      "aceite" mezcle oliva, girasol y motor. Ahora se dice.
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
    return json_build_object(
      'error', 'Falta el nombre del producto.',
      'compras', '[]'::json);
  end if;

  with recientes as (
    -- Las v_limite lineas MAS RECIENTES. `count(*) over ()` se evalua ANTES del
    -- LIMIT, asi que cuenta todas las coincidencias reales de la base de datos.
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
    -- Extremos SIMETRICOS: media del precio unitario en la fecha mas antigua
    -- frente a la media en la mas reciente. Usar min() en un extremo y max()
    -- en el otro producia un sesgo al alza sistematico.
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
               cantidad, unidad, precio_unitario, total_linea
        from compras order by fecha asc, linea_id asc
      ) y)
  ) into resultado;

  return coalesce(resultado, json_build_object('compras_encontradas', 0, 'compras', '[]'::json));
end;
$function$;

comment on function public.historial_precios_agente(text, integer) is
  'Evolucion del precio unitario de un producto y comparativa entre proveedores. Devuelve las lineas MAS RECIENTES (nunca las mas antiguas) y marca el truncado. precio_inicial y precio_actual son medias simetricas de la fecha mas antigua y la mas reciente: usar min/max cruzados inventaba subidas. Lee productos_factura (dato vivo), no historial_precios (insert-only, se desfasa al editar).';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 2 · B-9 — resumen_periodo_agente
-- ────────────────────────────────────────────────────────────────────────────
--  Cambios:
--   1. Una fecha ausente ya NO se sustituye por el historico completo: es un
--      error explicito que el modelo puede corregir reintentando. Silencio ->
--      error. El `coalesce(p_desde, min(fecha))` era el bug.
--   2. Se valida tambien `desde > hasta`.
--   3. `periodo` incluye `confirmado: true` para que el modelo pueda comprobar
--      que el rango devuelto es el que pidio.
--   4. Marcas de truncado en los dos tops (15 proveedores, 15 productos).
--   5. Se anaden `base_imponible` e `iva_total` a facturas: hasta ahora solo se
--      devolvia `total` (IVA incluido) y nada lo aclaraba, asi que "gasto" era
--      ambiguo. Ahora el modelo puede responder las dos preguntas y decir cual
--      esta dando.
--   6. `sin_datos`: distingue "no hay documentos cargados en ese periodo" de
--      "se gasto 0,00 €", que para el dueno son conclusiones opuestas.
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
  v_desde date := p_desde;
  v_hasta date := p_hasta;
  v_docs  int;
begin
  -- B-9: sin rango NO se responde. Antes se sustituia por todo el historico y
  -- se devolvia esa cifra como si fuera la del periodo preguntado.
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
    -- `confirmado` deja explicito que el rango devuelto es el que se pidio:
    -- nunca hay sustitucion silenciosa.
    'periodo', json_build_object('desde', v_desde, 'hasta', v_hasta, 'confirmado', true),
    'sin_datos', (v_docs = 0),
    'aviso_sin_datos', case when v_docs = 0 then
      'No hay NINGUN documento cargado entre ' || v_desde || ' y ' || v_hasta || '. '
      || 'Los importes de 0,00 € significan "no hay datos cargados de ese periodo", '
      || 'NUNCA "no se gasto nada". Dilo asi.' end,
    'facturas', json_build_object(
      'num_documentos',  (select count(*) from docs where tipo = 'factura'),
      'gasto_total',     (select round(coalesce(sum(total), 0)::numeric, 2) from docs where tipo = 'factura'),
      'base_imponible',  (select round(coalesce(sum(subtotal), 0)::numeric, 2) from docs where tipo = 'factura'),
      'iva_total',       (select round(coalesce(sum(iva), 0)::numeric, 2) from docs where tipo = 'factura'),
      'ticket_medio',    (select round(coalesce(avg(total), 0)::numeric, 2) from docs where tipo = 'factura'),
      'nota_iva', 'gasto_total es el importe TOTAL con IVA incluido. base_imponible es sin IVA. Di siempre cual de los dos estas dando.'
    ),
    -- Los albaranes se informan APARTE y nunca se suman al gasto: son entregas,
    -- no importes facturados, y sumarlos falsearia la cifra.
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
  'Gasto, proveedores y productos de un rango de fechas, con facturas y albaranes SIEMPRE separados. Las dos fechas son OBLIGATORIAS: una fecha nula devuelve error, nunca el historico completo (ese fallo convertia "el mes pasado" en "desde siempre"). Marca el truncado de sus dos tops y distingue "sin datos" de "cero gasto".';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 3 · A-4/A-5 — estadisticas_globales_agente: marcar topes y vacio
-- ────────────────────────────────────────────────────────────────────────────
--  Solo se anaden metadatos: los topes (6 meses, 8 proveedores, 10 productos,
--  5 documentos) recortaban en silencio y el modelo presentaba el recorte como
--  el conjunto. El calculo de las cifras no cambia.
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
      'total_facturas',          (select count(*) from facturas where tipo = 'factura'),
      'total_albaranes',         (select count(*) from facturas where tipo = 'albaran'),
      'total_productos',         (select count(*) from productos_factura),
      'gasto_total_facturado',   (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'factura'),
      'base_imponible_total',    (select round(coalesce(sum(subtotal), 0)::numeric, 2) from facturas where tipo = 'factura'),
      'valor_albaranes',         (select round(coalesce(sum(total), 0)::numeric, 2) from facturas where tipo = 'albaran'),
      'nota_albaranes',          'valor_albaranes son entregas recibidas, NO gasto facturado. Nunca sumar ambas cifras.',
      'nota_iva',                'gasto_total_facturado lleva el IVA incluido; base_imponible_total es sin IVA. Di cual estas dando.',
      'fecha_primera_factura',   (select min(fecha) from facturas),
      'fecha_ultima_factura',    (select max(fecha) from facturas),
      'documentos_sin_verificar',(select count(*) from facturas where coalesce(verificada, false) = false)
    ),

    'gastos_mensuales', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (select * from vista_gastos_mensuales limit 6) t
    ),
    'gastos_mensuales_truncado', (v_meses > 6),

    -- Top proveedores calculado aqui, con facturas y albaranes separados: la
    -- vista_proveedores_resumen los suma y el albaran 38 (120.580 €, fallo de
    -- OCR) falseaba el ranking entero.
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

    -- Una sola nota para los cuatro recortes: es lo que impedia que el modelo
    -- supiera que estaba mirando un extracto y no el conjunto.
    'aviso_topes',
      'LISTAS PARCIALES: gastos_mensuales son los ultimos 6 meses, top_proveedores los 8 de mayor '
      || 'gasto (de ' || v_proveedores || ' en total), productos_mas_comprados los 10 mayores y '
      || 'ultimos_documentos los 5 mas recientes. Son extractos, no el conjunto: no los sumes para '
      || 'dar totales (usa resumen_general) ni afirmes que algo no existe porque no aparezca aqui.'

  );
end;
$function$;

comment on function public.estadisticas_globales_agente() is
  'Foto global del negocio sin filtros, con facturas y albaranes separados. Marca explicitamente que sus cuatro listas son extractos truncados y distingue "sin datos" de "cero gasto".';


-- ────────────────────────────────────────────────────────────────────────────
--  BLOQUE 4 · Permisos
-- ────────────────────────────────────────────────────────────────────────────
--  El DROP de los bloques 1 y 2 se lleva por delante los GRANT, asi que hay que
--  rehacerlos. Mismo criterio que la migracion anterior: la anon key es publica
--  y viaja en el bundle del panel, asi que estas RPC no pueden ser ejecutables
--  por anon. Quien las invoca es la Edge Function con el service role.
-- ────────────────────────────────────────────────────────────────────────────

revoke all on function public.historial_precios_agente(text, integer)  from public, anon;
revoke all on function public.resumen_periodo_agente(date, date)       from public, anon;
revoke all on function public.estadisticas_globales_agente()           from public, anon;

grant execute on function public.historial_precios_agente(text, integer)  to authenticated, service_role;
grant execute on function public.resumen_periodo_agente(date, date)       to authenticated, service_role;
grant execute on function public.estadisticas_globales_agente()           to authenticated, service_role;
