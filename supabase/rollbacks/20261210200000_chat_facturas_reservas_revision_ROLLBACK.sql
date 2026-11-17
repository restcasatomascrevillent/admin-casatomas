set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK 20261210200000_chat_facturas_reservas_revision · Copiloto de Facturas (18/11/2026)
-- Revisión independiente del PR #277 (facturas-conocimiento/revision-277-2026-11-18.md). Solo funciones (create or replace,
-- mismas firmas); ni tablas ni datos:
--  1. compras_producto_agente: el coste efectivo (botellas sin cargo) se calcula POR producto y formato (75 cl, magnum…) y no
--     por factura y unidad: antes una factura con las dos presentaciones daba 14,31 € (22,90 → 14,31), que no es de ninguna botella.
--  2. lineas_producto_base_agente: erratas de una letra en palabras de 6 letras o más («centoyo», «nabajas», «pintja») vuelven a
--     casar (parecido 0,4 con longitud ±1; 0,45 para el resto: «gordura» sigue sin ser «gorda»); y «CAVA JUVE MASANA» ya no se
--     pierde al buscar «juve camps» (la línea con la primera palabra buscada se queda).
--  3. variacion_precios_agente: dudosa también si el cociente es casi un entero de 4 a 9 (envase de 9 contra unidad: +795 %).
-- Vuelve a las funciones de 20261210110000.
-- ============================================================================
set lock_timeout = '5s';

-- ─── lineas_producto_base_agente ───
CREATE OR REPLACE FUNCTION public.lineas_producto_base_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105180000_productos_raices_precalculadas: raíces y palabras precalculadas por línea.
-- 20261107600000_chat_facturas_busqueda_rapida: candidatas por GIN, catálogo y alias.
-- 20261208190000_chat_facturas_fallos_evaluacion:
--   1b. A lo encontrado por texto se SUMAN las líneas que abrevian el nombre o llevan sus
--       siglas (lineas_abreviadas_agente). Si solo hay de estas, el método es 'aproximada'
--       (se avisa de que no es el nombre exacto).
--   2 y 3. Mismo resultado, sin los tres costes de antes: la raíz del vocabulario solo se
--       calcula para las palabras que empiezan como la buscada (antes, para las 8.000);
--       si alguna palabra buscada no casa con nada no se recorre ninguna línea; y el
--       filtro de servicios/subproductos va después de acotar las candidatas.
-- 20261210110000_chat_facturas_bateria_fallos: (1) «ml», «kg»… son unidades, no un producto (antes «ml» casaba con 668
--   líneas); (2) con dos palabras o más, una línea que solo casa por el producto del catálogo exige que el catálogo
--   comparta la primera palabra con la línea sin ser de la búsqueda («pan de cristal» ya no suma «Tostadas Cristal»); (3) erratas: parecido
--   mínimo 0,45 (antes 0,4: «gordura» caía en «chirla gorda»).
-- 20261209200000_chat_facturas_busqueda_precision: las abreviaturas y siglas SOLO cuando no hay nada
--   por texto (metodo 'aproximada'). Con algo directo ya no se suman: compras_producto_agente las da
--   aparte (posibles_coincidencias, lineas_posibles_agente).
declare
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas', 'precio', 'precios'];
  c_unidades constant text[] := array['kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts',
    'litro', 'litros', 'ml', 'cl', 'dl', 'ud', 'uds', 'unidad', 'unidades'];
  c_sub constant text[] := array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar'];
  -- Raíces con formas cortas propias (raiz_producto_agente): «cg» = congelado, «ib» = ibérico…
  c_rai_cortas constant text[] := array['congel', 'fresc', 'iberic', 'jamon'];
  c_pal_cortas constant text[] := array['cg', 'cong', 'fr', 'ib', 'iber', 'jam'];
  v_todas text[] := palabras_producto_agente(p_texto);
  v_pal   text[];
  v_rai   text[];
  v_excl  text[];
  v_serv  boolean;
  v_sub   boolean;
  v_ids   bigint[];
  v_subs  text[];
  v_met   text;
  v_abr   bigint[];
  v_voc   text[];
begin
  v_pal := array(select w from unnest(v_todas) w where not (w = any(c_relleno)));
  if cardinality(v_pal) = 0 then
    -- «cajas» a secas se busca tal cual; «ml» o «kg» a secas no son un producto: sin nombre.
    v_pal := array(select w from unnest(v_todas) w where not (w = any(c_unidades)));
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
             not v_sub
             and (case when pf.raices_nombre @> v_rai or pc.nombre is null
                       then pf.raices_nombre else pc.raices_nombre end) && c_sub
             and es_subproducto_agente(
               case when pf.raices_nombre @> v_rai or pc.nombre is null
                    then pf.nombre::text else pc.nombre end, v_rai) as es_sub
        from productos_factura pf
        left join productos_catalogo pc on pc.id = pf.producto_id
       where pf.id in (select x.id from productos_factura x where x.raices_nombre @> v_rai
                       union
                       select x.id from productos_catalogo y
                         join productos_factura x on x.producto_id = y.id
                        where y.raices_nombre @> v_rai
                       union
                       select x.id from productos_alias al
                         join productos_factura x on x.producto_id = al.producto_id
                        where al.raices_texto @> v_rai)
         and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
         and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
         -- 20261210110000: varias palabras: se descarta la línea que casa SOLO por el producto del catálogo cuando comparte alguna
         -- palabra con lo buscado, le falta otra que no es un formato (magnum…) y línea y catálogo empiezan por la misma palabra
         -- ajena a la búsqueda («TOSTADAS CRISTAL» = «Tostadas de pan de cristal» no es «pan de cristal»).
         and not (cardinality(v_rai) >= 2
              and not (pf.raices_nombre @> v_rai)
              and pf.raices_nombre && v_rai
              and not (array(select r from unnest(v_rai) r where not (r = any(pf.raices_nombre)))
                       <@ array['magnum', 'mgn', 'mg', 'jerobo', 'litro', 'cl', 'ml'])
              and not exists (select 1 from productos_alias al where al.producto_id = pf.producto_id and al.raices_texto @> v_rai)
              and coalesce(raiz_producto_agente((array(select w from unnest(pf.palabras_nombre) w where not (w = any(c_vacias))))[1])
                           = raiz_producto_agente((array(select w from unnest(pc.palabras_nombre) w where not (w = any(c_vacias))))[1]), false)
              and not (raiz_producto_agente((array(select w from unnest(pf.palabras_nombre) w where not (w = any(c_vacias))))[1]) = any(v_rai)))
    ) c;
  if v_ids is not null then
    v_met := 'texto';
  end if;

  -- 1b. Abreviaturas y siglas (dos palabras o más), solo si no hay nada por texto (20261209200000).
  if v_ids is null and cardinality(v_pal) >= 2 then
    select array_agg(pf.id order by pf.id) into v_abr
      from unnest(lineas_abreviadas_agente(v_pal, v_ids)) u(id)
      join productos_factura pf on pf.id = u.id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not (pf.id = any(coalesce(v_ids, '{}'::bigint[])))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not ((case when pc.nombre is null then pf.raices_nombre else pc.raices_nombre end) && c_sub
                          and es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai)));
    if v_abr is not null then
      if v_ids is null then
        v_met := 'aproximada';
      end if;
      v_ids := array(select distinct x from unnest(coalesce(v_ids, '{}'::bigint[]) || v_abr) x order by 1);
    end if;
  end if;

  if v_ids is null then
    v_voc := array(select unnest(pf.palabras_nombre) from productos_factura pf
                   union
                   select unnest(pc.palabras_nombre) from productos_catalogo pc);
  end if;

  -- 2. Derivada: cada raíz buscada es la palabra o su aumentativo/diminutivo
  --    (gamba → gambón, cebolla → cebollita). Sin -ino (langosta ≠ langostino)
  --    ni -ete (salmón ≠ salmonete).
  if v_ids is null then
    with m as materialized (
           select r, coalesce(array_agg(v.w) filter (where v.w is not null), '{}'::text[]) as ws
             from unnest(v_rai) r
             left join unnest(v_voc) v(w)
               on (v.w like r || '%' and length(v.w) <= length(r) + 2 and raiz_producto_agente(v.w) = r)
               or (r = any(c_rai_cortas) and v.w = any(c_pal_cortas) and raiz_producto_agente(v.w) = r)
               or (length(r) >= 4 and v.w ~ ('^' || r || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))
            group by r),
         cand as materialized (
           select pf.id
             from productos_factura pf
             left join productos_catalogo pc on pc.id = pf.producto_id
            where not exists (select 1 from m where cardinality(m.ws) = 0)
              and not exists (
                    select 1 from m
                     where not ((pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) && m.ws)))
    select array_agg(pf.id order by pf.id) into v_ids
      from cand
      join productos_factura pf on pf.id = cand.id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not ((case when pc.nombre is null then pf.raices_nombre else pc.raices_nombre end) && c_sub
                          and es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai)));
    if v_ids is not null then
      v_met := 'derivada';
    end if;
  end if;

  -- 3. Aproximada (erratas): cada palabra buscada de ≥ 4 letras casa con una
  --    de longitud parecida (±2) y trigram similarity ≥ 0,4; las cortas, por
  --    raíz. La longitud evita que «salmon» caiga en «salmonete».
  if v_ids is null then
    with q as materialized (
           select distinct qw, raiz_producto_agente(qw) as rq from unnest(v_pal) qw),
         m as materialized (
           select q.qw, coalesce(array_agg(v.w) filter (where v.w is not null), '{}'::text[]) as ws
             from q
             left join unnest(v_voc) v(w)
               on (v.w like q.rq || '%' and length(v.w) <= length(q.rq) + 2 and raiz_producto_agente(v.w) = q.rq)
               or (q.rq = any(c_rai_cortas) and v.w = any(c_pal_cortas) and raiz_producto_agente(v.w) = q.rq)
               or (length(q.qw) >= 4 and abs(length(v.w) - length(q.qw)) <= 2
                   and extensions.similarity(q.qw, v.w) >= 0.45)
            group by q.qw),
         cand as materialized (
           select pf.id
             from productos_factura pf
             left join productos_catalogo pc on pc.id = pf.producto_id
            where not exists (select 1 from m where cardinality(m.ws) = 0)
              and not exists (
                    select 1 from m
                     where not ((pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) && m.ws)))
    select array_agg(pf.id order by pf.id) into v_ids
      from cand
      join productos_factura pf on pf.id = cand.id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not ((case when pc.nombre is null then pf.raices_nombre else pc.raices_nombre end) && c_sub
                          and es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai)));
    if v_ids is not null then
      v_met := 'aproximada';
    end if;
  end if;

  return query select v_ids, v_met, v_subs, v_pal;
