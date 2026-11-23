set client_encoding = 'UTF8';
-- 20261217100100_chat_facturas_busqueda_por_partes (aplicada como 20261217100000) · ROLLBACK: vuelve a la búsqueda que exige todas las palabras, al proveedor por nombre seguido
-- y a «copas» = familia Licores. Los índices se quitan (no molestan si se dejan).
set lock_timeout = '5s';

-- compras_producto_agente y ficha_proveedor_agente: se deshacen los parches.
do $mig$
declare
  v_def text;
begin
  -- ─── compras_producto_agente ───
  v_def := replace(pg_get_functiondef('public.compras_producto_agente'::regproc), E'\r', '');
  v_def := replace(v_def, $b0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido
  v_par   jsonb;      -- 20261217100000: busqueda por partes (parcial_producto_agente)
  v_tprov text;       -- 20261217100000: lo pedido es tambien el nombre de un proveedor$b0$, $a0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$a0$);
  v_def := replace(v_def, $b1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);
  -- 20261217100000: sin nada, o encontrado por partes (ninguna linea lleva todas las palabras): parcial_producto_agente
  -- dice si lo pedido es un proveedor, que palabras no casan y que nombres sugerir.
  -- (Si lineas_producto_agente ya la pidio en esta consulta, parcial_producto_agente devuelve lo guardado.)
  if v_ids is null
     or (v_met = 'aproximada'
         and current_setting('chat_facturas.parcial_clave', true) = md5(coalesce(p_texto, '') || '|' || coalesce(p_excluir, ''))) then
    v_par := parcial_producto_agente(p_texto, p_excluir);
  end if;
  -- El modelo parte a veces el nombre del proveedor: producto «suministros», proveedor «altamira». Si las palabras de los dos
  -- juntas son el nombre de UN proveedor y ese proveedor no factura ningun producto asi, lo pedido es el proveedor.
  if nullif(trim(coalesce(p_proveedor, '')), '') is not null
     and not exists (select 1 from unnest(v_pal) w
                      where exists (select 1 from terminos_agente tt where tt.raices = array[raiz_producto_agente(w)])) then
    select c.nombre into v_tprov
      from proveedor_buscar_agente(v_frase || ' ' || p_proveedor) c
     where c.claro and c.metodo in ('exacto', 'contiene', 'palabras')
       and not exists (select 1 from productos_factura pf join facturas f on f.id = pf.factura_id
                        where pf.id = any(coalesce(v_ids, '{}'::bigint[])) and f.proveedor_id = c.id)
     limit 1;
    if v_tprov is not null then
      return jsonb_build_object(
        'buscado',      p_texto,
        'proveedor_pedido', p_proveedor,
        'coincidencia', 'proveedor',
        'sin_datos',    true,
        'es_proveedor', v_tprov,
        'nota', '«' || p_texto || ' ' || p_proveedor || '» es el nombre del proveedor ' || v_tprov
                || ', no un producto suyo. Para su gasto, sus productos y sus precios usa ficha_proveedor con ese nombre.')::json;
    end if;
  end if;
  -- Encontrado por su nombre, pero lo pedido es TAMBIEN un proveedor («altamira»): se avisa.
  if v_ids is not null and v_met = 'texto' and cardinality(v_pal) <= 3
     and nullif(trim(coalesce(p_proveedor, '')), '') is null
     and not exists (select 1 from unnest(v_pal) w
                      where exists (select 1 from terminos_agente tt where tt.raices = array[raiz_producto_agente(w)])) then
    select c.nombre into v_tprov from proveedor_buscar_agente(v_frase) c
     where c.claro and c.metodo in ('exacto', 'contiene', 'palabras') limit 1;
  end if;$b1$, $a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);$a1$);
  v_def := replace(v_def, $b2$    -- 20261217100000: lo pedido no es un producto sino un proveedor («suministros altamira»).
    if v_par ? 'es_proveedor' then
      return jsonb_build_object(
        'buscado',      p_texto,
        'coincidencia', 'proveedor',
        'sin_datos',    true,
        'es_proveedor', v_par->'es_proveedor',
        'nota', '«' || p_texto || '» no es un producto: es el proveedor ' || (v_par->>'es_proveedor')
                || '. Para su gasto, sus productos y sus precios usa ficha_proveedor con ese nombre (sus documentos: filtrar_documentos).')::json;
    end if;
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$b2$, $a2$    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$a2$);
  v_def := replace(v_def, $b3$      'sugerencias',  (select jsonb_agg(z.x order by z.o)
                         from (select u.x, min(u.o) as o
                                 from (select a.x, a.o from jsonb_array_elements_text(coalesce(v_par->'sugerencias', '[]'::jsonb)) with ordinality a(x, o)
                                       union all
                                       select b.x, 100 + b.o from jsonb_array_elements_text(coalesce(v_sug, '[]'::jsonb)) with ordinality b(x, o)) u
                                group by u.x
                                order by min(u.o)
                                limit 6) z),
      'sugerencias_detalle', v_par->'sugerencias_detalle',$b3$, $a3$      'sugerencias',  v_sug,$a3$);
  v_def := replace(v_def, $b4$             where coalesce(jsonb_array_length(v_par->'sugerencias'), 0) < 4
               and extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$b4$, $a4$             where extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$a4$);
  v_def := replace(v_def, $b5$      'nota',         case when v_par ? 'sugerencias_detalle' then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados. sugerencias_detalle dice que proveedor trae '
                        || 'cada uno y cuando fue la ultima vez: nombralos con su proveedor y pregunta si es alguno.'
                      when v_sug is not null then$b5$, $a5$      'nota',         case when v_sug is not null then$a5$);
  v_def := replace(v_def, $b6$      'variante_cercana', v_var,
      'por_partes', case when v_par ? 'ids' then jsonb_strip_nulls(jsonb_build_object(
        'palabras_sin_casar', v_par->'sin_casar',
        'nota', case when v_par->>'nivel' = 'unico'
                  then 'Ningun producto lleva «' || p_texto || '» entero: las palabras de palabras_sin_casar no estan en ninguno. Se da el UNICO '
                       || 'producto que casa con el resto: EMPIEZA diciendolo y nombralo como figura en la factura (productos_coincidentes).'
                  else 'Ninguna linea lleva juntas todas las palabras de «' || p_texto || '»: se dan las que las llevan repartidas entre su nombre, '
                       || 'su producto del catalogo, su familia, su proveedor o una inicial («L.» por Leon). Di con que nombre figura en la factura '
                       || '(productos_coincidentes).' end
                || case when v_par->'sin_casar' is not null and v_par->>'nivel' <> 'unico'
                        then ' Lo de palabras_sin_casar (la añada pedida) no figura en el nombre: dilo.' else '' end)) end,
      'tambien_proveedor', case when v_tprov is not null then jsonb_build_object(
        'nombre', v_tprov,
        'nota', '«' || p_texto || '» es tambien el nombre de un proveedor. Si la pregunta es por el proveedor (su gasto, que trae), '
                || 'esto NO la contesta: usa ficha_proveedor.') end,$b6$, $a6$      'variante_cercana', v_var,$a6$);
  execute v_def;
  -- ─── ficha_proveedor_agente ───
  v_def := replace(pg_get_functiondef('public.ficha_proveedor_agente'::regproc), E'\r', '');
  v_def := replace(v_def, $b0$    -- 20261217100000: no es un proveedor pero si un producto («ficha de leon beyer»): se dice, para ir a compras_producto.
    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,
              'es_producto', (select case when h.ids is not null then true end from lineas_producto_agente(p_texto) h),$b0$, $a0$    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,$a0$);
  execute v_def;
