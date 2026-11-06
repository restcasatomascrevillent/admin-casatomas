-- ============================================================================
--  20261113100000_chat_facturas_bebidas
-- ----------------------------------------------------------------------------
--  El chatbot de Facturas no sabía contestar bien de bebidas (prueba del dueño
--  del 06/11/2026 en la demo):
--    · «¿tenemos cerveza?» buscaba el TEXTO «cerveza»: salía «MOSTAZA DE
--      CERVEZA» (Despensa) y no salían Heineken ni los barriles de Cruzcampo,
--      que no llevan la palabra. Eso se arregla en chat-facturas (las familias
--      van a esta RPC por categoría).
--    · «botellas por vino» daba «4 botellas y 99 cajas»: sumaba la cantidad
--      tal cual por unidad. Esta RPC ya pasaba las cajas a botellas
--      (`envases`), pero solo enseñaba 12 productos ordenados por litros y sin
--      decir el tipo de envase.
--
--  Cambios (solo lectura, ningún dato se toca):
--    1. `volumen_tipo_envase(cantidad, unidad, categoria, texto)`: nombre del
--       envase: «barril 50 l», «tercio 33 cl», «quinto 20 cl», «botellín
--       25 cl», «lata 33 cl», «brick 1 l», «magnum 1,5 l», «botella 75 cl»…
--    2. `volumen_comprado_agente` gana `p_limite` (1-40, por defecto 12) y
--       `p_orden` ('envases' = más botellas primero; si no, litros). Por
--       producto devuelve también `formato`, `compra` legible («99 caja de 6,
--       4 botella») y el proveedor principal; `por_envase` lleva `formato`;
--       `por_proveedor` lleva envases y productos; arriba, `cajas` y
--       `productos_truncado`. Los campos de antes siguen igual (`envase` =
--       «33 cl», `total`, `envases`…).
--
--  La firma cambia (8 parámetros con valores por defecto): se borra la de 6
--  para que no haya dos funciones con el mismo nombre (PostgREST no sabría
--  cuál llamar). Quien la llamaba con 4 o 6 parámetros sigue funcionando.
--
--  Deshacer: supabase/rollbacks/20261113100000_chat_facturas_bebidas_ROLLBACK.sql
--  Test:     supabase/tests/chat_facturas_bebidas_test.sql
--  Aplicar:  supabase db query --linked -f supabase/migrations/20261113100000_chat_facturas_bebidas.sql
--            y después desplegar chat-facturas (usa p_limite y p_orden).
-- ============================================================================

