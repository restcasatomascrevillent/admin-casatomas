set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Chatbot de Facturas: herramientas SQL precisas y compactas,         ##
-- ##   documentos sin total, ranking, filtros, detalle y consulta flexible ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (prueba del 05/10/2026, engram `facturas/chatbot-prueba-2026-10`)
--   27 preguntas a `chat-facturas` verificadas contra SQL. Fallos que vienen
--   de las RPC:
--   · Totales NULL contados como 0 sin aviso: `resumen_periodo_agente` daba
--     Luga (id 54, ML/101511) con gasto 0 y 6 facturas en enero; la vista
--     `vista_gastos_mensuales` (filtra total IS NOT NULL) contaba 5. Mismo
--     caso con Salazones Garre (id 39, F/25011959) en diciembre.
--   · Sin herramienta de ranking: «el producto más caro» salía 450 € (caja
--     regalo) en vez de 519,40 € (jamón; TRABAJOS 598 € es un servicio).
--   · Las alertas solo llegaban como contador: el chat dijo «importes que no
--     cuadran» del id 52, cuya alerta es `fecha_ausente`.
--   · «Cada mes» sin año: `gastos_mensuales` salía de la vista (sin los
--     documentos sin total) y cortado a 6 meses.
--   Indicaciones del dueño (05/10): herramientas SQL precisas que devuelvan
--   el resultado YA AGREGADO y mínimo (ahorrar tokens), y una herramienta
--   comodín SEGURA (lista blanca, nunca SQL libre) para lo no previsto.
--
-- QUÉ CAMBIA
--   Ayudantes nuevos (IMMUTABLE/STABLE, sin efectos):
--   · es_linea_servicio_agente(text): portes, transporte, gestión y
--     logística, punto verde, canon, trabajos, mano de obra, servicios,
--     desplazamiento, reparación, instalación, montaje… Misma lista que
--     `esLineaDeServicio` de src/components/facturas/shared/formatters.tsx
--     MÁS trabajos/mano de obra/servicio/desplazamiento/reparación/
--     instalación/montaje (los servicios reales de MR FRIOSAT y CANDELA).
--   · alertas_resumen_agente(jsonb) -> [{codigo, mensaje}] o NULL.
--   · fecha_dudosa_agente(jsonb): hay alerta `fecha_ausente` (la fecha
--     guardada es la de subida).
--   · documento_compacto_agente(facturas, detalle): fila mínima de un
--     documento {id, tipo, numero, proveedor, fecha, total, sin_total?,
--     fecha_dudosa?, alertas?}.
--   · docs_sin_total_agente(tipo, desde, hasta) -> {n, docs[]} o NULL.
--   Reescritas (MISMA firma y tipo de retorno json; las usa SOLO
--   chat-facturas, comprobado con grep en src/ y supabase/functions/):
--   · estadisticas_globales_agente(): facturas/albaranes con `sin_total`,
--     `documentos_sin_total`, `con_alertas` (código + mensaje), `meses`
--     (TODOS los meses con datos, con año, hasta 24, contando también los
--     documentos sin total), top 8 proveedores con `sin_total`, 3 últimos
--     documentos con `fecha_dudosa`. Ya no usa vista_gastos_mensuales.
--   · resumen_periodo_agente(desde, hasta): mismos errores de fechas;
--     conteos alineados con estadisticas (n cuenta TODOS los documentos y
--     `sin_total` dice cuántos no suman), `documentos_sin_total`,
--     `con_alertas`, top 10 proveedores, top 8 productos SIN servicios.
--   · buscar_facturas_agente / buscar_productos_agente: misma búsqueda
--     semántica, filas compactas (sin observaciones, drive_url, cif…) y
--     alertas con código + mensaje.
--   Herramientas nuevas:
--   · ranking_agente(criterio, tipo, limite, desde, hasta, orden,
--     incluir_servicios): precio_unitario | importe_linea | cantidad |
--     veces | gasto_proveedor | importe_documento. Devuelve `criterio`,
--     excluye servicios por defecto (y dice cuáles), `documentos_sin_total`.
--   · filtrar_documentos_agente(filtro, texto, tipo, desde, hasta, orden,
--     limite): todos | sin_total | sin_verificar | con_alertas |
--     fecha_dudosa, por número/proveedor/CIF, con `sumas` de TODO lo
--     filtrado (no solo de las filas devueltas).
--   · detalle_documento_agente(id, numero): un documento con sus líneas y
--     `suma_lineas` (SIN IVA).
--   · buscar_productos_texto_agente(texto, limite): búsqueda exacta por
--     palabras del nombre normalizado; chat-facturas la prueba ANTES que la
--     semántica y se ahorra la llamada de embeddings si encuentra algo.
--   · consulta_flexible_agente(jsonb): agregados con LISTA BLANCA de fuente,
--     métricas, agrupaciones, filtros y orden. Los valores del usuario van
--     SIEMPRE como parámetros (EXECUTE … USING); los nombres de columna y
--     expresiones salen de constantes de esta función. Lo que no está en la
--     lista blanca devuelve {"error": …, "permitidos": […]}.
--     Nota sobre statement_timeout: un `SET statement_timeout` dentro de la
--     función (cláusula SET o set_config) NO arma el temporizador de la
--     sentencia en curso (verificado en producción el 05/10/2026 con
--     pg_sleep). El techo real es el de la conexión de PostgREST
--     (authenticator: 8 s) y la forma acotada de las consultas (2 tablas
--     fijas, ≤ 3 agrupaciones, ≤ 4 métricas, ≤ 50 filas).
--   Todas: SECURITY INVOKER, `search_path = public`, EXECUTE solo para
--   authenticated y service_role (igual que las *_agente actuales).
--   No toca datos, tablas, vistas ni `normalizar_proveedor`.
--   buscar_documentos_agente e historial_precios_agente NO cambian
--   (buscar_documentos sale de las herramientas del chat: la sustituye
--   filtrar_documentos; la función SQL se conserva).
--
-- ESTADO VERIFICADO (producción, 05/10/2026, md5 de pg_get_functiondef)
--   estadisticas_globales_agente()                          e69e6fe3962c2565ccd259897a2adf57
--   resumen_periodo_agente(date,date)                       6fa4d19db2e699ece264ea3a535bccf0
--   buscar_facturas_agente(vector,integer,float8,text)      9685f84f0f4b310d38fe4e3574e6721c
--   buscar_productos_agente(vector,integer,float8)          8055a25809e189447bb739f786c90dae
--   19 documentos (12 facturas, 7 albaranes); sin total: 38 (albarán de
--   entrega sin precios), 39 y 54; id 52 con alerta fecha_ausente.
--   Si el estado no es ese (y la migración no está ya aplicada), ABORTA sin
--   cambiar nada.
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005100000_chatbot_facturas_ranking_sin_total.sql
--      Tiene que imprimir «chatbot_facturas_ranking_sin_total: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/chatbot_facturas_ranking_sin_total_test.sql
--   3. npx supabase functions deploy chat-facturas
--      (ANTES de desplegar la función: la nueva chat-facturas llama a las
--      RPC nuevas; desplegarla sin la migración deja el chat roto. La
--      chat-facturas ACTUAL sigue funcionando con la migración aplicada,
--      aunque con los campos nuevos.)
--   Deshacer: supabase/rollbacks/20261005100000_chatbot_facturas_ranking_sin_total_ROLLBACK.sql
--   (y volver a desplegar la chat-facturas anterior).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Comprobaciones previas
-- ---------------------------------------------------------------------------
do $$
declare
  v_md5 text;
