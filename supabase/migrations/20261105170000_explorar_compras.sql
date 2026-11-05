set client_encoding = 'UTF8';
-- ===========================================================================
-- explorar_compras + documentos_de_cifra · 2026-11-05
-- ===========================================================================
--
-- Facturas › Análisis gana un EXPLORADOR (estilo Vega-Lite/Tableau ligero):
-- el dueño elige medida, eje, desglose por color y filtros, y la gráfica cambia
-- al instante sin pasar por la IA. Y desde cualquier cifra puede bajar a los
-- DOCUMENTOS que la forman (y abrir su PDF).
--
--   explorar_compras(desde, hasta, medida, agrupar, desglose, filtros, top)
--       → JSON con los puntos de la gráfica, las series del desglose, el total,
--         el periodo anterior equivalente y la variación.
--   documentos_de_cifra(desde, hasta, medida, agrupar, desglose, filtros,
--                       clave, clave_desglose, top, limite, desplazamiento)
--       → los documentos de UNA cifra (un punto, una barra, una serie, o el
--         total si no hay clave) con lo que aporta cada uno; paginado.
--
-- Las dos leen la MISMA tabla de hechos (explorar_compras_hechos): la suma de
-- lo que aporta cada documento cuadra con la cifra de la gráfica por
-- construcción.
--
-- Parámetros (listas cerradas; nada de SQL dinámico):
--   medida    gasto       total del documento CON IVA
--             base        importe de las líneas SIN IVA
--             documentos  nº de documentos
--             abonos      importe devuelto (en positivo) de los documentos con total < 0, CON IVA
--             regalado    importe_bruto − total de las líneas con descuento o regalo, SIN IVA
--             cantidad    cantidad comprada (exige filtrar productos; una sola unidad)
--             precio      precio medio ponderado SIN IVA (exige filtrar productos; una sola unidad)
--   agrupar   dia · semana · mes · trimestre · proveedor · familia · producto · local · tipo
--   desglose  null · local · proveedor (top N + «Otros») · familia · tipo
--   filtros   {"proveedores":[id…], "familias":[id…, 0 = sin clasificar],
--              "productos":["texto"…], "tipos":["factura"|"albaran"|"abono"…],
--              "local":"casa_tomas"|"touza", "unidad":"kg"}
--   top       1 … 50 (eje por proveedor o producto y series de proveedor; el resto, «Otros»).
--             Familia, local y tipo salen siempre enteros (son pocos).
--
-- REGLAS (las de tablero_compras y Compras):
--   · El albarán ya facturado (facturado_en_id not null) NO suma.
--   · local NULL = Casa Tomás.
--   · Tipo «abono» = documento con total < 0; si no, factura o albarán.
--   · Con familias, productos o unidad (en el eje, el desglose o los filtros)
--     se cuenta por LÍNEAS: gasto y abonos (que son por documento, con IVA) no
--     se pueden combinar con ellas → error que propone «base».
--   · Medidas de producto (cantidad, precio) y el eje «producto» quitan las
--     líneas que no son producto (es_linea_no_producto_tablero: portes,
--     servicios, envases, energía…), y cantidad/precio solo cuentan líneas con
--     cantidad y precio > 0.
--   · Familia = la familia raíz de la categoría del producto del catálogo.
--
-- SECURITY INVOKER: respeta la RLS de facturas / productos_factura /
-- proveedores / catálogo. Sin permiso de Facturas, todo sale vacío.
--
-- Idempotente. Test: supabase/tests/explorar_compras_test.sql
-- Rollback: supabase/rollbacks/20261105170000_explorar_compras_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ── ¿Hace falta contar por líneas? ──────────────────────────────────────────
create or replace function public.explorar_compras_por_lineas(p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_medida in ('base', 'regalado', 'cantidad', 'precio')
      or coalesce(p_agrupar, '') in ('familia', 'producto')
      or coalesce(p_desglose, '') in ('familia', 'producto')
      or coalesce(p_filtros, '{}'::jsonb) ?| array['familias', 'productos', 'unidad']
$$;

-- ── Validación con listas blancas (null = todo bien) ───────────────────────
create or replace function public.explorar_compras_error(
  p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb, p_top int)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if p_medida is null or p_medida not in ('gasto', 'base', 'documentos', 'abonos', 'regalado', 'cantidad', 'precio') then
    return 'medida debe ser gasto, base, documentos, abonos, regalado, cantidad o precio.';
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
  if p_medida in ('gasto', 'abonos') and public.explorar_compras_por_lineas(p_medida, p_agrupar, p_desglose, p_filtros) then
    return 'gasto y abonos se miden por documento (con IVA); con familias, productos o unidad usa la medida base (sin IVA).';
  end if;
  if p_medida in ('cantidad', 'precio') and jsonb_array_length(coalesce(p_filtros -> 'productos', '[]'::jsonb)) = 0 then
    return 'cantidad y precio necesitan filtrar uno o más productos.';
  end if;
  return null;
end;
$$;

-- ── Clave de una dimensión (eje o desglose) ────────────────────────────────
-- SIN `set search_path` y STABLE (no IMMUTABLE) a propósito: así Postgres la
-- «inlinea» (con SET no puede, y to_char es STABLE: declarada IMMUTABLE
-- tampoco) y no cuesta una llamada por línea (~25 µs × 2 × 12.000 líneas).
-- Solo usa funciones de pg_catalog, escritas con su esquema.
create or replace function public.explorar_compras_clave(
  p_dim text, p_fecha date, p_prov_k text, p_loc text, p_tipo text, p_fam bigint, p_prod text)
returns text
language sql
stable
as $$
  select case p_dim
    when 'dia'       then pg_catalog.to_char(p_fecha, 'YYYY-MM-DD')
    when 'semana'    then pg_catalog.to_char(pg_catalog.date_trunc('week', p_fecha::timestamp), 'YYYY-MM-DD')
    when 'mes'       then pg_catalog.to_char(p_fecha, 'YYYY-MM')
    when 'trimestre' then pg_catalog.to_char(p_fecha, 'YYYY') || '-T' || pg_catalog.to_char(p_fecha, 'Q')
    when 'proveedor' then p_prov_k
    when 'familia'   then coalesce(p_fam, 0)::text
    when 'producto'  then p_prod
    when 'local'     then p_loc
    when 'tipo'      then p_tipo
  end
$$;

-- ── Etiqueta legible de una clave ──────────────────────────────────────────
create or replace function public.explorar_compras_etiqueta(
  p_dim text, p_clave text, p_prov_id bigint, p_prov_txt text, p_prod text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_clave = '__otros__' then 'Otros'
    when p_dim = 'proveedor' then coalesce((select pv.nombre::text from proveedores pv where pv.id = p_prov_id),
                                           nullif(btrim(p_prov_txt), ''), 'Sin proveedor')
    when p_dim = 'familia' then case when p_clave = '0' then 'Sin clasificar'
                                     else coalesce((select c.nombre::text from categorias_producto c where c.id::text = p_clave),
                                                   'Familia ' || p_clave) end
    when p_dim = 'producto' then coalesce(nullif(btrim(p_prod), ''), p_clave)
    when p_dim = 'local' then case p_clave when 'touza' then 'Touza' else 'Casa Tomás' end
    when p_dim = 'tipo' then case p_clave when 'factura' then 'Factura' when 'albaran' then 'Albarán sin factura'
                                          when 'abono' then 'Abono' else p_clave end
    else p_clave
  end
$$;

-- ── Tabla de hechos común (un documento o una línea por fila) ──────────────
-- num/den: lo que suma cada fila. gasto → total; abonos → −total; base y
-- documentos (por líneas) → importe de la línea; regalado → bruto − total;
-- cantidad y precio → num = precio × cantidad, den = cantidad.
-- documentos (por documento) → num = total (para enseñar el importe).
-- No filtra la unidad: lo hacen las que la llaman (unidad elegida o la más usada).
create or replace function public.explorar_compras_hechos(
  p_desde date, p_hasta date, p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
returns table (
  doc_id bigint, fecha date, prov_k text, proveedor_id bigint, proveedor_txt text, loc text, tipo_k text,
  fam_id bigint, prod_k text, prod_nombre text, unidad text, num numeric, den numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
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
             (case when p_medida = 'abonos' then -d.total else coalesce(d.total, 0) end)::numeric,
             0::numeric
        from (select fa.id, fa.fecha, fa.total, fa.proveedor_id, fa.proveedor::text as proveedor_txt,
                     coalesce(fa.proveedor_id::text,
                              'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
                     case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
                     case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k
                from facturas fa
               where fa.fecha between p_desde and p_hasta
                 and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)) d
       where (p_medida <> 'abonos' or d.total < 0)
         and (v_local is null or d.loc = v_local)
         and (v_prov is null or d.proveedor_id = any(v_prov))
         and (v_tipos is null or d.tipo_k = any(v_tipos));
  else
    -- «¿Es producto?» una vez por nombre y unidad, no por línea (la expresión
    -- regular es lo más caro de todo el explorador).
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
               pf.cantidad, pf.precio_unitario, pf.importe_bruto, pf.total as total_linea,
               coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as importe
          from facturas fa
          join productos_factura pf on pf.factura_id = fa.id
          left join productos_catalogo pc on pc.id = pf.producto_id
          left join categorias_producto c on c.id = pc.categoria_id
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
      no_producto as (
        select z.nom_n, z.uni, public.es_linea_no_producto_tablero(z.nom_n, z.uni) as no_es
          from (select distinct l.nom_n, l.uni from l where v_solo) z
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
        left join no_producto np on np.nom_n = l.nom_n and np.uni = l.uni
       where (not v_solo or not coalesce(np.no_es, false));
  end if;
end;
$$;

-- ── El explorador ──────────────────────────────────────────────────────────
create or replace function public.explorar_compras(
  p_desde date,
  p_hasta date,
  p_medida text,
  p_agrupar text,
  p_desglose text default null,
  p_filtros jsonb default '{}'::jsonb,
  p_top int default 10
)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261105170000_explorar_compras
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
           count(distinct a.doc_id) as docs, count(*) as filas
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
        'unidad', (select u.unidad from u)),
    'sin_datos', (select t.docs = 0 from tot t),
    'total', (select jsonb_build_object('valor', t.valor, 'documentos', t.docs,
                                        'lineas', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros)
                                                       then t.filas end,
                                        'variacion_pct', case when v_ant_desde is not null and ta.valor > 0 and t.valor is not null
                                                                   and ta.docs >= 0.5 * t.docs
                                                              then round((t.valor / ta.valor - 1) * 100, 1) end)
                from tot t cross join tant ta),
    'anterior', case when v_ant_desde is not null then
                  (select jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta, 'valor', ta.valor, 'documentos', ta.docs)
                     from tant ta) end,
    'unidades', case when v_medida in ('cantidad', 'precio') or v_filtros ? 'unidad' then
                  coalesce((select jsonb_agg(jsonb_build_object('unidad', uds.unidad, 'lineas', uds.lineas)
                                             order by uds.lineas desc, uds.unidad) from uds), '[]'::jsonb) end,
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
$$;
comment on function public.explorar_compras(date, date, text, text, text, jsonb, int) is
  'Facturas › Análisis › Explorar: una gráfica a medida (medida, eje, desglose, filtros) en un JSON. SECURITY INVOKER. 20261105170000.';

-- ── Los documentos de una cifra ────────────────────────────────────────────
create or replace function public.documentos_de_cifra(
  p_desde date,
  p_hasta date,
  p_medida text,
  p_agrupar text default null,
  p_desglose text default null,
  p_filtros jsonb default '{}'::jsonb,
  p_clave text default null,
  p_clave_desglose text default null,
  p_top int default 10,
  p_limite int default 50,
  p_desplazamiento int default 0
)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261105170000_explorar_compras
declare
  v_medida   text := lower(btrim(coalesce(p_medida, '')));
  v_agrupar  text := nullif(lower(btrim(coalesce(p_agrupar, ''))), '');
  v_desglose text := nullif(lower(btrim(coalesce(p_desglose, ''))), '');
  v_filtros  jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_top      int := coalesce(p_top, 10);
  v_limite   int := coalesce(p_limite, 50);
  v_desp     int := coalesce(p_desplazamiento, 0);
  v_err      text;
  v_desde    date;
  v_hasta    date;
  v_tiempo   boolean;
  resultado  jsonb;
begin
  v_err := public.explorar_compras_error(v_medida, v_agrupar, v_desglose, v_filtros, v_top);
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_clave is not null and v_agrupar is null then
    return json_build_object('error', 'clave necesita agrupar.');
  end if;
  if p_clave_desglose is not null and v_desglose is null then
    return json_build_object('error', 'clave_desglose necesita desglose.');
  end if;
  if length(coalesce(p_clave, '')) > 200 or length(coalesce(p_clave_desglose, '')) > 200 then
    return json_build_object('error', 'clave demasiado larga.');
  end if;
  if v_limite < 1 or v_limite > 200 or v_desp < 0 then
    return json_build_object('error', 'limite debe estar entre 1 y 200 y desplazamiento ser ≥ 0.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  v_desde := coalesce(p_desde, (select min(fa.fecha) from facturas fa));
  v_hasta := coalesce(p_hasta, (select max(fa.fecha) from facturas fa));
  if v_desde is null or v_hasta is null or v_desde > v_hasta then
    return json_build_object('cifra', null, 'documentos', 0, 'filas', '[]'::json);
  end if;
  v_tiempo := coalesce(v_agrupar, '') in ('dia', 'semana', 'mes', 'trimestre');

  with
  h0 as materialized (
    select * from public.explorar_compras_hechos(v_desde, v_hasta, v_medida, v_agrupar, v_desglose, v_filtros)
  ),
  uds as (
    select x.unidad, count(*) as lineas from h0 x where x.unidad is not null group by x.unidad
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
  -- «Otros» del eje (categorías fuera del top) y del desglose por proveedor:
  -- el mismo orden que explorar_compras.
  top1 as (
    select g.k1 from (
      select a.k1,
             case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                           when 'cantidad' then round(sum(a.den), 3)
                           when 'documentos' then count(distinct a.doc_id)::numeric
                           else round(coalesce(sum(a.num), 0), 2) end as valor
        from h a group by a.k1) g
     order by g.valor desc nulls last, g.k1
     limit case when p_clave = '__otros__' and v_agrupar in ('proveedor', 'producto') then v_top else 0 end
  ),
  top2 as (
    select g.k2 from (
      select a.k2,
             case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                           when 'cantidad' then round(sum(a.den), 3)
                           when 'documentos' then count(distinct a.doc_id)::numeric
                           else round(coalesce(sum(a.num), 0), 2) end as valor
        from h a group by a.k2) g
     order by g.valor desc nulls last, g.k2
     limit case when p_clave_desglose = '__otros__' and v_desglose = 'proveedor' then v_top else 0 end
  ),
  sel as (
    select a.* from h a
     where (p_clave is null
            or (p_clave = '__otros__' and v_agrupar in ('proveedor', 'producto') and not exists (select 1 from top1 t where t.k1 is not distinct from a.k1))
            or a.k1 = p_clave)
       and (p_clave_desglose is null
            or (p_clave_desglose = '__otros__' and v_desglose = 'proveedor'
                and not exists (select 1 from top2 t where t.k2 is not distinct from a.k2))
            or a.k2 = p_clave_desglose)
  ),
  por_doc as (
    select s.doc_id, round(coalesce(sum(s.num), 0), 2) as aporta, round(sum(s.den), 3) as cantidad, count(*) as filas
      from sel s group by s.doc_id
  ),
  tot as (
    select case v_medida when 'precio' then round(sum(s.num) / nullif(sum(s.den), 0), 4)
                         when 'cantidad' then round(sum(s.den), 3)
                         when 'documentos' then count(distinct s.doc_id)::numeric
                         else round(coalesce(sum(s.num), 0), 2) end as valor,
           count(distinct s.doc_id) as docs,
           round(coalesce(sum(s.num), 0), 2) as importe,
           round(coalesce(sum(s.den), 0), 3) as cantidad
      from sel s
  )
  select jsonb_build_object(
    'cifra', t.valor,
    'documentos', t.docs,
    'importe_total', t.importe,
    'cantidad_total', case when v_medida in ('cantidad', 'precio') then t.cantidad end,
    'unidad', (select u.unidad from u),
    'por_lineas', public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros),
    'limite', v_limite,
    'desplazamiento', v_desp,
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', fa.id, 'fecha', fa.fecha,
               'proveedor', coalesce(pv.nombre::text, fa.proveedor::text),
               'proveedor_id', fa.proveedor_id,
               'numero_documento', fa.numero_documento,
               'tipo', case when fa.total < 0 then 'abono' else fa.tipo::text end,
               'local', case when fa.local = 'touza' then 'touza' else 'casa_tomas' end,
               'total', fa.total,
               'importe_aportado', case when v_medida = 'documentos' then coalesce(fa.total, 0) else d.aporta end,
               'cantidad', case when v_medida in ('cantidad', 'precio') then d.cantidad end,
               'lineas', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros) then d.filas end,
               'drive_url', fa.drive_url,
               'archivo_path', fa.archivo_path)
             order by fa.fecha desc, fa.id desc)
        from (select pd.* from por_doc pd
                join facturas f2 on f2.id = pd.doc_id
               order by f2.fecha desc, f2.id desc
               limit v_limite offset v_desp) d
        join facturas fa on fa.id = d.doc_id
        left join proveedores pv on pv.id = fa.proveedor_id), '[]'::jsonb)
  ) into resultado
  from tot t;

  return resultado::json;
