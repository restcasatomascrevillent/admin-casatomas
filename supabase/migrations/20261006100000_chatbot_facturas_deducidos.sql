set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Chatbot de Facturas: totales deducidos, conteos y IVA (06/10/2026)  ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (tercera batería, 06/10/2026, con 20261005140000 aplicada y
-- chat-facturas v60; engram `facturas/chatbot-arreglos-2026-10`):
--   1. Totales deducidos: la factura 54 (Luga ML/101511) tiene
--      total_origen = 'deducido' (hoy = suma de las bases de sus líneas, SIN
--      IVA; otra migración lo corregirá para que incluya el IVA de cada línea).
--      El chatbot la llamaba «IVA incluido» (q20) y la sumaba en gastos y
--      rankings sin avisar (q01, q02, q03, q16, n1). Ninguna RPC devolvía
--      total_origen.
--   2. n1 (proveedor × mes) omitía a Garre (sin total) y decía «datos
--      completos»: la fila de Garre venía con sum_total null y nada más.
--   3. Conteos (q04, q12, q13) con avisos de cifra parcial y sumas que nadie
--      había pedido: filtrar_documentos sumaba importes con cualquier filtro.
--   4. IVA total (q22): no citaba los documentos con IVA NULL (Luga hoy).
--   5. q21: «las líneas suman 436,92 € sin IVA» de un documento sin total en
--      el que no consta si las líneas llevan IVA.
--   Indicación del dueño: la lógica en SQL, herramientas precisas y compactas.
--
-- QUÉ CAMBIA (mismas firmas, mismo tipo de retorno, mismos permisos)
--   · Ayudantes NUEVOS docs_deducidos_agente(tipo, desde, hasta) →
--     {n, docs:[{id, numero, proveedor, fecha, iva_conocido}]} y
--     docs_sin_iva_agente(tipo, desde, hasta) → {n, docs} (total sí, IVA no);
--     NULL si no hay ninguno (como docs_sin_total_agente).
--   · documento_compacto_agente (filas de filtrar, ranking, detalle,
--     ultimos y buscar_facturas): `total_origen: "deducido"` e
--     `iva_conocido` cuando el total es deducido (nada si es leído).
--   · estadisticas_globales_agente / resumen_periodo_agente: facturas y
--     albaranes llevan sus avisos en `si_das_importes` {sin_total, deducidos,
--     sin_iva (solo facturas)} —ya no `sin_total` suelto junto al conteo, que
--     se colaba en las respuestas de «cuántas»—; `deducidos` por mes y por
--     proveedor.
--   · filtrar_documentos_agente: con filtro sin_total / sin_verificar /
--     con_alertas / fecha_dudosa SOLO cuenta (sumas = {facturas:{n},
--     albaranes:{n}}, sin importes ni avisos; el criterio dice que los
--     importes van por consulta_flexible). Con «todos», `deducidos` en sumas
--     y `documentos_deducidos` si hay filas fuera de la vista.
--   · ranking_agente: gasto_proveedor con `deducidos` por fila; gasto e
--     importe_documento con `documentos_deducidos`.
--   · consulta_flexible_agente: con métricas de importe de documentos, cada
--     fila trae `sin_total` / `deducidos` (solo si > 0) y el nivel superior
--     `documentos_deducidos`; con métricas de IVA, `documentos_sin_iva`. Los
--     conteos siguen sin avisos.
--   · detalle_documento_agente: `nota` según el caso (deducido sin IVA = base;
--     deducido con IVA; sin total = no consta si las líneas llevan IVA).
--   No toca datos, tablas, vistas ni otras funciones.
--
-- ESTADO VERIFICADO (producción, 06/10/2026, md5 de pg_get_functiondef SIN
-- retornos de carro; son las de 20261005140000 y 20261005100000 APLICADAS)
--   estadisticas_globales_agente()                                   b79a063fe33c3a4bd30d7b64c56590ee
--   resumen_periodo_agente(date,date)                                1cec9a50eed923134f95436926b4ecb5
--   filtrar_documentos_agente(text,text,text,date,date,text,integer) d871a61699d8e2d3502663f93b042d37
--   ranking_agente(text,text,integer,date,date,text,boolean)         3b25f7d2268342935810be081f9393cf
--   consulta_flexible_agente(jsonb)                                  70948fdb88bd037ab48db969c102bff5
--   detalle_documento_agente(bigint,text)                            02760aac1aa3a02b9049fb07d55cf15c
--   documento_compacto_agente(facturas,boolean)                      1dd95438f7943f5023f9a3e730ae505e
--   Si no coinciden (y la migración no está ya aplicada), ABORTA sin cambiar nada.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; NO en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261006100000_chatbot_facturas_deducidos.sql
--      Tiene que imprimir «chatbot_facturas_deducidos: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/chatbot_facturas_deducidos_test.sql
--      Tiene que imprimir «chatbot_facturas_deducidos: todas las comprobaciones han pasado».
--   3. npx supabase functions deploy chat-facturas
--      (la v60 desplegada sigue funcionando con esta migración; la nueva
--      lleva las reglas cortas de deducidos, conteos e IVA).
--   Es independiente de 20261006110000_luga_54_total_con_iva: vale antes y
--   después (iva_conocido sale de facturas.iva).
--   Deshacer: supabase/rollbacks/20261006100000_chatbot_facturas_deducidos_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_md5 text;
begin
  if to_regprocedure('public.docs_deducidos_agente(text,date,date)') is not null
     and position('iva_conocido' in pg_get_functiondef('public.documento_compacto_agente(facturas,boolean)'::regprocedure)) > 0 then
    raise notice 'Ya aplicada: se vuelven a crear las funciones (idempotente).';
    return;
  end if;
  select md5(replace(pg_get_functiondef('public.estadisticas_globales_agente()'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> 'b79a063fe33c3a4bd30d7b64c56590ee' then
    raise exception 'MIGRACIÓN ABORTADA: estadisticas_globales_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.resumen_periodo_agente(date,date)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '1cec9a50eed923134f95436926b4ecb5' then
    raise exception 'MIGRACIÓN ABORTADA: resumen_periodo_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.filtrar_documentos_agente(text,text,text,date,date,text,integer)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> 'd871a61699d8e2d3502663f93b042d37' then
    raise exception 'MIGRACIÓN ABORTADA: filtrar_documentos_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.ranking_agente(text,text,integer,date,date,text,boolean)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '3b25f7d2268342935810be081f9393cf' then
    raise exception 'MIGRACIÓN ABORTADA: ranking_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.consulta_flexible_agente(jsonb)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '70948fdb88bd037ab48db969c102bff5' then
    raise exception 'MIGRACIÓN ABORTADA: consulta_flexible_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.detalle_documento_agente(bigint,text)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '02760aac1aa3a02b9049fb07d55cf15c' then
    raise exception 'MIGRACIÓN ABORTADA: detalle_documento_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  select md5(replace(pg_get_functiondef('public.documento_compacto_agente(facturas,boolean)'::regprocedure), chr(13), '')) into v_md5;
  if v_md5 <> '1dd95438f7943f5023f9a3e730ae505e' then
    raise exception 'MIGRACIÓN ABORTADA: documento_compacto_agente no es la verificada el 06/10/2026 (md5 %). No se ha cambiado nada.', v_md5;
  end if;
  if to_regprocedure('public.docs_sin_total_agente(text,date,date)') is null then
    raise exception 'MIGRACIÓN ABORTADA: falta docs_sin_total_agente (20261005100000). No se ha cambiado nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'facturas' and column_name = 'total_origen') then
    raise exception 'MIGRACIÓN ABORTADA: falta facturas.total_origen (20260928190000). No se ha cambiado nada.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. Ayudantes nuevos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.docs_deducidos_agente(p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
           'n', count(*),
           'docs', jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'id', f.id, 'tipo', case when p_tipo is null then f.tipo end, 'numero', f.numero_documento,
                     'proveedor', f.proveedor, 'fecha', f.fecha, 'iva_conocido', f.iva is not null)) order by f.fecha, f.id))
    from public.facturas f
   where f.total_origen = 'deducido'
     and f.total is not null
     and (p_tipo is null or f.tipo = p_tipo)
     and (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
  having count(*) > 0
$function$;

comment on function public.docs_deducidos_agente(text, date, date) is
  'Chatbot de facturas: documentos con total DEDUCIDO (calculado desde las líneas, no leído) de un tipo y rango; iva_conocido=false => el total es la base SIN IVA y el real será mayor. NULL si no hay.';

CREATE OR REPLACE FUNCTION public.docs_sin_iva_agente(p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
           'n', count(*),
           'docs', jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'id', f.id, 'tipo', case when p_tipo is null then f.tipo end, 'numero', f.numero_documento,
                     'proveedor', f.proveedor, 'fecha', f.fecha)) order by f.fecha, f.id))
    from public.facturas f
   where f.iva is null
     and f.total is not null
     and (p_tipo is null or f.tipo = p_tipo)
     and (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
  having count(*) > 0
$function$;

comment on function public.docs_sin_iva_agente(text, date, date) is
  'Chatbot de facturas: documentos con total pero SIN IVA registrado (su IVA no está en ninguna suma de IVA) de un tipo y rango. Los sin total van en docs_sin_total_agente. NULL si no hay.';

-- ---------------------------------------------------------------------------
-- 1. documento_compacto_agente(facturas, boolean)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.documento_compacto_agente(p_doc facturas, p_detalle boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',           p_doc.id,
    'tipo',         p_doc.tipo,
    'numero',       p_doc.numero_documento,
    'proveedor',    p_doc.proveedor,
    'fecha',        p_doc.fecha,
    'total',        round(p_doc.total::numeric, 2),
    'sin_total',    case when p_doc.total is null then true end,
    -- Solo si el total NO se leyó del documento (calculado desde las líneas).
    'total_origen', case when p_doc.total_origen = 'deducido' then 'deducido' end,
    'iva_conocido', case when p_doc.total_origen = 'deducido' then p_doc.iva is not null end,
    'fecha_dudosa', case when public.fecha_dudosa_agente(p_doc.alertas_validacion) then true end,
    'alertas',      public.alertas_resumen_agente(p_doc.alertas_validacion),
    'base',         case when p_detalle then round(p_doc.subtotal::numeric, 2) end,
    'iva',          case when p_detalle then round(p_doc.iva::numeric, 2) end,
    'cif',          case when p_detalle then p_doc.cif end,
    'verificada',   case when p_detalle then coalesce(p_doc.verificada, false) end,
    'resumen',      case when p_detalle then left(p_doc.resumen, 300) end
  ))
