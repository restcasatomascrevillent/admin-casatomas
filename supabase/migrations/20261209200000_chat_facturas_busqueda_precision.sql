set client_encoding = 'UTF8';
-- ============================================================================
-- 20261209200000_chat_facturas_busqueda_precision · Copiloto de Facturas
-- ----------------------------------------------------------------------------
-- Arregla las reservas de la revisión independiente del #255
-- (facturas-conocimiento/revision-chat-255-2026-11-17.md):
--
--  1. Abreviaturas y siglas: metían productos que no son y los SUMABAN sin avisar
--     («aceite de oliva» +3.768 € de anchoas «A/OLIVA», «pera conferencia» = tomate
--     pera «C-M», «solomillo vaca» = chuletero «C/S VACA», «vieira congelada» =
--     «vieira CON concha», «frutos rojos» = manzanas con «FR»).
--     · Lo que sale por abreviatura o sigla ya NO se suma a lo encontrado de forma
--       directa: compras_producto_agente lo da aparte en posibles_coincidencias, con
--       su nombre exacto, para que el modelo pregunte o lo diga. Solo si no hay nada
--       directo se usa como resultado, con coincidencia 'aproximada' (como antes).
--     · Recorte corto (1-3 letras) solo con punto en la factura («S. CANTABRIA»,
--       «COL.», «R.DUERO», «M. DE RISCAL»); «c/», «s/», «a/», «C-M» o «con» ya no
--       valen como «congelada», «solomillo» o «aceite». Si la abreviatura no empieza
--       la línea, la primera palabra buscada (el sustantivo principal) tiene que ir entera y
--       los demás recortes, con punto: «VENTRESCA … A.OLIVA» no es «aceite de oliva».
--     · Sigla («LP») solo si es lo primero de la línea (tras formato: «C/6B», «BOT.»):
--       el sustantivo principal manda; «PIMIENTO PEQ FR», «ARENQUE AHUM AC» o una
--       conserva «… AO» ya no son «frutos rojos», «atún claro» ni «aceite de oliva».
--  2. Proveedor por parecido: solo se da por seguro si es una errata de verdad
--     (cada palabra igual, empezada o con UNA letra cambiada, y alguna exacta;
--     «salazones garro» = Garre, «liga sabor» = Luga Sabores). «mercadona» ya no es
--     el Registro Mercantil, ni «naturgy» Naturcid, ni «mahou» una persona, ni
--     «damm» Viveros La Dama: se devuelven como parecidos para preguntar, sin cifras.
--     compras_producto_agente con un proveedor que no existe ya no da cifras: dice
--     que no se le compra (o pregunta por los parecidos).
--  3. Telegram: los chat_error se agrupan. Como mucho un aviso cada 15 minutos; los
--     que llegan mientras tanto se cuentan en la última fila y salen en el aviso
--     siguiente (acumulados_antes). Así «Reintentar» en bucle no inunda el grupo ni
--     agota el tope del panel.
--  4. registrar_fallo_interno('chat_error') exige poder ver Facturas y guarda solo
--     origen, motivo, pregunta (300), duración y detalle (300), saneados.
--
-- Solo funciones: no cambia tablas ni datos. Firmas iguales (create or replace).
-- Rollback: supabase/rollbacks/20261209200000_chat_facturas_busqueda_precision_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.lineas_abreviadas_agente(text[], bigint[])') is null
     or to_regprocedure('public.proveedor_buscar_agente(text)') is null
     or to_regprocedure('public.fallo_interno_registrar(text, jsonb, uuid, text)') is null
     or to_regprocedure('public.can_read_section(text)') is null then
    raise exception 'chat_facturas_busqueda_precision: falta 20261208190000_chat_facturas_fallos_evaluacion. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. ¿Una palabra es la otra con UNA letra cambiada, quitada o puesta? ───
