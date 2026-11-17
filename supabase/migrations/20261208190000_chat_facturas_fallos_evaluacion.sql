set client_encoding = 'UTF8';
-- ============================================================================
-- 20261208190000_chat_facturas_fallos_evaluacion · Copiloto de Facturas
-- ----------------------------------------------------------------------------
-- Arregla los fallos de CÓDIGO que sacó la evaluación de 123 preguntas reales
-- (facturas-conocimiento/evaluacion-chat-facturas-2026-11-16.md, 58 % bien):
--
--  1. Falsos «no hay compras» por abreviaturas, marca que falta o erratas.
--     · lineas_abreviadas_agente (nueva): a lo que encuentra el texto se SUMAN
--       las líneas que abrevian el nombre («S. CANTABRIA 25 PRIMEUR» = Sierra
--       Cantabria, «COL.» = Colección) y las que llevan sus siglas («C/6B LP LA
--       CUVEE» = Laurent Perrier) si son de la misma categoría y proveedor que algo
--       ya encontrado. Antes «Laurent Perrier» daba 28 líneas y se dejaba fuera
--       La Cuvée 75 cl (26.000 €/año); «Sierra Cantabria», la compra de 2026.
--     · proveedor_buscar_agente (nueva): proveedor por nombre, alias, nombre
--       comercial y, si no, por parecido (pg_trgm): «salazones garro» = Salazones
--       Garre, «liga sabor» = Luga Sabores. La usan ficha_proveedor_agente,
--       filtrar_documentos_agente, albaranes_sin_factura_agente y el filtro de
--       proveedor de compras_producto_agente. Si no hay uno claro, se devuelven
--       los parecidos para preguntar; nunca un «no hay» seco.
--  2. Totales siempre en SQL: filtrar_documentos_agente devuelve en `sumas` la
--     base (sin IVA), el IVA y el total de TODO lo filtrado, y el reparto por
--     mes cuando se filtra por un texto. Antes solo el total con IVA: «la base
--     de Acciona 2026» se pidió 4 veces y el modelo sumó las 10 filas que veía.
--  3. Velocidad: un «no hay» costaba 6 s por llamada (y se hacían dos):
--     raiz_producto_agente sobre todo el vocabulario, el filtro de servicios
--     sobre las 30.000 líneas y dos strict_word_similarity por línea. Ahora la
--     raíz solo se calcula sobre las palabras que empiezan igual, los filtros
--     caros van después de acotar y las sugerencias usan palabras_nombre.
--  4. registrar_fallo_interno acepta 'chat_error' (el panel avisa cuando la
--     función no contesta); chat-facturas registra los suyos con
--     fallo_interno_registrar (tiempo agotado, herramienta caída, sin respuesta).
--  5. Vinos: margenes_carta_agente busca por palabras («laurent perrier» casa
--     con «Laurent‑Perrier La Cuvée»); chat-facturas lo consulta en paralelo
--     cuando se pregunta el precio de un vino.
--
-- Solo funciones: no cambia tablas ni datos.
-- Rollback: supabase/rollbacks/20261208190000_chat_facturas_fallos_evaluacion_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.lineas_producto_base_agente(text, text)') is null
     or to_regprocedure('public.vinos_coste_carta_datos(date, integer, jsonb)') is null
     or to_regprocedure('public.fallo_interno_registrar(text, jsonb, uuid, text)') is null then
    raise exception 'chat_facturas_fallos_evaluacion: faltan 20261107600000, 20261207150000 o 20261127100100. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Proveedor por nombre o por parecido ─────────────────────────────────
create or replace function public.proveedor_buscar_agente(p_texto text)
returns table(id bigint, nombre text, metodo text, parecido real, claro boolean)
language sql
stable
set search_path to 'public'
as $function$
  -- metodo: exacto (nombre, nombre comercial o alias), contiene, parecido (errata).
  -- claro: el primero y sin otro casi igual de parecido → se puede usar sin preguntar.
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
                        where a.proveedor_id = p.id and a.alias_normalizado is not null), 0)) as s
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
                       or (o.s >= 0.5 and o.s - coalesce((select max(x.s) from o x where x.rn = 2), 0) >= 0.08))
    from o
   where o.rn <= 5
   order by o.rn
$function$;
revoke all on function public.proveedor_buscar_agente(text) from public, anon;
grant execute on function public.proveedor_buscar_agente(text) to authenticated, service_role;