$function$;

comment on function public.documento_compacto_agente(facturas, boolean) is
  'Documento en forma mínima para el chatbot {id, tipo, numero, proveedor, fecha, total, sin_total?, total_origen="deducido"? + iva_conocido?, fecha_dudosa?, alertas?}; con p_detalle añade base, iva, cif, verificada y resumen.';

-- ---------------------------------------------------------------------------
-- 2. estadisticas_globales_agente()
-- ---------------------------------------------------------------------------
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
    'albaranes', (select jsonb_build_object(
                   'n',     count(*),
                   'valor', round(coalesce(sum(total), 0)::numeric, 2),
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
    -- antiguo al más reciente. Cuenta también los documentos sin total.
    'meses', (select jsonb_agg(to_jsonb(m) order by m.mes)
                from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                             count(*) filter (where tipo = 'factura')                                    as facturas,
                             round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto,
                             nullif(count(*) filter (where tipo = 'factura' and total is null), 0)       as sin_total,
                             nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
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
                                       nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
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
  'Chatbot de facturas: foto global compacta. facturas/albaranes = {n, gasto|valor, si_das_importes: {sin_total, deducidos, sin_iva}} de SU tipo (avisos solo para importes, no para conteos), con_alertas, todos los meses con datos y año (sin_total/deducidos por mes), top 8 proveedores, 3 últimos documentos.';

-- ---------------------------------------------------------------------------
-- 3. resumen_periodo_agente(date, date)
-- ---------------------------------------------------------------------------
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
                   'n',     count(*),
                   'gasto', round(coalesce(sum(total), 0)::numeric, 2),
                   'base',  round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',   round(coalesce(sum(iva), 0)::numeric, 2),
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('factura', v_desde, v_hasta),
                                        'deducidos', docs_deducidos_agente('factura', v_desde, v_hasta),
                                        'sin_iva',   docs_sin_iva_agente('factura', v_desde, v_hasta))), '{}'::jsonb))
                   from facturas where tipo = 'factura' and fecha between v_desde and v_hasta),
    'albaranes', (select jsonb_build_object(
                   'n',     count(*),
                   'valor', round(coalesce(sum(total), 0)::numeric, 2),
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
    -- Solo si el rango abarca más de un mes.
    'meses', case when to_char(v_desde, 'YYYY-MM') <> to_char(v_hasta, 'YYYY-MM') then
               (select jsonb_agg(to_jsonb(m) order by m.mes)
                  from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                               count(*) filter (where tipo = 'factura')                                    as facturas,
                               round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto,
                               nullif(count(*) filter (where tipo = 'factura' and total is null), 0)       as sin_total,
                               nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
                               nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes
                          from facturas where fecha between v_desde and v_hasta
                         group by 1) m)
             end,
    'proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                      from (select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
                                   nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                   round((sum(total) filter (where tipo = 'factura'))::numeric, 2)              as gasto,
                                   nullif(count(*) filter (where tipo = 'factura' and total is null), 0)        as sin_total,
                                   nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
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
  'Chatbot de facturas: resumen compacto de un rango. facturas/albaranes = {n, gasto|valor, si_das_importes: {sin_total, deducidos, sin_iva}} de SU tipo (avisos solo para importes), con_alertas, meses si abarca varios (sin_total/deducidos por mes), top 10 proveedores, top 8 productos sin servicios.';

-- ---------------------------------------------------------------------------
-- 4. filtrar_documentos_agente(text, text, text, date, date, text, integer)
-- ---------------------------------------------------------------------------
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
  v_ded    jsonb;
  v_cuenta boolean;
begin
  -- «Sin factura», «sin facturar», «albaranes sin factura»…: no existe ningun
  -- vinculo guardado entre albaranes y facturas. Se dice claro en vez de
  -- dejar que el modelo lo confunda con sin_total (prueba del 05/10, q19).
  if v_filtro ~ '(factur|albar|vincul|relacion|pagad|pago)' then
    return json_build_object(
      'error', 'No hay ninguna relacion guardada entre albaranes y facturas (ni estado de pago): no se puede saber que albaranes estan facturados, sin facturar o pagados. Dilo asi. sin_total NO significa sin factura.');
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
  v_cuenta := v_filtro <> 'todos';

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
                            'total',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) end) end,
              'albaranes', case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'albaran'),
                            'valor',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total_origen = 'deducido'), 0) end) end))
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
                        || case when v_cuenta then '; solo conteo: para importes usa consulta_flexible' else '' end,
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

