set client_encoding = 'UTF8';
-- ============================================================================
-- 20261217100000_chat_facturas_busqueda_por_partes · Facturas (23/11/2026)
-- El copiloto de Facturas contestaba «no hay compras» de productos y proveedores que sí están. Conversaciones reales de
-- producción (19-23/11/2026) y un banco de 5.500 consultas generadas de los productos y proveedores reales:
--   · «Precio leon beyer» → nada (la línea es «L.Beyer Gewurztraminer 2021»): la búsqueda exigía TODAS las palabras en la
--     misma línea, así que una inicial, una palabra de más o una palabra de familia la dejaban en cero.
--     «vino aalto», «botella X», «X 2021» (añada que no está en el nombre): 46 %, 0 % y 8 % de acierto.
--   · «PRECIO L.P.ROSE» → nada: las siglas con puntos se partían en letras sueltas («l» = litro) y no casaban con «LP ROSE».
--   · «ACEITE PALO PRECIO» → sugería «pan aceite»: la palabra que distingue (palo) no contaba más que la genérica.
--   · «gasto de suministros altamira» → se buscó como PRODUCTO y dio «no encuentro»: es un proveedor.
--   · Proveedores: solo valía el nombre seguido («suministros altamira» no está dentro de «suministros hosteleros altamira»)
--     y dos letras bailadas no eran una errata («fenrando»). Acierto claro del 82 %; con nombre a medias, 52 %; con errata, 41 %.
--   · «copas» era la familia Licores: «gasto en copas» (cristalería) daba 35.428 € de licores.
--   · Erratas de teclado en productos («labraodr», «petlaos»): 72 %.
-- Qué cambia:
--   1. proveedor_buscar_agente: método «palabras» (todas las palabras pedidas están en el nombre, enteras o empezadas, en
--      cualquier orden y aunque falten las de en medio) y errata con dos letras bailadas. La usan ficha_proveedor,
--      filtrar_documentos, albaranes_sin_factura y el filtro de proveedor de compras_producto.
--   2. consulta_producto_agente: une las siglas con puntos de la pregunta.
--   3. parcial_producto_agente (nueva): búsqueda por partes cuando ninguna línea lleva todas las palabras.
--   4. lineas_producto_base_agente: siglas, erratas de teclado y candidatas por índice (antes recorría las ~30.000 líneas
--      evaluando una expresión regular en cada una). lineas_producto_agente: la búsqueda por partes (no la base, que
--      también usa la comparación de presupuestos).
--   5. compras_producto_agente: `es_proveedor` (lo pedido es un proveedor), `por_partes` (qué palabras no casan),
--      `tambien_proveedor` y sugerencias por la palabra que distingue. ficha_proveedor_agente: `es_producto`.
--   6. albaranes_facturados_agente por índice (misma regla, mismo resultado; la llaman 13 RPC en cada pregunta).
--   7. Índices GIN de raíces y palabras en el catálogo, los alias y las líneas.
--   8. terminos_agente: «copas» deja de ser la familia Licores (se busca por nombre: las copas de cristal).
-- Las funciones enteras parten de la definición VIVA (idéntica en demo y producción el 23/11/2026); compras_producto_agente
-- y ficha_proveedor_agente se parchean con sustituciones de texto (aborta sin cambiar nada si no es la esperada).
-- Requiere 20261212530000. Sin begin/commit propios. Rollback: supabase/rollbacks/20261217100000_chat_facturas_busqueda_por_partes_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $pre$
begin
  if to_regprocedure('public.variante_valida_agente(text, text, bigint, bigint[])') is null
     or to_regprocedure('public.lineas_abreviadas_agente(text[], bigint[])') is null then
    raise exception '20261217100000: faltan 20261209200000 / 20261212530000. No se ha cambiado nada.';
  end if;
end
$pre$;

-- ─── 1. Proveedores ─────────────────────────────────────────────────────────
-- una_letra_agente: además de una letra cambiada, de más o de menos, dos letras seguidas bailadas
-- («fenrando» = fernando, «discalrux» = discarlux): la errata más corriente al teclear.
create or replace function public.una_letra_agente(a text, b text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when a is null or b is null then false
    when a = b then true
    when abs(length(a) - length(b)) > 1 then false
    when length(a) = length(b) then exists (
      select 1 from generate_series(1, length(a)) i
       where left(a, i - 1) || substr(a, i + 1) = left(b, i - 1) || substr(b, i + 1)
          or (i < length(a)
              and left(a, i - 1) || substr(a, i + 1, 1) || substr(a, i, 1) || substr(a, i + 2) = b))
    when length(a) > length(b) then exists (
      select 1 from generate_series(1, length(a)) i where left(a, i - 1) || substr(a, i + 1) = b)
    else exists (
      select 1 from generate_series(1, length(b)) i where left(b, i - 1) || substr(b, i + 1) = a)
  end
$$;

-- Palabras con las que se busca un proveedor: sin artículos, formas societarias ni «proveedor».
create or replace function public.palabras_proveedor_agente(p_texto text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct w), '{}'::text[])
    from regexp_split_to_table(coalesce(public.normalizar_proveedor_base(coalesce(p_texto, '')), ''), '[^a-z0-9]+') w
   where length(w) >= 2
     and w <> all (array['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'en', 'al', 'a', 'con', 'sl', 'slu', 'sa', 'sau', 'sll',
                         'srl', 'cb', 'sc', 'scp', 'coop', 'proveedor', 'proveedores', 'empresa', 'distribuidor'])