-- ─── 2. ¿Están todas las palabras buscadas en estos textos? ─────────────────
create or replace function public.casa_palabras_agente(p_buscado text, variadic p_textos text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  -- Sin tildes, guiones ni signos («laurent perrier» casa con «Laurent‑Perrier La Cuvée»);
  -- las palabras vacías y las de relleno de la pregunta («precio botella») no cuentan.
  select not exists (
           select 1 from unnest(palabras_producto_agente(p_buscado)) w
            where w <> all (array['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'un', 'una',
                                  'vino', 'vinos', 'botella', 'botellas', 'precio', 'coste'])
              and position(w in t.t) = 0)
    from (select array_to_string(palabras_producto_agente(array_to_string(p_textos, ' ')), ' ') as t) t
$function$;
revoke all on function public.casa_palabras_agente(text, text[]) from public, anon;
grant execute on function public.casa_palabras_agente(text, text[]) to authenticated, service_role;

-- ─── 3. Líneas que abrevian el nombre buscado o llevan sus siglas ───────────
create or replace function public.lineas_abreviadas_agente(p_palabras text[], p_ids bigint[] default null)
returns bigint[]
language sql
stable
set search_path to 'public'
as $function$
  -- p_palabras: las palabras buscadas (≥ 2), en su orden. p_ids: lo ya encontrado por texto.
  -- A. Abreviadas: las palabras seguidas y en orden, cada una entera (raíz + vocal/plural)
  --    o, si tiene 5 letras o más, cortada («s» = sierra, «col» = colección, «laur» =
  --    laurent); alguna de 4 letras o más tiene que ir entera (índice GIN de raíces).
  --    Se mira en la línea y en su producto del catálogo.
  -- B. Siglas («lp» = laurent perrier): solo líneas de la MISMA categoría y proveedor que
  --    algo ya encontrado (por texto o por A), y con ellas todo su producto del catálogo.
  --    Sin nada encontrado no se usan: «pc» o «vt» sueltos son demasiado ambiguos. Tampoco
  --    si la sigla es una unidad («gamba roja» → «gr») o sale en más del 0,5 % de las líneas.
  with q as (
    select t.w, t.n, raiz_producto_agente(t.w) as rz
      from unnest(p_palabras) with ordinality as t(w, n)
  ),
  pat as (
    select q.n, q.rz, length(q.w) >= 4 and q.w !~ '[0-9]' as larga,
           '(?:' || q.rz || '(?:[aeo]|[aeo]?s|es)?'
           || case when length(q.w) >= 5 and q.w !~ '[0-9]'
                   then '|' || (select string_agg(left(q.w, i), '|' order by i desc)
                                  from generate_series(1, length(q.w) - 1) i)
                   else '' end
           || ')' as p
      from q
  ),
  rx as (
    select '(?:^| )' || string_agg(pat.p, ' (?:(?:de|del|la|las|el|los|y|e) )*' order by pat.n) || '(?: |$)' as r,
           coalesce(array_agg(pat.rz) filter (where pat.larga), '{}'::text[]) as largas,
           (select string_agg(left(q.w, 1), '' order by q.n) from q) as sigla,
           count(*) >= 2
             and (select string_agg(left(q.w, 1), '' order by q.n) from q) ~ '^[a-z]{2,6}$'
             and (select string_agg(left(q.w, 1), '' order by q.n) from q) <> all (array[
                   'gr', 'grs', 'kg', 'kgs', 'mg', 'ml', 'cl', 'dl', 'lt', 'lts', 'ud', 'uds', 'un', 'pc', 'pz', 'pza',
                   'bt', 'bot', 'cj', 'caj', 'pk', 'bl', 'bs', 'lat', 'tr', 'cm', 'mm', 'mt', 'iva', 'sin', 'con', 'del',
                   'de', 'la', 'el', 'en', 'al', 'sl', 'sa', 'slu', 'cb']) as sigla_ok,
           count(*) as n
      from pat
  ),
  a as materialized (
    select pf.id
      from rx
      join productos_factura pf on pf.raices_nombre && rx.largas
     where rx.n >= 2 and array_to_string(pf.palabras_nombre, ' ') ~ rx.r
    union
    select pf.id
      from rx
      join productos_catalogo pc on pc.raices_nombre && rx.largas
      join productos_factura pf on pf.producto_id = pc.id
     where rx.n >= 2 and array_to_string(pc.palabras_nombre, ' ') ~ rx.r
  ),
  dir as materialized (
    select distinct pc.categoria_id as cat, f.proveedor_id
      from (select unnest(coalesce(p_ids, '{}'::bigint[])) as id union select a.id from a) u
      join productos_factura pf on pf.id = u.id
      join facturas f on f.id = pf.factura_id
      left join productos_catalogo pc on pc.id = pf.producto_id
  ),
  s0 as materialized (
    select pf.id, pf.producto_id, pf.factura_id
      from rx
      join productos_factura pf on pf.palabras_nombre @> array[rx.sigla]
     where rx.sigla_ok
    union
    select pf.id, pf.producto_id, pf.factura_id
      from rx
      join productos_catalogo pc on pc.palabras_nombre @> array[rx.sigla]
      join productos_factura pf on pf.producto_id = pc.id
     where rx.sigla_ok
  ),
  s as (
    select s0.id, s0.producto_id
      from s0
      join facturas f on f.id = s0.factura_id
      left join productos_catalogo pc on pc.id = s0.producto_id
     where (select count(*) from s0) <= greatest(60, (select count(*) from productos_factura) / 200)
       and exists (select 1 from dir d
                    where d.cat is not distinct from pc.categoria_id
                      and d.proveedor_id is not distinct from f.proveedor_id)
  ),
  sx as (
    select pf.id
      from (select s.producto_id, count(*) as n from s where s.producto_id is not null group by 1) p
      join productos_factura pf on pf.producto_id = p.producto_id
     -- el producto entero solo si al menos la mitad de sus líneas llevan la sigla
     where p.n * 2 >= (select count(*) from productos_factura x where x.producto_id = p.producto_id)
  )
  select coalesce(array_agg(distinct x.id), '{}'::bigint[])
    from (select a.id from a union all select s.id from s union all select sx.id from sx) x
$function$;
revoke all on function public.lineas_abreviadas_agente(text[], bigint[]) from public, anon;
grant execute on function public.lineas_abreviadas_agente(text[], bigint[]) to authenticated, service_role;

-- ─── 4. Búsqueda de líneas de producto: + abreviaturas y sin pasos lentos ───
create or replace function public.lineas_producto_base_agente(p_texto text, p_excluir text default null::text)
 returns table(ids bigint[], metodo text, subproductos text[], palabras text[])
 language plpgsql
 stable
 set search_path to 'public'
as $function$
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
    ) c;
  if v_ids is not null then
    v_met := 'texto';
  end if;

  -- 1b. Abreviaturas y siglas (dos palabras o más): se suman a lo anterior.
  if cardinality(v_pal) >= 2 then
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
                   and extensions.similarity(q.qw, v.w) >= 0.4)
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
revoke all on function public.lineas_producto_base_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_base_agente(text, text) to authenticated, service_role;