begin
  if to_regprocedure('public.consulta_flexible_agente(jsonb)') is not null then
    raise notice 'Ya aplicada: se vuelven a crear las funciones (idempotente).';
    return;
  end if;

  select md5(pg_get_functiondef('public.estadisticas_globales_agente()'::regprocedure)) into v_md5;
  if v_md5 <> 'e69e6fe3962c2565ccd259897a2adf57' then
    raise exception 'MIGRACIÓN ABORTADA: estadisticas_globales_agente() no es la verificada el 05/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.resumen_periodo_agente(date,date)'::regprocedure)) into v_md5;
  if v_md5 <> '6fa4d19db2e699ece264ea3a535bccf0' then
    raise exception 'MIGRACIÓN ABORTADA: resumen_periodo_agente(date,date) no es la verificada (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.buscar_facturas_agente(vector,integer,double precision,text)'::regprocedure)) into v_md5;
  if v_md5 <> '9685f84f0f4b310d38fe4e3574e6721c' then
    raise exception 'MIGRACIÓN ABORTADA: buscar_facturas_agente no es la verificada (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(pg_get_functiondef('public.buscar_productos_agente(vector,integer,double precision)'::regprocedure)) into v_md5;
  if v_md5 <> '8055a25809e189447bb739f786c90dae' then
    raise exception 'MIGRACIÓN ABORTADA: buscar_productos_agente no es la verificada (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  if to_regprocedure('public.normalizar_proveedor(text)') is null
     or to_regprocedure('public.normalizar_nombre_producto(text)') is null
     or to_regprocedure('public.normalizar_texto(text)') is null then
    raise exception 'MIGRACIÓN ABORTADA: faltan normalizar_proveedor/normalizar_nombre_producto/normalizar_texto. No se ha cambiado nada.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Ayudantes