$$;
revoke all on function public.palabras_proveedor_agente(text) from public, anon;
grant execute on function public.palabras_proveedor_agente(text) to authenticated, service_role;

create or replace function public.proveedor_buscar_agente(p_texto text)
returns table(id bigint, nombre text, metodo text, parecido real, claro boolean)
language sql
stable
set search_path = public
as $$
  -- metodo: exacto (nombre, nombre comercial o alias), contiene (el texto seguido), palabras
  -- (todas las palabras buscadas están en el nombre, enteras o empezadas, en cualquier orden y
  -- aunque falten las de en medio: «suministros altamira» = Suministros Hosteleros Altamira),
  -- parecido (errata).
  -- claro: el primero y sin otro casi igual de parecido → se puede usar sin preguntar.
  -- 20261209200000: por parecido solo es claro si es una errata (errata_proveedor_agente);
  -- si no, sale en la lista para preguntar y NUNCA se dan cifras suyas.
  -- 20261217100000: método «palabras» (claro solo si es el único que las lleva así de enteras o
  -- tiene muchos más documentos que el siguiente) y una errata clara ya no necesita, además,
  -- parecerse tanto en trigramas (con dos letras bailadas el parecido cae por debajo del umbral).
  with q as (
    select nullif(normalizar_proveedor_base(coalesce(p_texto, '')), '') as n,
           palabras_proveedor_agente(p_texto) as ws
  ),
  -- una expresión regular por palabra buscada: entera, o empezada si tiene 4 letras o más
  qr as (
    select coalesce(array_agg('(^|[^a-z0-9])' || w || case when length(w) >= 4 then '' else '([^a-z0-9]|$)' end), '{}'::text[]) as rx,
           coalesce(array_agg('(^|[^a-z0-9])' || w || '([^a-z0-9]|$)'), '{}'::text[]) as rx_entera,
           coalesce(bool_or(length(w) >= 4), false) as alguna_larga
      from q, unnest(q.ws) w
  ),
  al as (
    select a.proveedor_id, string_agg(a.alias_normalizado, ' | ') as txt
      from proveedores_alias a
     where a.alias_normalizado is not null
     group by a.proveedor_id
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
                then 2
                when qr.alguna_larga
                 and not exists (
                       select 1 from unnest(qr.rx) r
                        where (coalesce(p.nombre_normalizado, '') || ' | '
                               || coalesce(normalizar_proveedor_base(p.nombre_comercial), '') || ' | '
                               || coalesce(al.txt, '')) !~ r)
                then 3 end as pri,
           -- cuántas de las palabras buscadas están ENTERAS (no solo empezadas): «henarejo» antes que «henarejos»
           (select count(*) from unnest(qr.rx_entera) r
             where (coalesce(p.nombre_normalizado, '') || ' | '
                    || coalesce(normalizar_proveedor_base(p.nombre_comercial), '') || ' | '
                    || coalesce(al.txt, '')) ~ r) as enteras,
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
     cross join qr
      left join al on al.proveedor_id = p.id
     where q.n is not null
  ),
  o as (
    select c.*,
           row_number() over (order by c.pri nulls last,
                                       case when c.pri = 3 then c.enteras end desc nulls last,
                                       case when c.pri is null then c.errata end desc nulls last,
                                       case when c.pri is null then c.s end desc nulls last,
                                       c.docs desc, c.nombre) as rn
      from c
     where c.pri is not null
        -- la errata (cara de calcular) solo se mira en los que algo se parecen
        or (length((select q.n from q)) >= 4 and c.docs > 0
            and case when c.s >= 0.45 then true when c.s >= 0.2 then c.errata else false end)
  )
  select o.id, o.nombre,
         case o.pri when 1 then 'exacto' when 2 then 'contiene' when 3 then 'palabras' else 'parecido' end,
         o.s::real,
         o.rn = 1 and (coalesce(o.pri, 0) in (1, 2)
                       -- palabras: el único que las lleva así de enteras, o con muchos más documentos que el siguiente
                       or (coalesce(o.pri, 0) = 3
                           and ((select count(*) from o x where x.pri = 3 and x.enteras >= o.enteras) = 1
                                or o.docs >= 4 * coalesce((select max(x.docs) from o x where x.pri = 3 and x.rn > 1), 0)
                                   and o.docs >= 5))
                       -- errata: la única candidata, o claramente la más parecida de las candidatas con errata
                       or (o.pri is null and o.errata
                           and ((o.s >= 0.25 and (select count(*) from o x where x.pri is null and x.errata) = 1)
                                or (o.s >= 0.5
                                    and o.s - coalesce((select max(x.s) from o x where x.rn > 1 and x.errata), 0) >= 0.15))))
    from o
   where o.rn <= 5
   order by o.rn
