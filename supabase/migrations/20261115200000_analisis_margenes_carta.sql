set client_encoding = 'UTF8';
-- ============================================================================
-- 20261115200000_analisis_margenes_carta — «Análisis general › Márgenes de
-- carta» (07/11/2026)
-- ----------------------------------------------------------------------------
-- Petición del dueño: cruzar los precios de la carta con lo que cuesta comprar
-- sus ingredientes principales (facturas) y enseñar dónde NO funcionan los
-- márgenes. No hay ventas por plato: el análisis es POR RACIÓN (o por unidad de
-- venta: 100 g, kg…), sin volumen.
--
-- QUÉ AÑADE
--   1. margenes_carta_config (fila única): umbrales. Por defecto: plato en rojo
--      si el coste pasa del 35 % del precio sin IVA; vino en rojo si el
--      multiplicador (precio de CARTA, con IVA, / coste sin IVA de la
--      botella) baja de 2,5×; el % de coste de vinos y platos, sin IVA;
--      «sube el coste» si sube más de un 10 % frente a hace 6 meses; IVA de
--      hostelería 10 %; ventana de referencia 90 días.
--   2. escandallo_platos: ingredientes PRINCIPALES de cada plato (1-3, los que
--      pesan en el coste) como producto del catálogo + cantidad por unidad de
--      venta en g, ml o ud. «ud» = la UNIDAD DE COMPRA de las líneas (lata,
--      cubeta, docena, caja…): 0,05 ud de helado = 5 % de una cubeta.
--      origen 'estimado' (lo puso Claude, migración de datos 20261115210000)
--      o 'manual' (corregido en el panel).
--   3. vino_producto: el producto del catálogo que es la botella de cada vino
--      de la carta (mismo vino; la añada puede diferir).
--   4. margenes_carta_revision: «revisado» por artículo y el motivo cuando no
--      se pudo mapear («No hay compras de…»).
--   5. margenes_carta_costes(ids, hoy, días) (interna): coste de compra por
--      producto, en una pasada por conjuntos:
--        · Líneas de Casa Tomás (local NULL o distinto de 'touza'), base SIN IVA
--          de la línea (productos_factura.total), sin albaranes facturados
--          (facturado_en_id no nulo), sin abonos ni líneas a 0.
--        · €/kg o €/l con volumen_linea (20261106400000: envase del catálogo o
--          del texto de la línea) y €/ud de compra (importe / cantidad) de las
--          líneas que no son a granel.
--        · Referencia ACTUAL = mediana de los últimos `días` (90); si no hay
--          compras en esa ventana, las 3 últimas compras. HACE 6 MESES = lo
--          mismo con el corte en hoy − 6 meses.
--   6. margenes_carta(hoy) (panel): un jsonb con config, resumen, platos y
--      vinos: precio sin IVA, coste actual y de hace 6 meses, % de coste,
--      margen bruto por ración, ingrediente que más pesa y banderas
--      (coste_alto, multiplicador_bajo, sube_coste, sin_datos, incompleto,
--      sin_mapear, sin_precio). «sube_coste» solo si el precio de la carta no
--      se ha tocado en 6 meses según historial_ajustes_precios (las subidas en
--      bloque; las ediciones sueltas de precio no quedan registradas).
--   7. RPC de edición (exigen «Editar» en Facturas): margenes_guardar_escandallo,
--      margenes_guardar_vino, margenes_marcar_revisado, margenes_guardar_config;
--      de apoyo: margenes_buscar_productos y margenes_compras_producto (las
--      compras que forman el coste, con su documento para abrir el original).
--
-- PERMISOS: la sección del panel usa los permisos de Facturas (no hay sección
-- 'analisis' propia). Lectura con (select can_read_section('facturas')),
-- edición con (select can_edit_section('facturas')): ENVUELTAS en select para
-- que se evalúen una vez por consulta (20261105200000; sin envolver, timeouts).
--
-- Rollback: supabase/rollbacks/20261115200000_analisis_margenes_carta_ROLLBACK.sql
-- Test:     supabase/tests/analisis_margenes_carta_test.sql
-- ============================================================================
set lock_timeout = '5s';

