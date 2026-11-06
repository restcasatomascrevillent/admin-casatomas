set client_encoding = 'UTF8';
-- ROLLBACK de 20261113100000_chat_facturas_bebidas (bebidas en el chatbot de Facturas).
-- Vuelve volumen_comprado_agente a la versión de 20261106400000 (6 parámetros,
-- copiada tal cual de esa migración) y borra volumen_tipo_envase. No toca datos.
--   supabase db query --linked -f supabase/rollbacks/20261113100000_chat_facturas_bebidas_ROLLBACK.sql
-- ANTES: desplegar chat-facturas sin p_limite/p_orden (la versión de 3b53b541);
-- la de esta migración llama a la RPC con 8 parámetros y fallaría.
begin;
set local lock_timeout = '5s';

drop function if exists public.volumen_comprado_agente(text, text, date, date, text, text, integer, text);
drop function if exists public.volumen_tipo_envase(numeric, text, text, text);

create or replace function public.volumen_comprado_agente(
  p_texto text default null, p_categoria text default null,
  p_desde date default null, p_hasta date default null,
  p_local text default null, p_medida text default null)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
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
  ok as (select s.* from sel s, med where s.medida = med.m),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.envases) as envases,
           max(o.envase_cantidad) as env_c, max(o.envase_unidad) as env_u,
           string_agg(distinct trim_scale(round(o.por_unidad, 3))::text, '/') as por_u
      from ok o group by 1, 2
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni || ' de ' || p.por_u || ' ' || (select m from med), ', '
                      order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  por_fmt as (
    select volumen_formato(o.envase_cantidad, o.envase_unidad) as envase,
           round(sum(coalesce(o.envases, case when o.metodo = 'envase' then o.cantidad end))) as envases,
           round(sum(o.cantidad_base), 2) as total
      from ok o where o.envase_cantidad is not null group by 1
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total
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
    'envases', (select round(sum(coalesce(o.envases, case when o.metodo = 'envase' then o.cantidad end))) from ok o),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'por_producto', (select json_agg(json_build_object('producto', x.producto, 'total', x.total, 'envases', x.envases,
                                                        'envase', x.envase, 'compra', x.compra)
                                      order by x.total desc)
                       from (select * from por_prod order by total desc limit 12) x),
    'productos', (select count(*) from por_prod),
    'por_envase', (select json_agg(json_build_object('envase', f.envase, 'envases', f.envases, 'total', f.total) order by f.total desc)
                     from (select * from por_fmt order by total desc limit 8) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total) order by p.total desc)
                        from (select * from por_prov order by total desc limit 6) p),
    'por_mes', (select json_agg(json_build_object('mes', m.mes, 'total', m.total) order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, count(*) as n from no n
                              group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$$;

revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text) to authenticated, service_role;

commit;

select '20261113100000_chat_facturas_bebidas: deshecha' as resultado;