$$;

-- ─── 2. Productos ───────────────────────────────────────────────────────────
-- Siglas con puntos en lo que se pregunta: «L.P.ROSE» → «lp rose», «j.b.» → «jb». Las letras sueltas
-- con punto se unen; una inicial seguida de una palabra («S.CANTABRIA») se deja como está.
create or replace function public.consulta_producto_agente(p_texto text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := lower(public.unaccent(coalesce(p_texto, '')));
  i int;
begin
  if t !~ '[a-z]\.\s?[a-z]' then return t; end if;
  -- «l.p» seguidas, o «l. p.» con espacio si la segunda también lleva punto («0,75 l. pack» no se une)
  t := regexp_replace(t, '(^|[^a-z0-9§])([a-z])\.(?:([a-z])(?![a-z0-9])|\s([a-z])(?=\.))', '\1\2§\3\4', 'g');
  for i in 1..4 loop
    exit when t !~ '§[a-z]\.(?:[a-z](?![a-z0-9])|\s[a-z]\.)';
    t := regexp_replace(t, '§([a-z])\.(?:([a-z])(?![a-z0-9])|\s([a-z])(?=\.))', '§\1§\2\3', 'g');
  end loop;
  return replace(t, '§', '');
end;
$$;
revoke all on function public.consulta_producto_agente(text) from public, anon;
grant execute on function public.consulta_producto_agente(text) to authenticated, service_role;

-- Búsqueda por partes: cuando ninguna línea lleva TODAS las palabras pedidas (lineas_producto_base_agente,
-- pasos 1 a 3), se mira qué palabras son las que distinguen el producto y cuáles sobran o van de otra manera.
--   Devuelve jsonb:
--     ids          líneas que se pueden dar como el producto pedido (o null)
--     nivel        'union' | 'categoria' | 'unico' (por qué se dan)
--     sin_casar    palabras pedidas que no están en esas líneas (para avisar)
--     es_proveedor nombre del proveedor, si lo pedido es un proveedor y no un producto
--     sugerencias  productos que casan con las palabras más distintivas, para preguntar (nunca se suman)
--     sugerencias_detalle  lo mismo con el proveedor que lo trae y la fecha de su última línea
--   Reglas (cada palabra casa también por raíz, diminutivo o una errata de una letra):
--     union      todas las palabras están, repartidas entre la línea, su producto del catálogo, sus alias, el nombre
--                del proveedor que la factura («aceite palo» = «HACIENDA EL PALO PREMIUM» de Aceites Hacienda El Palo)
--                o una inicial con punto («leon beyer» = «L.Beyer Gewurztraminer»).
--     categoria  la palabra que falta es el nombre de una familia («vino aalto», «cerveza alhambra») y la línea es
--                de esa familia.
--     unico      la palabra que falta no existe en ningún producto y las demás (dos o más) señalan un único producto
--                del catálogo («petalos negros superior»).
--   La añada pedida («2021») filtra si alguna línea la lleva; si no, se da el producto y se avisa (sin_casar).
--   Guarda el último resultado en una variable de la transacción (chat_facturas.parcial_*): no escribe en ninguna tabla.
create or replace function public.parcial_producto_agente(p_texto text, p_excluir text default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas', 'precio', 'precios'];
  c_max_df   constant int := 40;   -- una palabra que está en más productos no sirve para sugerir
  v_pal   text[];
  v_excl  text[];
  v_voc   text[];
  v_prov  text;
  v_res   jsonb;
  -- Misma pregunta dos veces en la misma consulta (lineas_producto_agente y luego compras_producto_agente): el
  -- resultado se guarda en una variable de la transacción y no se calcula otra vez.
  v_clave text := md5(coalesce(p_texto, '') || '|' || coalesce(p_excluir, ''));
begin
  if current_setting('chat_facturas.parcial_clave', true) = v_clave then
    return nullif(current_setting('chat_facturas.parcial_valor', true), '')::jsonb;
  end if;
  perform set_config('chat_facturas.parcial_clave', v_clave, true);
  perform set_config('chat_facturas.parcial_valor', '', true);
  v_pal := array(select w from unnest(palabras_producto_agente(consulta_producto_agente(p_texto))) with ordinality t(w, n)
                  where not (w = any(c_relleno)) order by n);
  if cardinality(v_pal) = 0 or cardinality(v_pal) > 8 then return null; end if;
  v_excl := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(p_excluir)) w
                   where not (w = any(c_vacias)));

  -- ¿Es un proveedor? Todas las palabras están en el nombre de UN proveedor y ninguna es el nombre de
  -- un producto o de una familia («suministros altamira» sí; «aceite palo» no: aceite es un producto).
  if not exists (select 1 from unnest(v_pal) w
                  where exists (select 1 from terminos_agente tt where tt.raices = array[raiz_producto_agente(w)])) then
    select c.nombre into v_prov from proveedor_buscar_agente(array_to_string(v_pal, ' ')) c
     where c.claro
       -- con errata («suminsitros altamira») solo si son dos palabras o más: una sola puede ser un producto mal escrito
       and (c.metodo in ('exacto', 'contiene', 'palabras') or cardinality(v_pal) >= 2)
     limit 1;
    if v_prov is not null then
      v_res := jsonb_build_object('es_proveedor', v_prov);
      perform set_config('chat_facturas.parcial_valor', v_res::text, true);
      return v_res;
    end if;
  end if;

  v_voc := array(select unnest(pf.palabras_nombre) from productos_factura pf
                 union
                 select unnest(pc.palabras_nombre) from productos_catalogo pc);

  with q as materialized (
    select t.n::int as n, t.w, raiz_producto_agente(t.w) as rq,
           t.w ~ '^(19[5-9]|20[0-4])[0-9]$' as anyo
      from unnest(v_pal) with ordinality t(w, n)
  ),
  -- palabras del vocabulario que valen por cada palabra pedida: 1 = la misma (raíz, plural, diminutivo),
  -- 2 = con una errata de una letra, 3 = la contiene («grasa» en «desengrasante»; de una palabra que no existe,
  -- también su principio o su final: «quitagrasa»). Las de tipo 2 solo si no hay de tipo 1; las de tipo 3 solo
  -- sirven para sugerir.
  m0 as materialized (
    select q.n, v.w,
           case when v.w = q.w
                  or (not q.anyo and (
                       (v.w like q.rq || '%' and length(v.w) <= length(q.rq) + 2 and raiz_producto_agente(v.w) = q.rq)
                       or (length(q.w) >= 4 and v.w ~ ('^' || q.rq || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))))
                then 1
                when not q.anyo and length(q.w) >= 5 and length(v.w) >= 5 and left(v.w, 1) = left(q.w, 1)
                 and abs(length(v.w) - length(q.w)) <= 1
                 and una_letra_agente(regexp_replace(q.w, 's$', ''), regexp_replace(v.w, 's$', ''))
                then 2
                when not q.anyo and length(q.w) >= 5 and length(v.w) >= length(q.w) + 2
                 and position(q.w in v.w) > 0
                then 3
           end as tipo
      from q
      join unnest(v_voc) v(w)
        on v.w = q.w
        or (not q.anyo and left(v.w, 1) = left(q.w, 1) and length(q.w) >= 3)
        or (not q.anyo and length(q.w) >= 5 and position(q.w in v.w) > 0)
  ),
  m1 as materialized (
    select n, w, tipo from m0 where tipo is not null
    union all
    -- palabra compuesta que no existe («quitagrasa»): si acaba en una palabra del vocabulario
    -- de 5 letras o más («grasa»), las palabras que la llevan («grasa», «antigrasa», «desengrasante»)
    select q.n, v.w, 3
      from q
      join lateral (select distinct x.w as trozo
                      from generate_series(5, length(q.w) - 2) k
                      join unnest(v_voc) x(w) on x.w = right(q.w, k)) t on true
      join unnest(v_voc) v(w) on position(t.trozo in v.w) > 0
     where not q.anyo and length(q.w) >= 7
       and not exists (select 1 from m0 where m0.n = q.n and m0.tipo is not null)
  ),
  m as materialized (
    select m1.n, case when m1.tipo = 3 then 3 else 1 end as fuerza,
           array_agg(distinct raiz_producto_agente(m1.w)) as rs
      from m1
     where m1.tipo = 3
        or m1.tipo = (select min(x.tipo) from m1 x where x.n = m1.n and x.tipo < 3)
     group by 1, 2
  ),
  -- palabra que es el nombre de una familia o de un producto genérico: sus categorías (con las hijas)
  g as materialized (
    select q.n, array_agg(distinct c.id) as cats
      from q
      join categorias_producto c
        on c.activa
       and (exists (select 1 from terminos_agente tt
                     where tt.raices = array[q.rq] and tt.formato is null
                       and (c.clave = tt.categoria_clave or c.clave like tt.categoria_clave || '.%'))
            or (length(q.w) >= 4 and q.rq = any(raices_producto_agente(c.nombre)))
            or exists (select 1 from categorias_producto p
                        where p.id = c.padre_id and length(q.w) >= 4 and q.rq = any(raices_producto_agente(p.nombre))))
     where not q.anyo
     group by q.n
  ),
  -- dónde está cada palabra: 1 = en la línea, su producto o un alias; 2 = en el nombre del proveedor;
  -- 3 = solo dentro de otra palabra (para sugerir)
  h as materialized (
    select pf.id, m.n, m.fuerza as src
      from m join productos_factura pf on pf.raices_nombre && m.rs
    union
    select pf.id, m.n, m.fuerza
      from m join productos_catalogo pc on pc.raices_nombre && m.rs
      join productos_factura pf on pf.producto_id = pc.id
    union
    select pf.id, m.n, 1
      from m join productos_alias al on al.raices_texto && m.rs
      join productos_factura pf on pf.producto_id = al.producto_id
     where m.fuerza = 1
    union
    select pf.id, q.n, 2
      from q
      join proveedores pv
        on exists (select 1 from regexp_split_to_table(coalesce(pv.nombre_normalizado, ''), '[^a-z0-9]+') t
                    where length(t) >= 4 and raiz_producto_agente(t) = q.rq)
      join facturas f on f.proveedor_id = pv.id
      join productos_factura pf on pf.factura_id = f.id
     where not q.anyo and length(q.w) >= 4
  ),
  -- en cuántos productos está cada palabra (lo distintiva que es)
  df as materialized (
    select h.n, count(distinct coalesce(pf.producto_id, -pf.id)) as n_prod
      from h join productos_factura pf on pf.id = h.id
     where h.src = 1
     group by h.n
  ),
  qq as materialized (
    select q.*, g.cats, coalesce(df.n_prod, 0) as n_prod,
           g.cats is not null as generica,
           coalesce(df.n_prod, 0) = 0 as desconocida
      from q left join g on g.n = q.n left join df on df.n = q.n
  ),
  -- líneas candidatas: alguna palabra no genérica en su texto
  l0 as materialized (
    select h.id,
           coalesce(array_agg(distinct h.n) filter (where h.src = 1), '{}'::int[]) as propias,
           coalesce(array_agg(distinct h.n) filter (where h.src in (1, 2)), '{}'::int[]) as todas,
           coalesce(array_agg(distinct h.n) filter (where h.src = 3), '{}'::int[]) as debiles
      from h
     group by h.id
    having bool_or(h.src in (1, 3))
  ),
  l as materialized (
    select l0.id, l0.propias, l0.todas, l0.debiles, pf.producto_id, pc.categoria_id,
           coalesce(pc.nombre, pf.nombre::text) as etiqueta, pf.nombre::text as nombre,
           normalizar_texto(pf.nombre::text) || ' | ' || coalesce(normalizar_texto(pc.nombre), '') as txt,
           pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[]) as pals
      from l0
      join productos_factura pf on pf.id = l0.id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
       and not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
       and exists (select 1 from qq where (qq.n = any(l0.propias) or qq.n = any(l0.debiles)) and not qq.anyo and not qq.generica)
  ),
  -- por línea: qué palabras quedan sin casar con cada regla
  e as materialized (
    select l.*,
           -- inicial con punto delante de otra palabra pedida que sí está: «l.beyer», «b.magno», «s.pellegrino»
           array(select u.n from qq u
                  where not u.anyo and not (u.n = any(l.todas)) and length(u.w) >= 3 and u.w ~ '^[a-z]+$'
                    and exists (select 1 from qq a
                                 where a.n <> u.n and a.n = any(l.propias)
                                   and l.txt ~ ('(^|[^a-z0-9])' || left(u.w, 1) || '\.\s?' || left(a.rq, 4)))) as iniciales
      from l
  ),
  r as materialized (
    select e.id, e.producto_id, e.etiqueta, e.nombre, e.propias, e.pals,
           exists (select 1 from qq where qq.n = any(e.propias) and not qq.anyo and not qq.generica) as fuerte,
           -- si se pidió una familia («champagne alexander»), lo sugerido tiene que ser de esa familia
           not exists (select 1 from qq where qq.generica and not (qq.n = any(e.propias))
                        and not coalesce(e.categoria_id = any(qq.cats), false)) as en_familia,
           -- 1. union: todo casa (línea, catálogo, alias, proveedor o inicial)
           not exists (select 1 from qq where not qq.anyo
                        and not (qq.n = any(e.todas)) and not (qq.n = any(e.iniciales))) as t_union,
           -- 2. categoria: lo que falta son nombres de familia y la línea es de esa familia
           not exists (select 1 from qq where not qq.anyo
                        and not (qq.n = any(e.propias)) and not (qq.n = any(e.iniciales))
                        and not (qq.generica and e.categoria_id = any(qq.cats))) as t_cat,
           -- 3. unico: lo que falta no existe en ningún producto
           not exists (select 1 from qq where not qq.anyo
                        and not (qq.n = any(e.propias)) and not (qq.n = any(e.iniciales))
                        and not (qq.generica and e.categoria_id = any(qq.cats))
                        and not qq.desconocida) as t_unico,
           -- para sugerir: la palabra tal cual (o en plural) puntúa entera; dentro de otra palabra, algo menos;
           -- por raíz o errata («pago» ~ «paga») no puntúa
           (select coalesce(sum(ln(1 + 2000.0 / greatest(qq.n_prod, 1))
                                * case when qq.n = any(e.propias) then 1 else 0.7 end), 0) from qq
             where not qq.anyo and not qq.generica
               and ((qq.n = any(e.propias)
                     and (qq.w = any(e.pals) or qq.w || 's' = any(e.pals) or qq.w || 'es' = any(e.pals)
                          or regexp_replace(qq.w, 'e?s$', '') = any(e.pals)))
                    or (qq.n = any(e.debiles) and not (qq.n = any(e.propias))))) as puntos,
           (select min(qq.n_prod) from qq where qq.n = any(e.propias) and not qq.anyo and not qq.generica) as min_df
      from e
  ),
  nivel as materialized (
    select case when exists (select 1 from r where fuerte and t_union) then 'union'
                when exists (select 1 from r where fuerte and t_cat) then 'categoria'
                when (select count(distinct coalesce(r.producto_id, -r.id)) from r where fuerte and t_unico) = 1
                 and (select min(r.min_df) from r where fuerte and t_unico) <= 3
                 -- con una sola palabra que casa no basta: «sierra cantabria» no es la «sierra de carnicero»
                 and (select count(*) from qq where not qq.anyo and not qq.generica and not qq.desconocida) >= 2 then 'unico'
           end as nv
  ),
  ok0 as materialized (
    select r.* from r, nivel
     where r.fuerte and ((nivel.nv = 'union' and r.t_union) or (nivel.nv = 'categoria' and r.t_cat) or (nivel.nv = 'unico' and r.t_unico))
  ),
  -- la añada pedida filtra si alguna de esas líneas la lleva
  anyos as materialized (
    select qq.w, exists (select 1 from ok0 where qq.w = any(ok0.pals)
                                             or right(qq.w, 2) = any(ok0.pals)) as esta
      from qq where qq.anyo
  ),
  ok as materialized (
    select ok0.* from ok0
     where not exists (select 1 from anyos a where a.esta and not (a.w = any(ok0.pals) or right(a.w, 2) = any(ok0.pals)))
  ),
  sug as (
    select s.etiqueta, s.nombre, s.puntos, s.lineas, s.id_ult
      from (select r.etiqueta,
                   (array_agg(r.nombre order by r.id desc))[1] as nombre, max(r.id) as id_ult,
                   max(r.puntos) as puntos, count(*) as lineas, min(r.min_df) as min_df
              from r
             where r.en_familia
             group by r.etiqueta) s
     where coalesce(s.min_df, 0) <= c_max_df and s.puntos > 0
       -- solo lo que casa casi tan bien como lo mejor: con «hormiga magnum» no se sugiere cualquier magnum
       and s.puntos >= 0.6 * (select max(r.puntos) from r where r.en_familia)
     order by s.puntos * (1 + ln(s.lineas) / 5) desc, s.lineas desc, s.etiqueta
     limit 6
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'ids',   (select to_jsonb(array_agg(ok.id order by ok.id)) from ok),
           'nivel', (select nivel.nv from nivel where exists (select 1 from ok)),
           'sin_casar', (select to_jsonb(array_agg(qq.w order by qq.n)) from qq
                          where exists (select 1 from ok)
                            and case when qq.anyo then not (select a.esta from anyos a where a.w = qq.w)
                                     else not exists (select 1 from ok where qq.n = any(ok.propias))
                                          and not qq.generica
                                          and (select nivel.nv from nivel) = 'unico' end),
           'sugerencias', (select jsonb_agg(sug.nombre order by sug.puntos * (1 + ln(sug.lineas) / 5) desc, sug.lineas desc, sug.etiqueta) from sug),
           -- quién trae cada sugerencia y cuándo fue la última vez («¿qué proveedor me trae el quitagrasa?»)
           'sugerencias_detalle', (
             select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                      'nombre', sug.nombre, 'producto', nullif(sug.etiqueta, sug.nombre),
                      'proveedor', coalesce(pv.nombre, f.proveedor)::text, 'ultima', f.fecha))
                    order by sug.puntos * (1 + ln(sug.lineas) / 5) desc, sug.lineas desc, sug.etiqueta)
               from sug
               join productos_factura pf on pf.id = sug.id_ult
               join facturas f on f.id = pf.factura_id
               left join proveedores pv on pv.id = f.proveedor_id)))
    into v_res;
  perform set_config('chat_facturas.parcial_valor', coalesce(v_res::text, ''), true);
  return v_res;
