set client_encoding = 'UTF8';
-- ROLLBACK de 20261106400000_facturas_volumenes (litros y kilos comprados).
-- Vuelve el explorador (explorar_compras, _hechos, _error, _por_lineas) a la
-- versión de 20261106310000 (sacada de la demo antes de aplicar), borra la RPC
-- del chatbot, la vista, los triggers, las funciones nuevas y las cuatro
-- columnas de envase del catálogo. No toca líneas ni facturas.
--   supabase db query --linked -f supabase/rollbacks/20261106400000_facturas_volumenes_ROLLBACK.sql
-- Después: volver a desplegar chat-facturas sin la herramienta volumen_comprado.
begin;
set local lock_timeout = '5s';

drop function if exists public.volumen_comprado_agente(text, text, date, date, text, text);
drop view if exists public.volumen_lineas;
drop trigger if exists trg_productos_catalogo_envase on public.productos_catalogo;
drop trigger if exists trg_productos_factura_envase_ins on public.productos_factura;
drop trigger if exists trg_productos_factura_envase_upd on public.productos_factura;
drop function if exists public.trg_productos_catalogo_envase();
drop function if exists public.trg_productos_factura_envase();
drop function if exists public.productos_envase_recalcular(bigint[]);

CREATE OR REPLACE FUNCTION public.explorar_compras(p_desde date, p_hasta date, p_medida text, p_agrupar text, p_desglose text DEFAULT NULL::text, p_filtros jsonb DEFAULT '{}'::jsonb, p_top integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105170000_explorar_compras
-- 20261106120000_facturas_cifras_coherentes: sin «−100 %» con el periodo vacío; lineas_sin_importe; precio sin atípicos.
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf; puntos[i].incompleto (mes/trimestre),
--   meses_incompletos y total.variacion_aviso.
declare
  v_medida    text := lower(btrim(coalesce(p_medida, '')));
  v_agrupar   text := nullif(lower(btrim(coalesce(p_agrupar, ''))), '');
  v_desglose  text := nullif(lower(btrim(coalesce(p_desglose, ''))), '');
  v_filtros   jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_top       int := coalesce(p_top, 10);
  v_err       text;
  v_desde     date;
  v_hasta     date;
  v_hasta_ef  date;
  v_meses     int;
  v_ant_desde date;
  v_ant_hasta date;
  v_tiempo    boolean;
  v_unidad_t  text;
  v_paso      interval;
  v_buckets   int;
  resultado   jsonb;
begin
  if v_agrupar is null then
    return json_build_object('error', 'agrupar es obligatorio.');
  end if;
  v_err := public.explorar_compras_error(v_medida, v_agrupar, v_desglose, v_filtros, v_top);
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  v_desde := coalesce(p_desde, (select min(fa.fecha) from facturas fa));
  v_hasta := coalesce(p_hasta, (select max(fa.fecha) from facturas fa));
  if v_desde is null or v_hasta is null or v_desde > v_hasta then
    return json_build_object('sin_datos', true, 'puntos', '[]'::json, 'series', '[]'::json,
                             'parametros', json_build_object('desde', p_desde, 'hasta', p_hasta, 'medida', v_medida,
                                                             'agrupar', v_agrupar, 'desglose', v_desglose));
  end if;
  v_hasta_ef := case when v_desde <= current_date and v_hasta > current_date then current_date else v_hasta end;

  -- Periodo anterior equivalente (misma regla que tablero_compras).
  if p_desde is not null and p_hasta is not null then
    if extract(day from p_desde) = 1
       and p_hasta = (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date then
      v_meses := (extract(year from p_hasta)::int * 12 + extract(month from p_hasta)::int)
               - (extract(year from p_desde)::int * 12 + extract(month from p_desde)::int) + 1;
      v_ant_desde := (p_desde - make_interval(months => v_meses))::date;
      v_ant_hasta := case when v_hasta_ef = p_hasta then p_desde - 1
                          else (v_hasta_ef - make_interval(months => v_meses))::date end;
    else
      v_ant_hasta := p_desde - 1;
      v_ant_desde := v_ant_hasta - (v_hasta_ef - p_desde);
    end if;
  end if;

  -- Eje de tiempo: todos los tramos del periodo (con 0 donde no hay nada).
  v_tiempo := v_agrupar in ('dia', 'semana', 'mes', 'trimestre');
  if v_tiempo then
    v_unidad_t := case v_agrupar when 'dia' then 'day' when 'semana' then 'week' when 'mes' then 'month' else 'quarter' end;
    v_paso := case v_agrupar when 'dia' then interval '1 day' when 'semana' then interval '1 week'
                             when 'mes' then interval '1 month' else interval '3 months' end;
    select count(*) into v_buckets
      from generate_series(date_trunc(v_unidad_t, v_desde::timestamp), date_trunc(v_unidad_t, v_hasta_ef::timestamp), v_paso);
    if v_agrupar = 'dia' and v_buckets > 400 then
      return json_build_object('error', format('Demasiados días (%s): agrupa por semana o por mes.', v_buckets));
    end if;
    if v_agrupar = 'semana' and v_buckets > 270 then
      return json_build_object('error', format('Demasiadas semanas (%s): agrupa por mes.', v_buckets));
    end if;
  end if;

  with
  inc as (
    select i.mes from public.meses_compras_incompletos(nullif(v_filtros ->> 'local', '')) i
  ),
  inc_act as (select inc.mes from inc where inc.mes between date_trunc('month', v_desde)::date and v_hasta),
  inc_ant as (
    select inc.mes from inc
     where v_ant_desde is not null and inc.mes between date_trunc('month', v_ant_desde)::date and v_ant_hasta
  ),
  h0 as materialized (
    select * from public.explorar_compras_hechos(least(v_desde, v_ant_desde), v_hasta, v_medida, v_agrupar, v_desglose, v_filtros)
  ),
  uds as (
    select x.unidad, count(*) as lineas from h0 x
     where x.unidad is not null and x.fecha between v_desde and v_hasta
     group by x.unidad
  ),
  u as (
    select coalesce(nullif(lower(btrim(v_filtros ->> 'unidad')), ''),
                    case when v_medida in ('cantidad', 'precio')
                         then (select uds.unidad from uds order by uds.lineas desc, uds.unidad limit 1) end) as unidad
  ),
  h as materialized (
    select x.*,
           public.explorar_compras_clave(v_agrupar, x.fecha, x.prov_k, x.loc, x.tipo_k, x.fam_id, x.prod_k) as k1,
           public.explorar_compras_clave(v_desglose, x.fecha, x.prov_k, x.loc, x.tipo_k, x.fam_id, x.prod_k) as k2
      from h0 x cross join u
     where u.unidad is null or x.unidad = u.unidad
  ),
  act as (select * from h where h.fecha between v_desde and v_hasta),
  ant as (select * from h where v_ant_desde is not null and h.fecha between v_ant_desde and v_ant_hasta),
  -- Valor de un grupo: la misma cuenta en todas partes.
  g1 as (
    select a.k1,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs,
           max(a.proveedor_id) as pid, max(a.proveedor_txt) as ptxt, max(a.prod_nombre) as pnom
      from act a group by a.k1
  ),
  rk as (
    select g1.*, row_number() over (order by g1.valor desc nulls last, g1.k1) as rn from g1
  ),
  top1 as (
    select rk.* from rk where v_tiempo or v_agrupar in ('familia', 'local', 'tipo') or rk.rn <= v_top
  ),
  -- Series del desglose (proveedor: top N + «Otros»).
  gs as (
    select a.k2,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           max(a.proveedor_id) as pid, max(a.proveedor_txt) as ptxt
      from act a where v_desglose is not null group by a.k2
  ),
  sk as (
    select gs.*, case when v_desglose = 'proveedor'
                           and row_number() over (order by gs.valor desc nulls last, gs.k2) > v_top
                      then '__otros__' else gs.k2 end as ks
      from gs
  ),
  series as (
    select sk.ks,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           max(sk.pid) as pid, max(sk.ptxt) as ptxt
      from act a join sk on sk.k2 = a.k2
     group by sk.ks
  ),
  g12 as (
    select a.k1, sk.ks,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor
      from act a join sk on sk.k2 = a.k2
     group by a.k1, sk.ks
  ),
  tramos as (
    select public.explorar_compras_clave(v_agrupar, g::date, null, null, null, null, null) as k1
      from generate_series(date_trunc(coalesce(v_unidad_t, 'day'), v_desde::timestamp),
                           date_trunc(coalesce(v_unidad_t, 'day'), v_hasta_ef::timestamp),
                           coalesce(v_paso, interval '1 day')) g
     where v_tiempo
    union
    select g1.k1 from g1 where v_tiempo
  ),
  puntos as (
    select t.k1, x.valor, x.docs, x.pid, x.ptxt, x.pnom, coalesce(x.rn, 0) as rn
      from tramos t left join rk x on x.k1 = t.k1
     where v_tiempo
    union all
    select x.k1, x.valor, x.docs, x.pid, x.ptxt, x.pnom, x.rn from top1 x where not v_tiempo
  ),
  resto as (
    select count(distinct a.k1) as entidades, count(distinct a.doc_id) as docs,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor
      from act a
     where not v_tiempo and not exists (select 1 from top1 t where t.k1 is not distinct from a.k1)
  ),
  tot as (
    select case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs, count(*) as filas,
           count(*) filter (where a.num is null) as sin_importe
      from act a
  ),
  tant as (
    select case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs
      from ant a
  )
  select jsonb_build_object(
    'parametros', jsonb_build_object(
        'desde', v_desde, 'hasta', v_hasta, 'hasta_efectivo', v_hasta_ef,
        'medida', v_medida, 'agrupar', v_agrupar, 'desglose', v_desglose, 'filtros', v_filtros, 'top', v_top,
        'por_lineas', public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros),
        'solo_productos', v_medida in ('cantidad', 'precio') or v_agrupar = 'producto',
        'unidad', (select u.unidad from u),
        'precio_sin_atipicos', v_medida = 'precio'),
    'sin_datos', (select t.docs = 0 from tot t),
    'total', (select jsonb_build_object('valor', t.valor, 'documentos', t.docs,
                                        'lineas', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros)
                                                       then t.filas end,
                                        'lineas_sin_importe', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros)
                                                                   then t.sin_importe end,
                                        'variacion_pct', case when v_ant_desde is not null and t.docs > 0 and ta.valor > 0 and t.valor is not null
                                                                   and ta.docs >= 0.5 * t.docs
                                                              then round((t.valor / ta.valor - 1) * 100, 1) end,
                                        'variacion_aviso', case when v_ant_desde is not null and t.docs > 0 and ta.valor > 0 and t.valor is not null
                                                                     and ta.docs >= 0.5 * t.docs and v_medida <> 'precio'
                                                                     and (exists (select 1 from inc_act) or exists (select 1 from inc_ant))
                                                                then 'La comparación incluye meses incompletos ('
                                                                     || (select string_agg(to_char(x.mes, 'MM/YYYY'), ', ' order by x.mes)
                                                                           from (select mes from inc_act union select mes from inc_ant) x)
                                                                     || '): faltan facturas por subir y la variación no es fiable.' end)
                from tot t cross join tant ta),
    'anterior', case when v_ant_desde is not null then
                  (select jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta, 'valor', ta.valor, 'documentos', ta.docs)
                     from tant ta) end,
    'unidades', case when v_medida in ('cantidad', 'precio') or v_filtros ? 'unidad' then
                  coalesce((select jsonb_agg(jsonb_build_object('unidad', uds.unidad, 'lineas', uds.lineas)
                                             order by uds.lineas desc, uds.unidad) from uds), '[]'::jsonb) end,
    'meses_incompletos', coalesce((select jsonb_agg(to_char(i.mes, 'YYYY-MM') order by i.mes) from inc_act i), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', s.ks,
               'etiqueta', public.explorar_compras_etiqueta(v_desglose, s.ks, s.pid, s.ptxt, null),
               'id', case when s.ks <> '__otros__' and v_desglose = 'proveedor' then s.pid
                          when s.ks <> '__otros__' and v_desglose = 'familia' and s.ks <> '0' then s.ks::bigint end,
               'valor', s.valor)
             order by (s.ks = '__otros__'), s.valor desc nulls last, s.ks)
        from series s), '[]'::jsonb),
    'puntos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', p.k1,
               'etiqueta', public.explorar_compras_etiqueta(v_agrupar, p.k1, p.pid, p.ptxt, p.pnom),
               'id', case when v_agrupar = 'proveedor' and p.k1 not like 'n:%' then p.pid
                          when v_agrupar = 'familia' and p.k1 <> '0' then p.k1::bigint end,
               'valor', case when p.valor is null and v_medida not in ('precio') then 0 else p.valor end,
               'documentos', coalesce(p.docs, 0),
               'incompleto', case when v_agrupar = 'mes'
                                    then exists (select 1 from inc_act i where to_char(i.mes, 'YYYY-MM') = p.k1)
                                  when v_agrupar = 'trimestre'
                                    then exists (select 1 from inc_act i where to_char(i.mes, 'YYYY') || '-T' || to_char(i.mes, 'Q') = p.k1) end,
               'desglose', case when v_desglose is not null then
                             coalesce((select jsonb_object_agg(g.ks, g.valor) from g12 g where g.k1 = p.k1), '{}'::jsonb) end)
             order by case when v_tiempo then 0 else p.rn end, p.k1)
        from puntos p), '[]'::jsonb),
    'resto', case when not v_tiempo then
               (select case when r.entidades > 0 then jsonb_build_object('entidades', r.entidades, 'valor', r.valor,
                                                                         'documentos', r.docs) end
                  from resto r) end
  ) into resultado;

  return resultado::json;