-- ---------------------------------------------------------------------------

-- Línea de servicio o cargo (no mercancía). Recibe preferentemente
-- `nombre_normalizado` (minúsculas sin tildes); tolera tildes por si llega el
-- nombre crudo.
create or replace function public.es_linea_servicio_agente(p_nombre text)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select coalesce(lower(p_nombre), '') ~
    '\m(portes?|transportes?|env[ií]os?|gastos? de (env[ií]o|gesti[oó]n|transporte)|gesti[oó]n y log[ií]stica|log[ií]stica|punto verde|ecoembes|canon|recargos?|fianzas?|dep[oó]sitos?|trabajos?|mano de obra|servicios?|desplazamientos?|reparaci[oó]n(es)?|instalaci[oó]n(es)?|montajes?)\M'
$function$;

comment on function public.es_linea_servicio_agente(text) is
  'true si la línea es un servicio o cargo (portes, gestión y logística, trabajos, mano de obra, servicio…), no mercancía. Lista de formatters.tsx (esLineaDeServicio) ampliada. La usan ranking_agente, resumen_periodo_agente y consulta_flexible_agente.';

-- Alertas de validación en forma compacta: [{codigo, mensaje}] o NULL.
create or replace function public.alertas_resumen_agente(p_alertas jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select case
    when jsonb_typeof(p_alertas) = 'array' and jsonb_array_length(p_alertas) > 0 then
      (select jsonb_agg(jsonb_build_object('codigo', a ->> 'codigo', 'mensaje', left(a ->> 'mensaje', 180)))
         from jsonb_array_elements(p_alertas) a)
  end
$function$;

comment on function public.alertas_resumen_agente(jsonb) is
  'Resume facturas.alertas_validacion en [{codigo, mensaje}] (o NULL si no hay alertas) para el chatbot.';

-- La fecha guardada es la de subida (el documento no traía fecha impresa).
create or replace function public.fecha_dudosa_agente(p_alertas jsonb)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select jsonb_typeof(p_alertas) = 'array'
     and exists (select 1 from jsonb_array_elements(p_alertas) a where a ->> 'codigo' = 'fecha_ausente')
$function$;

comment on function public.fecha_dudosa_agente(jsonb) is
  'true si el documento tiene la alerta fecha_ausente: su fecha es la de subida, no la del documento.';

-- Fila mínima de un documento. Las claves opcionales solo aparecen cuando
-- aplican (jsonb_strip_nulls) para no gastar tokens en "false"/null.
create or replace function public.documento_compacto_agente(p_doc public.facturas, p_detalle boolean default false)
returns jsonb
language sql
stable
set search_path = public
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',           p_doc.id,
    'tipo',         p_doc.tipo,
    'numero',       p_doc.numero_documento,
    'proveedor',    p_doc.proveedor,
    'fecha',        p_doc.fecha,
    'total',        round(p_doc.total::numeric, 2),
    'sin_total',    case when p_doc.total is null then true end,
    'fecha_dudosa', case when public.fecha_dudosa_agente(p_doc.alertas_validacion) then true end,
    'alertas',      public.alertas_resumen_agente(p_doc.alertas_validacion),
    'base',         case when p_detalle then round(p_doc.subtotal::numeric, 2) end,
    'iva',          case when p_detalle then round(p_doc.iva::numeric, 2) end,
    'cif',          case when p_detalle then p_doc.cif end,
    'verificada',   case when p_detalle then coalesce(p_doc.verificada, false) end,
    'resumen',      case when p_detalle then left(p_doc.resumen, 300) end
  ))