end;
$$;
revoke all on function public.parcial_producto_agente(text, text) from public, anon;
grant execute on function public.parcial_producto_agente(text, text) to authenticated, service_role;

-- ─── 7. Índices ─────────────────────────────────────────────────────────────
-- Las líneas ya tenían el de raíces (productos_factura_raices_nombre_gin); el catálogo y los alias se recorrían enteros
-- en cada búsqueda, y las siglas («lp») buscaban por palabras sin índice.
create index if not exists productos_catalogo_raices_nombre_gin on public.productos_catalogo using gin (raices_nombre);
create index if not exists productos_catalogo_palabras_nombre_gin on public.productos_catalogo using gin (palabras_nombre);
create index if not exists productos_alias_raices_texto_gin on public.productos_alias using gin (raices_texto);
create index if not exists productos_factura_palabras_nombre_gin on public.productos_factura using gin (palabras_nombre);

-- ─── 3. lineas_producto_base_agente: siglas con puntos y erratas de teclado ───
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
-- 20261217100000_chat_facturas_busqueda_por_partes: (1) las siglas con puntos de la pregunta se unen («L.P.ROSE» = «lp rose»);
--   (3) una errata es también una letra de más, de menos o dos letras bailadas («labraodr», «petlaos»), no solo el parecido por
--   trigramas. La búsqueda por partes va en lineas_producto_agente (la comparación de presupuestos usa esta y no debe casar por partes).
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
  v_todas text[] := palabras_producto_agente(consulta_producto_agente(p_texto));
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
               -- una letra de más, de menos o dos seguidas bailadas (misma inicial): «labraodr», «petlaos», «burelte»
               or (length(q.qw) >= 5 and length(v.w) >= 5 and left(v.w, 1) = left(q.qw, 1)
                   and abs(length(v.w) - length(q.qw)) <= 1
                   and una_letra_agente(regexp_replace(q.qw, 's$', ''), regexp_replace(v.w, 's$', '')))
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

  -- 20261217100000: con las siglas unidas no hay nada y la línea las escribe con puntos («W. J.B 0.70», «BITTER KAS
  -- N.R.»): se repite con las letras sueltas, como antes (sin puntos no se vuelve a unir nada).
  if v_ids is null and v_subs is null and position('.' in p_texto) > 0
     and v_todas is distinct from palabras_producto_agente(p_texto) then
    return query select * from lineas_producto_base_agente(replace(p_texto, '.', ' '), p_excluir);
    return;
  end if;

  return query select v_ids, v_met, v_subs, v_pal;