-- ─── 1. Configuración ───────────────────────────────────────────────────────
create table if not exists public.margenes_carta_config (
  id boolean primary key default true check (id),
  coste_max_plato_pct numeric(5,2) not null default 35 check (coste_max_plato_pct > 0 and coste_max_plato_pct < 100),
  multiplicador_min_vino numeric(5,2) not null default 2.5 check (multiplicador_min_vino > 0 and multiplicador_min_vino <= 20),
  subida_coste_pct numeric(5,2) not null default 10 check (subida_coste_pct >= 0 and subida_coste_pct <= 100),
  iva_pct numeric(5,2) not null default 10 check (iva_pct >= 0 and iva_pct < 100),
  dias_referencia integer not null default 90 check (dias_referencia between 7 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.margenes_carta_config (id) values (true) on conflict (id) do nothing;

-- ─── 2. Escandallo de platos ────────────────────────────────────────────────
create table if not exists public.escandallo_platos (
  id bigint generated always as identity primary key,
  plato_id text not null references public."Platos"(id) on delete cascade,
  producto_id bigint not null references public.productos_catalogo(id) on delete cascade,
  cantidad numeric(12,4) not null check (cantidad > 0 and cantidad <= 100000),
  unidad text not null check (unidad in ('g', 'ml', 'ud')),
  origen text not null default 'manual' check (origen in ('estimado', 'manual')),
  nota text check (nota is null or char_length(nota) <= 300),
  orden smallint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (plato_id, producto_id)
);
create index if not exists escandallo_platos_producto_idx on public.escandallo_platos (producto_id);

-- ─── 3. Vino ↔ producto ─────────────────────────────────────────────────────
create table if not exists public.vino_producto (
  vino_id text primary key references public."Vinos"(id) on delete cascade,
  producto_id bigint not null references public.productos_catalogo(id) on delete cascade,
  origen text not null default 'manual' check (origen in ('estimado', 'manual')),
  nota text check (nota is null or char_length(nota) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists vino_producto_producto_idx on public.vino_producto (producto_id);

-- ─── 4. Revisión y motivo de «sin mapear» ───────────────────────────────────
create table if not exists public.margenes_carta_revision (
  tipo text not null check (tipo in ('plato', 'vino')),
  articulo_id text not null,
  revisado boolean not null default false,
  sin_mapear_motivo text check (sin_mapear_motivo is null or char_length(sin_mapear_motivo) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tipo, articulo_id)
);

-- ─── RLS ────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['margenes_carta_config', 'escandallo_platos', 'vino_producto', 'margenes_carta_revision'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''facturas'')))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_edit_section(''facturas'')))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.can_edit_section(''facturas''))) with check ((select public.can_edit_section(''facturas'')))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.can_edit_section(''facturas'')))', t || '_delete', t);
  end loop;
end $$;
-- La fila única de configuración no se borra ni se crea desde el panel.
drop policy if exists margenes_carta_config_insert on public.margenes_carta_config;
drop policy if exists margenes_carta_config_delete on public.margenes_carta_config;
revoke insert, delete on public.margenes_carta_config from authenticated;