-- ─── 5. El panel puede registrar «el chat no ha contestado» ─────────────────
create or replace function public.registrar_fallo_interno(p_tipo text, p_datos jsonb default '{}'::jsonb, p_clave text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'registrar_fallo_interno: hace falta iniciar sesión' using errcode = '42501';
  end if;
  -- chat_error (20261208190000): el copiloto de Facturas no contestó (lo manda el panel si la
  -- función no devuelve nada; los fallos que ve la propia función los registra ella).
  if p_tipo is null or p_tipo not in ('albaran_aviso', 'chat_error') then
    raise exception 'registrar_fallo_interno: tipo no permitido %', p_tipo using errcode = '22023';
  end if;
  if (select count(*) from public.fallos_internos f where f.usuario_id = v_uid and f.created_at > now() - interval '1 hour') >= 30 then
    return null;
  end if;
  -- chat_error va sin usuario (solo la pregunta, la duración y el motivo): su tope es global.
  if p_tipo = 'chat_error'
     and (select count(*) from public.fallos_internos f where f.tipo = 'chat_error' and f.created_at > now() - interval '1 hour') >= 40 then
    return null;
  end if;
  return public.fallo_interno_registrar(p_tipo, p_datos, case when p_tipo = 'chat_error' then null else v_uid end, left(p_clave, 200));
end;
$$;

-- ─── 6. compras_producto_agente: proveedor con errata, sugerencias rápidas, busqueda_hecha ───
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
  end if;

  select h.ids, h.metodo, h.subproductos, h.palabras
    into v_ids, v_met, v_subs, v_pal
    from lineas_producto_agente(p_texto, p_excluir) h;
  if coalesce(cardinality(v_pal), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_frase := array_to_string(v_pal, ' ');
  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

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
               'precio_unitario', trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)),
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
       where x.pu is not null
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', (
      select case when m.lineas > 0 then
        'PRECIO DE REFERENCIA = ultima_factura (fecha, proveedor, numero: citalo para el enlace; precio_unitario por su unidad). '
        || 'por_proveedor.ultimo_precio y numero = la ultima factura de cada proveedor; precio_medio, min y max solo despues, '
        || 'como contexto. Mas barato = por ultimo_precio.' end
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
    jsonb_strip_nulls(jsonb_build_object('como_leer', resultado -> 'como_leer', 'ultima_factura', resultado -> 'ultima_factura')),
    resultado);
end;
$function$;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) to authenticated, service_role;