$function$;

comment on function public.documento_compacto_agente(public.facturas, boolean) is
  'Documento en forma mínima para el chatbot {id, tipo, numero, proveedor, fecha, total, sin_total?, fecha_dudosa?, alertas?}; con p_detalle añade base, iva, cif, verificada y resumen.';

-- Documentos SIN total de un ámbito: {n, docs:[{id,tipo,numero,proveedor,fecha}]} o NULL.
create or replace function public.docs_sin_total_agente(p_tipo text default null, p_desde date default null, p_hasta date default null)
returns jsonb
language sql
stable
set search_path = public
as $function$
  select jsonb_build_object(
           'n', count(*),
           'docs', jsonb_agg(jsonb_build_object('id', f.id, 'tipo', f.tipo, 'numero', f.numero_documento,
                                                'proveedor', f.proveedor, 'fecha', f.fecha) order by f.fecha, f.id))
    from public.facturas f
   where f.total is null
     and (p_tipo is null or f.tipo = p_tipo)
     and (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
  having count(*) > 0
$function$;

comment on function public.docs_sin_total_agente(text, date, date) is
  'Documentos sin total (no suman en ninguna cifra) de un tipo y rango; NULL si no hay. Si n > 0 la cifra del chatbot es PARCIAL.';

-- ---------------------------------------------------------------------------
-- 2. estadisticas_globales_agente() — reescrita, misma firma
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_globales_agente()
returns json
language plpgsql
stable
set search_path = public
as $function$
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

-- ---------------------------------------------------------------------------
-- 3. resumen_periodo_agente(desde, hasta) — reescrita, misma firma
-- ---------------------------------------------------------------------------
create or replace function public.resumen_periodo_agente(p_desde date default null::date, p_hasta date default null::date)
returns json
language plpgsql
stable
set search_path = public
as $function$
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

-- ---------------------------------------------------------------------------
-- 4. Búsquedas semánticas — mismas firmas, filas compactas
-- ---------------------------------------------------------------------------
create or replace function public.buscar_facturas_agente(embedding_query vector, limite integer default 8, umbral double precision default 0.25, p_tipo text default null::text)
returns json
language plpgsql
stable
set search_path = public
as $function$
declare
  resultado json;
  v_tipo    text := nullif(lower(trim(coalesce(p_tipo, ''))), '');
begin
  if v_tipo in ('albaran', 'albarán', 'albaranes', 'albaranés') then
    v_tipo := 'albaran';
  elsif v_tipo in ('factura', 'facturas', 'invoice') then
    v_tipo := 'factura';
  else
    v_tipo := null;
  end if;

  select coalesce(json_agg(t.fila order by t.distancia), '[]'::json) into resultado
  from (
    select
      documento_compacto_agente(f)
        || jsonb_strip_nulls(jsonb_build_object(
             'resumen',   left(f.resumen, 200),
             'similitud', round((1 - (f.embedding <=> embedding_query))::numeric, 3))) as fila,
      f.embedding <=> embedding_query                                                 as distancia
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

create or replace function public.buscar_productos_agente(embedding_query vector, limite integer default 12, umbral double precision default 0.25)
returns json
language plpgsql
stable
set search_path = public
as $function$
declare
  resultado json;
begin
  select coalesce(json_agg(t.fila order by t.distancia), '[]'::json) into resultado
  from (
    select
      jsonb_strip_nulls(jsonb_build_object(
        'producto',   pf.nombre,
        'cantidad',   pf.cantidad,
        'unidad',     pf.unidad,
        'precio',     round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),
        'importe',    round(pf.total::numeric, 2),
        'servicio',   case when es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) then true end,
        'proveedor',  f.proveedor,
        'numero',     f.numero_documento,
        'fecha',      f.fecha,
        'tipo',       f.tipo,
        'fecha_dudosa', case when fecha_dudosa_agente(f.alertas_validacion) then true end,
        'alertas_doc', alertas_resumen_agente(f.alertas_validacion),
        'similitud',  round((1 - (pf.embedding <=> embedding_query))::numeric, 3))) as fila,
      pf.embedding <=> embedding_query                                            as distancia
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

comment on function public.buscar_facturas_agente(vector, integer, double precision, text) is
  'Chatbot de facturas: búsqueda semántica de documentos (orden por distancia coseno, índice HNSW). Filas compactas de documento_compacto_agente + resumen (200 caracteres) + similitud; alertas con código y mensaje.';

comment on function public.buscar_productos_agente(vector, integer, double precision) is
  'Chatbot de facturas: búsqueda semántica de líneas de producto con su documento. precio e importe de línea SIN IVA; servicio=true en portes/trabajos/…; alertas_doc y fecha_dudosa son del documento PADRE.';

-- Búsqueda EXACTA por palabras del nombre (sin embeddings). Todas las
-- palabras de ≥ 3 letras tienen que aparecer; plural simple tolerado.
create or replace function public.buscar_productos_texto_agente(p_texto text, p_limite integer default 12)
returns json
language plpgsql
stable
set search_path = public
as $function$
declare
  v_lim    int := least(greatest(coalesce(p_limite, 12), 1), 50);
  v_pal    text[];
  resultado json;
begin
  select coalesce(array_agg(case when length(w) >= 5 and w ~ 's$' then left(w, -1) else w end), '{}')
    into v_pal
    from regexp_split_to_table(coalesce(normalizar_nombre_producto(coalesce(p_texto, '')), ''), '\s+') w
   where length(w) >= 3;

  if cardinality(v_pal) = 0 then
    return '[]'::json;
  end if;

  select coalesce(json_agg(t.fila order by t.fecha desc, t.id desc), '[]'::json) into resultado
  from (
    select pf.id, f.fecha,
      jsonb_strip_nulls(jsonb_build_object(
        'producto',   pf.nombre,
        'cantidad',   pf.cantidad,
        'unidad',     pf.unidad,
        'precio',     round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),
        'importe',    round(pf.total::numeric, 2),
        'servicio',   case when es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) then true end,
        'proveedor',  f.proveedor,
        'numero',     f.numero_documento,
        'fecha',      f.fecha,
        'tipo',       f.tipo,
        'fecha_dudosa', case when fecha_dudosa_agente(f.alertas_validacion) then true end,
        'alertas_doc', alertas_resumen_agente(f.alertas_validacion))) as fila
    from productos_factura pf
    join facturas f on f.id = pf.factura_id
    where not exists (
      select 1 from unnest(v_pal) p
       where coalesce(pf.nombre_normalizado, lower(pf.nombre)) not like '%' || p || '%')
    order by f.fecha desc, pf.id desc
    limit v_lim
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