-- ─── 5. Coste de compra por producto (interna) ──────────────────────────────
create or replace function public.margenes_carta_costes(p_ids bigint[], p_hoy date, p_dias integer)
returns table (
  producto_id bigint, eur_base numeric, medida text, eur_ud numeric, unidad_compra text,
  lineas integer, ultima date, eur_base_6m numeric, eur_ud_6m numeric
)
language sql
stable
set search_path = public
as $$
  -- 20261115200000_analisis_margenes_carta
  with l as (
    select pf.producto_id, pf.id, fa.fecha, pf.total as importe, pf.cantidad,
           coalesce(unidad_agente(pf.unidad::text), 'ud') as u, v.medida, v.cantidad_base
      from productos_factura pf
      join facturas fa on fa.id = pf.factura_id
      join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join lateral volumen_linea(pf.nombre::text, pf.unidad::text, pf.cantidad,
             coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)),
             pf.contenido_cantidad, pf.contenido_unidad, pc.envase_cantidad, pc.envase_unidad,
             pc.envases_por_bulto, volumen_max_eur_litro(c.nombre)) v on true
     where pf.producto_id = any(p_ids)
       and fa.fecha is not null and fa.fecha <= p_hoy
       and fa.local is distinct from 'touza'
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and coalesce(fa.total, 0) >= 0
       and pf.total > 0 and pf.cantidad > 0
  ),
  r as (
    select x.ref, x.corte, l.*
      from (values ('a', p_hoy), ('b', (p_hoy - interval '6 months')::date)) as x(ref, corte)
      join l on l.fecha <= x.corte
  ),
  w as (
    select r.*,
           row_number() over (partition by r.ref, r.producto_id order by r.fecha desc, r.id desc) as rn,
           count(*) filter (where r.fecha > r.corte - p_dias) over (partition by r.ref, r.producto_id) as n_vent
      from r
  ),
  s as (
    select * from w
     where (n_vent > 0 and fecha > corte - p_dias) or (n_vent = 0 and rn <= 3)
  ),
  agg as (
    select s.ref, s.producto_id,
           percentile_cont(0.5) within group (order by s.importe / s.cantidad_base)
             filter (where s.medida is not null and s.cantidad_base > 0) as eur_base,
           mode() within group (order by s.medida) filter (where s.medida is not null) as medida,
           percentile_cont(0.5) within group (order by s.importe / s.cantidad)
             filter (where s.u not in ('kg', 'l')) as eur_ud,
           mode() within group (order by s.u) filter (where s.u not in ('kg', 'l')) as unidad_compra,
           count(*)::int as n, max(s.fecha) as ultima
      from s
     group by s.ref, s.producto_id
  )
  select a.producto_id,
         round(a.eur_base::numeric, 4), a.medida, round(a.eur_ud::numeric, 4), a.unidad_compra,
         a.n, a.ultima,
         round(b.eur_base::numeric, 4), round(b.eur_ud::numeric, 4)
    from agg a
    left join agg b on b.producto_id = a.producto_id and b.ref = 'b'
   where a.ref = 'a'
$$;
revoke all on function public.margenes_carta_costes(bigint[], date, integer) from public, anon, authenticated;

-- Gramos de la unidad de venta de un plato («100 g» → 100, «kg» → 1000; «Unidad» → NULL).
create or replace function public.margenes_gramos_venta(p_unidad text)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- 20261115200000_analisis_margenes_carta
  select case
    when p_unidad ~* '^\s*kg\s*$' then 1000::numeric
    when p_unidad ~* '^\s*\d+([.,]\d+)?\s*kg\s*$' then replace(substring(p_unidad from '\d+(?:[.,]\d+)?'), ',', '.')::numeric * 1000
    when p_unidad ~* '^\s*\d+([.,]\d+)?\s*g\s*$' then replace(substring(p_unidad from '\d+(?:[.,]\d+)?'), ',', '.')::numeric
  end
$$;