comment on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) is
  'Chatbot de facturas: documentos por filtro (todos|sin_total|sin_verificar|con_alertas|fecha_dudosa), texto (número, proveedor o CIF), tipo y fechas. Con «todos», sumas de TODO lo filtrado (con sin_total/deducidos); con los demás filtros SOLO cuenta. Un filtro de «sin factura»/«pagado» devuelve error: no hay relación albarán-factura. sin_total NO significa sin factura.';

-- ---------------------------------------------------------------------------
-- 5. ranking_agente(text, text, integer, date, date, text, boolean)
-- ---------------------------------------------------------------------------
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
  v_ded   jsonb;
  v_txt   text;
  v_unid  json;
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
         from l where servicio),
      -- cantidad: el primero de CADA unidad (kg, ud, l…), porque 172,7 kg y
      -- 156 ud no se pueden comparar entre si.
      (select case when v_crit = 'cantidad' and count(*) > 1 then
                json_agg(json_build_object('unidad', u.unidad, 'producto', u.producto, 'cantidad', u.cantidad) order by u.n)
              end
         from (select distinct on (coalesce(unidad, '?')) unidad, producto, cantidad, n
                 from o order by coalesce(unidad, '?'), n) u)
    into v_total, v_filas, v_excl, v_unid;

    v_txt := case when v_crit = 'cantidad'
                  then 'Cantidad total comprada de cada producto, en su unidad (kg con kg, ud con ud: unidades distintas no se comparan)'
                  else 'Numero de compras (lineas) de cada producto' end
             || case when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit = 'gasto_proveedor' then
    v_tipo := coalesce(v_tipo, 'factura');
    with g as (
      select coalesce(max(proveedor), proveedor_normalizado)              as proveedor,
             count(*)                                                     as documentos,
             round(coalesce(sum(total), 0)::numeric, 2)                   as importe,
             nullif(count(*) filter (where total is null), 0)             as sin_total,
             nullif(count(*) filter (where total_origen = 'deducido'), 0) as deducidos,
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
                 'proveedor', proveedor, 'documentos', documentos, 'importe', importe, 'sin_total', sin_total,
                 'deducidos', deducidos)) order by n), '[]'::json)
         from o where n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
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
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := 'Documentos por total (IVA incluido)'
             || case when v_tipo is null then ', facturas y albaranes mezclados (mira "tipo")' else '' end
             || '; los documentos sin total no entran';
  end if;

  -- Un total deducido no se leyó del documento: el «IVA incluido» del
  -- criterio no vale para él si iva_conocido = false (prueba del 06/10, q03).
  if v_ded is not null then
    v_txt := v_txt || '; documentos_deducidos: total calculado desde las lineas (sin IVA si iva_conocido=false)';
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
          || case when v_unid is not null then jsonb_build_object('primero_por_unidad', v_unid) else '{}'::jsonb end
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
         )::json;