-- ─── 7. filtrar_documentos_agente: base, IVA y reparto por mes de TODO lo filtrado; proveedor con errata ───
CREATE OR REPLACE FUNCTION public.filtrar_documentos_agente(p_filtro text DEFAULT 'todos'::text, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'fecha_desc'::text, p_limite integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: filtros sin_factura y facturados (la relación albarán → factura existe); sumas.gasto_total como el panel.
declare
  c_filtros constant text[] := array['todos', 'sin_total', 'sin_verificar', 'con_alertas', 'fecha_dudosa', 'sin_factura', 'facturados'];
  c_ordenes constant text[] := array['fecha_desc', 'fecha_asc', 'total_desc', 'total_asc'];
  v_filtro text := lower(trim(coalesce(nullif(p_filtro, ''), 'todos')));
  v_orden  text := lower(trim(coalesce(nullif(p_orden, ''), 'fecha_desc')));
  v_texto  text := nullif(trim(coalesce(p_texto, '')), '');
  v_tipo   text := lower(trim(coalesce(p_tipo, '')));
  v_lim    int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_num    text;
  v_prov   text;
  v_total  int;
  v_filas  json;
  v_sumas  jsonb;
  v_sint   jsonb;
  v_ded    jsonb;
  v_cuenta boolean;
  v_fact   bigint[];
  v_prov_id   bigint;
  v_prov_nom  text;
  v_parecidos jsonb;
  v_meses     jsonb;
begin
  -- «Sin factura», «sin facturar», «albaranes sin factura»…: no es un filtro de
  -- esta herramienta (albaranes_sin_factura). Se dice claro en vez de dejar que
  -- el modelo lo confunda con sin_total (prueba del 05/10, q19).
  -- La relación albarán → factura SÍ está guardada (facturado_en_id, o la factura del
  -- proveedor que cita su número: albaranes_facturados_agente): «sin factura» y «ya
  -- facturados» son filtros de verdad. Lo que no existe es el estado de pago.
  if v_filtro ~ '(pagad|pago)' then
    return json_build_object(
      'error', 'No hay estado de pago: no se sabe que esta pagado. Para albaranes sin factura o ya facturados usa el filtro sin_factura o facturados (o la herramienta albaranes_sin_factura). sin_total NO significa sin factura.');
  end if;
  if v_filtro ~ '(sin|pendient|no)[ _-]*(de[ _-]*)?factur' then
    v_filtro := 'sin_factura';
  elsif v_filtro ~ '(facturad|vincul|relacion)' then
    v_filtro := 'facturados';
  end if;
  if not v_filtro = any(c_filtros) then
    return json_build_object('error', format('Filtro "%s" no valido.', p_filtro), 'permitidos', to_json(c_filtros));
  end if;
  if not v_orden = any(c_ordenes) then
    return json_build_object('error', format('Orden "%s" no valido.', p_orden), 'permitidos', to_json(c_ordenes));
  end if;
  v_tipo := case when v_tipo like 'albar%' then 'albaran'
                 when v_tipo like 'factura%' then 'factura'
                 when v_tipo in ('', 'ambos', 'todos') then null
                 else '#' end;
  if v_tipo = '#' then
    return json_build_object('error', format('Tipo "%s" no valido.', p_tipo), 'permitidos', json_build_array('factura', 'albaran', null));
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- Un filtro de estado (sin_total, sin_verificar, con_alertas, fecha_dudosa)
  -- responde a «cuántos/cuáles»: solo cuenta, sin importes ni avisos de cifra
  -- parcial (prueba del 06/10: q12 y q13 sumaban sin que se pidiera).
  v_cuenta := v_filtro not in ('todos', 'sin_factura', 'facturados');
  v_fact := array(select albaran_id from albaranes_facturados_agente());

  if v_texto is not null then
    v_num  := nullif(regexp_replace(regexp_replace(lower(v_texto), '[^a-z0-9]', '', 'g'), '^0+', ''), '');
    v_prov := nullif(normalizar_proveedor(v_texto), '');
  end if;

  -- 20261208190000: errata en el proveedor («garro», «liga sabor»). Si el texto no casa con
  -- ningún documento (número, proveedor ni CIF, en cualquier fecha), se usa el proveedor más
  -- parecido si está claro; si no, se devuelven los parecidos para preguntar.
  if v_texto is not null and not exists (
       select 1 from facturas f
        where f.numero_documento ilike '%' || v_texto || '%'
           or (v_num is not null
               and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '')
                   like '%' || v_num || '%')
           or (v_prov is not null and coalesce(f.proveedor_normalizado, '') like '%' || v_prov || '%')
           or lower(coalesce(f.cif, '')) like '%' || lower(v_texto) || '%') then
    select c.id, c.nombre into v_prov_id, v_prov_nom from proveedor_buscar_agente(v_texto) c where c.claro limit 1;
    if v_prov_id is null then
      select jsonb_agg(c.nombre) into v_parecidos from proveedor_buscar_agente(v_texto) c;
    end if;
  end if;

  with m as (
    select f.*
      from facturas f
     where (v_tipo is null or f.tipo = v_tipo)
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_texto is null
            or (v_prov_id is not null and f.proveedor_id = v_prov_id)
            or f.numero_documento ilike '%' || v_texto || '%'
            or (v_num is not null
                and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '')), '[^a-z0-9]', '', 'g'), '^0+', '')
                    like '%' || v_num || '%')
            or (v_prov is not null and coalesce(f.proveedor_normalizado, '') like '%' || v_prov || '%')
            or lower(coalesce(f.cif, '')) like '%' || lower(v_texto) || '%')
       and case v_filtro
             when 'todos'         then true
             when 'sin_total'     then f.total is null
             when 'sin_verificar' then not coalesce(f.verificada, false)
             when 'con_alertas'   then alertas_resumen_agente(f.alertas_validacion) is not null
             when 'fecha_dudosa'  then fecha_dudosa_agente(f.alertas_validacion)
             when 'sin_factura'   then f.tipo = 'albaran' and not f.id = any(v_fact)
             when 'facturados'    then f.tipo = 'albaran' and f.id = any(v_fact)
           end
  ),
  o as (
    select m.id,
           row_number() over (order by case when v_orden = 'fecha_desc' then m.fecha end desc nulls last,
                                       case when v_orden = 'fecha_asc'  then m.fecha end asc,
                                       case when v_orden = 'total_desc' then m.total end desc nulls last,
                                       case when v_orden = 'total_asc'  then m.total end asc nulls last,
                                       m.fecha desc, m.id desc) as n
      from m
  )
  select
    (select count(*) from m),
    (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
       from o join facturas f on f.id = o.id where o.n <= v_lim),
    (select jsonb_strip_nulls(jsonb_build_object(
              'facturas', case when count(*) filter (where tipo = 'factura') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'factura'),
                            'total',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) end) end,
              'albaranes', case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                            'n',         count(*) filter (where tipo = 'albaran'),
                            'valor',     case when not v_cuenta then round(coalesce(sum(total) filter (where tipo = 'albaran'), 0)::numeric, 2) end,
                            'sin_total', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total is null), 0) end,
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total_origen = 'deducido'), 0) end,
                            -- Los ya facturados están dentro de su factura: valor_sin_factura es lo que suma.
                            'ya_facturados', nullif(count(*) filter (where tipo = 'albaran' and id = any(v_fact)), 0),
                            'valor_sin_factura', case when not v_cuenta and count(*) filter (where tipo = 'albaran' and id = any(v_fact)) > 0
                                                      then round(coalesce(sum(total) filter (where tipo = 'albaran' and not id = any(v_fact)), 0)::numeric, 2) end) end,
              -- 20261208190000: base (sin IVA) e IVA de TODO lo filtrado, con la regla de gasto_total
              -- (facturas + albaranes sin factura). El modelo no suma filas: da estas cifras.
              'base', case when not v_cuenta and count(*) > 0
                           then round(coalesce(sum(subtotal) filter (where not (tipo = 'albaran' and id = any(v_fact))), 0)::numeric, 2) end,
              'iva', case when not v_cuenta and count(*) > 0
                          then round(coalesce(sum(iva) filter (where not (tipo = 'albaran' and id = any(v_fact))), 0)::numeric, 2) end,
              'sin_base', case when not v_cuenta
                               then nullif(count(*) filter (where subtotal is null and not (tipo = 'albaran' and id = any(v_fact))), 0) end,
              -- Gasto como el panel: facturas + albaranes sin factura.
              'gasto_total', case when not v_cuenta and count(*) > 0
                                  then round(coalesce(sum(total) filter (where not (tipo = 'albaran' and id = any(v_fact))), 0)::numeric, 2) end))
       from m),
    (select jsonb_build_object('n', count(*),
              'docs', jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero_documento,
                                                   'proveedor', proveedor, 'fecha', fecha) order by fecha, id))
       from m where total is null having count(*) > 0),
    (select jsonb_build_object('n', count(*),
              'docs', jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero_documento,
                                                   'proveedor', proveedor, 'fecha', fecha, 'iva_conocido', iva is not null)
                                order by fecha, id))
       from m where total_origen = 'deducido' and total is not null having count(*) > 0)
    ,
    -- Reparto por mes (filtrando por un texto: «¿ha subido lo que pago a Acciona?»).
    (select jsonb_agg(jsonb_build_object('mes', x.mes, 'n', x.n, 'base', x.base, 'total', x.total) order by x.mes)
       from (select to_char(fecha, 'YYYY-MM') as mes, count(*) as n,
                    round(coalesce(sum(subtotal), 0)::numeric, 2) as base,
                    round(coalesce(sum(total), 0)::numeric, 2) as total
               from m
              where fecha is not null and not (tipo = 'albaran' and id = any(v_fact))
              group by 1) x
      where v_texto is not null and not v_cuenta
     having count(*) between 2 and 24)
  into v_total, v_filas, v_sumas, v_sint, v_ded, v_meses;

  return (jsonb_build_object(
            'criterio', format('filtro=%s%s%s%s%s; orden=%s', v_filtro,
                               case when v_texto is not null then '; texto=' || v_texto else '' end,
                               case when v_tipo is not null then '; tipo=' || v_tipo else '' end,
                               case when p_desde is not null then '; desde=' || p_desde else '' end,
                               case when p_hasta is not null then '; hasta=' || p_hasta else '' end,
                               v_orden)
                        || case when v_cuenta then '; solo conteo: para importes usa consulta_flexible' else '' end
                        || case when v_filtro in ('sin_factura', 'facturados')
                                then '; albaran ya facturado = facturado_en_id o factura del proveedor que cita su numero' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim,
            'sumas',       coalesce(v_sumas, '{}'::jsonb))
          || case when v_total > 0 and not v_cuenta
                  then jsonb_build_object('como_leer', format(
                         'sumas = TODOS los %s documentos filtrados (base sin IVA, iva, total con IVA), no solo las %s filas mostradas: da ESAS cifras y no sumes filas.',
                         v_total, least(v_total, v_lim)))
                  else '{}'::jsonb end
          || case when v_meses is not null then jsonb_build_object('por_mes', v_meses) else '{}'::jsonb end
          || case when v_prov_id is not null
                  then jsonb_build_object('proveedor_corregido', jsonb_build_object('buscado', v_texto, 'usado', v_prov_nom,
                         'nota', 'No hay documentos con ese texto exacto: se ha usado el proveedor mas parecido. Dilo.'))
                  else '{}'::jsonb end
          || case when v_parecidos is not null
                  then jsonb_build_object('proveedores_parecidos', v_parecidos,
                         'nota_parecidos', 'Ningun documento casa con ese texto; proveedores_parecidos = nombres parecidos: pregunta si es alguno.')
                  else '{}'::jsonb end
          || case when v_filtro = 'sin_total'
                  then jsonb_build_object('nota', 'sin_total = no se leyo el importe total del documento. NO significa sin factura ni sin pagar.')
                  else '{}'::jsonb end
          -- Las listas solo si hay documentos que NO se ven en las filas (las
          -- filas ya dicen sin_total / total_origen) y solo con importes.
          || case when v_sint is not null and not v_cuenta and v_total > v_lim
                  then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null and not v_cuenta and v_total > v_lim
                  then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
         )::json;