-- ─── 6. El análisis para el panel ───────────────────────────────────────────
create or replace function public.margenes_carta(p_hoy date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta. Ver la cabecera de la migración.
declare
  v_hoy date := coalesce(p_hoy, current_date);
  c public.margenes_carta_config%rowtype;
  v_ids bigint[];
  v_iva numeric;
  v_res jsonb;
begin
  if not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso para ver los márgenes de la carta' using errcode = '42501';
  end if;
  select * into c from public.margenes_carta_config where id;
  if not found then
    c.coste_max_plato_pct := 35; c.multiplicador_min_vino := 2.5; c.subida_coste_pct := 10;
    c.iva_pct := 10; c.dias_referencia := 90;
  end if;
  v_iva := 1 + c.iva_pct / 100;

  select coalesce(array_agg(distinct x.producto_id), '{}') into v_ids
    from (select e.producto_id from escandallo_platos e union select vp.producto_id from vino_producto vp) x;

  with k as materialized (
    select * from margenes_carta_costes(v_ids, v_hoy, c.dias_referencia)
  ),
  ajustes as (
    select distinct h.tipo_carta, e->>'id' as id
      from historial_ajustes_precios h
      cross join lateral jsonb_array_elements(case when jsonb_typeof(h.snapshot) = 'array' then h.snapshot else '[]'::jsonb end) e
     where h.fecha > v_hoy - interval '6 months'
  ),
  rev as (
    select * from margenes_carta_revision
  ),
  -- PLATOS ------------------------------------------------------------------
  pl as (
    select p.id, p.nombre, p.categoria, p.precio_eur::numeric as precio, p.unidad, p.orden,
           margenes_gramos_venta(p.unidad) as gramos_venta
      from "Platos" p
     where p.activado and p.restaurante
  ),
  ing as (
    select e.plato_id, e.id, e.producto_id, pc.nombre as producto, e.cantidad, e.unidad, e.origen, e.nota, e.orden,
           k.medida, k.unidad_compra, k.lineas, k.ultima,
           case when e.unidad = 'ud' then k.eur_ud else k.eur_base end as eur,
           case when e.unidad = 'ud' then k.eur_ud_6m else k.eur_base_6m end as eur_6m
      from escandallo_platos e
      join pl on pl.id = e.plato_id
      join productos_catalogo pc on pc.id = e.producto_id
      left join k on k.producto_id = e.producto_id
  ),
  ing2 as (
    select ing.*,
           round(case when unidad = 'ud' then cantidad * eur else cantidad / 1000 * eur end, 4) as coste,
           round(case when unidad = 'ud' then cantidad * eur_6m else cantidad / 1000 * eur_6m end, 4) as coste_6m
      from ing
  ),
  pp as (
    select plato_id,
           sum(coste) as coste, sum(coste_6m) as coste_6m,
           count(*) as n, count(coste) as n_con, count(coste_6m) as n_6m,
           bool_or(origen = 'manual') as manual,
           (array_agg(producto order by coste desc nulls last))[1] as principal,
           (array_agg(coste order by coste desc nulls last))[1] as principal_coste,
           jsonb_agg(jsonb_build_object(
             'id', id, 'producto_id', producto_id, 'producto', producto,
             'cantidad', cantidad, 'unidad', unidad, 'origen', origen, 'nota', nota,
             'medida', medida, 'unidad_compra', unidad_compra, 'eur', eur, 'eur_6m', eur_6m,
             'coste', coste, 'coste_6m', coste_6m, 'lineas', lineas, 'ultima', ultima
           ) order by orden, id) as ingredientes
      from ing2
     group by plato_id
  ),
  pc1 as (
    select pl.*, pp.coste, pp.coste_6m, pp.n, pp.n_con, pp.n_6m, pp.manual, pp.principal, pp.principal_coste, pp.ingredientes,
           case when pl.precio > 0 then round(pl.precio / v_iva, 4) end as venta,
           r.revisado, r.sin_mapear_motivo
      from pl
      left join pp on pp.plato_id = pl.id
      left join rev r on r.tipo = 'plato' and r.articulo_id = pl.id
  ),
  pc2 as (
    select pc1.*,
           case when venta > 0 and n_con > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and n_con > 0 then round(venta - coste, 2) end as margen,
           case when n_6m = n and n > 0 and coste_6m > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'platos' and a.id = pc1.id) as precio_ajustado
      from pc1
  ),
  pc3 as (
    select pc2.*,
           array_remove(array[
             case when n is null then 'sin_mapear' end,
             case when n > 0 and n_con = 0 then 'sin_datos' end,
             case when n_con > 0 and n_con < n then 'incompleto' end,
             case when venta is null then 'sin_precio' end,
             case when pct > c.coste_max_plato_pct then 'coste_alto' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from pc2
  ),
  -- VINOS -------------------------------------------------------------------
  vi as (
    select v.id, v.nombre, v.categoria, v.precio_eur::numeric as precio, v.precio_copa_eur::numeric as precio_copa, v.orden,
           vp.producto_id, pc.nombre as producto, vp.origen, vp.nota,
           case when pc.envase_unidad = 'l' and pc.envase_cantidad > 0 then pc.envase_cantidad else 0.75 end as litros,
           k.eur_base, k.eur_ud, k.eur_base_6m, k.eur_ud_6m, k.lineas, k.ultima, k.unidad_compra,
           r.revisado, r.sin_mapear_motivo
      from "Vinos" v
      left join vino_producto vp on vp.vino_id = v.id
      left join productos_catalogo pc on pc.id = vp.producto_id
      left join k on k.producto_id = vp.producto_id
      left join rev r on r.tipo = 'vino' and r.articulo_id = v.id
     where v.activado and v.restaurante and v.precio_eur is not null
  ),
  vi2 as (
    select vi.*,
           round(coalesce(eur_base * litros, eur_ud), 4) as coste,
           round(coalesce(eur_base_6m * litros, eur_ud_6m), 4) as coste_6m,
           case when precio > 0 then round(precio / v_iva, 4) end as venta
      from vi
  ),
  vi3 as (
    select vi2.*,
           -- Multiplicador sobre el precio de CARTA (con IVA): «me cuesta 10 y la vendo a 25» = 2,5×.
           case when venta > 0 and coste > 0 then round(precio / coste, 2) end as multiplicador,
           case when venta > 0 and coste > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and coste > 0 then round(venta - coste, 2) end as margen,
           case when coste_6m > 0 and coste > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'vinos' and a.id = vi2.id) as precio_ajustado
      from vi2
  ),
  vi4 as (
    select vi3.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and coste is null then 'sin_datos' end,
             case when venta is null then 'sin_precio' end,
             case when multiplicador < c.multiplicador_min_vino then 'multiplicador_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from vi3
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'config', jsonb_build_object(
      'coste_max_plato_pct', c.coste_max_plato_pct, 'multiplicador_min_vino', c.multiplicador_min_vino,
      'subida_coste_pct', c.subida_coste_pct, 'iva_pct', c.iva_pct, 'dias_referencia', c.dias_referencia),
    'resumen', jsonb_build_object(
      'platos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where pct is not null),
          'food_cost_medio', round(avg(pct), 1),
          'food_cost_mediana', round((percentile_cont(0.5) within group (order by pct))::numeric, 1),
          'en_rojo', count(*) filter (where 'coste_alto' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where pct is null),
          'incompletos', count(*) filter (where 'incompleto' = any(banderas)),
          'revisados', count(*) filter (where revisado))
        from pc3),
      'vinos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where multiplicador is not null),
          'multiplicador_medio', round(avg(multiplicador), 2),
          'multiplicador_mediana', round((percentile_cont(0.5) within group (order by multiplicador))::numeric, 2),
          'en_rojo', count(*) filter (where 'multiplicador_bajo' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where multiplicador is null),
          'revisados', count(*) filter (where revisado))
        from vi4)),
    'platos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta', venta, 'coste', coste, 'coste_6m', case when n_6m = n then coste_6m end,
        'pct', pct, 'margen', margen, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'principal', principal, 'principal_coste', principal_coste,
        'origen', case when n is null then null when manual then 'manual' else 'estimado' end,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas), 'ingredientes', coalesce(ingredientes, '[]'::jsonb)
      ) order by categoria, orden, nombre) from pc3), '[]'::jsonb),
    'vinos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'precio_copa', precio_copa,
        'venta', venta, 'producto_id', producto_id, 'producto', producto, 'litros', litros,
        'coste', coste, 'coste_6m', coste_6m, 'multiplicador', multiplicador, 'pct', pct, 'margen', margen,
        'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'lineas', lineas, 'ultima', ultima, 'origen', origen, 'nota', nota,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from vi4), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.margenes_carta(date) from public, anon;