comment on function public.buscar_productos_texto_agente(text, integer) is
  'Chatbot de facturas: líneas cuyo nombre normalizado contiene TODAS las palabras buscadas (sin embeddings). chat-facturas la usa antes que buscar_productos_agente.';

-- ---------------------------------------------------------------------------
-- 5. ranking_agente
-- ---------------------------------------------------------------------------
create or replace function public.ranking_agente(
  p_criterio          text,
  p_tipo              text    default null,
  p_limite            integer default 10,
  p_desde             date    default null,
  p_hasta             date    default null,
  p_orden             text    default 'desc',
  p_incluir_servicios boolean default false)
returns json
language plpgsql
stable
set search_path = public
as $function$
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

-- ---------------------------------------------------------------------------
-- 6. filtrar_documentos_agente
-- ---------------------------------------------------------------------------
create or replace function public.filtrar_documentos_agente(
  p_filtro text    default 'todos',
  p_texto  text    default null,
  p_tipo   text    default null,
  p_desde  date    default null,
  p_hasta  date    default null,
  p_orden  text    default 'fecha_desc',
  p_limite integer default 10)
returns json
language plpgsql
stable
set search_path = public
as $function$
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

-- ---------------------------------------------------------------------------
-- 7. detalle_documento_agente
-- ---------------------------------------------------------------------------
create or replace function public.detalle_documento_agente(p_id bigint default null, p_numero text default null)
returns json
language plpgsql
stable
set search_path = public
as $function$
declare
  v_numero text := nullif(trim(coalesce(p_numero, '')), '');
  v_num    text;
  v_ids    bigint[];
  v_id     bigint;
  v_lineas int;