end;
$function$;
revoke all on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) from public, anon;
grant execute on function public.filtrar_documentos_agente(text, text, text, date, date, text, integer) to authenticated, service_role;

-- ─── 8. ficha_proveedor_agente: proveedor con errata ───
CREATE OR REPLACE FUNCTION public.ficha_proveedor_agente(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
declare
  v_n     text := nullif(normalizar_proveedor_base(coalesce(p_texto, '')), '');
  v_id    bigint;
  v_otros jsonb;
  v_corr  boolean := false;
  resultado jsonb;
begin
  if v_n is null then
    return json_build_object('error', 'Falta el nombre del proveedor.');
  end if;

  with c as (
    select p.id, p.nombre::text as nombre,
           case when p.nombre_normalizado = v_n
                  or normalizar_proveedor_base(p.nombre_comercial) = v_n
                  or exists (select 1 from proveedores_alias a where a.proveedor_id = p.id and a.alias_normalizado = v_n)
                then 1
                when length(v_n) >= 3
                 and (position(v_n in p.nombre_normalizado) > 0
                      or position(v_n in coalesce(normalizar_proveedor_base(p.nombre_comercial), '')) > 0
                      or exists (select 1 from proveedores_alias a
                                  where a.proveedor_id = p.id and position(v_n in a.alias_normalizado) > 0))
                then 2 end as pri,
           (select count(*) from facturas f where f.proveedor_id = p.id) as docs
      from proveedores p
  ),
  o as (
    select *, row_number() over (order by pri, docs desc, nombre) as rn from c where pri is not null
  )
  select (select id from o where rn = 1),
         (select jsonb_agg(nombre order by rn) from o where rn between 2 and 4)
    into v_id, v_otros;

  -- 20261208190000: errata en el nombre («salazones garro»): el más parecido si está claro;
  -- si no, los parecidos para preguntar.
  if v_id is null then
    select c.id into v_id from proveedor_buscar_agente(p_texto) c where c.claro limit 1;
    v_corr := v_id is not null;
  end if;
  if v_id is null then
    return (jsonb_strip_nulls(jsonb_build_object('buscado', p_texto, 'sin_datos', true,
              'proveedores_parecidos', (select jsonb_agg(c.nombre) from proveedor_buscar_agente(p_texto) c),
              'nota', 'Ningun proveedor se llama exactamente asi (nombre, alias ni nombre comercial); si vienen proveedores_parecidos, pregunta si es alguno.')))::json;
  end if;

  with d as (
    select f.* from facturas f
     where f.proveedor_id = v_id
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
  ),
  fechas as (select count(distinct fecha) as n, min(fecha) as primera, max(fecha) as ultima from d),
  l as (
    select coalesce(pc.nombre, pf.nombre::text) as producto,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as k,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           pf.total as imp,   -- solo el importe leído (una línea sin importe no suma)
           d.fecha, d.id as doc
      from productos_factura pf
      join d on d.id = pf.factura_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))
  ),
  top as (
    select min(producto) as producto, unidad, sum(imp) as imp,
           (array_agg(precio order by fecha desc nulls last, doc desc) filter (where precio > 0))[1] as ult_precio,
           max(fecha) as ult_fecha
      from l
     group by k, unidad
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'proveedor', (select nombre from proveedores where id = v_id),
    'otros_parecidos', v_otros,
    'proveedor_corregido', case when v_corr then jsonb_build_object('buscado', p_texto,
       'nota', 'No hay proveedor con ese nombre exacto: se ha usado el mas parecido. Dilo.') end,
    'docs', (select count(*) from d),
    'primera', (select primera from fechas),
    'ultima', (select ultima from fechas),
    'intervalo_medio_dias', (select case when n >= 2 then round((ultima - primera)::numeric / (n - 1), 0) end from fechas),
    'gasto', (select trim_scale(round(coalesce(sum(total), 0), 2)) from d),
    'reparto', (select case when count(*) filter (where tipo = 'albaran') > 0 then jsonb_build_object(
                  'en_facturas', trim_scale(round(coalesce(sum(total) filter (where tipo = 'factura'), 0), 2)),
                  'en_albaranes_sin_factura', trim_scale(round(coalesce(sum(total) filter (where tipo = 'albaran'), 0), 2))) end
                  from d),
    'sin_total', (select nullif(count(*) filter (where total is null), 0) from d),
    'nota', 'gasto con IVA; precios de linea SIN IVA',
    'top_productos', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'producto',      t.producto,
               'unidad',        t.unidad,
               'ultimo_precio', trim_scale(round(t.ult_precio, case when t.ult_precio < 1 then 4 else 2 end)),
               'ultima_fecha',  t.ult_fecha))
             order by t.imp desc nulls last, t.producto)
        from (select * from top order by imp desc nulls last, producto limit 8) t)
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.ficha_proveedor_agente(text) from public, anon;
grant execute on function public.ficha_proveedor_agente(text) to authenticated, service_role;