grant execute on function public.margenes_carta(date) to authenticated, service_role;

-- ─── 7. Edición ─────────────────────────────────────────────────────────────
create or replace function public.margenes_exigir_edicion()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 20261115200000_analisis_margenes_carta
  if not (select public.can_edit_section('facturas')) then
    raise exception 'Hace falta «Editar» en Facturas para cambiar los márgenes de la carta' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.margenes_exigir_edicion() from public, anon;
grant execute on function public.margenes_exigir_edicion() to authenticated, service_role;

-- Sustituye el escandallo del plato por la lista dada (origen 'manual').
-- p_ingredientes: [{producto_id, cantidad, unidad: g|ml|ud, nota?}]. Lista vacía = sin escandallo.
create or replace function public.margenes_guardar_escandallo(p_plato_id text, p_ingredientes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
declare
  v_n integer;
  e jsonb;
begin
  perform margenes_exigir_edicion();
  if not exists (select 1 from "Platos" where id = p_plato_id) then
    raise exception 'El plato no existe' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_ingredientes, '[]'::jsonb)) <> 'array' then
    raise exception 'Los ingredientes deben ser una lista' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(coalesce(p_ingredientes, '[]'::jsonb));
  if v_n > 12 then
    raise exception 'Como mucho 12 ingredientes por plato' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_ingredientes, '[]'::jsonb)) loop
    if (e->>'unidad') is null or (e->>'unidad') not in ('g', 'ml', 'ud') then
      raise exception 'Unidad no válida: %', coalesce(e->>'unidad', '(vacía)') using errcode = '22023';
    end if;
    if coalesce((e->>'cantidad')::numeric, 0) <= 0 then
      raise exception 'La cantidad tiene que ser mayor que 0' using errcode = '22023';
    end if;
    if not exists (select 1 from productos_catalogo where id = (e->>'producto_id')::bigint) then
      raise exception 'El producto % no existe', e->>'producto_id' using errcode = 'P0002';
    end if;
  end loop;
  if (select count(distinct (x->>'producto_id')) from jsonb_array_elements(coalesce(p_ingredientes, '[]'::jsonb)) x) <> v_n then
    raise exception 'Un producto está repetido en el escandallo' using errcode = '22023';
  end if;

  delete from escandallo_platos where plato_id = p_plato_id;
  insert into escandallo_platos (plato_id, producto_id, cantidad, unidad, origen, nota, orden, updated_by)
  select p_plato_id, (x->>'producto_id')::bigint, (x->>'cantidad')::numeric, x->>'unidad', 'manual',
         nullif(left(btrim(coalesce(x->>'nota', '')), 300), ''), (o - 1)::smallint, auth.uid()
    from jsonb_array_elements(coalesce(p_ingredientes, '[]'::jsonb)) with ordinality as t(x, o);
  if v_n > 0 then
    update margenes_carta_revision set sin_mapear_motivo = null, updated_at = now(), updated_by = auth.uid()
     where tipo = 'plato' and articulo_id = p_plato_id and sin_mapear_motivo is not null;
  end if;
  return jsonb_build_object('ok', true, 'ingredientes', v_n);