end;
$function$;

-- ─── 4. lineas_producto_agente: búsqueda por partes cuando nada lleva todas las palabras ───
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
  v_par  jsonb;
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
  -- 20261217100000: ninguna línea lleva TODAS las palabras → búsqueda por partes (parcial_producto_agente):
  -- «leon beyer» = «L.Beyer», «vino aalto» = Aalto (familia), «aceite palo» = Hacienda El Palo (la palabra
  -- está en el proveedor). Método 'aproximada': quien la usa avisa de que no es el nombre exacto.
  if b.ids is null and b.subproductos is null then
    v_par := parcial_producto_agente(p_texto, p_excluir);
    if v_par ? 'ids' then
      return query select array(select x::bigint from jsonb_array_elements_text(v_par->'ids') x order by 1),
                          'aproximada'::text, null::text[], b.palabras;
      return;
    end if;
  end if;
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

-- ─── 5. compras_producto_agente y ficha_proveedor_agente (parches sobre la definición viva) ───
do $mig$
declare
  v_def text;
begin
  -- ─── compras_producto_agente ───
  v_def := replace(pg_get_functiondef('public.compras_producto_agente'::regproc), E'\r', '');
  if position($m$v_par   jsonb;$m$ in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, $a0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$a0$, ''))) <> length($a0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$a0$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 1 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);$a1$, ''))) <> length($a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);$a1$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 2 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a2$    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$a2$, ''))) <> length($a2$    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$a2$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 3 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a3$      'sugerencias',  v_sug,$a3$, ''))) <> length($a3$      'sugerencias',  v_sug,$a3$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 4 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a4$             where extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$a4$, ''))) <> length($a4$             where extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$a4$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 5 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a5$      'nota',         case when v_sug is not null then$a5$, ''))) <> length($a5$      'nota',         case when v_sug is not null then$a5$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 6 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    if (length(v_def) - length(replace(v_def, $a6$      'variante_cercana', v_var,$a6$, ''))) <> length($a6$      'variante_cercana', v_var,$a6$) then
      raise exception '20261217100000: compras_producto_agente: el texto a cambiar n.º 7 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    v_def := replace(v_def, $a0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$a0$, $b0$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido
  v_par   jsonb;      -- 20261217100000: busqueda por partes (parcial_producto_agente)
  v_tprov text;       -- 20261217100000: lo pedido es tambien el nombre de un proveedor$b0$);
    v_def := replace(v_def, $a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);$a1$, $b1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);
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
  end if;$b1$);
    v_def := replace(v_def, $a2$    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$a2$, $b2$    -- 20261217100000: lo pedido no es un producto sino un proveedor («suministros altamira»).
    if v_par ? 'es_proveedor' then
      return jsonb_build_object(
        'buscado',      p_texto,
        'coincidencia', 'proveedor',
        'sin_datos',    true,
        'es_proveedor', v_par->'es_proveedor',
        'nota', '«' || p_texto || '» no es un producto: es el proveedor ' || (v_par->>'es_proveedor')
                || '. Para su gasto, sus productos y sus precios usa ficha_proveedor con ese nombre (sus documentos: filtrar_documentos).')::json;
    end if;
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)$b2$);
    v_def := replace(v_def, $a3$      'sugerencias',  v_sug,$a3$, $b3$      'sugerencias',  (select jsonb_agg(z.x order by z.o)
                         from (select u.x, min(u.o) as o
                                 from (select a.x, a.o from jsonb_array_elements_text(coalesce(v_par->'sugerencias', '[]'::jsonb)) with ordinality a(x, o)
                                       union all
                                       select b.x, 100 + b.o from jsonb_array_elements_text(coalesce(v_sug, '[]'::jsonb)) with ordinality b(x, o)) u
                                group by u.x
                                order by min(u.o)
                                limit 6) z),
      'sugerencias_detalle', v_par->'sugerencias_detalle',$b3$);
    v_def := replace(v_def, $a4$             where extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$a4$, $b4$             where coalesce(jsonb_array_length(v_par->'sugerencias'), 0) < 4
               and extensions.strict_word_similarity(v_frase, n.t) >= c_sim_texto$b4$);
    v_def := replace(v_def, $a5$      'nota',         case when v_sug is not null then$a5$, $b5$      'nota',         case when v_par ? 'sugerencias_detalle' then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados. sugerencias_detalle dice que proveedor trae '
                        || 'cada uno y cuando fue la ultima vez: nombralos con su proveedor y pregunta si es alguno.'
                      when v_sug is not null then$b5$);
    v_def := replace(v_def, $a6$      'variante_cercana', v_var,$a6$, $b6$      'variante_cercana', v_var,
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
                || 'esto NO la contesta: usa ficha_proveedor.') end,$b6$);
    execute v_def;
  end if;
  -- ─── ficha_proveedor_agente ───
  v_def := replace(pg_get_functiondef('public.ficha_proveedor_agente'::regproc), E'\r', '');
  if position($m$'es_producto',$m$ in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, $a0$    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,$a0$, ''))) <> length($a0$    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,$a0$) then
      raise exception '20261217100000: ficha_proveedor_agente: el texto a cambiar n.º 1 no aparece exactamente una vez. No se ha cambiado nada.';
    end if;
    v_def := replace(v_def, $a0$    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,$a0$, $b0$    -- 20261217100000: no es un proveedor pero si un producto («ficha de leon beyer»): se dice, para ir a compras_producto.
    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,
              'es_producto', (select case when h.ids is not null then true end from lineas_producto_agente(p_texto) h),$b0$);
    execute v_def;
  end if;