-- ─── 9. albaranes_sin_factura_agente: proveedor con errata ───
CREATE OR REPLACE FUNCTION public.albaranes_sin_factura_agente(p_proveedor text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albaranes que todavía no están en ninguna factura (regla de
-- albaranes_facturados_agente), del más antiguo al más reciente, con los días
-- que llevan sin facturar. Proveedor opcional (canónico, alias o nombre comercial).
declare
  c_max constant int := 30;
  v_n      text := nullif(normalizar_proveedor_base(coalesce(p_proveedor, '')), '');
  v_ids    bigint[];
  v_nombres text[];
  resultado jsonb;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  if v_n is not null then
    select array_agg(p.id order by p.nombre), array_agg(p.nombre::text order by p.nombre)
      into v_ids, v_nombres
      from proveedores p
     where p.nombre_normalizado = v_n
        or normalizar_proveedor_base(p.nombre_comercial) = v_n
        or exists (select 1 from proveedores_alias a where a.proveedor_id = p.id and a.alias_normalizado = v_n)
        or (length(v_n) >= 3
            and (position(v_n in p.nombre_normalizado) > 0
                 or position(v_n in coalesce(normalizar_proveedor_base(p.nombre_comercial), '')) > 0
                 or exists (select 1 from proveedores_alias a
                             where a.proveedor_id = p.id and position(v_n in a.alias_normalizado) > 0)));
    -- 20261208190000: errata en el nombre: el más parecido si está claro; si no, los parecidos.
    if v_ids is null then
      select array[c.id], array[c.nombre] into v_ids, v_nombres
        from proveedor_buscar_agente(p_proveedor) c where c.claro limit 1;
    end if;
    if v_ids is null then
      return (jsonb_strip_nulls(jsonb_build_object('buscado', p_proveedor, 'sin_datos', true,
                'proveedores_parecidos', (select jsonb_agg(c.nombre) from proveedor_buscar_agente(p_proveedor) c),
                'nota', 'Ningun proveedor se llama exactamente asi (nombre, alias ni nombre comercial); si vienen proveedores_parecidos, pregunta si es alguno.')))::json;
    end if;
  end if;

  with a as (
    select f.id, f.numero_documento::text as numero,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,
           f.fecha, f.total, f.total_origen,
           ((now() at time zone 'Europe/Madrid')::date - f.fecha) as dias
      from facturas f
      left join proveedores pv on pv.id = f.proveedor_id
     where f.tipo = 'albaran'
       and f.id not in (select albaran_id from albaranes_facturados_agente())
       and (v_ids is null or f.proveedor_id = any(v_ids))
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
  ),
  o as (
    select a.*, row_number() over (order by a.fecha nulls last, a.id) as rn from a
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'proveedor', case when v_nombres is null then null
                      when cardinality(v_nombres) = 1 then to_jsonb(v_nombres[1])
                      else to_jsonb(v_nombres[1:4]) end,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'albaranes_sin_factura', (select count(*) from a),
    'suma_con_iva', (select trim_scale(round(coalesce(sum(a.total), 0), 2)) from a),
    'sin_total',    (select nullif(count(*) filter (where a.total is null), 0) from a),
    'albaranes', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'numero',    o.numero,
               'proveedor', o.proveedor,
               'fecha',     o.fecha,
               'importe',   o.total,
               'deducido',  case when o.total_origen = 'deducido' then true end,
               'dias',      o.dias))
             order by o.rn)
        from o where o.rn <= c_max),
    'truncado', (select case when count(*) > c_max then true end from a),
    'nota', case when (select count(*) from a) = 0
                 then 'Ninguno: todos los albaranes (de ese proveedor y periodo) estan ya en una factura.'
                 else 'Sin factura = ninguna factura del proveedor cita su numero de albaran. Importes con IVA. No hay estado de pago.' end
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.albaranes_sin_factura_agente(text, date, date) from public, anon;
grant execute on function public.albaranes_sin_factura_agente(text, date, date) to authenticated, service_role;