create or replace function public.una_letra_agente(a text, b text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
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
revoke all on function public.una_letra_agente(text, text) from public, anon;
grant execute on function public.una_letra_agente(text, text) to authenticated, service_role;

-- ─── 2. ¿El nombre buscado es una errata de este proveedor? ─────────────────
create or replace function public.errata_proveedor_agente(p_buscado text, p_nombre text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  -- Cada palabra buscada (≥ 3 letras) está en el nombre igual, empezada («sabor» →
  -- sabores) o con UNA letra distinta (≥ 4 letras: «garro» → garre, «liga» → luga), y
  -- alguna está igual o empezada. Con una sola palabra, la errata vale si tiene ≥ 6
  -- letras. «mercadona» ≠ mercantil, «naturgy» ≠ naturcid, «mahou» ≠ mamadou, «damm» ≠ dama.
  with b as (
    select w from regexp_split_to_table(coalesce(p_buscado, ''), '[^a-z0-9]+') w where length(w) >= 3
  ),
  n as (
    select w from regexp_split_to_table(coalesce(p_nombre, ''), '[^a-z0-9]+') w where w <> ''
  ),
  m as (
    select b.w,
           exists (select 1 from n where n.w = b.w or (length(b.w) >= 4 and n.w like b.w || '%')) as igual,
           exists (select 1 from n where length(b.w) >= 4 and length(n.w) >= 4 and una_letra_agente(b.w, n.w)) as errata
      from b
  )
  select count(*) > 0
         and bool_and(m.igual or m.errata)
         and (bool_or(m.igual) or (count(*) = 1 and max(length(m.w)) >= 6))
    from m
$function$;
revoke all on function public.errata_proveedor_agente(text, text) from public, anon;
grant execute on function public.errata_proveedor_agente(text, text) to authenticated, service_role;

-- ─── 3. Proveedor por nombre o por parecido: «claro» solo con errata de verdad ───
create or replace function public.proveedor_buscar_agente(p_texto text)
returns table(id bigint, nombre text, metodo text, parecido real, claro boolean)
language sql
stable
set search_path to 'public'
as $function$
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
revoke all on function public.proveedor_buscar_agente(text) from public, anon;
grant execute on function public.proveedor_buscar_agente(text) to authenticated, service_role;

-- ─── 4. Líneas que abrevian el nombre buscado o llevan sus siglas ───────────
create or replace function public.lineas_abreviadas_agente(p_palabras text[], p_ids bigint[] default null)
returns bigint[]
language sql
stable
set search_path to 'public'
as $function$
  -- p_palabras: las palabras buscadas (≥ 2), en su orden. p_ids: lo ya encontrado por texto.
  -- A. Abreviadas: las palabras seguidas y en orden, cada una entera (raíz + vocal/plural)
  --    o, si tiene 5 letras o más, cortada; alguna de 4 letras o más tiene que ir entera
  --    (índice GIN de raíces). Se mira en la línea y en su producto del catálogo.
  --    20261209200000: un recorte de 1 a 3 letras solo vale con punto en el nombre
  --    («S. CANTABRIA», «COL.», «R.DUERO»): «c/», «s/», «a/», «C-M» y «con» ya no son
  --    «congelada», «solomillo» o «aceite». Si la abreviatura no empieza la línea (tras el
  --    formato: «C/6B», «BOT.», «M 049161»), la primera palabra buscada (el sustantivo
  --    principal) tiene que ir entera y los demás recortes, con punto («VENTRESCA … A.OLIVA»
  --    no es «aceite de oliva»; «pera» en «TOMATE PERA» es un adjetivo).
  -- B. Siglas («lp» = laurent perrier): solo líneas de la MISMA categoría y proveedor que
  --    algo ya encontrado (por texto o por A), y con ellas todo su producto del catálogo.
  --    Sin nada encontrado no se usan: «pc» o «vt» sueltos son demasiado ambiguos. Tampoco
  --    si la sigla es una unidad («gamba roja» → «gr») o sale en más del 0,5 % de las líneas.
  --    20261209200000: la sigla tiene que ser lo primero de la línea (tras el formato): el
  --    sustantivo principal manda («PIMIENTO PEQ FR» no es «frutos rojos»).
  with q as (
    select t.w, t.n, raiz_producto_agente(t.w) as rz
      from unnest(p_palabras) with ordinality as t(w, n)
  ),
  pat as (
    select q.n, q.rz, length(q.w) >= 4 and q.w !~ '[0-9]' as larga,
           -- sobre palabras_nombre (prefiltro, como antes)
           '(?:' || q.rz || '(?:[aeo]|[aeo]?s|es)?'
           || case when length(q.w) >= 5 and q.w !~ '[0-9]'
                   then '|' || (select string_agg(left(q.w, i), '|' order by i desc)
                                  from generate_series(1, length(q.w) - 1) i)
                   else '' end
           || ')' as p,
           -- sobre el nombre tal cual (normalizar_texto): recortes cortos solo con punto
           '(?:' || q.rz || '(?:[aeo]|[aeo]?s|es)?(?![a-z0-9])'
           || case when length(q.w) >= 5 and q.w !~ '[0-9]'
                   then '|(?:' || (select string_agg(left(q.w, i), '|' order by i desc)
                                     from generate_series(4, length(q.w) - 1) i) || ')(?![a-z])'
                        || '|(?:' || (select string_agg(left(q.w, i), '|' order by i desc)
                                        from generate_series(1, 3) i) || ')\.'
                   else '' end
           || ')' as p_ini,
           '(?:' || q.rz || '(?:[aeo]|[aeo]?s|es)?(?![a-z0-9])'
           || case when length(q.w) >= 5 and q.w !~ '[0-9]'
                   then '|(?:' || (select string_agg(left(q.w, i), '|' order by i desc)
                                     from generate_series(1, length(q.w) - 1) i) || ')\.'
                   else '' end
           || ')' as p_dot,
           q.rz || '(?:[aeo]|[aeo]?s|es)?(?![a-z0-9])' as p_entera
      from q
  ),
  rx as (
    select '(?:^| )' || string_agg(pat.p, ' (?:(?:de|del|la|las|el|los|y|e) )*' order by pat.n) || '(?: |$)' as r,
           '^[^a-z0-9]*(?:(?:[a-z]|[0-9][a-z0-9,]*|bot|bt|cj|caja|pack)[^a-z0-9]+)*'
             || string_agg(pat.p_ini, '[^a-z0-9]*(?:(?:de|del|la|las|el|los|y|e)[^a-z0-9]+)*' order by pat.n) as r_ini,
           '(?:^|[^a-z0-9])'
             || string_agg(case when pat.n = 1 then pat.p_entera else pat.p_dot end, '[^a-z0-9]*(?:(?:de|del|la|las|el|los|y|e)[^a-z0-9]+)*' order by pat.n) as r_dot,
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
       and (normalizar_texto(pf.nombre) ~ rx.r_ini or normalizar_texto(pf.nombre) ~ rx.r_dot)
    union
    select pf.id
      from rx
      join productos_catalogo pc on pc.raices_nombre && rx.largas
      join productos_factura pf on pf.producto_id = pc.id
     where rx.n >= 2 and array_to_string(pc.palabras_nombre, ' ') ~ rx.r
       and (normalizar_texto(pc.nombre) ~ rx.r_ini or normalizar_texto(pc.nombre) ~ rx.r_dot)
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
       and array_to_string(pf.palabras_nombre, ' ')
           ~ ('^(?:(?:[a-z]|[0-9][a-z0-9]*|bot|bt|cj|caja|pack) )*' || rx.sigla || '(?: |$)')
    union
    select pf.id, pf.producto_id, pf.factura_id
      from rx
      join productos_catalogo pc on pc.palabras_nombre @> array[rx.sigla]
      join productos_factura pf on pf.producto_id = pc.id
     where rx.sigla_ok
       and array_to_string(pc.palabras_nombre, ' ')
           ~ ('^(?:(?:[a-z]|[0-9][a-z0-9]*|bot|bt|cj|caja|pack) )*' || rx.sigla || '(?: |$)')
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

-- ─── 5. Posibles coincidencias: lo que solo sale por abreviatura o sigla ───
create or replace function public.lineas_posibles_agente(p_texto text, p_excluir text default null, p_ids bigint[] default null)
returns bigint[]
language sql
stable
set search_path to 'public'
as $function$
  -- Líneas que PUEDEN ser el producto buscado escrito con abreviatura o siglas («C/6B LP LA
  -- CUVEE» para «laurent perrier»), sin las ya encontradas (p_ids) ni las que dicen las
  -- palabras buscadas enteras. No se suman: compras_producto_agente las da aparte.
  -- Mismos filtros que lineas_producto_base_agente (excluir, servicios, subproductos).
  with w as (
    select array(select x from unnest(palabras_producto_agente(p_texto)) x
                  where not (x = any(array[
                    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
                    'un', 'una', 'unos', 'unas', 'mi', 'mis',
                    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
                    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
                    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
                    'pieza', 'piezas', 'precio', 'precios']))) as pal
  ),
  v as (
    select w.pal,
           array(select distinct raiz_producto_agente(x) from unnest(w.pal) x) as rai,
           array(select distinct raiz_producto_agente(x) from unnest(palabras_producto_agente(p_excluir)) x
                  where not (x = any(array['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con',
                                           'para', 'en', 'al', 'a', 'por', 'un', 'una', 'unos', 'unas', 'mi', 'mis']))) as excl,
           es_linea_servicio_agente(array_to_string(w.pal, ' ')) as serv
      from w
  ),
  v2 as (
    select v.*, v.rai && array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar'] as sub
      from v
  )
  select coalesce(array_agg(pf.id order by pf.id), '{}'::bigint[])
    from v2
   cross join lateral unnest(case when cardinality(v2.pal) >= 2
                                  then lineas_abreviadas_agente(v2.pal, p_ids) else '{}'::bigint[] end) u(id)
    join productos_factura pf on pf.id = u.id
    left join productos_catalogo pc on pc.id = pf.producto_id
   where not (pf.id = any(coalesce(p_ids, '{}'::bigint[])))
     and not (pf.raices_nombre @> v2.rai)
     and not coalesce(pc.raices_nombre @> v2.rai, false)
     and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v2.excl)
     and (v2.serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
     and (v2.sub or not ((case when pc.nombre is null then pf.raices_nombre else pc.raices_nombre end)
                          && array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar']
                         and es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v2.rai)))
$function$;
revoke all on function public.lineas_posibles_agente(text, text, bigint[]) from public, anon;
grant execute on function public.lineas_posibles_agente(text, text, bigint[]) to authenticated, service_role;

-- ─── 6. Búsqueda de líneas de producto: las abreviaturas ya no se suman a lo directo ───
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

-- ─── 7. compras_producto_agente: posibles coincidencias aparte; proveedor que no existe, sin cifras ───
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
    jsonb_strip_nulls(jsonb_build_object('como_leer', resultado -> 'como_leer', 'ultima_factura', resultado -> 'ultima_factura',
      'posibles_coincidencias', v_posj,
      'nota_posibles', case when v_posj is not null then
        'posibles_coincidencias = lineas que PUEDEN ser este producto escrito con abreviatura o siglas (p. ej. «LP» = Laurent '
        || 'Perrier). NO estan en total, ultima_factura ni por_proveedor. Dilas APARTE con su nombre exacto y su precio, '
        || 'sin sumarlas, y pregunta si son el mismo producto.' end)),
    resultado);
end;
$function$;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) to authenticated, service_role;