end;
$$;
comment on function public.documentos_de_cifra(date, date, text, text, text, jsonb, text, text, int, int, int) is
  'Facturas › Análisis: los documentos que forman una cifra del explorador o del tablero, con lo que aporta cada uno (paginado). SECURITY INVOKER. 20261105170000.';

-- ── Permisos ───────────────────────────────────────────────────────────────
revoke all on function public.explorar_compras_por_lineas(text, text, text, jsonb) from public, anon;
revoke all on function public.explorar_compras_error(text, text, text, jsonb, int) from public, anon;
revoke all on function public.explorar_compras_clave(text, date, text, text, text, bigint, text) from public, anon;
revoke all on function public.explorar_compras_etiqueta(text, text, bigint, text, text) from public, anon;
revoke all on function public.explorar_compras_hechos(date, date, text, text, text, jsonb) from public, anon;
revoke all on function public.explorar_compras(date, date, text, text, text, jsonb, int) from public, anon;
revoke all on function public.documentos_de_cifra(date, date, text, text, text, jsonb, text, text, int, int, int) from public, anon;
grant execute on function public.explorar_compras_por_lineas(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.explorar_compras_error(text, text, text, jsonb, int) to authenticated, service_role;
grant execute on function public.explorar_compras_clave(text, date, text, text, text, bigint, text) to authenticated, service_role;
grant execute on function public.explorar_compras_etiqueta(text, text, bigint, text, text) to authenticated, service_role;
grant execute on function public.explorar_compras_hechos(date, date, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.explorar_compras(date, date, text, text, text, jsonb, int) to authenticated, service_role;
grant execute on function public.documentos_de_cifra(date, date, text, text, text, jsonb, text, text, int, int, int) to authenticated, service_role;

commit;

select 'explorar_compras: aplicada' as resultado;