end;
$function$
;

revoke all on function public.lineas_producto_base_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_base_agente(text, text) to authenticated, service_role;

-- ─── compras_producto_agente ───
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_base boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
-- 20261124120000_chatbot_precio_unidad_compra: p_base = false (chat-facturas) → precio tal como se compra; precio_comparable
-- (€/kg, €/l) solo si mezcla formatos (unidades o contenidos distintos) para poder decir el más barato.
-- 20261128150000_chatbot_ultima_factura: primero la ÚLTIMA factura (ultima_factura, con su número para el
-- enlace) y como_leer; por unidad y por proveedor, el precio de su última factura (ultimo_precio, numero);
-- «más barato» (orden precio y precio_comparable) por el precio de la última factura, no por la media.
-- 20261130180000_chatbot_ultima_factura_varias_lineas: si la última factura trae varias líneas del producto
-- (misma unidad) a precios distintos, ultima_factura.misma_factura las resume (precios, precio_medio); a
-- igualdad de factura, el «último precio» de cada proveedor es el de la línea más nueva (id), como ultima_factura.
-- 20261208190000_chat_facturas_fallos_evaluacion: proveedor con errata (proveedor_buscar_agente), sugerencias por
-- texto sobre palabras_nombre (antes dos strict_word_similarity + palabras_producto_agente por línea: 3,5 s) y
-- busqueda_hecha en el «no hay» para que el modelo no repita la búsqueda con otra herramienta.
-- 20261209200000_chat_facturas_busqueda_precision: lo que solo sale por abreviatura o sigla va APARTE en
-- posibles_coincidencias (nombre exacto, sin sumar) y un proveedor que no existe no da cifras.
-- 20261210110000_chat_facturas_bateria_fallos: botellas (o unidades) SIN CARGO de la misma factura: ultima_factura.precio_unitario
-- y por_proveedor.ultimo_coste_efectivo son el coste REAL = total pagado / (pagadas + sin cargo), con la misma fórmula que el coste
-- de la carta de vinos (coste_efectivo_agente, también usada por vinos_coste_carta_datos); precio_linea = el de la línea.
declare
  c_max_variantes constant int := 15;
  c_sim_semantica constant float8 := 0.5;   -- sugerencias por embedding: parecido mínimo
  c_sim_texto     constant float8 := 0.5;   -- sugerencias por texto: frase y primera palabra
  c_dif_variantes constant numeric := 1.15; -- precios de variantes «distintos»: más de un 15 %
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_uni    text := unidad_agente(p_unidad);
  -- Palabras distintivas del proveedor pedido (sin «grupo», «distribuciones», «sl»…): todas deben
  -- estar en su nombre. Sin proveedor, vacío = no filtra.
  v_provw  text[] := coalesce((
    select array_agg(w) from regexp_split_to_table(lower(coalesce(p_proveedor, '')), '[^a-z0-9áéíóúñü]+') w
     where length(w) >= 3
       and w <> all (array['grupo','distribuciones','distribuidora','hermanos','sociedad','limitada','srl','slu','del','los','las'])
  ), '{}');
  v_tipo   text;
  v_pal    text[];
  v_frase  text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_aprox  boolean;
  v_sug    jsonb;
  v_sem    boolean;
  v_prov_id  bigint;
  v_prov_nom text;
  v_parecidos jsonb;
  v_pos    bigint[];
  v_posj   jsonb;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  if v_orden not in ('importe', 'cantidad', 'precio') then
    return json_build_object('error', 'orden debe ser importe, cantidad o precio.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  -- Proveedor pedido con errata («garro» = Garre): si sus palabras no están en ningún proveedor,
  -- se usa el más parecido cuando está claro.
  if cardinality(v_provw) > 0
     and not exists (select 1 from proveedores p
                      where not exists (select 1 from unnest(v_provw) w where position(w in lower(p.nombre)) = 0)) then
    select c.id, c.nombre into v_prov_id, v_prov_nom from proveedor_buscar_agente(p_proveedor) c where c.claro limit 1;
    -- 20261209200000: ni por nombre ni por errata clara → ninguna cifra (antes salían las de otros
    -- proveedores como «fuera del filtro»). Los parecidos, para preguntar.
    if v_prov_id is null
       and not exists (select 1 from facturas f
                        where f.proveedor_id is null
                          and not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(f.proveedor, ''))) = 0)) then
      v_parecidos := (select jsonb_agg(c.nombre order by c.parecido desc) from proveedor_buscar_agente(p_proveedor) c);
      return jsonb_strip_nulls(jsonb_build_object(
        'buscado',               p_texto,
        'proveedor_pedido',      p_proveedor,
        'proveedor_no_encontrado', true,
        'sin_datos',             true,
        'proveedores_parecidos', v_parecidos,
        'nota', case when v_parecidos is not null then
                  'No hay ningun proveedor con ese nombre. proveedores_parecidos solo se parecen en la escritura y pueden ser '
                  || 'otros: NO des cifras de ellos; di que a ese nombre no se le compra y pregunta si se refiere a alguno.'
                else 'No se compra a ningun proveedor con ese nombre ni parecido: dilo asi, sin dar cifras de otros.' end
      ))::json;
    end if;
  end if;

  select h.ids, h.metodo, h.subproductos, h.palabras
    into v_ids, v_met, v_subs, v_pal
    from lineas_producto_agente(p_texto, p_excluir) h;
  if coalesce(cardinality(v_pal), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_frase := array_to_string(v_pal, ' ');
  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- 20261209200000: líneas que solo salen por abreviatura o sigla («C/6B LP LA CUVEE» para
  -- «laurent perrier»): aparte, con su nombre exacto, NUNCA en los totales ni en ultima_factura.
  if v_ids is not null and v_met = 'texto' then
    v_pos := lineas_posibles_agente(p_texto, p_excluir, v_ids);
    if cardinality(v_pos) > 0 then
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre',    g.nombre,
               'proveedor', g.proveedor,
               'lineas',    g.lineas,
               'importe',   trim_scale(round(g.imp, 2)),
               'ultima',    jsonb_strip_nulls(jsonb_build_object(
                              'fecha', g.fecha, 'numero', g.numero,
                              'cantidad', trim_scale(round(g.cant, 3)), 'unidad', g.uni,
                              'precio_unitario', trim_scale(round(g.pu, case when g.pu < 1 then 4 else 2 end))))))
             order by g.imp desc nulls last, g.nombre)
        into v_posj
        from (
          select pf.nombre::text as nombre, count(*) as lineas, sum(pf.total) as imp,
                 (array_agg(coalesce(pv.nombre, f.proveedor)::text order by f.fecha desc nulls last, pf.id desc))[1] as proveedor,
                 (array_agg(f.fecha order by f.fecha desc nulls last, pf.id desc))[1] as fecha,
                 (array_agg(f.numero_documento::text order by f.fecha desc nulls last, pf.id desc))[1] as numero,
                 (array_agg(pf.cantidad::numeric order by f.fecha desc nulls last, pf.id desc))[1] as cant,
                 (array_agg(unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud'))
                            order by f.fecha desc nulls last, pf.id desc))[1] as uni,
                 (array_agg(case when pf.total > 0 and pf.cantidad > 0 then pf.total::numeric / pf.cantidad::numeric end
                            order by f.fecha desc nulls last, pf.id desc))[1] as pu
            from productos_factura pf
            join facturas f on f.id = pf.factura_id
            left join proveedores pv on pv.id = f.proveedor_id
           where pf.id = any(v_pos)
             and pf.total is distinct from 0
             and (p_desde is null or f.fecha >= p_desde)
             and (p_hasta is null or f.fecha <= p_hasta)
             and (v_tipo is null or f.tipo = v_tipo)
             and (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                       else not exists (select 1 from unnest(v_provw) w
                                         where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)
           group by pf.nombre
           order by sum(pf.total) desc nulls last, pf.nombre
           limit 6) g;
    end if;
  end if;

  -- ── Nada: solo subproductos, o sugerencias (semánticas si hay embedding) ──
  if v_ids is null then
    if v_subs is not null then
      return jsonb_build_object(
        'buscado',      p_texto,
        'coincidencia', 'solo_subproductos',
        'sin_datos',    true,
        'subproductos', to_jsonb(v_subs),
        'nota', 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto: dilo y pregunta si es eso.')::json;
    end if;
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)
      into v_sug, v_sem
      from (
        select min(nombre) as nombre, min(pri) as pri, max(s) as s
          from (
            -- 20261203100000: un vector por nombre (productos_nombre_embedding).
            select e.nombre, 1 as pri, 1 - (e.embedding <=> p_embedding::halfvec(1536)) as s
              from productos_nombre_embedding e
             where p_embedding is not null and e.embedding is not null
               and 1 - (e.embedding <=> p_embedding::halfvec(1536)) >= c_sim_semantica
               and exists (select 1 from productos_factura pf where pf.nombre = e.nombre)
            union all
            select n.nombre, 2, extensions.strict_word_similarity(v_frase, n.t)
              from (select pf.nombre::text as nombre, array_to_string(pf.palabras_nombre, ' ') as t
                      from productos_factura pf
                     group by pf.nombre, pf.palabras_nombre) n
             where extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto
               and extensions.strict_word_similarity(v_pal[1], n.t) >= c_sim_texto
          ) x
         group by array_to_string(palabras_producto_agente(nombre), ' ')
         order by min(pri), max(s) desc
         limit 5
      ) y;

    return jsonb_strip_nulls(jsonb_build_object(
      'buscado',      p_texto,
      'coincidencia', case when v_sem then 'semantica' else 'ninguna' end,
      'sin_datos',    true,
      'sugerencias',  v_sug,
      'busqueda_hecha', 'Ya se ha buscado por nombre, raiz, abreviaturas y siglas, erratas'
                        || case when p_embedding is not null then ' y significado' else '' end
                        || ': no repitas la busqueda con otra herramienta ni con otras palabras.',
      'nota',         case when v_sug is not null then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados: pregunta si es alguno.'
                      else 'No hay compras de ese producto ni nada parecido: dilo asi, sin sugerir otros productos.' end
    ))::json;
  end if;

  -- ── Agregación ──
  with base0 as (
    select pf.id, pf.nombre::text as nombre,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.total::numeric as imp,   -- solo el importe leído: sin importe = sin_importe, sin precio
           f.id as doc, f.tipo, f.fecha, f.numero_documento::text as numero, f.proveedor_id as prov_id,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,   -- nombre canónico
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal or palabras_producto_agente(pc.nombre) @> v_pal as exacta,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(v_ids)
       and pf.total is distinct from 0   -- líneas a 0 €: fuera
  ),
  -- Albarán ya facturado (vínculo guardado o factura del proveedor que cita su número): fuera,
  -- salvo que se pidan solo albaranes.
  base as (
    select * from base0 where not fact or v_tipo = 'albaran'
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
       and (v_uni is null or unidad = v_uni)
       and (case when v_prov_id is not null then prov_id = v_prov_id
                 else not exists (select 1 from unnest(v_provw) w where position(w in lower(proveedor)) = 0) end)
  ),
  -- Albaranes ya facturados que se han dejado fuera (solo para el aviso).
  ya_facturados as (
    select b.id from base0 b
     where b.fact and v_tipo is null
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (v_uni is null or b.unidad = v_uni)
  ),
  c as (
    select *, case when imp > 0 and cant > 0 then imp / cant end as pu
      from filtrada
  ),
  -- Líneas sin cargo (total 0) del mismo producto en esas facturas.
  sc as (
    select pf.factura_id as doc, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           sum(pf.cantidad::numeric) as gratis
      from productos_factura pf
     where pf.total = 0 and pf.cantidad > 0
       and pf.factura_id in (select doc from c)
       and (pf.id = any(v_ids)
            or pf.producto_id in (select x.producto_id from productos_factura x where x.id = any(v_ids) and x.producto_id is not null))
     group by 1, 2
  ),
  efe as (
    select y.doc, y.unidad, sum(y.cant) as pagadas, s.gratis,
           coste_efectivo_agente(sum(y.imp), sum(y.cant), s.gratis) as coste
      from c y
      join sc s on s.doc = y.doc and s.unidad = y.unidad
     where y.pu is not null
     group by y.doc, y.unidad, s.gratis
  ),
  -- Variantes con su propio precio (por unidad). «Distintas» = dos variantes de la misma
  -- unidad con más de un 15 % de diferencia: entonces no se da una media global.
  var_u as (
    select mode() within group (order by nombre) as nombre, unidad,
           sum(cant) as cant, sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           count(distinct doc) as compras, max(fecha) as ultima,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' '), unidad
  ),
  var_dist as (
    select exists (select 1 from var_u a join var_u b on a.unidad = b.unidad
                    and b.precio > 0 and a.precio > b.precio * c_dif_variantes) as ok
  ),
  var_pu as (
    select prov_n, unidad, array_to_string(palabras_producto_agente(nombre), ' ') as k,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio
      from c group by 1, 2, 3
  ),
  prov_multi as (
    select a.prov_n, a.unidad from var_pu a join var_pu b
      on a.prov_n = b.prov_n and a.unidad = b.unidad and b.precio > 0 and a.precio > b.precio * c_dif_variantes
     group by 1, 2
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           (array_agg(proveedor order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_prov,
           max(fecha) filter (where pu is not null) as ultima,
           count(*) as lineas,
           count(distinct doc) as compras
      from c
     group by unidad
  ),
  por_prov as (
    select prov_n, unidad,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           (array_agg(numero order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_numero,
           (array_agg(doc order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_doc,
           min(pu) as p_min,
           max(pu) as p_max,
           count(distinct doc) as compras,
           min(fecha) as primera,
           max(fecha) as ultima,
           case when bool_and(tipo = 'albaran') then 'albaran'
                when bool_or(tipo = 'albaran') then 'factura+albaran' end as tipo
      from c
     group by prov_n, unidad
  ),
  ordenada as (
    select p.*,
           exists (select 1 from prov_multi pm where pm.prov_n = p.prov_n and pm.unidad = p.unidad) as multi,
           row_number() over (
             order by u.imp desc nulls last, u.cant desc nulls last, p.unidad,
                      case when v_orden = 'cantidad' then p.cant end desc nulls last,
                      case when v_orden = 'precio' then coalesce(p.ult_precio, p.precio) end asc nulls last,
                      p.imp desc nulls last, p.cant desc nulls last, p.proveedor) as rn,
           count(*) over () as n
      from por_prov p
      join por_unidad u using (unidad)
  ),
  -- Variantes agrupadas por sus palabras («20% nata» = «20%nata»).
  variantes as (
    select mode() within group (order by nombre) as nombre,
           count(*) as lineas, bool_and(exacta) as exacta, max(fecha) as ultima
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' ')
  ),
  marco as (
    select count(*) as lineas,
           count(distinct doc) as compras,
           count(distinct prov_n) as proveedores,
           count(distinct unidad) as unidades,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where cant is null or cant = 0) as sin_cantidad,
           count(distinct doc) filter (where fd) as fecha_dudosa,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           coalesce(bool_and(exacta), false) as todas_exactas,
           coalesce(bool_or(exacta), false) as alguna_exacta
      from c
  ),
  -- Precio comparable: solo si TODAS las líneas con precio se pueden pasar a la
  -- misma unidad base (kg, l, ud) y alguna es un envase (caja, cubo, bote...).
  -- Con p_base = false, además, solo si hay formatos distintos que comparar.
  cmp_marco as (
    select min(unidad_base) as ub,
           coalesce(bool_and(unidad_base is not null) and min(unidad_base) = max(unidad_base) and bool_or(conv)
                    and (p_base or count(distinct unidad) > 1 or min(factor) <> max(factor)), false) as ok
      from c
     where pu is not null
  ),
  cmp_prov as (
    select prov_n,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(imp) / nullif(sum(cant * factor), 0) as precio,
           (array_agg(pu / factor order by fecha desc nulls last, doc desc, id desc))[1] as ult_precio,
           min(pu / factor) as p_min,
           max(pu / factor) as p_max,
           count(distinct doc) as compras,
           max(fecha) as ultima,
           string_agg(distinct ctxt, ' / ') filter (where conv) as desde,
           row_number() over (order by (array_agg(pu / factor order by fecha desc nulls last, doc desc, id desc))[1],
                                       sum(imp) / nullif(sum(cant * factor), 0), (array_agg(proveedor))[1]) as rn
      from c
     where pu is not null
     group by prov_n
  )
  select jsonb_strip_nulls(jsonb_build_object(
    -- 20261128150000: la última factura (la más nueva con precio) y cómo leer el resultado.
    'ultima_factura', (
      select jsonb_strip_nulls(jsonb_build_object(
               'fecha', x.fecha, 'proveedor', x.proveedor, 'numero', x.numero, 'documento_id', x.doc,
               'tipo', x.tipo, 'producto', x.nombre, 'cantidad', trim_scale(round(x.cant, 3)), 'unidad', x.unidad,
               'precio_unitario', trim_scale(round(coalesce(e.coste, x.pu), case when coalesce(e.coste, x.pu) < 1 then 4 else 2 end)),
               'precio_linea', case when e.coste is not null then trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)) end,
               'sin_cargo', case when e.coste is not null then jsonb_build_object(
                              'unidades', trim_scale(round(e.gratis, 3)), 'pagadas', trim_scale(round(e.pagadas, 3)),
                              'nota', 'precio_unitario = COSTE REAL por unidad (total pagado / pagadas + sin cargo). precio_linea es el de la linea, sin las sin cargo: da el coste real y di que hay unidades sin cargo.') end,
               'fecha_dudosa', case when x.fd then true end,
               'misma_factura', (
                 select case when count(*) > 1 and min(y.pu) <> max(y.pu) then jsonb_build_object(
                          'lineas', count(*),
                          'precios', jsonb_agg(trim_scale(round(y.pu, case when y.pu < 1 then 4 else 2 end)) order by y.pu),
                          'precio_medio', trim_scale(round(sum(y.pu * y.cant) / nullif(sum(y.cant), 0), 2)),
                          'nota', 'Esta ultima factura trae varias lineas de este producto a precios distintos (p. ej. dos calibres): da los precios de todas (precios) o el precio_medio de la factura, no solo uno.') end
                   from c y
                  where y.doc = x.doc and y.unidad is not distinct from x.unidad and y.pu is not null and y.cant > 0)))
        from c x
        left join efe e on e.doc = x.doc and e.unidad is not distinct from x.unidad
       where x.pu is not null
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', (
      select case when m.lineas > 0 then
        'PRECIO DE REFERENCIA = ultima_factura (fecha, proveedor, numero: citalo para el enlace; precio_unitario por su unidad). '
        || 'por_proveedor.ultimo_precio y numero = la ultima factura de cada proveedor; precio_medio, min y max solo despues, '
        || 'como contexto. Mas barato = por ultimo_precio. '
        || 'Si ultima_factura trae sin_cargo, su precio_unitario ya es el coste real con las unidades sin cargo: dalo (y precio_linea).' end
        from marco m),
    'buscado',  p_texto,
    'excluido', nullif(trim(coalesce(p_excluir, '')), ''),
    'proveedor_pedido', nullif(trim(coalesce(p_proveedor, '')), ''),
    'proveedor_corregido', case when v_prov_id is not null then jsonb_build_object('usado', v_prov_nom,
       'nota', 'No hay proveedor con ese nombre exacto: se ha usado el mas parecido. Dilo.') end,
    'unidad',   v_uni,
    'periodo',  case when p_desde is not null or p_hasta is not null
                     then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                     else to_jsonb('todo el historico'::text) end,
    'tipo',     v_tipo,
    'coincidencia', (
      select case when v_aprox then 'aproximada'
                  when m.lineas = 0 then null
                  when m.todas_exactas then 'exacta'
                  when m.alguna_exacta then 'exacta+raiz'
                  else 'raiz' end
        from marco m),
    'productos_coincidentes', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', v.nombre,
               'lineas', v.lineas,
               'coincidencia', case when not v_aprox and m.alguna_exacta and not m.todas_exactas and not v.exacta
                                    then 'raiz' end))
             order by v.lineas desc, v.ultima desc nulls last, v.nombre)
        from (select * from variantes order by lineas desc, ultima desc nulls last, nombre limit c_max_variantes) v
       cross join marco m),
    'variantes_total', (select case when count(*) > c_max_variantes then count(*) end from variantes),
    'por_variante', (
      select case when (select ok from var_dist) then (
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'nombre',        v.nombre,
                        'unidad',        v.unidad,
                        'cantidad',      trim_scale(round(v.cant, 3)),
                        'importe',       trim_scale(round(v.imp, 2)),
                        'precio_medio',  trim_scale(round(v.precio, case when v.precio < 1 then 4 else 2 end)),
                        'ultimo_precio', trim_scale(round(v.ult_precio, case when v.ult_precio < 1 then 4 else 2 end)),
                        'compras',       v.compras,
                        'ultima',        v.ultima,
                        'proveedor',     v.proveedor))
                      order by v.imp desc nulls last, v.nombre)
                 from (select * from var_u order by imp desc nulls last, nombre limit 8) v) end),
    'nota_variantes', (
      select case when ok then 'Variantes con precios distintos: da CADA variante con su precio (por_variante), no una media.' end from var_dist),
    'subproductos_excluidos', to_jsonb(v_subs),
    'total', (
      select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
               'importe',     trim_scale(round(m.imp, 2)),
               'en_facturas', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
               'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
               'lineas',      m.lineas,
               'compras',     m.compras,
               'proveedores', m.proveedores)) end
        from marco m),
    'por_unidad', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'unidad',       u.unidad,
               'cantidad',     trim_scale(round(u.cant, 3)),
               'importe',      trim_scale(round(u.imp, 2)),
               'precio_medio', case when (select ok from var_dist) then null
                                    else trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)) end,
               'ultimo_precio', case when (select ok from var_dist) then null
                                     else trim_scale(round(u.ult_precio, case when u.ult_precio < 1 then 4 else 2 end)) end,
               'ultima',       u.ultima,
               'ultimo_proveedor', u.ult_prov,
               'lineas',       u.lineas,
               'compras',      u.compras))
             order by u.imp desc nulls last, u.cant desc nulls last, u.unidad)
        from por_unidad u),
    'por_proveedor', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',     o.proveedor,
               'unidad',        o.unidad,
               'cantidad',      trim_scale(round(o.cant, 3)),
               'importe',       trim_scale(round(o.imp, 2)),
               'precio_medio',  case when o.multi then null else trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)) end,
               'ultimo_precio', case when o.multi then null else trim_scale(round(o.ult_precio, case when o.ult_precio < 1 then 4 else 2 end)) end,
               'ultimo_coste_efectivo', (select trim_scale(round(e.coste, 2)) from efe e where e.doc = o.ult_doc and e.unidad = o.unidad and not o.multi),
               'precio_min',    case when o.multi then null else trim_scale(round(o.p_min, case when o.p_min < 1 then 4 else 2 end)) end,
               'precio_max',    case when o.multi then null else trim_scale(round(o.p_max, case when o.p_max < 1 then 4 else 2 end)) end,
               'varias_variantes', case when o.multi then true end,
               'compras',       o.compras,
               'primera',       o.primera,
               'ultima',        o.ultima,
               'numero',        o.ult_numero,
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'precio_comparable', (
      select case when cm.ok and not (select ok from var_dist) then jsonb_build_object(
               'unidad_base', cm.ub,
               'criterio', case when p_base then
                             'Todo convertido a €/' || cm.ub || ' dividiendo el precio del envase por su contenido (convertido_desde). '
                             || 'Compara con ESTOS precios y di de donde viene la conversion.'
                           else 'Formatos distintos pasados a €/' || cm.ub || ' (convertido_desde) SOLO para decir cual sale mas barato; '
                             || 'el precio de cada proveedor dalo en su formato (por_proveedor).' end,
               'por_proveedor', (
                 select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'proveedor',      p.proveedor,
                          'precio_medio',   trim_scale(round(p.precio, case when p.precio < 1 then 4 else 2 end)),
                          'ultimo_precio',  trim_scale(round(p.ult_precio, case when p.ult_precio < 1 then 4 else 2 end)),
                          'precio_min',     trim_scale(round(p.p_min, case when p.p_min < 1 then 4 else 2 end)),
                          'precio_max',     trim_scale(round(p.p_max, case when p.p_max < 1 then 4 else 2 end)),
                          'compras',        p.compras,
                          'ultima',         p.ultima,
                          'convertido_desde', p.desde))
                        order by p.rn)
                   from cmp_prov p
                  where p.rn <= v_lim)) end
        from cmp_marco cm),
    'una_compra',  (select case when m.compras = 1 then true end from marco m),
    'truncado',    (select case when max(n) > v_lim then true end from ordenada),
    'filas_total', (select case when max(n) > v_lim then max(n) end from ordenada),
    'criterio', (
      select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta. Precios SIN IVA.' end
        from marco m),
    'avisos', (
      select nullif(jsonb_strip_nulls(jsonb_build_object(
               'sin_importe',             nullif(m.sin_importe, 0),
               'sin_cantidad',            nullif(m.sin_cantidad, 0),
               'fecha_dudosa',            nullif(m.fecha_dudosa, 0),
               'unidades_mezcladas',      case when m.unidades > 1 then true end,
               'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
        from marco m),
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'fuera_del_filtro', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'lineas',    count(*),
                        'primera',   min(b.fecha),
                        'ultima',    max(b.fecha),
                        'tipos',     string_agg(distinct b.tipo, ','),
                        'unidades',  string_agg(distinct b.unidad, ','),
                        'productos', (select jsonb_agg(distinct b2.nombre) from (select nombre from base limit 5) b2)))
                 from base b) end
        from marco m),
    -- Periodo/tipo/unidad sin nada pero sí hay histórico: la última compra.
    'ultimo_dato', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'fecha',     u.fecha,
                        'producto',  u.nombre,
                        'cantidad',  trim_scale(round(u.cant, 3)),
                        'unidad',    u.unidad,
                        'proveedor', u.proveedor,
                        'importe',   trim_scale(round(u.imp, 2)),
                        'tipo',      u.tipo))
                 from (select b.fecha, b.unidad, b.tipo, max(b.proveedor) as proveedor, min(b.nombre) as nombre,
                              sum(b.cant) as cant, sum(b.imp) as imp
                         from base b
                        where b.doc = (select b2.doc from base b2 order by b2.fecha desc nulls last, b2.doc desc limit 1)
                        group by b.fecha, b.unidad, b.tipo
                        order by sum(b.imp) desc nulls last, sum(b.cant) desc nulls last
                        limit 1) u) end
        from marco m)
  )) into resultado;

  -- 20261128150000: la última factura y como_leer, lo primero del resultado (lo lee antes el modelo
  -- y no se pierde si el resultado se recorta).
  return json_delante_agente(
    jsonb_strip_nulls(jsonb_build_object('como_leer', resultado -> 'como_leer', 'ultima_factura', resultado -> 'ultima_factura',
      'posibles_coincidencias', v_posj,
      'nota_posibles', case when v_posj is not null then
        'posibles_coincidencias = lineas que PUEDEN ser este producto escrito con abreviatura o siglas (p. ej. «LP» = Laurent '
        || 'Perrier). NO estan en total, ultima_factura ni por_proveedor. Dilas APARTE con su nombre exacto y su precio, '
        || 'sin sumarlas, y pregunta si son el mismo producto.' end)),
    resultado);