end
$mig$;

-- ─── 6. albaranes_facturados_agente: misma regla, por índice ────────────────
-- La usan 13 RPC del chat (a veces dos veces por pregunta). La regla (b) —una factura del mismo proveedor cita
-- el número del albarán en alguna línea— se resolvía mirando, por cada pareja albarán × factura del proveedor,
-- las líneas de esa factura. Ahora se llega desde el albarán a las líneas que citan su número por un índice
-- (productos_factura_albaran_ref_norm_idx) y de ahí a su factura: MISMO resultado, ~10 veces menos trabajo.
create index if not exists productos_factura_albaran_ref_norm_idx
  on public.productos_factura (public.numero_documento_normalizado(albaran_ref::text))
  where albaran_ref is not null;

create or replace function public.albaranes_facturados_agente()
returns table(albaran_id bigint, factura_id bigint, motivo text)
language sql
stable
set search_path = public
as $$
  -- 20261010170000_chatbot_ronda9: UNA sola regla de «albarán ya facturado» para todas las RPC del
  -- chatbot. Un albarán cuenta como facturado SOLO si
  --   (a) facturas.facturado_en_id lo dice (vínculo automático o manual), o
  --   (b) una factura del MISMO proveedor cita su número en el albaran_ref de
  --       alguna línea (números normalizados: sin «V/», puntos ni ceros),
  -- y nunca si el albarán es de fecha POSTERIOR a esa factura, ni por
  -- coincidencia de producto, cantidad o precio. Un albarán desvinculado a mano
  -- (facturado_origen = 'manual' sin factura) no cuenta como facturado.
  -- 20261217100000: (b) por el índice del número citado (misma regla y mismo resultado).
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
        join productos_factura l
          on l.albaran_ref is not null
         and numero_documento_normalizado(l.albaran_ref::text) = numero_documento_normalizado(a.numero_documento)
        join facturas fx on fx.id = l.factura_id and fx.tipo = 'factura' and fx.proveedor_id = a.proveedor_id
       where a.tipo = 'albaran'
         and a.proveedor_id is not null
         and a.facturado_origen is distinct from 'manual'
         and (a.fecha is null or fx.fecha is null or a.fecha <= fx.fecha)
         and numero_documento_normalizado(a.numero_documento) is not null
    ) x
   order by x.albaran_id, x.pri, x.factura_id
$$;

-- ─── 8. «copas» no es la familia Licores ────────────────────────────────────
-- En las compras de un restaurante «copas» son las de cristal (hay una docena de productos «COPA …» en Menaje).
delete from public.terminos_agente where termino = 'copas' and origen = 'semilla';

analyze public.productos_factura;
analyze public.productos_catalogo;
analyze public.productos_alias;

do $$ begin raise notice 'chat_facturas_busqueda_por_partes: aplicada'; end $$;