end;
$function$;

comment on function public.ranking_agente(text, text, integer, date, date, text, boolean) is
  'Chatbot de facturas: rankings precio_unitario | importe_linea | cantidad | veces | gasto_proveedor | importe_documento. Devuelve criterio, filas, total_filas, truncado, servicios_excluidos, documentos_sin_total, documentos_deducidos (gasto e importe_documento) y, con cantidad, primero_por_unidad.';

-- ---------------------------------------------------------------------------
-- 6. consulta_flexible_agente(jsonb)
-- ---------------------------------------------------------------------------
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
      using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;

    -- Avisos de cifras parciales en el mismo ámbito filtrado (solo con
    -- importes: un conteo no lleva ninguno).
    if v_fuente = 'documentos' and v_import then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total is null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_sint
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Totales deducidos (calculados desde las lineas, no leidos).
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha, ''iva_conocido'', f.iva is not null)'
        || ' order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total_origen = ''deducido'' and f.total is not null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_ded
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Con IVA: documentos con total pero sin IVA (no entran en la suma de IVA).
      if v_iva then
        execute format(
          'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
          || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
          || ' from facturas f where %s and f.iva is null and f.total is not null having count(*) > 0',
          array_to_string(v_where, ' and '))
          into v_siva
          using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      end if;
    elsif v_fuente = 'lineas' and cardinality(v_lin_nul) > 0 then
      execute format(
        'select count(*)::int from productos_factura l join facturas f on f.id = l.factura_id where %s and (%s)',
        array_to_string(v_where, ' and '),
        array_to_string(array(select c || ' is null' from unnest(v_lin_nul) c), ' or '))
        into v_lsin
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
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
                                when v_import and v_ded is not null
                                then '; total con IVA salvo documentos_deducidos sin IVA conocido, subtotal sin IVA'
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