-- ─── 1. Nombre del envase ──────────────────────────────────────────────────
create or replace function public.volumen_tipo_envase(p_c numeric, p_u text, p_categoria text, p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  -- 20261113100000_chat_facturas_bebidas
  select case
           when p_c is null or p_u is null or p_c <= 0 then null
           when p_u <> 'l' then f
           when s ~ '(barril|keg)' or (p_categoria = 'Cervezas' and p_c >= 5) then 'barril ' || f
           when s ~ '(^|[^a-z])latas?([^a-z]|$)' or s ~ '(^|[^a-z])lt\.? ?[0-9]+ ?cl' then 'lata ' || f
           when s ~ '(brick|brik|tetra)' then 'brick ' || f
           when s ~ 'bidon' then 'bidón ' || f
           when s ~ 'garrafa' then 'garrafa ' || f
           when p_categoria = 'Cervezas' and round(p_c, 2) = 0.33 then 'tercio ' || f
           when p_categoria = 'Cervezas' and round(p_c, 2) = 0.20 then 'quinto ' || f
           when p_categoria = 'Cervezas' and round(p_c, 2) = 0.25 then 'botellín ' || f
           when p_categoria = 'Vinos' and p_c = 1.5 then 'magnum ' || f
           when p_categoria = 'Vinos' and p_c = 3 then 'doble magnum ' || f
           when p_categoria = 'Vinos' and round(p_c, 3) = 0.375 then 'media botella ' || f
           else 'botella ' || f
         end
    from (select translate(lower(coalesce(p_texto, '')), 'áéíóúü', 'aeiouu') as s,
                 public.volumen_formato(p_c, p_u) as f) t
$$;

comment on function public.volumen_tipo_envase(numeric, text, text, text) is
  '20261113100000_chat_facturas_bebidas: nombre del envase (barril 50 l, tercio 33 cl, lata 33 cl, magnum 1,5 l, botella 75 cl…).';

-- ─── 2. RPC del chatbot ─────────────────────────────────────────────────────
drop function if exists public.volumen_comprado_agente(text, text, date, date, text, text);

create or replace function public.volumen_comprado_agente(
  p_texto text default null, p_categoria text default null,
  p_desde date default null, p_hasta date default null,
  p_local text default null, p_medida text default null,
  p_limite integer default null, p_orden text default null)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
-- 20261113100000_chat_facturas_bebidas: formato con nombre, botellas y cajas por
-- producto, proveedor principal, p_limite (1-40) y p_orden ('envases' | litros).
declare
  v_txt    text := nullif(btrim(coalesce(p_texto, '')), '');
  v_cattxt text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_cat    bigint;
  v_catnom text;
  v_ids    bigint[];
  v_met    text;
  v_med    text := case lower(btrim(coalesce(p_medida, '')))
                     when 'l' then 'l' when 'litros' then 'l' when 'kg' then 'kg' when 'kilos' then 'kg' end;
  v_loc    text := case when p_local in ('casa_tomas', 'touza') then p_local end;
  v_lim    integer := least(greatest(coalesce(p_limite, 12), 1), 40);
  v_ord    text := case when lower(btrim(coalesce(p_orden, ''))) in ('envases', 'botellas', 'unidades') then 'envases' else 'total' end;
  r        json;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- «cerveza», «vinos», «licores»… escritos como producto son una familia.
  if v_cattxt is null and v_txt is not null
     and normalizar_texto(v_txt) ~ '^((las|los|el|la) )?(cervezas?|vinos?|licor(es)?|destilados?|refrescos?|bebidas?|cafes?|infusion(es)?|pescados?|mariscos?|carnes?)$' then
    v_cattxt := v_txt;
    v_txt := null;
  end if;
  if v_cattxt is not null then
    v_cat := categoria_agente(v_cattxt);
    if v_cat is null then
      return json_build_object('error', format('No conozco la categoría «%s».', left(v_cattxt, 60)));
    end if;
    select nombre into v_catnom from categorias_producto where id = v_cat;
  end if;
  if v_txt is not null then
    select l.ids, l.metodo into v_ids, v_met from lineas_producto_agente(v_txt, null) l;
    if v_ids is null then
      return json_build_object('sin_datos', true, 'producto', v_txt, 'categoria', v_catnom,
                               'nota', 'Ninguna línea de compra coincide con ese producto.');
    end if;
  end if;
  if v_cat is null and v_ids is null then
    return json_build_object('error', 'Falta producto o categoria (cerveza, vino, agua, aceite, gamba…).');
  end if;

  with
  base as materialized (
    select v.*, pc.envase_origen
      from volumen_lineas v
      left join productos_catalogo pc on pc.id = v.producto_id
     where (p_desde is null or v.fecha >= p_desde)
       and (p_hasta is null or v.fecha <= p_hasta)
       and (v_loc is null or v.loc = v_loc)
       and (v_cat is null or v.categoria_id = v_cat
            or exists (select 1 from categorias_producto c where c.id = v.categoria_id and c.padre_id = v_cat))
  ),
  sel as materialized (
    select * from base b where v_ids is null or b.linea_id = any(v_ids)
  ),
  med as (
    select coalesce(v_med,
                    (select s.medida from sel s where s.medida is not null
                      group by s.medida order by count(*) desc, s.medida limit 1), 'l') as m
  ),
  -- Líneas convertidas con su envase: el del catálogo o, si no lo tiene, el que
  -- sale de la propia línea (litros / envases).
  ok as materialized (
    select s.*, e.env_n, e.env_c, e.env_u,
           volumen_tipo_envase(e.env_c, e.env_u, s.categoria,
                               coalesce(s.producto, '') || ' ' || coalesce(s.nombre_linea, '') || ' ' || coalesce(s.unidad, '')) as tipo,
           case when s.cantidad <> 0 and e.env_n is not null and s.metodo in ('caja', 'precio')
                then round(e.env_n / s.cantidad) end as n_por
      from sel s
      cross join med
      cross join lateral (
        select coalesce(s.envases, case when s.metodo = 'envase' then s.cantidad end) as env_n,
               coalesce(s.envase_cantidad,
                        case when coalesce(s.envases, 0) > 0 then round(s.cantidad_base / s.envases, 3) end) as env_c,
               case when s.envase_cantidad is not null then s.envase_unidad
                    when coalesce(s.envases, 0) > 0 then s.medida end as env_u
      ) e
     where s.medida = med.m
  ),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni, o.n_por,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.env_n) as envases,
           max(o.env_c) as env_c, max(o.env_u) as env_u
      from ok o group by 1, 2, 3
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni
                      || case when p.n_por > 1 then ' de ' || trim_scale(p.n_por)::text else '' end,
                      ', ' order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  ptipo as (
    select coalesce(o.producto, o.nombre_linea) as producto, string_agg(distinct o.tipo, ', ') as formato
      from ok o group by 1
  ),
  pprov as (
    select z.producto, z.proveedor, z.n
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rn,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n
              from ok o group by 1, o.prov_k) z
     where z.rn = 1
  ),
  prod_rk as (
    select pp.*, t.formato,
           pv.proveedor || case when pv.n > 1 then format(' (+%s)', pv.n - 1) else '' end as proveedor,
           row_number() over (order by case when v_ord = 'envases' then pp.envases else pp.total end desc nulls last,
                                       pp.total desc, pp.producto) as rk
      from por_prod pp
      left join ptipo t on t.producto = pp.producto
      left join pprov pv on pv.producto = pp.producto
  ),
  por_fmt as (
    select max(volumen_formato(o.env_c, o.env_u)) as envase, o.tipo as formato,
           round(sum(o.env_n)) as envases, round(sum(o.cantidad_base), 2) as total
      from ok o where o.tipo is not null group by o.tipo
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.env_n)) as envases, count(distinct coalesce(o.producto, o.nombre_linea)) as productos
      from ok o group by o.prov_k
  ),
  por_mes as (
    select to_char(o.fecha, 'YYYY-MM') as mes, round(sum(o.cantidad_base), 2) as total
      from ok o group by 1
  ),
  otra as (
    select s.medida, round(sum(s.cantidad_base), 2) as total, count(*) as lineas
      from sel s, med where s.medida is not null and s.medida <> med.m group by s.medida
  )
  select json_build_object(
    'periodo', json_build_object('desde', coalesce(p_desde, (select min(fecha) from sel)), 'hasta', coalesce(p_hasta, (select max(fecha) from sel))),
    'categoria', v_catnom, 'producto', v_txt, 'coincidencia', v_met, 'local', v_loc,
    'unidad', (select m from med),
    'total', (select round(coalesce(sum(o.cantidad_base), 0), 2) from ok o),
    'envases', (select round(sum(o.env_n)) from ok o),
    'cajas', (select round(sum(o.cantidad)) from ok o where o.n_por > 1),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'orden', case v_ord when 'envases' then 'envases' else 'total' end,
    'por_producto', (select json_agg(json_build_object('producto', x.producto, 'total', x.total, 'envases', x.envases,
                                                        'envase', x.envase, 'formato', x.formato, 'compra', x.compra,
                                                        'proveedor', x.proveedor)
                                      order by x.rk)
                       from prod_rk x where x.rk <= v_lim),
    'productos', (select count(*) from por_prod),
    'productos_truncado', (select count(*) > v_lim from por_prod),
    'por_envase', (select json_agg(json_build_object('formato', f.formato, 'envase', f.envase, 'envases', f.envases, 'total', f.total)
                                   order by f.total desc)
                     from (select * from por_fmt order by total desc limit 10) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total, 'envases', p.envases,
                                                         'productos', p.productos) order by p.total desc)
                        from (select * from por_prov order by total desc limit 8) p),
    'por_mes', (select json_agg(json_build_object('mes', m.mes, 'total', m.total) order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'cantidad', z.cant,
                                                        'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, trim_scale(sum(n.cantidad)) as cant, count(*) as n
                               from no n group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'envases = botellas, latas o barriles con las cajas ya abiertas (caja de 6 = 6). '
            || 'compra = como se facturo («99 caja de 6» = 99 cajas de 6 botellas). formato = tipo de envase. '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$$;

comment on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) is
  '20261113100000_chat_facturas_bebidas: litros/kilos, botellas, cajas, formatos y proveedores de un producto o familia (chatbot de Facturas).';

revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) to authenticated, service_role;
revoke all on function public.volumen_tipo_envase(numeric, text, text, text) from public, anon;
grant execute on function public.volumen_tipo_envase(numeric, text, text, text) to authenticated, service_role;