end;
$$;
revoke all on function public.margenes_guardar_escandallo(text, jsonb) from public, anon;
grant execute on function public.margenes_guardar_escandallo(text, jsonb) to authenticated, service_role;

-- Producto del catálogo que es la botella del vino. p_producto_id NULL = quitar el mapeo.
create or replace function public.margenes_guardar_vino(p_vino_id text, p_producto_id bigint, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
begin
  perform margenes_exigir_edicion();
  if not exists (select 1 from "Vinos" where id = p_vino_id) then
    raise exception 'El vino no existe' using errcode = 'P0002';
  end if;
  if p_producto_id is null then
    delete from vino_producto where vino_id = p_vino_id;
    return jsonb_build_object('ok', true, 'mapeado', false);
  end if;
  if not exists (select 1 from productos_catalogo where id = p_producto_id) then
    raise exception 'El producto % no existe', p_producto_id using errcode = 'P0002';
  end if;
  insert into vino_producto (vino_id, producto_id, origen, nota, updated_at, updated_by)
  values (p_vino_id, p_producto_id, 'manual', nullif(left(btrim(coalesce(p_nota, '')), 300), ''), now(), auth.uid())
  on conflict (vino_id) do update
    set producto_id = excluded.producto_id, origen = 'manual', nota = excluded.nota,
        updated_at = now(), updated_by = auth.uid();
  update margenes_carta_revision set sin_mapear_motivo = null, updated_at = now(), updated_by = auth.uid()
   where tipo = 'vino' and articulo_id = p_vino_id and sin_mapear_motivo is not null;
  return jsonb_build_object('ok', true, 'mapeado', true);
end;
$$;
revoke all on function public.margenes_guardar_vino(text, bigint, text) from public, anon;
grant execute on function public.margenes_guardar_vino(text, bigint, text) to authenticated, service_role;

create or replace function public.margenes_marcar_revisado(p_tipo text, p_articulo_id text, p_revisado boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
begin
  perform margenes_exigir_edicion();
  if p_tipo not in ('plato', 'vino') then
    raise exception 'Tipo no válido: %', p_tipo using errcode = '22023';
  end if;
  if (p_tipo = 'plato' and not exists (select 1 from "Platos" where id = p_articulo_id))
     or (p_tipo = 'vino' and not exists (select 1 from "Vinos" where id = p_articulo_id)) then
    raise exception 'El artículo no existe' using errcode = 'P0002';
  end if;
  insert into margenes_carta_revision (tipo, articulo_id, revisado, updated_at, updated_by)
  values (p_tipo, p_articulo_id, coalesce(p_revisado, false), now(), auth.uid())
  on conflict (tipo, articulo_id) do update
    set revisado = excluded.revisado, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true, 'revisado', coalesce(p_revisado, false));
end;
$$;
revoke all on function public.margenes_marcar_revisado(text, text, boolean) from public, anon;
grant execute on function public.margenes_marcar_revisado(text, text, boolean) to authenticated, service_role;

-- p: {coste_max_plato_pct?, multiplicador_min_vino?, subida_coste_pct?, iva_pct?, dias_referencia?}; lo que no venga no cambia.
create or replace function public.margenes_guardar_config(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
begin
  perform margenes_exigir_edicion();
  insert into margenes_carta_config (id) values (true) on conflict (id) do nothing;
  update margenes_carta_config set
    coste_max_plato_pct = coalesce((p->>'coste_max_plato_pct')::numeric, coste_max_plato_pct),
    multiplicador_min_vino = coalesce((p->>'multiplicador_min_vino')::numeric, multiplicador_min_vino),
    subida_coste_pct = coalesce((p->>'subida_coste_pct')::numeric, subida_coste_pct),
    iva_pct = coalesce((p->>'iva_pct')::numeric, iva_pct),
    dias_referencia = coalesce((p->>'dias_referencia')::integer, dias_referencia),
    updated_at = now(), updated_by = auth.uid()
  where id;
  return (select to_jsonb(x) - 'id' - 'updated_by' from margenes_carta_config x where id);
end;
$$;
revoke all on function public.margenes_guardar_config(jsonb) from public, anon;
grant execute on function public.margenes_guardar_config(jsonb) to authenticated, service_role;

-- Buscador de productos del catálogo para el escandallo (con nº de compras de Casa Tomás).
create or replace function public.margenes_buscar_productos(p_texto text, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
declare
  v_t text := translate(lower(btrim(coalesce(p_texto, ''))), 'áéíóúüàèìòùñ', 'aeiouuaeioun');
begin
  if not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if char_length(v_t) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'categoria', x.categoria, 'lineas', x.lineas, 'ultima', x.ultima)
                     order by x.lineas desc, x.nombre)
      from (
        select pc.id, pc.nombre, cp.nombre as categoria,
               (select count(*) from productos_factura pf join facturas fa on fa.id = pf.factura_id
                 where pf.producto_id = pc.id and fa.local is distinct from 'touza')::int as lineas,
               (select max(fa.fecha) from productos_factura pf join facturas fa on fa.id = pf.factura_id
                 where pf.producto_id = pc.id and fa.local is distinct from 'touza') as ultima
          from productos_catalogo pc
          left join categorias_producto cp on cp.id = pc.categoria_id
         where translate(lower(pc.nombre), 'áéíóúüàèìòùñ', 'aeiouuaeioun') like '%' || v_t || '%'
         order by pc.nombre
         limit 200
      ) x
     order by x.lineas desc, x.nombre
     limit least(greatest(coalesce(p_limite, 20), 1), 50)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.margenes_buscar_productos(text, integer) from public, anon;
grant execute on function public.margenes_buscar_productos(text, integer) to authenticated, service_role;

-- Las compras de un producto que cuentan para el coste (las mismas reglas), con su documento.
create or replace function public.margenes_compras_producto(p_producto_id bigint, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261115200000_analisis_margenes_carta
begin
  if not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'producto_id', p_producto_id,
    'producto', (select nombre from productos_catalogo where id = p_producto_id),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'linea_id', z.linea_id, 'id', z.factura_id, 'fecha', z.fecha, 'proveedor', z.proveedor,
               'proveedor_id', z.proveedor_id, 'numero_documento', z.numero_documento, 'tipo', z.tipo,
               'local', z.local, 'total', z.total_doc, 'drive_url', z.drive_url, 'archivo_path', z.archivo_path,
               'nombre_linea', z.nombre_linea, 'cantidad', z.cantidad, 'unidad', z.unidad,
               'importe_aportado', z.importe, 'medida', z.medida, 'cantidad_base', z.cantidad_base,
               'eur_base', case when z.cantidad_base > 0 then round(z.importe / z.cantidad_base, 4) end,
               'eur_ud', round(z.importe / z.cantidad, 4)
             ) order by z.fecha desc, z.linea_id desc)
        from (
          select pf.id as linea_id, fa.id as factura_id, fa.fecha,
                 coalesce(pr.nombre, fa.proveedor::text, 'Sin proveedor') as proveedor, fa.proveedor_id,
                 fa.numero_documento::text as numero_documento,
                 case when fa.total < 0 then 'abono' when fa.tipo = 'albaran' then 'albaran' else 'factura' end as tipo,
                 case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as local,
                 fa.total as total_doc, fa.drive_url, fa.archivo_path,
                 pf.nombre::text as nombre_linea, pf.cantidad, pf.unidad::text as unidad, pf.total as importe,
                 v.medida, v.cantidad_base
            from productos_factura pf
            join facturas fa on fa.id = pf.factura_id
            join productos_catalogo pc on pc.id = pf.producto_id
            left join proveedores pr on pr.id = fa.proveedor_id
            left join categorias_producto c on c.id = pc.categoria_id
            left join lateral volumen_linea(pf.nombre::text, pf.unidad::text, pf.cantidad,
                   coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)),
                   pf.contenido_cantidad, pf.contenido_unidad, pc.envase_cantidad, pc.envase_unidad,
                   pc.envases_por_bulto, volumen_max_eur_litro(c.nombre)) v on true
           where pf.producto_id = p_producto_id
             and fa.fecha is not null
             and fa.local is distinct from 'touza'
             and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
             and coalesce(fa.total, 0) >= 0
             and pf.total > 0 and pf.cantidad > 0
           order by fa.fecha desc, pf.id desc
           limit least(greatest(coalesce(p_limite, 20), 1), 100)
        ) z
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.margenes_compras_producto(bigint, integer) from public, anon;
grant execute on function public.margenes_compras_producto(bigint, integer) to authenticated, service_role;

select 'analisis_margenes_carta: aplicada' as resultado;