end;
$function$
;

revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) to authenticated, service_role;

-- ─── variacion_precios_agente ───
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text, p_base boolean DEFAULT true, p_comparar text DEFAULT 'media'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261107200000_variacion_precios_rapida: por conjuntos (una pasada), mismos resultados.
-- 20261124120000_chatbot_precio_unidad_compra: con p_base = false (chat-facturas) solo se convierte el producto que
-- mezcla formatos (si no, no habría con qué comparar); el resto, en la unidad en que se compra.
-- 20261128150000_chatbot_ultima_factura: p_comparar = 'anterior' (chat-facturas): la ÚLTIMA factura frente a la
-- factura ANTERIOR del MISMO proveedor (si no hay, la anterior de otro: cambio_proveedor), con su número
-- para el enlace; la media de 90 días va aparte (media), como contexto. 'media' (por defecto, el panel):
-- como hasta ahora, la última compra frente a la media ponderada de 90 días.
-- 20261210110000_chat_facturas_bateria_fallos: si el precio cambia ×10 o más (o ÷10) frente a la referencia no se compara
-- (caja contra unidad, kilo contra bulto): sale en unidades_dudosas, no como «+11.900 %».
declare
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_ids     bigint[];
  v_subs    text[];
  resultado jsonb;
  v_ant     boolean;
