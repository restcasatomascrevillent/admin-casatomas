set client_encoding = 'UTF8';
-- ===========================================================================
-- analisis_rapido · 2026-11-05
-- ===========================================================================
--
-- Facturas › Análisis tardaba en abrir: tablero_compras(año) 1,2-1,7 s en la
-- BD. Lo caro era preguntar «¿esta línea es un producto?» (dos expresiones
-- regulares en es_linea_no_producto_tablero, ~45 µs por llamada) línea a
-- línea, dos veces (lo que más ha subido y gastos fijos), sobre 12.500 líneas.
--
--   · CACHÉ nombres_linea_no_producto (nombre normalizado, unidad) → bool: hay
--     ~4.100 combinaciones distintas. Se rellena aquí y la mantiene al día un
--     trigger AFTER INSERT/UPDATE OF nombre, unidad de productos_factura (una
--     fila nueva solo si el nombre es nuevo). Si faltara alguna, las RPC la
--     calculan al vuelo (coalesce), así que nunca cambian las cifras.
--     NO es una columna generada: añadirla reescribe productos_factura y su
--     índice HNSW de embeddings (en la demo pasó de 2 min y se canceló).
--   · tablero_compras y explorar_compras_hechos leen la caché (misma firma,
--     mismas cifras: lo comprueban tablero_compras_test y explorar_compras_test).
--   · OJO: si se cambia la lista de es_linea_no_producto_tablero hay que
--     vaciar la caché y volver a rellenarla (ver el final del test).
--
-- RLS: lectura con can_read_section('facturas') (lo mismo que las líneas) y el
-- bloqueo de sesión del panel; escribe solo el trigger (SECURITY DEFINER).
--
-- Idempotente. Test: supabase/tests/analisis_rapido_test.sql
-- Rollback: supabase/rollbacks/20261105191000_analisis_rapido_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create table if not exists public.nombres_linea_no_producto (
  nombre_n    text    not null,
  unidad_k    text    not null,
  no_producto boolean not null,
  primary key (nombre_n, unidad_k)
);
comment on table public.nombres_linea_no_producto is
  'Caché de es_linea_no_producto_tablero(nombre normalizado, unidad) para el tablero y el explorador de Análisis. La mantiene trg_productos_factura_no_producto. 20261105191000.';

alter table public.nombres_linea_no_producto enable row level security;
revoke all on table public.nombres_linea_no_producto from public, anon;
grant select on table public.nombres_linea_no_producto to authenticated;
grant all on table public.nombres_linea_no_producto to service_role;

drop policy if exists nombres_linea_no_producto_select on public.nombres_linea_no_producto;
create policy nombres_linea_no_producto_select on public.nombres_linea_no_producto
  for select to authenticated using (public.can_read_section('facturas'));
drop policy if exists nombres_linea_no_producto_service_role on public.nombres_linea_no_producto;
create policy nombres_linea_no_producto_service_role on public.nombres_linea_no_producto
  for all to service_role using (true) with check (true);
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.nombres_linea_no_producto';
    execute 'create policy "acceso_panel_no_bloqueado" on public.nombres_linea_no_producto as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- Relleno (una vez por combinación distinta).
insert into public.nombres_linea_no_producto (nombre_n, unidad_k, no_producto)
select z.nombre_n, z.unidad_k, public.es_linea_no_producto_tablero(z.nombre_n, z.unidad_k)
  from (select distinct coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nombre_n,
                        lower(btrim(coalesce(pf.unidad::text, ''))) as unidad_k
          from public.productos_factura pf) z
 where z.nombre_n is not null
on conflict do nothing;

-- Mantenimiento: cada línea nueva (o renombrada) apunta su nombre si no estaba.
create or replace function public.productos_factura_no_producto_cache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := coalesce(nullif(new.nombre_normalizado::text, ''), lower(new.nombre::text));
  v_unidad text := lower(btrim(coalesce(new.unidad::text, '')));
begin
  if v_nombre is not null then
    insert into public.nombres_linea_no_producto (nombre_n, unidad_k, no_producto)
    values (v_nombre, v_unidad, public.es_linea_no_producto_tablero(v_nombre, v_unidad))
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.productos_factura_no_producto_cache() from public, anon, authenticated;

