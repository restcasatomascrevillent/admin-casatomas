-- ============================================================================
--  ROLLBACK de 20261107100000_chat_facturas_asociacion
-- ----------------------------------------------------------------------------
--  Vuelve categoria_agente (lista fija de sinónimos), lineas_producto_agente
--  (20261105180000) y volumen_comprado_agente (20261113100000, sin precio por
--  litro) a como estaban en la demo el 06/11/2026; borra asociar_termino_agente,
--  asociar_pregunta_agente, lineas_producto_base_agente y la tabla
--  terminos_agente (se pierden los términos añadidos a mano). No toca datos de
--  compras. Desplegar antes chat-facturas sin asociar_* (si no, la pista de la
--  pregunta falla en silencio y el resto sigue).
--    supabase db query --linked -f supabase/rollbacks/20261107100000_chat_facturas_asociacion_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';
begin;

CREATE OR REPLACE FUNCTION public.categoria_agente(p_texto text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_vacias constant text[] := array['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'en', 'a', 'al',
                                    'gasto', 'gastos', 'categoria', 'productos', 'producto', 'compras', 'todo', 'toda'];
  v_t   text := btrim(coalesce(normalizar_texto(p_texto), ''));
  v_r   text[];
  v_id  bigint;
begin
  if v_t = '' then
    return null;
  end if;
  -- 1. Clave escrita como clave («bebidas.vinos», «pescado_marisco»). Una
  --    palabra suelta («carnes») va por nombre y sinónimos: carnes = carne.
  if v_t ~ '[._]' then
    select id into v_id from categorias_producto where activa and clave = v_t;
    if v_id is not null then return v_id; end if;
  end if;
  -- 2. Nombre exacto, sin tildes ni mayúsculas.
  select id into v_id from categorias_producto
   where activa and normalizar_texto(nombre) = v_t
   order by padre_id nulls last, id limit 1;
  if v_id is not null then return v_id; end if;

  v_r := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(v_t)) w
                where not (w = any(c_vacias)));
  if cardinality(v_r) = 0 then
    return null;
  end if;
  -- 3. Sinónimos simples (todas sus raíces en lo pedido; gana el más largo).
  select c.id into v_id
    from (values
      ('vino', 'bebidas.vinos'), ('cava', 'bebidas.vinos'), ('champan', 'bebidas.vinos'),
      ('champagne', 'bebidas.vinos'), ('espumoso', 'bebidas.vinos'),
      ('cerveza', 'bebidas.cervezas'),
      ('licor', 'bebidas.licores'), ('destilado', 'bebidas.licores'), ('alcohol', 'bebidas.licores'),
      ('ginebra', 'bebidas.licores'), ('gin', 'bebidas.licores'), ('ron', 'bebidas.licores'),
      ('whisky', 'bebidas.licores'), ('vodka', 'bebidas.licores'), ('vermut', 'bebidas.licores'),
      ('copas', 'bebidas.licores'),
      ('refresco', 'bebidas.refrescos'), ('agua', 'bebidas.refrescos'), ('zumo', 'bebidas.refrescos'),
      ('tonica', 'bebidas.refrescos'),
      ('cafe', 'bebidas.cafe'), ('infusion', 'bebidas.cafe'),
      ('bebida', 'bebidas'),
      ('pescado', 'pescado_marisco.pescado'), ('marisco', 'pescado_marisco.marisco'),
      ('crustaceo', 'pescado_marisco.marisco'), ('molusco', 'pescado_marisco.marisco'),
      ('pescado marisco', 'pescado_marisco'), ('pescaderia', 'pescado_marisco'),
      ('carne', 'carnes.carne'), ('carniceria', 'carnes'), ('carne embutido', 'carnes'),
      ('embutido', 'carnes.embutidos'), ('iberico', 'carnes.embutidos'), ('jamon', 'carnes.embutidos'),
      ('charcuteria', 'carnes.embutidos'),
      ('lacteo', 'lacteos'), ('leche', 'lacteos'), ('queso', 'lacteos'), ('huevo', 'lacteos'),
      ('fruta', 'frutas_verduras'), ('verdura', 'frutas_verduras'), ('hortaliza', 'frutas_verduras'),
      ('fruteria', 'frutas_verduras'),
      ('despensa', 'despensa'), ('ultramarino', 'despensa'), ('conserva', 'despensa'), ('aceite', 'despensa'),
      ('pan', 'panaderia'), ('panaderia', 'panaderia'), ('reposteria', 'panaderia'), ('pasteleria', 'panaderia'),
      ('postre', 'panaderia'), ('helado', 'panaderia'), ('bolleria', 'panaderia'),
      ('congelado', 'congelados'),
      ('limpieza', 'limpieza'), ('desechable', 'limpieza'), ('drogueria', 'limpieza'),
      ('menaje', 'menaje'), ('equipamiento', 'menaje'), ('vajilla', 'menaje'), ('maquinaria', 'menaje'),
      ('servicio', 'servicios'), ('porte', 'servicios'), ('transporte', 'servicios'), ('reparacion', 'servicios')
    ) as s(sinonimo, clave)
    join categorias_producto c on c.clave = s.clave and c.activa
   where v_r @> raices_producto_agente(s.sinonimo)
   order by cardinality(raices_producto_agente(s.sinonimo)) desc, c.id
   limit 1;
  if v_id is not null then return v_id; end if;
  -- 4. Raíces del nombre («refrescos» → «Refrescos y aguas»): la más ajustada.
  select id into v_id from categorias_producto
   where activa
     and array(select raiz_producto_agente(w) from unnest(palabras_producto_agente(nombre)) w
                where not (w = any(c_vacias))) @> v_r
   order by cardinality(palabras_producto_agente(nombre)), padre_id nulls last, id
   limit 1;
  if v_id is not null then return v_id; end if;
  -- 5. Último recurso: la clave sin el punto («cervezas», «cafe»).
  select id into v_id from categorias_producto
   where activa and (clave = v_t or split_part(clave, '.', 2) = v_t)
   order by id limit 1;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lineas_producto_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105180000_productos_raices_precalculadas: raíces y palabras precalculadas por línea.