begin
  v_ant := case lower(coalesce(nullif(trim(p_comparar), ''), 'media')) when 'anterior' then true when 'media' then false end;
  if v_ant is null then
    return json_build_object('error', 'comparar debe ser anterior o media.');
  end if;
  v_sentido := case when v_sentido like 'sub%' then 'subidas' when v_sentido like 'baj%' then 'bajadas'
                    when v_sentido in ('ambas', 'ambos', 'todas', 'todo') then 'ambas' else '?' end;
  if v_sentido = '?' then
    return json_build_object('error', 'sentido debe ser subidas, bajadas o ambas.');
  end if;
  if v_umbral < 0 or v_umbral > 1000 then
    return json_build_object('error', 'umbral_pct debe estar entre 0 y 1000.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
  end if;
  if nullif(trim(coalesce(p_producto, '')), '') is not null then
    select h.ids, h.subproductos into v_ids, v_subs from lineas_producto_agente(p_producto) h;
    v_prods := array(select distinct pf.producto_id from productos_factura pf
                      where pf.id = any(v_ids) and pf.producto_id is not null);
    if cardinality(v_prods) = 0 then
      return jsonb_strip_nulls(jsonb_build_object('buscado', p_producto, 'sin_datos', true,
        'subproductos', to_jsonb(v_subs),
        'nota', case when v_subs is not null
                     then 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto.'
                     else 'Ningun producto del catalogo se llama asi: prueba compras_producto o historial_precios.' end))::json;
    end if;
  end if;

  with
  -- Albaranes ya facturados (vínculo facturado_en_id, misma regla de fechas que
  -- albaranes_facturados_agente).
  fact as materialized (
    select a.id
      from facturas a
      join facturas fx on fx.id = a.facturado_en_id and fx.tipo = 'factura'
     where a.tipo = 'albaran'
       and (a.facturado_origen = 'manual' or a.fecha is null or fx.fecha is null or a.fecha <= fx.fecha)
  ),
  -- Productos que entran (categoría / producto pedido / sin servicios).
  prod as materialized (
    select p.id, p.nombre, p.contenido_cantidad, p.contenido_unidad
      from productos_catalogo p
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or p.id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- unidad_agente una vez por unidad escrita distinta (no por línea).
  um as materialized (
    select d.u, unidad_agente(d.u) as ua
      from (select distinct coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as u from productos_factura pf) d
  ),
  -- Líneas como lineas_precio_agente(null, null, true), solo de esos productos.
  l0 as materialized (
    select pf.id, pf.factura_id, pf.producto_id, pr.nombre as producto,
           um.u as unidad, um.ua,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           coalesce(pf.contenido_cantidad, pr.contenido_cantidad) as cc,
           case when pf.contenido_cantidad is not null then pf.contenido_unidad else pr.contenido_unidad end as cu
      from productos_factura pf
      join prod pr on pr.id = pf.producto_id
      join facturas f on f.id = pf.factura_id
      join um on um.u = coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')
     where not (f.tipo = 'albaran' and f.id in (select id from fact))
  ),
  -- base_linea_agente / contenido_texto_agente escritas en línea.
  lb as (
    select l0.*,
           case when l0.ua in ('kg', 'l') then l0.ua
                when l0.ua <> 'm' and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') then l0.cu end as unidad_base,
           case when l0.ua in ('kg', 'l') then 1::numeric
                when l0.ua <> 'm' and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') then l0.cc end as factor,
           l0.ua not in ('kg', 'l', 'm') and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') as conv,
           case when l0.cc > 0 and l0.cu is not null then
                  case when l0.ua = 'caja' then 'caja' else 'envase' end
                  || ' de ' || trim_scale(l0.cc)::text || ' ' || l0.cu end as ctxt
      from l0
     where l0.precio > 0
       -- Albarán repetido en una factura (mismo producto, unidad y cantidad, del
       -- mismo proveedor, de 7 días antes a 75 después): cuenta la factura.
       and not (l0.tipo = 'albaran' and exists (
             select 1
               from productos_factura x
               join facturas fx on fx.id = x.factura_id
              where fx.tipo = 'factura'
                and x.producto_id = l0.producto_id
                and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = l0.unidad
                and x.cantidad = l0.cantidad
                and fx.fecha between l0.fecha - 7 and l0.fecha + 75
                and mismo_proveedor_agente(
                      coalesce(nullif(fx.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(fx.proveedor), ''), '?'),
                      l0.prov_n)))
  ),
  -- Con base: si TODAS las líneas del producto pasan a la misma unidad base y
  -- alguna es un envase, precio y cantidad van en esa unidad.
  lk as (
    select lb.*,
           coalesce(bool_and(lb.unidad_base is not null) over w
                    and min(lb.unidad_base) over w = max(lb.unidad_base) over w
                    and bool_or(lb.conv) over w
                    and (p_base or min(lb.ua) over w <> max(lb.ua) over w or min(lb.factor) over w <> max(lb.factor) over w), false) as ok
      from lb
    window w as (partition by lb.producto_id)
  ),
  l as materialized (
    select lk.id, lk.factura_id, lk.producto_id, lk.producto,
           case when lk.ok then lk.unidad_base else lk.unidad end as unidad,
           case when lk.ok then lk.cantidad * lk.factor else lk.cantidad end as cantidad,
           case when lk.ok then round(lk.precio / lk.factor, 4) else lk.precio end as precio,
           lk.fecha, lk.tipo, lk.proveedor, lk.prov_n,
           case when lk.ok and lk.conv then lk.ctxt end as convertido_desde
      from lk
  ),
  -- Todo por ventanas sobre l, sin cruzar CTE entre sí (sobre un CTE el
  -- planificador estima 1 fila y repite bucles anidados: 4-60 s).
  -- a) Última compra de cada producto y unidad dentro del periodo (= DISTINCT ON
  --    producto, unidad ORDER BY fecha DESC, factura_id DESC de antes).
  ua as (
    select l.*,
           first_value(l.factura_id) over wu as u_fid,
           first_value(l.fecha) over wu as u_fecha,
           first_value(l.prov_n) over wu as u_prov,
           bool_or(l.en_periodo) over (partition by l.producto_id, l.unidad) as hay
      from (select l.*, coalesce((p_desde is null or l.fecha >= p_desde) and (p_hasta is null or l.fecha <= p_hasta), false) as en_periodo
              from l) l
    window wu as (partition by l.producto_id, l.unidad order by l.en_periodo desc, l.fecha desc, l.factura_id desc)
  ),
  -- b) Compras anteriores en otro documento (= precio_referencia_agente: misma
  --    unidad, fecha anterior o mismo día con id menor).
  ub as (
    select ua.*,
           ua.factura_id = ua.u_fid as es_ult,
           coalesce(ua.factura_id <> ua.u_fid
                    and (ua.fecha < ua.u_fecha or (ua.fecha = ua.u_fecha and ua.factura_id < ua.u_fid)), false) as es_ant,
           -- 20261128150000: anterior del MISMO proveedor que la última.
           coalesce(ua.factura_id <> ua.u_fid and ua.prov_n = ua.u_prov
                    and (ua.fecha < ua.u_fecha or (ua.fecha = ua.u_fecha and ua.factura_id < ua.u_fid)), false) as es_ant_m
      from ua
     where ua.hay
  ),
  -- c) Documentos anteriores: orden (el más reciente = 1) y cuántos en 90 días.
  uc as (
    select ub.*,
           dense_rank() over (partition by ub.producto_id, ub.unidad
                              order by ub.es_ant desc, ub.fecha desc, ub.factura_id desc) as rn_doc,
           dense_rank() over (partition by ub.producto_id, ub.unidad
                              order by ub.es_ant_m desc, ub.fecha desc, ub.factura_id desc) as rn_m,
           row_number() over (partition by ub.producto_id, ub.unidad, ub.factura_id order by ub.id) = 1 as pri_doc
      from ub
  ),
  ud as (
    select uc.*,
           count(*) filter (where uc.es_ant and uc.pri_doc and uc.fecha >= uc.u_fecha - 90)
             over (partition by uc.producto_id, uc.unidad) as n90
      from uc
  ),
  -- d) Líneas de la referencia: media de 90 días si hay ≥ 2 documentos, si no
  --    las 3 últimas compras.
  ue as (
    select ud.*,
           ud.es_ant and case when ud.n90 >= 2 then ud.fecha >= ud.u_fecha - 90 else ud.rn_doc <= 3 end as es_ref,
           case when ud.n90 >= 2 then 'media_90_dias' else 'ultimas_compras' end as metodo
      from ud
  ),
  -- e) Proveedor de la referencia: el de más importe (empate: por nombre).
  uf as (
    select ue.*,
           first_value(ue.proveedor) over (partition by ue.producto_id, ue.unidad
                                           order by ue.es_ref desc, ue.peso desc nulls last, ue.proveedor) as ref_prov
      from (select ue.*,
                   sum(ue.precio * coalesce(nullif(ue.cantidad, 0), 1)) filter (where ue.es_ref)
                     over (partition by ue.producto_id, ue.unidad, ue.proveedor) as peso
              from ue) ue
  ),
  ult as (
    select uf.producto_id, uf.unidad, uf.producto,
           min(uf.u_fid) as factura_id,
           min(uf.u_fecha) as fecha,
           (array_agg(uf.tipo) filter (where uf.es_ult))[1] as tipo,
           (array_agg(uf.proveedor) filter (where uf.es_ult))[1] as proveedor,
           (array_agg(uf.prov_n) filter (where uf.es_ult))[1] as prov_n,
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ult and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ult and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ult)) as precio,
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ref and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ref and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ref)) as ref_precio,
           nullif(count(distinct uf.factura_id) filter (where uf.es_ref), 0)::integer as ref_compras,
           min(uf.fecha) filter (where uf.es_ref) as ref_desde,
           max(uf.fecha) filter (where uf.es_ref) as ref_hasta,
           (array_agg(uf.ref_prov) filter (where uf.es_ref))[1] as ref_proveedor,
           array_agg(distinct uf.prov_n) filter (where uf.es_ref) as proveedores_n,
           (array_agg(uf.metodo) filter (where uf.es_ref))[1] as metodo,
           -- 20261128150000: la factura anterior del mismo proveedor (antm) y la anterior de cualquiera (anta).
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ant_m and uf.rn_m = 1 and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ant_m and uf.rn_m = 1 and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ant_m and uf.rn_m = 1)) as antm_precio,
           max(uf.fecha) filter (where uf.es_ant_m and uf.rn_m = 1) as antm_fecha,
           max(uf.factura_id) filter (where uf.es_ant_m and uf.rn_m = 1) as antm_fid,
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ant and uf.rn_doc = 1 and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ant and uf.rn_doc = 1 and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ant and uf.rn_doc = 1)) as anta_precio,
           max(uf.fecha) filter (where uf.es_ant and uf.rn_doc = 1) as anta_fecha,
           max(uf.factura_id) filter (where uf.es_ant and uf.rn_doc = 1) as anta_fid
      from uf
     group by uf.producto_id, uf.unidad, uf.producto
  ),
  cmp0 as (
    select u.*,
           case when u.antm_fid is not null then u.antm_precio else u.anta_precio end as ant_precio,
           case when u.antm_fid is not null then u.antm_fecha else u.anta_fecha end as ant_fecha,
           case when u.antm_fid is not null then u.antm_fid else u.anta_fid end as ant_fid,
           case when u.ref_precio > 0 then round((u.precio / u.ref_precio - 1) * 100, 1) end as var_media
      from ult u
  ),
  cmp as materialized (
    select u.*, dd.dudosa,
           case when dd.dudosa then null
                when v_ant then case when u.ant_precio > 0 then round((u.precio / u.ant_precio - 1) * 100, 1) end
                else u.var_media end as var,
           case when v_ant then u.antm_fid is null and u.anta_fid is not null
                else u.ref_precio is not null and not (u.prov_n = any(u.proveedores_n)) end as cambio
      from cmp0 u
      cross join lateral (
        select coalesce(case when v_ant then u.ant_precio > 0 and (u.precio / u.ant_precio >= 10 or u.precio / u.ant_precio <= 0.1)
                             else u.ref_precio > 0 and (u.precio / u.ref_precio >= 10 or u.precio / u.ref_precio <= 0.1) end, false) as dudosa
      ) dd
  ),
  sel as materialized (
    select c.*, row_number() over (
             order by case when v_sentido = 'bajadas' then c.var end asc nulls last,
                      case when v_sentido = 'ambas' then abs(c.var) end desc nulls last,
                      c.var desc nulls last, c.producto) as rn,
           count(*) over () as n
      from cmp c
     where c.var is not null
       and (v_prods is not null
            or (v_sentido = 'subidas' and c.var >= v_umbral)
            or (v_sentido = 'bajadas' and c.var <= -v_umbral)
            or (v_sentido = 'ambas' and abs(c.var) >= v_umbral))
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'criterio', case when v_ant then
                  'Por producto y unidad: precio de la ULTIMA factura frente a la factura ANTERIOR del MISMO proveedor '
                  || '(si no hay, la anterior de otro proveedor: cambio_proveedor). media = media ponderada de los 90 dias '
                  || 'anteriores, solo como contexto. Precios de linea SIN IVA.'
                else 'Por producto y unidad: precio de la ultima compra frente a la media ponderada de las compras de los '
                  || '90 dias anteriores (o de las 3 ultimas compras anteriores si en 90 dias hay menos de 2). '
                  || 'Precios de linea SIN IVA.' end
                || case when v_prods is not null then ' Producto pedido: todas sus unidades, sin umbral.' else '' end,
    'como_leer', case when v_ant then
                   'Da primero precio, fecha, proveedor y numero (la ultima factura: cita el numero para el enlace) y su '
                   || 'variacion_pct frente a anterior; media, despues y solo como contexto.' end,
    'buscado',   p_producto,
    'categoria', v_cat.nombre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(case when v_ant then jsonb_strip_nulls(jsonb_build_object(
                 -- 20261128150000: la última factura, la anterior (mismo proveedor) y la media como contexto.
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'convertido_desde', (select string_agg(distinct x.convertido_desde, ' / ') from l x
                                       where x.producto_id = s.producto_id and x.unidad = s.unidad),
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                              where f.id = s.factura_id), s.proveedor),
                 'numero',         (select f.numero_documento::text from facturas f where f.id = s.factura_id),
                 'documento_id',   s.factura_id,
                 'tipo',           case when s.tipo = 'albaran' then 'albaran' end,
                 'variacion_pct',  s.var,
                 'anterior',       case when s.ant_fid is not null then jsonb_strip_nulls(jsonb_build_object(
                                     'precio',    trim_scale(round(s.ant_precio, 4)),
                                     'fecha',     s.ant_fecha,
                                     'proveedor', (select coalesce(pv.nombre, f.proveedor::text) from facturas f
                                                     left join proveedores pv on pv.id = f.proveedor_id where f.id = s.ant_fid),
                                     'numero',    (select f.numero_documento::text from facturas f where f.id = s.ant_fid))) end,
                 'cambio_proveedor', case when s.cambio then true end,
                 'ref_antigua',    case when s.ant_fecha < s.fecha - 180 then true end,
                 'media',          case when s.ref_precio is not null then jsonb_strip_nulls(jsonb_build_object(
                                     'precio',        trim_scale(round(s.ref_precio, 4)),
                                     'compras',       s.ref_compras,
                                     'desde',         s.ref_desde,
                                     'hasta',         case when s.ref_hasta <> s.ref_desde then s.ref_hasta end,
                                     'variacion_pct', s.var_media)) end))
               else jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'convertido_desde', (select string_agg(distinct x.convertido_desde, ' / ') from l x
                                       where x.producto_id = s.producto_id and x.unidad = s.unidad),
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                              where f.id = s.factura_id), s.proveedor),
                 'tipo',           case when s.tipo = 'albaran' then 'albaran' end,
                 'variacion_pct',  s.var,
                 'ref_precio',     trim_scale(round(s.ref_precio, 4)),
                 'ref_compras',    s.ref_compras,
                 'ref_desde',      s.ref_desde,
                 'ref_hasta',      case when s.ref_hasta <> s.ref_desde then s.ref_hasta end,
                 'ref_proveedor',  case when s.cambio or s.ref_proveedor is distinct from s.proveedor then s.ref_proveedor end,
                 'cambio_proveedor', case when s.cambio then true end,
                 'pocas_compras',  case when s.ref_compras = 1 then true end,
                 'ref_antigua',    case when s.metodo = 'ultimas_compras' and s.ref_hasta < s.fecha - 90 then true end)) end
               order by s.rn)
          from sel s where s.rn <= v_lim), '[]'::jsonb),
    -- Producto pedido sin precio anterior con que comparar: su última compra
    -- (una_compra = solo hay una: no hay subida ni bajada posible).
    'sin_comparar', case when v_prods is not null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',   c.producto,
                 'unidad',     c.unidad,
                 'unidades_dudosas', case when c.dudosa then true end,
                 'precio',     trim_scale(round(c.precio, 4)),
                 'fecha',      c.fecha,
                 'proveedor',  coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                          where f.id = c.factura_id), c.proveedor),
                 'numero',     case when v_ant then (select f.numero_documento::text from facturas f where f.id = c.factura_id) end,
                 'una_compra', case when (select count(distinct l2.factura_id) from l l2
                                           where l2.producto_id = c.producto_id and l2.unidad = c.unidad) = 1 then true end))
               order by c.fecha desc, c.producto)
          from (select * from cmp where var is null order by fecha desc, producto limit v_lim) c) end,
    'total_productos', (select coalesce(max(n), 0) from sel),
    'truncado',  (select case when max(n) > v_lim then true end from sel),
    'comparados', (select count(*) from cmp where var is not null),
    'avisos', nullif(jsonb_strip_nulls(jsonb_build_object(
        'sin_referencia', nullif((select count(*) from cmp where var is null and not dudosa), 0),
        'unidades_dudosas', nullif((select count(*) from cmp where dudosa), 0),
        'pocas_compras',  case when not v_ant then nullif((select count(*) from sel where ref_compras = 1 and rn <= v_lim), 0) end,
        'cambio_proveedor', nullif((select count(*) from sel where cambio and rn <= v_lim), 0),
        'sin_clasificar', nullif((select count(*) from productos_factura pf join facturas f on f.id = pf.factura_id
                                   where pf.producto_id is null
                                     and not (f.tipo = 'albaran' and f.id in (select id from fact))
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'unidades_dudosas', (
        select jsonb_agg(jsonb_build_object('producto', d.producto, 'unidad', d.unidad,
                                            'precio', trim_scale(round(d.precio, 4)),
                                            'precio_referencia', trim_scale(round(case when v_ant then d.ant_precio else d.ref_precio end, 4)))
                         order by d.producto)
          from (select * from cmp where dudosa order by producto limit 5) d),
    'nota_unidades_dudosas', (select case when exists (select 1 from cmp where dudosa) then
        'unidades_dudosas = productos cuyo precio cambia x10 o mas frente a la referencia (casi seguro caja contra unidad). '
        || 'NO los des como subida o bajada: avisa de que las unidades de esas compras no son comparables.' end),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$
;

revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text, boolean, text) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text, boolean, text) to authenticated, service_role;