drop trigger if exists trg_productos_factura_no_producto on public.productos_factura;
create trigger trg_productos_factura_no_producto
  after insert or update of nombre, unidad on public.productos_factura
  for each row execute function public.productos_factura_no_producto_cache();

create or replace function public.tablero_compras(
  p_desde date default null,
  p_hasta date default null,
  p_local text default null
)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261105150500_tablero_compras
-- 20261105191000_analisis_rapido: «¿no es producto?» sale de la caché nombres_linea_no_producto
declare
  v_local     text := nullif(lower(btrim(coalesce(p_local, ''))), '');
  v_desde     date;
  v_hasta     date;
  v_hasta_ef  date;
  v_meses     int;
  v_ant_desde date;
  v_ant_hasta date;
  v_ini_hasta date;   -- fin del primer tercio
  v_fin_desde date;   -- inicio del último tercio
  v_d1        date;
  v_d2        date;
  v_fij_desde date;
  v_fij_hasta date;
  resultado   jsonb;
begin
  -- ── Argumentos ──
  if v_local in ('todos', 'ambos', 'todo') then
    v_local := null;
  elsif v_local in ('casa tomas', 'casa tomás', 'casatomas', 'casa_tomás') then
    v_local := 'casa_tomas';
  end if;
  if v_local is not null and v_local not in ('casa_tomas', 'touza') then
    return json_build_object('error', 'local debe ser casa_tomas, touza o null (los dos).');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  -- Sin fechas = todo el histórico (de la primera a la última fecha cargada).
  v_desde := coalesce(p_desde, (select min(f.fecha) from facturas f));
  v_hasta := coalesce(p_hasta, (select max(f.fecha) from facturas f));
  if v_desde is null or v_hasta is null then
    return json_build_object('sin_datos', true,
                             'periodo', json_build_object('desde', p_desde, 'hasta', p_hasta, 'local', v_local));
  end if;
  if v_desde > v_hasta then
    return json_build_object('sin_datos', true,
                             'periodo', json_build_object('desde', v_desde, 'hasta', v_hasta, 'local', v_local));
  end if;

  -- Periodo abierto (incluye hoy): se compara solo hasta hoy.
  v_hasta_ef := case when v_desde <= current_date and v_hasta > current_date then current_date else v_hasta end;

  -- Periodo anterior equivalente (solo con las dos fechas):
  --   meses enteros (día 1 … último día) → los mismos meses justo antes, hasta
  --   el mismo día relativo; si no, los mismos días justo antes.
  if p_desde is not null and p_hasta is not null then
    if extract(day from p_desde) = 1
       and p_hasta = (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date then
      v_meses := (extract(year from p_hasta)::int * 12 + extract(month from p_hasta)::int)
               - (extract(year from p_desde)::int * 12 + extract(month from p_desde)::int) + 1;
      v_ant_desde := (p_desde - make_interval(months => v_meses))::date;
      -- Periodo cerrado: los meses anteriores enteros (30 sep → 31 ago, no 30 ago).
      v_ant_hasta := case when v_hasta_ef = p_hasta then p_desde - 1
                          else (v_hasta_ef - make_interval(months => v_meses))::date end;
    else
      v_ant_hasta := p_desde - 1;
      v_ant_desde := v_ant_hasta - (v_hasta_ef - p_desde);
    end if;
  end if;

  -- Tramos para «lo que más ha subido»: tercios del intervalo donde de verdad
  -- hay documentos (percentiles 2 y 98 de las fechas), para que unos pocos
  -- documentos sueltos muy antiguos no dejen vacío el primer tercio.
  select percentile_disc(0.02) within group (order by f.fecha),
         percentile_disc(0.98) within group (order by f.fecha)
    into v_d1, v_d2
    from facturas f
   where f.fecha between v_desde and v_hasta_ef
     and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local);
  if v_d1 is not null then
    v_ini_hasta := v_d1 + (v_d2 - v_d1) / 3;
    v_fin_desde := v_d2 - (v_d2 - v_d1) / 3;
  end if;

  -- Ventana de gastos fijos: el periodo si abarca ≥ 3 meses; si no, los 12
  -- meses que acaban en él.
  if (v_hasta_ef - v_desde) >= 85 then
    v_fij_desde := v_desde;
  else
    v_fij_desde := (date_trunc('month', v_hasta_ef) - interval '11 months')::date;
  end if;
  v_fij_hasta := v_hasta_ef;

  with
  -- Documentos que suman (sin albaranes ya facturados), de los dos locales.
  docs_todos as (
    select f.id, f.tipo::text as tipo, f.fecha, f.total, coalesce(f.total, 0)::numeric as importe,
           f.proveedor_id,
           coalesce(f.proveedor_id::text, 'n:' || coalesce(nullif(f.proveedor_normalizado::text, ''), lower(f.proveedor::text), '?')) as prov_k,
           f.proveedor::text as proveedor_txt,
           case when f.local = 'touza' then 'touza' else 'casa_tomas' end as loc
      from facturas f
     where f.fecha between v_desde and v_hasta
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  docs as (
    select * from docs_todos where v_local is null or loc = v_local
  ),
  tot as (
    select coalesce(sum(importe), 0) as gasto, count(*) as n from docs
  ),
  anterior as (
    select coalesce(sum(coalesce(f.total, 0)), 0) as gasto, count(*) as n
      from facturas f
     where v_ant_desde is not null
       and f.fecha between v_ant_desde and v_ant_hasta
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
       and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
  ),
  -- Líneas de los documentos que suman (base SIN IVA).
  lineas as (
    select pf.id, pf.factura_id, d.fecha, d.proveedor_id, d.prov_k, d.loc,
           pf.nombre::text as nombre,
           coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.cantidad, pf.precio_unitario,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as importe,
           pf.importe_bruto, pf.total as total_linea, coalesce(pf.importe_bruto_estimado, false) as bruto_estimado,
           pf.producto_id, p.categoria_id, lower(btrim(coalesce(pf.unidad::text, ''))) as uni_k
      from productos_factura pf
      join docs d on d.id = pf.factura_id
      left join productos_catalogo p on p.id = pf.producto_id
  ),
  nombres as (
    select k.prov_k, coalesce(pv.nombre::text, k.txt) as nombre
      from (select prov_k, max(proveedor_id) as proveedor_id, max(proveedor_txt) as txt
              from docs_todos group by prov_k) k
      left join proveedores pv on pv.id = k.proveedor_id
  ),
  -- ── Gasto por mes ──
  rango_meses as (
    select generate_series(date_trunc('month', min(fecha)), date_trunc('month', max(fecha)), interval '1 month')::date as mes
      from docs
  ),
  por_mes as (
    select to_char(m.mes, 'YYYY-MM') as mes,
           coalesce(sum(d.importe) filter (where d.loc = 'casa_tomas'), 0) as casa_tomas,
           coalesce(sum(d.importe) filter (where d.loc = 'touza'), 0)      as touza,
           coalesce(sum(d.importe), 0) as total,
           count(d.id) as documentos
      from rango_meses m
      left join docs d on date_trunc('month', d.fecha)::date = m.mes
     group by m.mes
  ),
  -- ── Proveedores ──
  por_prov as (
    select d.prov_k, max(d.proveedor_id) as id, sum(d.importe) as gasto, count(*) as documentos
      from docs d group by d.prov_k
  ),
  -- ── Lo que más ha subido ──
  precios as (
    select l.proveedor_id, l.nom_n, l.unidad,
           max(l.nombre) as nombre,
           sum(l.precio_unitario * l.cantidad) filter (where l.fecha <= v_ini_hasta)
             / nullif(sum(l.cantidad) filter (where l.fecha <= v_ini_hasta), 0) as p_ini,
           sum(l.precio_unitario * l.cantidad) filter (where l.fecha >= v_fin_desde)
             / nullif(sum(l.cantidad) filter (where l.fecha >= v_fin_desde), 0) as p_fin,
           count(distinct l.factura_id) filter (where l.fecha <= v_ini_hasta) as n_ini,
           count(distinct l.factura_id) filter (where l.fecha >= v_fin_desde) as n_fin,
           sum(l.importe) as importe
      from lineas l
      left join public.nombres_linea_no_producto np on np.nombre_n = l.nom_n and np.unidad_k = l.uni_k
     where v_ini_hasta is not null
       and l.proveedor_id is not null
       and l.cantidad > 0 and l.precio_unitario > 0
       and not coalesce(np.no_producto, public.es_linea_no_producto_tablero(l.nom_n, l.unidad))
     group by l.proveedor_id, l.nom_n, l.unidad
  ),
  subidas as (
    select p.*, round((p.p_fin / p.p_ini - 1) * 100, 1) as var
      from precios p
     where p.n_ini >= 2 and p.n_fin >= 2 and p.p_ini > 0
       and p.p_fin > p.p_ini
       -- Más de ×4 suele ser un cambio de formato con la misma unidad, no una subida.
       and p.p_fin / p.p_ini <= 4
  ),
  -- ── Familias ──
  familias as (
    select coalesce(m.id, c.id) as id, coalesce(m.nombre, c.nombre)::text as familia,
           min(coalesce(m.orden, c.orden)) as orden,
           sum(l.importe) as importe, count(*) as lineas
      from lineas l
      join categorias_producto c on c.id = l.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     group by 1, 2
  ),
  -- ── Gastos fijos ──
  docs_fij as (
    select f.id, f.fecha, coalesce(f.total, 0)::numeric as importe,
           coalesce(f.proveedor_id::text, 'n:' || coalesce(nullif(f.proveedor_normalizado::text, ''), lower(f.proveedor::text), '?')) as prov_k,
           f.proveedor_id, f.proveedor::text as proveedor_txt,
           date_trunc('month', f.fecha)::date as mes
      from facturas f
     where f.fecha between v_fij_desde and v_fij_hasta
       and f.tipo = 'factura'
       and (v_local is null or (case when f.local = 'touza' then 'touza' else 'casa_tomas' end) = v_local)
  ),
  -- Meses «con datos»: los que tienen al menos un 25 % de los documentos del mes
  -- más cargado (un mes con 4 documentos sueltos no cuenta como mes completo).
  meses_fij as (
    select mes, count(*) as n from docs_fij group by mes
  ),
  meses_ok as (
    select mes from meses_fij where n >= 0.25 * (select max(n) from meses_fij)
  ),
  -- Qué parte de lo que factura cada proveedor son líneas de suministro o
  -- servicio (alquiler, luz, teléfono, gestoría…), no producto.
  serv_fij as (
    select d.prov_k,
           coalesce(sum(pf.total) filter (where pf.total > 0
                                   and coalesce(np.no_producto,
                                                public.es_linea_no_producto_tablero(coalesce(pf.nombre_normalizado::text, pf.nombre::text), pf.unidad::text))), 0)
             / nullif(sum(pf.total) filter (where pf.total > 0), 0) as pct_serv
      from docs_fij d
      join productos_factura pf on pf.factura_id = d.id
      left join public.nombres_linea_no_producto np
             on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
     group by d.prov_k
  ),
  mes_fij as (
    select d.prov_k, d.mes, sum(d.importe) as importe, count(*) as documentos
      from docs_fij d
      join meses_ok mo on mo.mes = d.mes
     where d.importe > 0
     group by d.prov_k, d.mes
  ),
  fij as (
    select m.prov_k, (select max(d.proveedor_id) from docs_fij d where d.prov_k = m.prov_k) as id,
           (select max(d.proveedor_txt) from docs_fij d where d.prov_k = m.prov_k) as txt,
           count(*) as meses, sum(m.documentos) as documentos, sum(m.importe) as importe,
           stddev_pop(m.importe) / nullif(avg(m.importe), 0) as cv,
           (select count(*) from meses_ok) as meses_datos
      from mes_fij m
     group by m.prov_k
  ),
  -- Fijo = factura casi todos los meses Y es un suministro/servicio (≥ 75 % del
  -- importe de sus líneas no es producto) o, sin líneas leídas, cobra casi lo
  -- mismo cada mes (variación ≤ 15 %). Así un mayorista que manda una factura
  -- mensual no sale como gasto fijo.
  fijos as (
    select f.*, coalesce(pv.nombre::text, f.txt) as nombre, f.importe / f.meses as medio
      from fij f
      left join serv_fij s on s.prov_k = f.prov_k
      left join proveedores pv on pv.id = f.id
     where f.meses_datos >= 3
       and f.meses >= greatest(3, ceil(0.75 * f.meses_datos))
       and f.documentos::numeric / f.meses <= 4
       and (coalesce(s.pct_serv, 0) >= 0.75 or (s.pct_serv is null and coalesce(f.cv, 1) <= 0.15))
  ),
  -- ── Abonos ──
  abonos as (
    select d.prov_k, max(d.proveedor_id) as id, sum(d.importe) as importe, count(*) as n
      from docs d where d.total < 0 group by d.prov_k
  ),
  -- ── Regalado y descuentos ──
  regalado as (
    select coalesce(sum(l.importe_bruto - l.total_linea), 0) as importe,
           coalesce(sum(l.importe_bruto), 0) as valia,
           count(*) as lineas,
           count(*) filter (where l.bruto_estimado) as estimadas,
           coalesce(sum(l.importe_bruto - l.total_linea) filter (where l.bruto_estimado), 0) as importe_estimado
      from lineas l
     where l.importe_bruto > l.total_linea
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object(
        'desde', v_desde, 'hasta', v_hasta, 'hasta_efectivo', v_hasta_ef, 'local', v_local,
        'anterior', case when v_ant_desde is not null then jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta) end),
    'sin_datos', (select n = 0 from tot),
    'criterio', 'Gasto de documentos con IVA (facturas y albaranes sin factura; el albarán ya facturado no suma). '
                || 'Importes de línea (familias, precios) SIN IVA. Local vacío = Casa Tomás.',
    'indicadores', (
      select jsonb_build_object(
        'gasto',              round(t.gasto, 2),
        'gasto_anterior',     case when v_ant_desde is not null and a.n > 0 then round(a.gasto, 2) end,
        'documentos_anterior', case when v_ant_desde is not null then a.n end,
        -- Solo se compara si el periodo anterior está cargado de verdad (al
        -- menos la mitad de documentos que el actual): con 1 documento suelto
        -- un «+400.000 %» no dice nada.
        'variacion_pct',      case when v_ant_desde is not null and a.gasto > 0 and a.n >= 0.5 * t.n
                                   then round((t.gasto / a.gasto - 1) * 100, 1) end,
        'documentos',         t.n,
        'facturas',           (select count(*) from docs where tipo = 'factura'),
        'albaranes_sin_factura', (select count(*) from docs where tipo = 'albaran'),
        'albaranes_sin_factura_importe', (select round(coalesce(sum(importe), 0), 2) from docs where tipo = 'albaran'),
        'sin_total',          (select count(*) from docs where total is null),
        'abonos',             (select round(coalesce(sum(importe), 0), 2) from docs where total < 0),
        'abonos_n',           (select count(*) from docs where total < 0),
        'regalado',           round(r.importe, 2),
        'regalado_valia',     round(r.valia, 2),
        'regalado_lineas',    r.lineas,
        'regalado_estimadas', r.estimadas,
        'regalado_estimado_importe', round(r.importe_estimado, 2),
        'proveedores',        (select count(*) from por_prov))
        from tot t cross join anterior a cross join regalado r),
    'meses', coalesce((
      select jsonb_agg(jsonb_build_object('mes', m.mes, 'casa_tomas', round(m.casa_tomas, 2),
                                          'touza', round(m.touza, 2), 'total', round(m.total, 2),
                                          'documentos', m.documentos) order by m.mes)
        from por_mes m), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'gasto', round(x.gasto, 2),
                                          'pct', case when t.gasto > 0 then round(100 * x.gasto / t.gasto, 1) end,
                                          'documentos', x.documentos) order by x.gasto desc, x.nombre)
        from (select p.*, n.nombre from por_prov p join nombres n on n.prov_k = p.prov_k
               where p.gasto > 0 order by p.gasto desc, n.nombre limit 10) x
        cross join tot t), '[]'::jsonb),
    'subidas', jsonb_build_object(
      'tramo_inicio', case when v_ini_hasta is not null then jsonb_build_object('desde', v_d1, 'hasta', v_ini_hasta) end,
      'tramo_fin',    case when v_fin_desde is not null then jsonb_build_object('desde', v_fin_desde, 'hasta', v_d2) end,
      'criterio', 'Mismo proveedor, mismo producto y misma unidad; precio medio (SIN IVA) del primer tercio del periodo '
                  || 'frente al del último tercio; mínimo 2 compras en cada tramo; sin servicios, portes, envases, '
                  || 'energía, residuos ni descuentos.',
      'comparados', (select count(*) from precios where n_ini >= 2 and n_fin >= 2),
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'producto', s.nombre, 'nombre_normalizado', s.nom_n, 'unidad', s.unidad,
                 'proveedor_id', s.proveedor_id, 'proveedor', coalesce(pv.nombre::text, '?'),
                 'precio_inicio', round(s.p_ini, 4), 'precio_fin', round(s.p_fin, 4),
                 'variacion_pct', s.var, 'compras_inicio', s.n_ini, 'compras_fin', s.n_fin,
                 'importe', round(s.importe, 2)) order by s.var desc, s.importe desc)
          from (select * from subidas order by var desc, importe desc limit 10) s
          left join proveedores pv on pv.id = s.proveedor_id), '[]'::jsonb)),
    'familias', (
      select jsonb_build_object(
        'importe_total',  round(coalesce(sum(l.importe), 0), 2),
        'lineas',         count(*),
        'sin_clasificar', jsonb_build_object(
                            'lineas',  count(*) filter (where l.categoria_id is null),
                            'importe', round(coalesce(sum(l.importe) filter (where l.categoria_id is null), 0), 2)),
        'familias', coalesce((
          select jsonb_agg(jsonb_build_object('id', fa.id, 'familia', fa.familia, 'importe', round(fa.importe, 2),
                                              'lineas', fa.lineas) order by fa.importe desc nulls last, fa.orden)
            from familias fa), '[]'::jsonb))
        from lineas l),
    'fijos', jsonb_build_object(
      'ventana', jsonb_build_object('desde', v_fij_desde, 'hasta', v_fij_hasta,
                                    'meses_con_datos', (select count(*) from meses_ok)),
      'criterio', 'Proveedores con factura en al menos el 75 % de los meses con datos (mínimo 3) que son suministro o '
                  || 'servicio (alquiler, luz, gas, agua, teléfono, gestoría, renting…). Importe medio con IVA de los '
                  || 'meses en que facturan.',
      'total_medio_mes', (select round(coalesce(sum(medio), 0), 2) from fijos),
      'proveedores', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'nombre', f.nombre, 'medio_mes', round(f.medio, 2),
                                            'meses', f.meses, 'meses_con_datos', f.meses_datos,
                                            'documentos', f.documentos) order by f.medio desc, f.nombre)
          from fijos f), '[]'::jsonb)),
    'abonos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'importe', round(x.importe, 2), 'documentos', x.n)
                       order by x.importe, x.nombre)
        from (select a.*, n.nombre from abonos a join nombres n on n.prov_k = a.prov_k
               order by a.importe, n.nombre limit 8) x), '[]'::jsonb),
    'locales', jsonb_build_object(
      'casa_tomas', (select jsonb_build_object('gasto', round(coalesce(sum(importe), 0), 2), 'documentos', count(*))
                       from docs_todos where loc = 'casa_tomas'),
      'touza',      (select jsonb_build_object('gasto', round(coalesce(sum(importe), 0), 2), 'documentos', count(*))
                       from docs_todos where loc = 'touza'),
      'meses', coalesce((
        select jsonb_agg(jsonb_build_object('mes', x.mes, 'casa_tomas', round(x.ct, 2), 'touza', round(x.tz, 2)) order by x.mes)
          from (select to_char(fecha, 'YYYY-MM') as mes,
                       coalesce(sum(importe) filter (where loc = 'casa_tomas'), 0) as ct,
                       coalesce(sum(importe) filter (where loc = 'touza'), 0) as tz
                  from docs_todos group by 1) x), '[]'::jsonb))
  ) into resultado;

  return resultado::json;
end;
$$;
comment on function public.tablero_compras(date, date, text) is
  'Facturas › Análisis: todos los bloques del tablero de compras en un JSON (indicadores, meses, proveedores, subidas, familias, fijos, abonos, locales). SECURITY INVOKER. 20261105150500 (rápida: 20261105191000).';

revoke all on function public.tablero_compras(date, date, text) from public, anon;
grant execute on function public.tablero_compras(date, date, text) to authenticated, service_role;

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
               coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as importe
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
       where (not v_solo or not coalesce(l.no_prod, public.es_linea_no_producto_tablero(l.nom_n, l.uni)));
  end if;
end;
$$;


commit;

select 'analisis_rapido: aplicada' as resultado;