comment on function public.consulta_flexible_agente(jsonb) is
  'Chatbot de facturas: agregados a medida con LISTA BLANCA (fuente, métricas —incl. count_con_total—, agrupaciones, filtros, orden, límite hasta 50). Cada avg_* trae n_con_*; con importes de documentos cada fila trae sin_total/deducidos y arriba documentos_sin_total/documentos_deducidos (+ documentos_sin_iva con IVA); los conteos no llevan avisos; al agrupar por fecha avisa de fechas_dudosas. Valores como parámetros de EXECUTE … USING; lo no permitido devuelve {error, permitidos}.';

-- ---------------------------------------------------------------------------
-- 7. detalle_documento_agente(bigint, text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detalle_documento_agente(p_id bigint DEFAULT NULL::bigint, p_numero text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    -- La nota depende de como se obtuvo el total (prueba del 06/10: q20
    -- llamaba «IVA incluido» a un total deducido sin IVA; q21 afirmaba «sin
    -- IVA» de unas lineas de un documento sin total).
    'nota', (select case
               when f.total is null
                 then 'Sin total leido: suma_lineas es orientativa y no consta si las lineas llevan IVA; no digas con ni sin IVA.'
               when f.total_origen = 'deducido' and f.iva is null
                 then 'Total deducido: calculado sumando las lineas, no leido del documento. Es la base SIN IVA; el total real sera mayor. Nunca digas IVA incluido.'
               when f.total_origen = 'deducido'
                 then 'Total deducido: calculado desde las lineas mas su IVA, no leido del documento; dilo. precio e importe de linea SIN IVA.'
               else 'precio, importe y suma_lineas son de linea, SIN IVA; total del documento con IVA' end
               from facturas f where f.id = v_id)))::json;
end;
$function$;