-- ─── 10. margenes_carta_agente: texto por palabras ───
create or replace function public.margenes_carta_agente(p_texto text DEFAULT NULL::text, p_vista text DEFAULT NULL::text, p_solo_problemas boolean DEFAULT false, p_limite integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- 20261207150000_coste_carta_vinos: los VINOS salen de vinos_coste_carta_datos (coste efectivo).
-- 20261208190000_chat_facturas_fallos_evaluacion: el texto se busca por palabras, sin tildes ni guiones
-- (casa_palabras_agente): «laurent perrier» casa con «Laurent‑Perrier La Cuvée».
-- 20261116100000_chatbot_margenes_alertas + 20261128150000_chatbot_ultima_factura: el coste es el de la
-- ÚLTIMA factura (margenes_carta, 20261128140000): cada fila trae ultima_factura (fecha, proveedor, número,
-- precio tal como se compró) y la mediana de 90 días aparte, como contexto.
declare
  m jsonb := public.margenes_carta();
  -- Vinos: una sola fuente con el coste efectivo (20261207150000_coste_carta_vinos).
  vc jsonb := public.vinos_coste_carta_datos(null, null, m);
  c public.margenes_carta_config%rowtype;
  v_min_peso numeric; v_min_vino numeric; v_max_pct numeric;
  v_txt text := nullif(public._norm_agente(btrim(p_texto)), '');
  v_lim int := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_vista text := nullif(lower(btrim(coalesce(p_vista, ''))), '');
  v_solo boolean := coalesce(p_solo_problemas, false);
begin
  if v_vista is not null and v_vista not in ('peso', 'vinos', 'platos') then
    return jsonb_build_object('error', 'vista debe ser peso, vinos, platos o null');
  end if;
  select * into c from public.margenes_carta_config where id;
  v_min_peso := coalesce(c.multiplicador_min_peso, 2);
  v_min_vino := coalesce(c.multiplicador_min_vino, 2.5);
  v_max_pct  := coalesce(c.coste_max_plato_pct, 35);

  return jsonb_strip_nulls(jsonb_build_object(
    'umbrales', jsonb_build_object('multiplicador_min_peso', v_min_peso, 'multiplicador_min_vino', v_min_vino,
                                   'coste_max_plato_pct', v_max_pct, 'iva_pct', coalesce(c.iva_pct, 10)),
    'como_leer', 'El coste (compra_kg, coste_botella, coste) es el de la ULTIMA factura: da primero ultima_factura (fecha, proveedor, '
                 || 'numero: citalo para el enlace; precio por su unidad); *_mediana = mediana de 90 dias, solo despues y como contexto. '
                 || 'multiplicador = cuantas veces cobras lo que pagas (venta SIN IVA / compra SIN IVA; peso: euros/kg de carta frente a '
                 || 'euros/kg comprado; vino: botella frente a botella). pct_coste = % del precio de VENTA sin IVA que se va en coste '
                 || '(de cada 100 euros que cobras, X son coste); no es un % sobre el coste. Platos con revisado=false son ESTIMACIONES de '
                 || 'escandallo: dilo y no las des como dato firme; sin texto solo salen platos revisados (resumen.platos dice cuantos hay). '
                 || 'VINOS: coste_botella es el coste EFECTIVO (ultima factura contando botellas_sin_cargo); coste_factura es el precio de la '
                 || 'factura. estado dudoso o revisar (mira avisos): dilo y no des su margen como firme. precio_sugerido = carta para llegar '
                 || 'al minimo. Pantalla: Facturas > Margenes (vinos: Coste vinos).',
    'resumen', jsonb_build_object(
      'peso', (select jsonb_build_object('articulos', count(*),
                 'por_debajo', count(*) filter (where (e ->> 'multiplicador')::numeric < v_min_peso),
                 'sin_datos', count(*) filter (where e ->> 'multiplicador' is null),
                 'mediana', round((percentile_cont(0.5) within group (order by (e ->> 'multiplicador')::numeric))::numeric, 2))
               from jsonb_array_elements(m -> 'peso') e),
      'vinos', jsonb_build_object('vinos', vc #> '{resumen,total}', 'con_coste', vc #> '{resumen,con_coste}',
                 'por_debajo', vc #> '{resumen,por_debajo}', 'mediana', vc #> '{resumen,multiplicador_mediana}',
                 'dudosos', vc #> '{resumen,dudosos}', 'otro_formato', vc #> '{resumen,revisar}',
                 'sin_enlazar', vc #> '{resumen,sin_enlazar}', 'sin_compra', vc #> '{resumen,sin_compra}'),
      'platos', (select jsonb_build_object('platos', count(*), 'con_escandallo', count(e ->> 'coste'),
                 'revisados', count(*) filter (where (e ->> 'revisado')::boolean),
                 'por_encima_pct', count(*) filter (where (e ->> 'pct')::numeric > v_max_pct))
               from jsonb_array_elements(m -> 'platos') e)),
    'peso', case when v_vista is null or v_vista = 'peso' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'precio_carta', e -> 'precio', 'unidad_carta', e ->> 'unidad',
                 'venta_kg_sin_iva', e -> 'venta_kg', 'producto_comprado', e ->> 'producto', 'compra_kg', e -> 'compra_kg',
                 'multiplicador', e -> 'multiplicador', 'por_debajo', (e ->> 'multiplicador')::numeric < v_min_peso,
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'compra_kg_mediana', e -> 'compra_kg_mediana', 'lineas', e -> 'lineas', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'peso') e
         where (v_txt is null or public.casa_palabras_agente(v_txt, e ->> 'nombre', e ->> 'producto'))
           and (not v_solo or (e ->> 'multiplicador')::numeric < v_min_peso)
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'vinos', case when v_vista is null or v_vista = 'vinos' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'precio_copa', e -> 'precio_copa', 'producto_comprado', e ->> 'producto', 'coste_botella', e -> 'coste_efectivo',
                 'coste_factura', e -> 'coste_factura',
                 'botellas_sin_cargo', case when (e ->> 'botellas_sin_cargo')::numeric > 0 then e -> 'botellas_sin_cargo' end,
                 'botellas_pagadas', case when (e ->> 'botellas_sin_cargo')::numeric > 0 then e -> 'botellas_pagadas' end,
                 'multiplicador', e -> 'multiplicador', 'por_debajo', e ->> 'estado' = 'bajo',
                 'estado', e ->> 'estado', 'avisos', nullif(e -> 'avisos', '[]'::jsonb),
                 'precio_sugerido', e -> 'precio_sugerido', 'margen_copa', e #> '{copa,margen}',
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(vc -> 'vinos') e
         where (v_txt is null or public.casa_palabras_agente(v_txt, e ->> 'nombre', e ->> 'producto'))
           and (not v_solo or e ->> 'estado' = 'bajo')
           -- Sin texto: solo los comparables (ni dudosos ni de otro formato salen como «los peores»).
           and (v_txt is not null or e ->> 'estado' in ('bien', 'bajo'))
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'platos', case when v_vista is null or v_vista = 'platos' then (
      select coalesce(jsonb_agg(r.j order by r.pct desc nulls last), '[]'::jsonb) from (
        select (e ->> 'pct')::numeric as pct,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'coste', e -> 'coste', 'pct_coste', e -> 'pct', 'margen', e -> 'margen',
                 'ingrediente_principal', e ->> 'principal', 'revisado', e -> 'revisado', 'origen', e ->> 'origen',
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'pct_mediana', e -> 'pct_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'platos') e
         where (v_txt is null or public.casa_palabras_agente(v_txt, e ->> 'nombre', e ->> 'principal'))
           and (not v_solo or (e ->> 'pct')::numeric > v_max_pct)
           -- Sin texto, solo escandallos revisados: los estimados (lata entera frente a la
           -- ración) salían como «los peores» sin serlo. Por nombre sí salen, marcados.
           and (v_txt is not null or (e ->> 'coste' is not null and (e ->> 'revisado')::boolean))
         order by (e ->> 'pct')::numeric desc nulls last limit v_lim) r) end));
end;
$$;
revoke all on function public.margenes_carta_agente(text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.margenes_carta_agente(text, text, boolean, integer) to service_role;

notify pgrst, 'reload schema';