-- ─── 8. Punto único de alta: los chat_error se agrupan (máx. un aviso cada 15 min) ───
-- Devuelve el id, o null si ya existía (misma clave), los datos son demasiado grandes o
-- (chat_error) se ha sumado al último aviso de los 15 minutos anteriores.
create or replace function public.fallo_interno_registrar(
  p_tipo text, p_datos jsonb default '{}'::jsonb, p_usuario_id uuid default null, p_clave text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_email text;
  v_ult   record;
  v_rep   int;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or pg_column_size(p_datos) > 60000 then
    return null;
  end if;
  -- 20261209200000: el chat (función o panel) puede fallar en bucle («Reintentar», OpenAI caído).
  -- Si ya hubo un chat_error en los últimos 15 minutos, no se crea otra fila (ni otro Telegram):
  -- se cuenta en esa (repetidos) y el siguiente aviso dice cuántos se acumularon.
  if p_tipo = 'chat_error' then
    perform pg_advisory_xact_lock(hashtext('fallos_internos:chat_error'));
    select f.id, f.created_at, f.datos into v_ult
      from public.fallos_internos f
     where f.tipo = 'chat_error'
     order by f.created_at desc, f.id desc
     limit 1;
    if v_ult.id is not null and v_ult.created_at > now() - interval '15 minutes' then
      update public.fallos_internos f
         set datos = f.datos || jsonb_build_object(
               'repetidos', coalesce((f.datos ->> 'repetidos')::int, 0) + 1,
               'ultimo_repetido', jsonb_strip_nulls(jsonb_build_object(
                 'hora', now(), 'motivo', left(p_datos ->> 'motivo', 60), 'pregunta', left(p_datos ->> 'pregunta', 120))))
       where f.id = v_ult.id;
      return null;
    end if;
    v_rep := coalesce((v_ult.datos ->> 'repetidos')::int, 0);
    if v_rep > 0 then
      p_datos := p_datos || jsonb_build_object('acumulados_antes', v_rep, 'acumulados_desde', v_ult.created_at);
    end if;
    p_clave := null;
  end if;
  if p_usuario_id is not null then
    select u.email into v_email from auth.users u where u.id = p_usuario_id;
  end if;
  insert into public.fallos_internos (tipo, datos, usuario_id, usuario, clave)
  values (p_tipo, p_datos, p_usuario_id, v_email, p_clave)
  on conflict (tipo, clave) where clave is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fallo_interno_registrar(text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.fallo_interno_registrar(text, jsonb, uuid, text) to service_role;

-- ─── 9. El panel: chat_error solo con permiso de Facturas y con datos saneados ───
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
  -- 20261209200000: el chat de Facturas solo lo ve quien puede ver Facturas; y de lo que manda el
  -- navegador solo se guarda esto, saneado (va tal cual al Telegram de desarrollo).
  if p_tipo = 'chat_error' then
    if not coalesce(public.can_read_section('facturas'), false) then
      raise exception 'registrar_fallo_interno: sin permiso de Facturas' using errcode = '42501';
    end if;
    if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
      p_datos := '{}'::jsonb;
    end if;
    p_datos := jsonb_strip_nulls(jsonb_build_object(
      'origen',      'panel',
      'motivo',      case when (p_datos ->> 'motivo') ~ '^[a-z_]{1,40}$' then p_datos ->> 'motivo' else 'desconocido' end,
      'pregunta',    nullif(left(btrim(regexp_replace(coalesce(p_datos ->> 'pregunta', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 301), ''),
      'duracion_ms', case when (p_datos ->> 'duracion_ms') ~ '^[0-9]{1,7}$' then (p_datos ->> 'duracion_ms')::int end,
      'detalle',     nullif(left(btrim(regexp_replace(coalesce(p_datos ->> 'detalle', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 300), '')));
    p_clave := null;
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
revoke all on function public.registrar_fallo_interno(text, jsonb, text) from public, anon;
grant execute on function public.registrar_fallo_interno(text, jsonb, text) to authenticated, service_role;