comment on function public.detalle_documento_agente(bigint, text) is
  'Chatbot de facturas: un documento (por id o número exacto/normalizado) con base, iva, alertas, total_origen/iva_conocido si el total es deducido y hasta 40 líneas; la nota dice si suma_lineas es SIN IVA, base de un deducido o de IVA desconocido.';

-- Permisos: los mismos de antes (CREATE OR REPLACE los conserva; se reafirman)
-- y los de las dos funciones nuevas, iguales que docs_sin_total_agente.
revoke all on function public.docs_deducidos_agente(text, date, date) from public, anon;
revoke all on function public.docs_sin_iva_agente(text, date, date) from public, anon;
revoke all on function public.documento_compacto_agente(facturas, boolean) from public, anon;
revoke all on function public.estadisticas_globales_agente() from public, anon;
revoke all on function public.resumen_periodo_agente(date, date) from public, anon;
revoke all on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) from public, anon;
revoke all on function public.ranking_agente(text, text, integer, date, date, text, boolean) from public, anon;
revoke all on function public.consulta_flexible_agente(jsonb) from public, anon;
revoke all on function public.detalle_documento_agente(bigint, text) from public, anon;
grant execute on function public.docs_deducidos_agente(text, date, date) to authenticated, service_role;
grant execute on function public.docs_sin_iva_agente(text, date, date) to authenticated, service_role;
grant execute on function public.documento_compacto_agente(facturas, boolean) to authenticated, service_role;
grant execute on function public.estadisticas_globales_agente() to authenticated, service_role;
grant execute on function public.resumen_periodo_agente(date, date) to authenticated, service_role;
grant execute on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) to authenticated, service_role;
grant execute on function public.ranking_agente(text, text, integer, date, date, text, boolean) to authenticated, service_role;
grant execute on function public.consulta_flexible_agente(jsonb) to authenticated, service_role;
grant execute on function public.detalle_documento_agente(bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comprobaciones finales (si fallan, no se aplica nada)
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  n int;
begin
  -- Los deducidos de facturas que ve el chatbot son todos los de la tabla.
  j := estadisticas_globales_agente()::jsonb;
  select count(*) into n from facturas where tipo = 'factura' and total_origen = 'deducido' and total is not null;
  if coalesce((j -> 'facturas' -> 'si_das_importes' -> 'deducidos' ->> 'n')::int, 0) <> n then
    raise exception 'MIGRACIÓN ABORTADA: estadisticas da % facturas deducidas y la tabla %.',
      j -> 'facturas' -> 'si_das_importes' -> 'deducidos' ->> 'n', n;
  end if;
  if (j -> 'facturas') ? 'sin_total' then
    raise exception 'MIGRACIÓN ABORTADA: facturas.sin_total sigue junto al conteo.';
  end if;
  -- Un conteo no lleva avisos de importe.
  j := consulta_flexible_agente('{"metricas": ["count_documentos"], "agrupar": ["tipo"]}')::jsonb;
  if j ? 'documentos_sin_total' or j ? 'documentos_deducidos' or j ? 'documentos_sin_iva' or j ? 'error' then
    raise exception 'MIGRACIÓN ABORTADA: conteo con avisos: %', j;
  end if;
  j := filtrar_documentos_agente('sin_verificar')::jsonb;
  if (j -> 'sumas' -> 'facturas') ? 'total' or j ? 'error' then
    raise exception 'MIGRACIÓN ABORTADA: filtrar sin_verificar sigue sumando: %', j -> 'sumas';
  end if;
  -- «Sin factura» no se confunde con sin_total.
  if filtrar_documentos_agente('albaranes_sin_factura')::jsonb ->> 'error' not ilike '%relacion%' then
    raise exception 'MIGRACIÓN ABORTADA: filtrar_documentos_agente acepta «sin factura».';
  end if;
  -- Ninguna ejecutable por anon.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('docs_deducidos_agente', 'docs_sin_iva_agente', 'documento_compacto_agente',
                       'estadisticas_globales_agente', 'resumen_periodo_agente', 'filtrar_documentos_agente',
                       'ranking_agente', 'consulta_flexible_agente', 'detalle_documento_agente')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then
    raise exception 'MIGRACIÓN ABORTADA: % funciones ejecutables por anon.', n;
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): tiene que salir «chatbot_facturas_deducidos: aplicada».
select 'chatbot_facturas_deducidos: aplicada' as resultado,
       (estadisticas_globales_agente()::jsonb -> 'facturas' -> 'si_das_importes') as avisos_importe_facturas;