end
$mig$;

-- Las funciones enteras, como estaban (definición viva del 23/11/2026).
CREATE OR REPLACE FUNCTION public.lineas_producto_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261107100000_chat_facturas_asociacion: primero se asocia el texto.
--   · Familia («cerveza», «vinos», «marisco»): las líneas de la familia
--     (metodo 'familia'), no las que dicen la palabra.
--   · Producto con familia («gamba», «cruzcampo», «vino tinto»): la búsqueda de
--     siempre (lineas_producto_base_agente) y, si alguna línea es de esa familia
--     raíz, se apartan las de otras familias como derivados en `subproductos`
--     («croqueta de gambas», «vinagre de vino»). Líneas sin categoría se quedan.
declare
  a      json := asociar_termino_agente(p_texto);
  v_cat  bigint;
  v_fam  bigint;
  v_excl text[];
  b      record;
  v_ok   bigint[];
  v_der  text[];
begin
  if a->>'tipo' = 'familia' then
    v_cat := (a->>'categoria_id')::bigint;
    v_excl := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(p_excluir)) w
                     where not (w = any(array['de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'con', 'sin'])));
    select array_agg(pf.id order by pf.id) into v_ok
      from productos_factura pf
      join productos_catalogo pc on pc.id = pf.producto_id
      join categorias_producto c on c.id = pc.categoria_id
     where (c.id = v_cat or c.padre_id = v_cat)
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl);
    if v_ok is not null then
      return query select v_ok, 'familia'::text, null::text[], palabras_producto_agente(p_texto);
      return;
    end if;
  end if;

  select * into b from lineas_producto_base_agente(p_texto, p_excluir);
  v_fam := (a->>'familia_id')::bigint;
  if a->>'tipo' = 'producto' and v_fam is not null and b.ids is not null then
    select array_agg(x.id order by x.id) filter (where x.dentro),
           (array_agg(distinct x.etq) filter (where not x.dentro))[1:5]
      into v_ok, v_der
      from (select pf.id, coalesce(pc.nombre, pf.nombre::text) as etq,
                   c.id is null or coalesce(c.padre_id, c.id) = v_fam as dentro
              from unnest(b.ids) u(id)
              join productos_factura pf on pf.id = u.id
              left join productos_catalogo pc on pc.id = pf.producto_id
              left join categorias_producto c on c.id = pc.categoria_id) x;
    if v_ok is not null and v_der is not null then
      return query select v_ok, b.metodo,
                          (coalesce(b.subproductos, '{}'::text[]) || v_der)[1:5], b.palabras;
      return;
    end if;
  end if;
  return query select b.ids, b.metodo, b.subproductos, b.palabras;
end;
$function$;

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
--   mínimo 0,45 (antes 0,4: «gordura» caía en «chirla gorda»), salvo palabras de 6 letras o más y misma longitud ±1
--   (una errata de una letra: «centoyo», «nabajas», «pintja»), que siguen en 0,4.
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
         -- palabra con lo buscado, le falta otra que no es un formato (magnum…), no tiene la primera palabra buscada y línea y catálogo empiezan por la misma palabra
         -- ajena a la búsqueda («TOSTADAS CRISTAL» = «Tostadas de pan de cristal» no es «pan de cristal»).
         and not (cardinality(v_rai) >= 2
              and not (pf.raices_nombre @> v_rai)
              and pf.raices_nombre && v_rai
              and not (raiz_producto_agente(v_pal[1]) = any(pf.raices_nombre))   -- la línea tiene la 1.ª palabra buscada («CAVA JUVE MASANA» para «juve camps»): se queda
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
                   and extensions.similarity(q.qw, v.w)
                       >= case when length(q.qw) >= 6 and abs(length(v.w) - length(q.qw)) <= 1 then 0.4 else 0.45 end)
               -- una sola letra cambiada (sin la -s final): «nabajas» por «navajas», cuando el vocabulario solo trae «navaja»
               or (length(q.qw) >= 6 and abs(length(v.w) - length(q.qw)) <= 1
                   and length(regexp_replace(v.w, 's$', '')) = length(regexp_replace(q.qw, 's$', ''))
                   and (select count(*) from generate_series(1, length(regexp_replace(q.qw, 's$', ''))) i
                         where substr(regexp_replace(q.qw, 's$', ''), i, 1) <> substr(regexp_replace(v.w, 's$', ''), i, 1)) = 1)
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
$function$;

CREATE OR REPLACE FUNCTION public.proveedor_buscar_agente(p_texto text)
 RETURNS TABLE(id bigint, nombre text, metodo text, parecido real, claro boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- metodo: exacto (nombre, nombre comercial o alias), contiene, parecido (errata).
  -- claro: el primero y sin otro casi igual de parecido → se puede usar sin preguntar.
  -- 20261209200000: por parecido solo es claro si es una errata (errata_proveedor_agente);
  -- si no, sale en la lista para preguntar y NUNCA se dan cifras suyas.
  with q as (
    select nullif(normalizar_proveedor_base(coalesce(p_texto, '')), '') as n
  ),
  c as (
    select p.id, p.nombre::text as nombre,
           (select count(*) from facturas f where f.proveedor_id = p.id) as docs,
           case when p.nombre_normalizado = q.n
                  or normalizar_proveedor_base(p.nombre_comercial) = q.n
                  or exists (select 1 from proveedores_alias a where a.proveedor_id = p.id and a.alias_normalizado = q.n)
                then 1
                when length(q.n) >= 3
                 and (position(q.n in p.nombre_normalizado) > 0
                      or position(q.n in coalesce(normalizar_proveedor_base(p.nombre_comercial), '')) > 0
                      or exists (select 1 from proveedores_alias a
                                  where a.proveedor_id = p.id and position(q.n in a.alias_normalizado) > 0))
                then 2 end as pri,
           greatest(
             extensions.word_similarity(q.n, coalesce(p.nombre_normalizado, '')),
             extensions.word_similarity(q.n, coalesce(normalizar_proveedor_base(p.nombre_comercial), '')),
             coalesce((select max(extensions.word_similarity(q.n, a.alias_normalizado))
                         from proveedores_alias a
                        where a.proveedor_id = p.id and a.alias_normalizado is not null), 0)) as s,
           errata_proveedor_agente(q.n, p.nombre_normalizado)
             or errata_proveedor_agente(q.n, normalizar_proveedor_base(p.nombre_comercial))
             or exists (select 1 from proveedores_alias a
                         where a.proveedor_id = p.id and errata_proveedor_agente(q.n, a.alias_normalizado)) as errata
      from proveedores p
     cross join q
     where q.n is not null
  ),
  o as (
    select c.*,
           row_number() over (order by c.pri nulls last, case when c.pri is null then c.s end desc nulls last,
                                       c.docs desc, c.nombre) as rn
      from c
     where c.pri is not null or (length((select q.n from q)) >= 4 and c.s >= 0.45 and c.docs > 0)
  )
  select o.id, o.nombre,
         case o.pri when 1 then 'exacto' when 2 then 'contiene' else 'parecido' end,
         o.s::real,
         o.rn = 1 and (o.pri is not null
                       or (o.errata and o.s >= 0.5
                           and o.s - coalesce((select max(x.s) from o x where x.rn = 2), 0) >= 0.08))
    from o
   where o.rn <= 5
   order by o.rn
$function$;

CREATE OR REPLACE FUNCTION public.una_letra_agente(a text, b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when a is null or b is null then false
    when a = b then true
    when abs(length(a) - length(b)) > 1 then false
    when length(a) = length(b) then exists (
      select 1 from generate_series(1, length(a)) i
       where left(a, i - 1) || substr(a, i + 1) = left(b, i - 1) || substr(b, i + 1))
    when length(a) > length(b) then exists (
      select 1 from generate_series(1, length(a)) i where left(a, i - 1) || substr(a, i + 1) = b)
    else exists (
      select 1 from generate_series(1, length(b)) i where left(b, i - 1) || substr(b, i + 1) = a)
  end
$function$;

CREATE OR REPLACE FUNCTION public.albaranes_facturados_agente()
 RETURNS TABLE(albaran_id bigint, factura_id bigint, motivo text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 20261010170000_chatbot_ronda9: UNA sola regla de «albarán ya facturado» para todas las RPC del
  -- chatbot. Un albarán cuenta como facturado SOLO si
  --   (a) facturas.facturado_en_id lo dice (vínculo automático o manual), o
  --   (b) una factura del MISMO proveedor cita su número en el albaran_ref de
  --       alguna línea (números normalizados: sin «V/», puntos ni ceros),
  -- y nunca si el albarán es de fecha POSTERIOR a esa factura, ni por
  -- coincidencia de producto, cantidad o precio. Un albarán desvinculado a mano
  -- (facturado_origen = 'manual' sin factura) no cuenta como facturado.
  select distinct on (x.albaran_id) x.albaran_id, x.factura_id, x.motivo
    from (
      select a.id as albaran_id, fx.id as factura_id, 'vinculo'::text as motivo, 1 as pri
        from facturas a
        join facturas fx on fx.id = a.facturado_en_id and fx.tipo = 'factura'
       where a.tipo = 'albaran'
         and (a.facturado_origen = 'manual' or a.fecha is null or fx.fecha is null or a.fecha <= fx.fecha)
      union all
      select a.id, fx.id, 'cita'::text, 2
        from facturas a
        join facturas fx on fx.tipo = 'factura' and fx.proveedor_id = a.proveedor_id
       where a.tipo = 'albaran'
         and a.proveedor_id is not null
         and a.facturado_origen is distinct from 'manual'
         and (a.fecha is null or fx.fecha is null or a.fecha <= fx.fecha)
         and numero_documento_normalizado(a.numero_documento) is not null
         and exists (select 1 from productos_factura l
                      where l.factura_id = fx.id
                        and numero_documento_normalizado(l.albaran_ref) = numero_documento_normalizado(a.numero_documento))
    ) x
   order by x.albaran_id, x.pri, x.factura_id
$function$;

drop function if exists public.parcial_producto_agente(text, text);
drop function if exists public.consulta_producto_agente(text);
drop function if exists public.palabras_proveedor_agente(text);

drop index if exists public.productos_factura_albaran_ref_norm_idx;
drop index if exists public.productos_catalogo_raices_nombre_gin;
drop index if exists public.productos_catalogo_palabras_nombre_gin;
drop index if exists public.productos_alias_raices_texto_gin;
drop index if exists public.productos_factura_palabras_nombre_gin;

insert into public.terminos_agente (termino, categoria_clave, nivel, formato, origen)
select 'copas', 'bebidas.licores', 'familia', null, 'semilla'
 where not exists (select 1 from public.terminos_agente where termino = 'copas');

do $$ begin raise notice 'chat_facturas_busqueda_por_partes: rollback aplicado'; end $$;