end;
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras_error(p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb, p_top integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf (por documento).
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if p_medida is null or p_medida not in ('gasto', 'base', 'documentos', 'abonos', 'regalado', 'cantidad', 'precio', 'retencion_irpf') then
    return 'medida debe ser gasto, base, documentos, abonos, regalado, cantidad, precio o retencion_irpf.';
  end if;
  if p_agrupar is not null
     and p_agrupar not in ('dia', 'semana', 'mes', 'trimestre', 'proveedor', 'familia', 'producto', 'local', 'tipo') then
    return 'agrupar debe ser dia, semana, mes, trimestre, proveedor, familia, producto, local o tipo.';
  end if;
  if p_desglose is not null then
    if p_desglose not in ('local', 'proveedor', 'familia', 'tipo') then
      return 'desglose debe ser local, proveedor, familia, tipo o null.';
    end if;
    if p_agrupar is null then
      return 'desglose necesita agrupar.';
    end if;
    if p_desglose = p_agrupar then
      return 'desglose no puede ser lo mismo que agrupar.';
    end if;
  end if;
  if p_top is null or p_top < 1 or p_top > 50 then
    return 'top debe estar entre 1 y 50.';
  end if;
  if p_filtros is null or jsonb_typeof(p_filtros) <> 'object' then
    return 'filtros debe ser un objeto JSON.';
  end if;
  for k, v in select x.key, x.value from jsonb_each(p_filtros) x loop
    if k not in ('proveedores', 'familias', 'productos', 'tipos', 'local', 'unidad') then
      return format('filtro desconocido: %s.', left(k, 40));
    end if;
    if k in ('proveedores', 'familias', 'productos', 'tipos') then
      if jsonb_typeof(v) <> 'array' then
        return format('%s debe ser una lista.', k);
      end if;
      if jsonb_array_length(v) > 50 then
        return format('%s: como mucho 50.', k);
      end if;
      for e in select y.value from jsonb_array_elements(v) y loop
        if k = 'proveedores' and not (jsonb_typeof(e) = 'number' and (e #>> '{}') ~ '^[1-9][0-9]{0,17}$') then
          return 'proveedores: ids enteros positivos.';
        elsif k = 'familias' and not (jsonb_typeof(e) = 'number' and (e #>> '{}') ~ '^[0-9]{1,18}$') then
          return 'familias: ids enteros (0 = sin clasificar).';
        elsif k = 'productos' and not (jsonb_typeof(e) = 'string' and length(btrim(e #>> '{}')) between 1 and 160) then
          return 'productos: textos de 1 a 160 letras.';
        elsif k = 'tipos' and not (jsonb_typeof(e) = 'string' and (e #>> '{}') in ('factura', 'albaran', 'abono')) then
          return 'tipos: factura, albaran o abono.';
        end if;
      end loop;
    elsif k = 'local' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('casa_tomas', 'touza') then
        return 'local debe ser casa_tomas o touza.';
      end if;
    elsif k = 'unidad' then
      if jsonb_typeof(v) <> 'string' or length(btrim(v #>> '{}')) not between 1 and 20 then
        return 'unidad: texto de 1 a 20 letras.';
      end if;
    end if;
  end loop;
  if p_medida in ('gasto', 'abonos', 'retencion_irpf') and public.explorar_compras_por_lineas(p_medida, p_agrupar, p_desglose, p_filtros) then
    return 'gasto, abonos y retención IRPF se miden por documento; con familias, productos o unidad usa la medida base (sin IVA).';
  end if;
  if p_medida in ('cantidad', 'precio') and jsonb_array_length(coalesce(p_filtros -> 'productos', '[]'::jsonb)) = 0 then
    return 'cantidad y precio necesitan filtrar uno o más productos.';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras_hechos(p_desde date, p_hasta date, p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
 RETURNS TABLE(doc_id bigint, fecha date, prov_k text, proveedor_id bigint, proveedor_txt text, loc text, tipo_k text, fam_id bigint, prod_k text, prod_nombre text, unidad text, num numeric, den numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- 20261106120000_facturas_cifras_coherentes: importe de línea = solo pf.total; medida precio sin atípicos.
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf (documentos con retención).
declare
  f       jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_err   text;
  v_prov  bigint[];
  v_fam   bigint[];
  v_prod  text[];
  v_tipos text[];
  v_local text;
  v_solo  boolean;
begin
  v_err := public.explorar_compras_error(p_medida, p_agrupar, p_desglose, f, 10);
  if v_err is not null then
    raise exception using errcode = '22023', message = v_err;
  end if;
  v_prov  := nullif(array(select x::bigint from jsonb_array_elements_text(coalesce(f -> 'proveedores', '[]')) x), '{}');
  v_fam   := nullif(array(select x::bigint from jsonb_array_elements_text(coalesce(f -> 'familias', '[]')) x), '{}');
  v_prod  := nullif(array(select distinct coalesce(nullif(public.normalizar_nombre_producto(btrim(x)), ''), lower(btrim(x)))
                            from jsonb_array_elements_text(coalesce(f -> 'productos', '[]')) x), '{}');
  v_tipos := nullif(array(select x from jsonb_array_elements_text(coalesce(f -> 'tipos', '[]')) x), '{}');
  v_local := f ->> 'local';
  v_solo  := p_medida in ('cantidad', 'precio') or coalesce(p_agrupar, '') = 'producto';

  if not public.explorar_compras_por_lineas(p_medida, p_agrupar, p_desglose, f) then
    return query
      select d.id, d.fecha, d.prov_k, d.proveedor_id, d.proveedor_txt, d.loc, d.tipo_k,
             null::bigint, null::text, null::text, null::text,
             (case when p_medida = 'abonos' then -d.total when p_medida = 'retencion_irpf' then d.retencion_irpf
                   else coalesce(d.total, 0) end)::numeric,
             0::numeric
        from (select fa.id, fa.fecha, fa.total, fa.retencion_irpf, fa.proveedor_id, fa.proveedor::text as proveedor_txt,
                     coalesce(fa.proveedor_id::text,
                              'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
                     case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
                     case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k
                from facturas fa
               where fa.fecha between p_desde and p_hasta
                 and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)) d
       where (p_medida <> 'abonos' or d.total < 0)
         and (p_medida <> 'retencion_irpf' or d.retencion_irpf is not null)
         and (v_local is null or d.loc = v_local)
         and (v_prov is null or d.proveedor_id = any(v_prov))
         and (v_tipos is null or d.tipo_k = any(v_tipos));
  else
    -- «¿Es producto?» sale de la caché nombres_linea_no_producto
    -- (20261105191000); solo lo que falte se calcula al vuelo.
    return query
      with l as materialized (
       select x.* from (
        select fa.id, fa.fecha, fa.proveedor_id, fa.proveedor::text as proveedor_txt,
               coalesce(fa.proveedor_id::text,
                        'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
               case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
               case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k,
               coalesce(c.padre_id, c.id) as fam,
               coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
               pf.nombre::text as nombre,
               lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as uni,
               np.no_producto as no_prod,
               pf.cantidad, pf.precio_unitario, pf.importe_bruto, pf.total as total_linea,
               pf.total::numeric as importe   -- sin importe leído no suma (20261106120000)
          from facturas fa
          join productos_factura pf on pf.factura_id = fa.id
          left join productos_catalogo pc on pc.id = pf.producto_id
          left join categorias_producto c on c.id = pc.categoria_id
          left join public.nombres_linea_no_producto np
                 on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
         where fa.fecha between p_desde and p_hasta
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       ) x
       where (v_local is null or x.loc = v_local)
         and (v_prov is null or x.proveedor_id = any(v_prov))
         and (v_tipos is null or x.tipo_k = any(v_tipos))
         and (v_fam is null or coalesce(x.fam, 0) = any(v_fam))
         and (v_prod is null or x.nom_n = any(v_prod))
         and (p_medida <> 'regalado' or x.importe_bruto > x.total_linea)
         and (p_medida not in ('cantidad', 'precio') or (x.cantidad > 0 and x.precio_unitario > 0))
      ),
      -- Precio: con 3 compras o más del mismo proveedor, producto y unidad (en todo
      -- el histórico, para que el explorador y documentos_de_cifra den lo mismo con
      -- cualquier rango), la que está a más de 3× (o a menos de 1/3) de la mediana no
      -- cuenta: suele ser una caja leída como unidad.
      med as (
        select coalesce(fa.proveedor_id::text,
                        'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as m_prov,
               coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as m_nom,
               lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as m_uni,
               percentile_cont(0.5) within group (order by pf.precio_unitario) as mediana, count(*) as m_n
          from facturas fa
          join productos_factura pf on pf.factura_id = fa.id
         where p_medida = 'precio'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and pf.cantidad > 0 and pf.precio_unitario > 0
         group by 1, 2, 3
      )
      select l.id, l.fecha, l.prov_k, l.proveedor_id, l.proveedor_txt, l.loc, l.tipo_k,
             l.fam, l.nom_n, l.nombre, l.uni,
             (case p_medida
                when 'regalado' then l.importe_bruto - l.total_linea
                when 'cantidad' then l.precio_unitario * l.cantidad
                when 'precio'   then l.precio_unitario * l.cantidad
                else l.importe end)::numeric,
             (case when p_medida in ('cantidad', 'precio') then l.cantidad else 0 end)::numeric
        from l
        left join med on med.m_prov = l.prov_k and med.m_nom = l.nom_n and med.m_uni = l.uni
       where (not v_solo or not coalesce(l.no_prod, public.es_linea_no_producto_tablero(l.nom_n, l.uni)))
         and (p_medida <> 'precio' or med.m_n is null or med.m_n < 3
              or l.precio_unitario between med.mediana / 3 and med.mediana * 3);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras_por_lineas(p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_medida in ('base', 'regalado', 'cantidad', 'precio')
      or coalesce(p_agrupar, '') in ('familia', 'producto')
      or coalesce(p_desglose, '') in ('familia', 'producto')
      or coalesce(p_filtros, '{}'::jsonb) ?| array['familias', 'productos', 'unidad']
$function$;

drop function if exists public.volumen_linea(text, text, numeric, numeric, numeric, text, numeric, text, numeric, numeric);
drop function if exists public.volumen_max_eur_litro(text);
drop function if exists public.volumen_formato(numeric, text);
drop function if exists public.envase_texto(text);

alter table public.productos_catalogo drop constraint if exists productos_catalogo_envase_chk;
alter table public.productos_catalogo
  drop column if exists envase_cantidad,
  drop column if exists envase_unidad,
  drop column if exists envases_por_bulto,
  drop column if exists envase_origen;

select 'facturas_volumenes: deshecha' as resultado;
commit;