declare
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas', 'precio', 'precios'];
  c_sub constant text[] := array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar'];
  v_todas text[] := palabras_producto_agente(p_texto);
  v_pal   text[];
  v_rai   text[];
  v_excl  text[];
  v_serv  boolean;
  v_sub   boolean;
  v_ids   bigint[];
  v_subs  text[];
  v_met   text;
begin
  v_pal := array(select w from unnest(v_todas) w where not (w = any(c_relleno)));
  if cardinality(v_pal) = 0 then
    v_pal := v_todas;   -- «cajas» a secas: se busca tal cual
  end if;
  if cardinality(v_pal) = 0 then
    return query select null::bigint[], null::text, null::text[], '{}'::text[];
    return;
  end if;
  v_rai  := array(select distinct raiz_producto_agente(w) from unnest(v_pal) w);
  v_excl := array(select distinct raiz_producto_agente(w)
                    from unnest(palabras_producto_agente(p_excluir)) w
                   where not (w = any(c_vacias)));   -- «caja» SÍ se puede excluir
  v_serv := es_linea_servicio_agente(array_to_string(v_pal, ' '));
  v_sub  := v_rai && c_sub;

  -- 1. Texto (exacta o raíz) en la línea, su producto del catálogo o un alias.
  select array_agg(c.id order by c.id) filter (where not c.es_sub),
         (array_agg(distinct c.etq) filter (where c.es_sub))[1:5]
    into v_ids, v_subs
    from (
      select pf.id, coalesce(pc.nombre, pf.nombre::text) as etq,
             not v_sub and es_subproducto_agente(
               case when pf.raices_nombre @> v_rai or pc.nombre is null
                    then pf.nombre::text else pc.nombre end, v_rai) as es_sub
        from productos_factura pf
        left join productos_catalogo pc on pc.id = pf.producto_id
       where (pf.raices_nombre @> v_rai
              or coalesce(pc.raices_nombre, '{}'::text[]) @> v_rai
              or exists (select 1 from productos_alias a
                          where a.producto_id = pf.producto_id
                            and a.raices_texto @> v_rai))
         and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
         and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
    ) c;
  if v_ids is not null then
    v_met := 'texto';
  end if;

  -- 2. Derivada: cada raíz buscada es la palabra o su aumentativo/diminutivo
  --    (gamba → gambón, cebolla → cebollita). Sin -ino (langosta ≠ langostino)
  --    ni -ete (salmón ≠ salmonete).
  if v_ids is null then
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from unnest(v_rai) r
              where not exists (
                select 1 from unnest(pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) nw
                 where raiz_producto_agente(nw) = r
                    or (length(r) >= 4 and nw ~ ('^' || r || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai));
    if v_ids is not null then
      v_met := 'derivada';
    end if;
  end if;

  -- 3. Aproximada (erratas): cada palabra buscada de ≥ 4 letras casa con una
  --    de longitud parecida (±2) y trigram similarity ≥ 0,4; las cortas, por
  --    raíz. La longitud evita que «salmon» caiga en «salmonete».
  if v_ids is null then
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from unnest(v_pal) qw
              where not exists (
                select 1 from unnest(pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) nw
                 where raiz_producto_agente(nw) = raiz_producto_agente(qw)
                    or (length(qw) >= 4 and abs(length(nw) - length(qw)) <= 2
                        and extensions.similarity(qw, nw) >= 0.4)))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai));
    if v_ids is not null then
      v_met := 'aproximada';
    end if;
  end if;

  return query select v_ids, v_met, v_subs, v_pal;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.volumen_comprado_agente(p_texto text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_local text DEFAULT NULL::text, p_medida text DEFAULT NULL::text, p_limite integer DEFAULT NULL::integer, p_orden text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;
revoke all on function public.categoria_agente(text) from public, anon;
grant execute on function public.categoria_agente(text) to authenticated, service_role;
revoke all on function public.lineas_producto_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_agente(text, text) to authenticated, service_role;
revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) to authenticated, service_role;

drop function if exists public.asociar_pregunta_agente(text);
drop function if exists public.asociar_termino_agente(text);
drop function if exists public.lineas_producto_base_agente(text, text);
drop table if exists public.terminos_agente;

commit;
select 'chat_facturas_asociacion: deshecha' as resultado;
