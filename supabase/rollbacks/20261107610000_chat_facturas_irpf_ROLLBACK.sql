set client_encoding = 'UTF8';
-- ROLLBACK de 20261107610000_chat_facturas_irpf.
-- Vuelve resumen_periodo_agente y consulta_flexible_agente a la versión de
-- 20261106140000 (copiadas tal cual de la demo el 07/11/2026). No toca datos.
-- ANTES: desplegar chat-facturas sin sum_retencion_irpf/count_con_retencion
-- (si no, el modelo puede pedir esas métricas y la RPC responde «no permitida»).
--   supabase db query --linked -f supabase/rollbacks/20261107610000_chat_facturas_irpf_ROLLBACK.sql
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

revoke all on function public.resumen_periodo_agente(date, date) from public, anon;
grant execute on function public.resumen_periodo_agente(date, date) to authenticated, service_role;
revoke all on function public.consulta_flexible_agente(jsonb) from public, anon;
grant execute on function public.consulta_flexible_agente(jsonb) to authenticated, service_role;

commit;
select 'chat_facturas_irpf: deshecha' as resultado;