begin
  if p_id is null and v_numero is null then
    return json_build_object('error', 'Falta el parametro: pasa el id o el numero del documento.');
  end if;

  if p_id is not null then
    v_ids := array(select id from facturas where id = p_id);
  else
    v_num := nullif(regexp_replace(regexp_replace(lower(v_numero), '[^a-z0-9]', '', 'g'), '^0+', ''), '');
    v_ids := array(
      select id from facturas
       where lower(trim(numero_documento)) = lower(v_numero)
          or (v_num is not null
              and regexp_replace(regexp_replace(lower(coalesce(numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '') = v_num)
       order by fecha desc, id desc
       limit 6);
    if cardinality(v_ids) = 0 and v_num is not null and length(v_num) >= 4 then
      v_ids := array(
        select id from facturas
         where regexp_replace(regexp_replace(lower(coalesce(numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '')
               like '%' || v_num || '%'
         order by fecha desc, id desc
         limit 6);
    end if;
  end if;

  if cardinality(v_ids) = 0 then
    return json_build_object('encontrado', false,
      'aviso', 'No existe ningun documento con ese numero o id. No busques ni propongas uno parecido.');
  end if;
  if cardinality(v_ids) > 1 then
    return json_build_object('encontrado', false,
      'aviso', 'Varios documentos coinciden: pregunta cual o vuelve a llamar con su id.',
      'candidatos', (select json_agg(documento_compacto_agente(f) order by f.fecha desc, f.id desc)
                       from facturas f where f.id = any(v_ids)));
  end if;

  v_id := v_ids[1];
  select count(*) into v_lineas from productos_factura where factura_id = v_id;

  return (jsonb_build_object(
    'encontrado', true,
    'documento', (select documento_compacto_agente(f, true) from facturas f where f.id = v_id),
    'lineas', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                         'producto', pf.nombre,
                         'cantidad', pf.cantidad,
                         'unidad',   pf.unidad,
                         'precio',   round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),
                         'importe',  round(pf.total::numeric, 2),
                         'servicio', case when es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) then true end))
                       order by pf.id), '[]'::jsonb)
                 from (select * from productos_factura where factura_id = v_id order by id limit 40) pf),
    'total_lineas', v_lineas,
    'truncado', v_lineas > 40,
    'suma_lineas', (select round(sum(total)::numeric, 2) from productos_factura where factura_id = v_id),
    'nota', 'precio, importe y suma_lineas son de linea, SIN IVA; total del documento con IVA'))::json;
end;
$function$;

comment on function public.detalle_documento_agente(bigint, text) is
  'Chatbot de facturas: un documento (por id o número exacto/normalizado) con base, iva, alertas y hasta 40 líneas; suma_lineas SIN IVA.';

-- ---------------------------------------------------------------------------
-- 8. consulta_flexible_agente — comodín con LISTA BLANCA
-- ---------------------------------------------------------------------------
--  Entrada (jsonb):
--   {"fuente": "documentos"|"lineas",
--    "metricas": ["sum_total", "count_documentos", ...],   // ≤ 4
--    "agrupar":  ["proveedor", "mes", ...],                // ≤ 3
--    "filtros":  {"desde": "2025-12-01", "proveedor": "osborne", ...},
--    "orden_por": "<una métrica o agrupación>", "orden_dir": "asc"|"desc",
--    "limite": 10}                                          // 1..50
--  Seguridad: los NOMBRES (fuente, métricas, agrupaciones, orden) se validan
--  contra constantes y el SQL se arma solo con fragmentos de este fichero;
--  los VALORES (fechas, textos, números, booleanos) viajan como parámetros
--  $1..$12 de EXECUTE … USING y nunca se concatenan.
create or replace function public.consulta_flexible_agente(p jsonb)
returns json
language plpgsql
stable
set search_path = public
as $function$
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

-- ---------------------------------------------------------------------------
-- 9. Permisos: los mismos que las *_agente actuales (ni PUBLIC ni anon)
-- ---------------------------------------------------------------------------
revoke all on function public.es_linea_servicio_agente(text)                                       from public, anon;
revoke all on function public.alertas_resumen_agente(jsonb)                                         from public, anon;
revoke all on function public.fecha_dudosa_agente(jsonb)                                            from public, anon;
revoke all on function public.documento_compacto_agente(public.facturas, boolean)                   from public, anon;
revoke all on function public.docs_sin_total_agente(text, date, date)                               from public, anon;
revoke all on function public.buscar_productos_texto_agente(text, integer)                          from public, anon;
revoke all on function public.ranking_agente(text, text, integer, date, date, text, boolean)        from public, anon;
revoke all on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) from public, anon;
revoke all on function public.detalle_documento_agente(bigint, text)                                from public, anon;
revoke all on function public.consulta_flexible_agente(jsonb)                                       from public, anon;

grant execute on function public.es_linea_servicio_agente(text)                                       to authenticated, service_role;
grant execute on function public.alertas_resumen_agente(jsonb)                                         to authenticated, service_role;
grant execute on function public.fecha_dudosa_agente(jsonb)                                            to authenticated, service_role;
grant execute on function public.documento_compacto_agente(public.facturas, boolean)                   to authenticated, service_role;
grant execute on function public.docs_sin_total_agente(text, date, date)                               to authenticated, service_role;
grant execute on function public.buscar_productos_texto_agente(text, integer)                          to authenticated, service_role;
grant execute on function public.ranking_agente(text, text, integer, date, date, text, boolean)        to authenticated, service_role;
grant execute on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) to authenticated, service_role;
grant execute on function public.detalle_documento_agente(bigint, text)                                to authenticated, service_role;
grant execute on function public.consulta_flexible_agente(jsonb)                                       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Comprobaciones finales (si fallan, no se aplica nada)
-- ---------------------------------------------------------------------------
do $$
declare
  j  jsonb;
  n  int;
begin
  -- Conteos alineados: enero de 2026 en resumen y en estadisticas.meses.
  j := resumen_periodo_agente('2026-01-01', '2026-01-31')::jsonb;
  select (m ->> 'facturas')::int into n
    from jsonb_array_elements(estadisticas_globales_agente()::jsonb -> 'meses') m where m ->> 'mes' = '2026-01';
  if (j -> 'facturas' ->> 'n')::int is distinct from n then
    raise exception 'MIGRACIÓN ABORTADA: enero 2026 da % facturas en resumen y % en estadisticas.', j -> 'facturas' ->> 'n', n;
  end if;

  -- La comodín rechaza lo que no está en la lista blanca.
  j := consulta_flexible_agente('{"agrupar": ["proveedor; drop table facturas"]}')::jsonb;
  if j ->> 'error' is null then
    raise exception 'MIGRACIÓN ABORTADA: consulta_flexible_agente aceptó una agrupación fuera de la lista blanca.';
  end if;

  -- Ninguna función nueva ejecutable por anon.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('es_linea_servicio_agente', 'alertas_resumen_agente', 'fecha_dudosa_agente', 'documento_compacto_agente',
                       'docs_sin_total_agente', 'buscar_productos_texto_agente', 'ranking_agente', 'filtrar_documentos_agente',
                       'detalle_documento_agente', 'consulta_flexible_agente')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then
    raise exception 'MIGRACIÓN ABORTADA: % funciones nuevas ejecutables por anon.', n;
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): tiene que salir «chatbot_facturas_ranking_sin_total: aplicada».
select 'chatbot_facturas_ranking_sin_total: aplicada' as resultado,
       (resumen_periodo_agente('2026-01-01', '2026-01-31')::jsonb -> 'facturas') as enero_2026_facturas,
       (estadisticas_globales_agente()::jsonb -> 'documentos_sin_total' ->> 'n') as documentos_sin_total;
