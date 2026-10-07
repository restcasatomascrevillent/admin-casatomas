set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##       Chatbot de Facturas: compras de un producto (07/10/2026)        ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (dueño, 07/10/2026; primera mejora del plan de facturas): el
-- chatbot no sabía responder preguntas GLOBALES de un producto: «¿cuántos
-- kilos de centollo he comprado este año y a quién?», «¿cuánto he gastado en
-- merluza?», «¿a quién le compro el jamón y a qué precio medio?», «¿qué
-- proveedor me vende más barata la nata?». Las herramientas que había
-- (buscar_productos_texto_agente, consulta_flexible_agente con filtro ilike,
-- historial_precios_agente) buscan la cadena tal cual: «centollo» no encuentra
-- «Centolla hembra 1-1.5 kg», y ninguna agrega cantidad, importe y precio
-- medio por proveedor sin mezclar kg con unidades.
-- Indicación permanente del dueño: herramientas SQL precisas y compactas.
--
-- QUÉ AÑADE (no cambia ninguna función, tabla ni dato existente)
--   · Extensión pg_trgm en el esquema `extensions` (si no estaba).
--   · palabras_producto_agente(text) → text[]: minúsculas, sin tildes, sin
--     signos, partido en palabras («20%nata» → 20, nata).
--   · raiz_producto_agente(text) → text: raíz simple en español: quita el
--     plural (-s; -es por la regla siguiente) y la vocal final a/e/o, de modo
--     que centollo = centolla = centollas = centoll, jamón = jamones = jamon,
--     tomate = tomates = tomat. Las palabras con cifras no se tocan.
--     Abreviaturas de factura: cg/cong/congelado → congel, fr/fresco → fresc,
--     ib/iber/ibérico → iberic, jam → jamon.
--   · raices_producto_agente(text) → text[]: las raíces de un nombre.
--   · compras_producto_agente(p_texto, p_desde, p_hasta, p_tipo, p_limite,
--     p_orden, p_excluir, p_embedding) → json. BÚSQUEDA en cascada, decidida
--     sobre TODAS las líneas (sin periodo ni tipo, para que «este año» no
--     caiga a una coincidencia peor):
--       1. exacta: todas las palabras buscadas están en el nombre
--          («jamón» → «JAMON JOSELITO G.R.», «nata» → «NATOP (20% nata…)»).
--       2. raiz: todas las raíces buscadas están entre las del nombre
--          («centollo» → «Centolla hembra»). Sin prefijos a propósito:
--          «salmon» NO encuentra «salmonete», «sal» NO «salsa».
--       3. aproximada (solo si 1-2 no dan nada): cada palabra buscada de
--          ≥ 4 letras casa con una del nombre de longitud ±2 y pg_trgm
--          similarity ≥ 0,4 («merlusa» → merluza, «centoya» → centolla,
--          «gamba» → GAMBON; «salmon» NO → salmonete). Va marcada: el
--          chatbot debe decir que no es el nombre exacto.
--       4. nada: sin sumas; `sugerencias` (≤ 5 nombres) por parecido
--          strict_word_similarity ≥ 0,3 y, si se pasa p_embedding, por
--          embedding ≥ 0,3
--          (coincidencia «semantica»). La semántica NUNCA suma: con
--          text-embedding-3-small dos productos distintos dan 0,5-0,66
--          (centolla~buey de mar 0,665, mayonesa~mermelada 0,50), así que
--          solo propone nombres para que el usuario confirme.
--     Palabras de relleno fuera de la búsqueda (de, la, kg, kilos, cajas,
--     botellas, ud…); p_excluir quita líneas cuyo nombre tenga esas raíces
--     («jamón» sin «caja»). Los servicios (portes, transporte…) no cuentan
--     salvo que se busquen.
--   AGREGACIÓN (sin mezclar unidades; importes de LÍNEA, SIN IVA):
--     total {importe, lineas, compras, proveedores}; por_unidad [{unidad,
--     cantidad, importe, precio_medio, lineas, compras, de_albaranes}];
--     por_proveedor [{proveedor, unidad, cantidad, importe, precio_medio,
--     compras, primera, ultima, tipo}] (proveedor agrupado por
--     proveedor_normalizado / normalizar_proveedor), ordenado por la unidad
--     de más importe y dentro por p_orden (importe | cantidad | precio,
--     precio = más barato primero); precio_medio = importe / cantidad solo
--     de las líneas con los dos (> 0), ponderado. productos_coincidentes
--     [{nombre tal cual (las que solo difieren en signos van juntas: «20% nata»
--     = «20%nata»), lineas, coincidencia si se mezclan}] (≤ 15,
--     variantes_total si hay más). `truncado` y `filas_total` si hay más
--     proveedores que p_limite (10 por defecto, máx. 50).
--   CRITERIO FACTURAS / ALBARANES: no hay vínculo albarán-factura. Por
--     defecto (p_tipo NULL) se suman los DOS —lo recibido—, porque muchas
--     compras solo constan en albarán (la centolla de Angelmar es un
--     albarán) y contar solo facturas diría «no has comprado centollo». Para
--     no contar dos veces el mismo pedido, NO se cuenta la línea de un
--     albarán si dentro del filtro hay una línea de FACTURA del mismo
--     proveedor (normalizado, o uno contiene al otro), mismo nombre
--     normalizado, misma unidad y misma cantidad, fechada entre 7 días antes
--     y 75 días después del albarán (avisos.albaranes_ya_facturados). Si se
--     cuentan albaranes, `incluye_albaranes` y `criterio` lo dicen y
--     por_unidad.de_albaranes da su parte. p_tipo 'factura' / 'albaran'
--     filtra.
--   AVISOS (solo si > 0): sin_importe (líneas sin precio: cuentan en la
--     cantidad, no en el importe ni en el precio medio), sin_cantidad,
--     fecha_dudosa (documentos con la fecha de subida), unidades_mezcladas,
--     albaranes_ya_facturados. Si el filtro lo deja todo fuera:
--     `sin_datos` y `fuera_del_filtro` {lineas, primera, ultima, productos}
--     («este año no; la última fue el 29/12/2025»).
--   Mismo patrón que las demás *_agente: SECURITY INVOKER, search_path
--   public, EXECUTE solo authenticated y service_role (nunca anon).
--
-- ESTADO VERIFICADO (producción, 07/10/2026): pg_trgm disponible 1.6 y NO
-- instalada; unaccent 1.1 en public; existen normalizar_texto,
-- normalizar_proveedor, fecha_dudosa_agente y es_linea_servicio_agente; no
-- existe compras_producto_agente. 165 líneas, 20 documentos.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; NO en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261007150000_chatbot_compras_producto.sql
--      Tiene que imprimir «chatbot_compras_producto: aplicada | {…centolla…}».
--   2. npx supabase db query --linked -f supabase/tests/chatbot_compras_producto_test.sql
--      Tiene que imprimir «chatbot_compras_producto: todas las comprobaciones han pasado».
--   3. npx supabase functions deploy chat-facturas
--      (la chat-facturas desplegada sigue funcionando sin esta migración y
--      con ella; la nueva necesita la migración APLICADA antes).
--   Deshacer: supabase/rollbacks/20261007150000_chatbot_compras_producto_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.compras_producto_agente(text,date,date,text,integer,text,text,vector)') is not null then
    raise notice 'Ya aplicada: se vuelven a crear las funciones (idempotente).';
  end if;
  if to_regprocedure('public.normalizar_texto(text)') is null
     or to_regprocedure('public.normalizar_proveedor(text)') is null
     or to_regprocedure('public.fecha_dudosa_agente(jsonb)') is null
     or to_regprocedure('public.es_linea_servicio_agente(text)') is null then
    raise exception 'MIGRACIÓN ABORTADA: faltan normalizar_texto / normalizar_proveedor / fecha_dudosa_agente / es_linea_servicio_agente. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    raise exception 'MIGRACIÓN ABORTADA: pg_trgm no está disponible. No se ha cambiado nada.';
  end if;
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
              where e.extname = 'pg_trgm' and n.nspname <> 'extensions') then
    raise exception 'MIGRACIÓN ABORTADA: pg_trgm ya está instalada fuera del esquema extensions; las funciones la llaman como extensions.word_similarity. No se ha cambiado nada.';
  end if;
end;
$$;

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Ayudantes de normalización
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.palabras_producto_agente(p_texto text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(w order by n) filter (where w <> ''), '{}'::text[])
    from regexp_split_to_table(
           regexp_replace(coalesce(normalizar_texto(p_texto), ''), '[^a-z0-9]+', ' ', 'g'),
           ' ') with ordinality as t(w, n)
$function$;

comment on function public.palabras_producto_agente(text) is
  'Chatbot de facturas: palabras de un nombre de producto (minúsculas, sin tildes ni signos).';

CREATE OR REPLACE FUNCTION public.raiz_producto_agente(p_palabra text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with s as (
    -- Plural: quita la -s final (no -ss). «jamones» → «jamone», que la vocal
    -- final deja en «jamon»; «tomates» → «tomate» → «tomat».
    select case when p_palabra ~ '[0-9]' then p_palabra
                when length(p_palabra) >= 4 and p_palabra ~ '[^s]s$' then left(p_palabra, -1)
                else p_palabra end as w
  ), r as (
    -- Género / vocal final: centollo = centolla = centoll.
    select case when p_palabra ~ '[0-9]' then w
                when length(w) >= 4 and w ~ '[aeo]$' then left(w, -1)
                else w end as w
      from s
  )
  select case
           when w in ('cg', 'cong', 'congel', 'congelad') then 'congel'
           when w in ('fr', 'fresc') then 'fresc'
           when w in ('ib', 'iber', 'iberic') then 'iberic'
           when w = 'jam' then 'jamon'
           else w
         end
    from r
$function$;

comment on function public.raiz_producto_agente(text) is
  'Chatbot de facturas: raíz simple en español (sin plural ni vocal final; centollo = centolla) y abreviaturas de factura (CG., FR., IB.).';

CREATE OR REPLACE FUNCTION public.raices_producto_agente(p_texto text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct raiz_producto_agente(w)), '{}'::text[])
    from unnest(palabras_producto_agente(p_texto)) w
$function$;

comment on function public.raices_producto_agente(text) is
  'Chatbot de facturas: raíces (raiz_producto_agente) de las palabras de un nombre de producto.';

-- ---------------------------------------------------------------------------
-- 2. compras_producto_agente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compras_producto_agente(
  p_texto text,
  p_desde date DEFAULT NULL::date,
  p_hasta date DEFAULT NULL::date,
  p_tipo text DEFAULT NULL::text,
  p_limite integer DEFAULT 10,
  p_orden text DEFAULT NULL::text,
  p_excluir text DEFAULT NULL::text,
  p_embedding vector DEFAULT NULL::vector)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  -- Relleno de la pregunta: no forma parte del producto («kilos de centollo»,
  -- «cajas de mayonesa»). Solo se quita del texto buscado, nunca del nombre.
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas'];
  c_max_variantes constant int := 15;
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_tipo   text;
  v_todas  text[] := palabras_producto_agente(p_texto);
  v_pal    text[];
  v_rai    text[];
  v_excl   text[];
  v_frase  text;
  v_serv   boolean;
  v_ids    bigint[];
  v_aprox  boolean := false;
  v_sug    jsonb;
  v_sem    boolean;
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

  v_pal := array(select w from unnest(v_todas) w where not (w = any(c_relleno)));
  if cardinality(v_pal) = 0 then
    v_pal := v_todas;   -- «cajas» a secas: se busca tal cual
  end if;
  if cardinality(v_pal) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_rai   := array(select distinct raiz_producto_agente(w) from unnest(v_pal) w);
  v_excl  := array(select distinct raiz_producto_agente(w)
                     from unnest(palabras_producto_agente(p_excluir)) w
                    where not (w = any(c_vacias)));   -- «caja» SÍ se puede excluir
  v_frase := array_to_string(v_pal, ' ');
  v_serv  := es_linea_servicio_agente(v_frase);

  -- ── 1-2. Exacta o por raíz (sobre TODAS las líneas: el periodo va luego) ──
  select array_agg(pf.id) into v_ids
    from productos_factura pf
   where raices_producto_agente(pf.nombre) @> v_rai
     and not (raices_producto_agente(pf.nombre) && v_excl)
     and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)));

  -- ── 3. Aproximada (erratas), solo si 1-2 no dieron nada: cada palabra
  --    buscada de ≥ 4 letras casa con una palabra del nombre de longitud
  --    parecida (±2) y trigram similarity ≥ 0,4 (merlusa ~ merluza 0,45,
  --    centoya ~ centolla 0,42); las cortas, por raíz. La longitud evita
  --    que «salmon» caiga en «salmonete» o «pan» en «panceta».
  if v_ids is null then
    select array_agg(pf.id) into v_ids
      from productos_factura pf
     where not exists (
             select 1 from unnest(v_pal) qw
              where not exists (
                select 1 from unnest(palabras_producto_agente(pf.nombre)) nw
                 where raiz_producto_agente(nw) = raiz_producto_agente(qw)
                    or (length(qw) >= 4 and abs(length(nw) - length(qw)) <= 2
                        and extensions.similarity(qw, nw) >= 0.4)))
       and not (raices_producto_agente(pf.nombre) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)));
    v_aprox := v_ids is not null;
  end if;

  -- ── 4. Nada: sugerencias (semánticas si hay embedding, y por parecido) ──
  if v_ids is null then
    -- Agrupadas por sus palabras: «(B/2K)» y «(B/ 2K)» son la misma.
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)
      into v_sug, v_sem
      from (
        select min(nombre) as nombre, min(pri) as pri, max(s) as s
          from (
            select pf.nombre::text as nombre, 1 as pri, max(1 - (pf.embedding <=> p_embedding)) as s
              from productos_factura pf
             where p_embedding is not null and pf.embedding is not null
             group by pf.nombre
            having max(1 - (pf.embedding <=> p_embedding)) >= 0.3
            union all
            select pf.nombre::text, 2,
                   max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' ')))
              from productos_factura pf
             group by pf.nombre
            having max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= 0.3
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
      'nota',         case when v_sug is not null then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados: pregunta si es alguno.' end
    ))::json;
  end if;

  -- ── Agregación ──
  with base as (
    select pf.id, pf.nombre::text as nombre,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(pf.unidad::text, ''), 'ud') as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo, f.fecha, f.proveedor,
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal as exacta
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where pf.id = any(v_ids)
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor: no se cuenta.
  ya_facturados as (
    select a.id
      from filtrada a
     where a.tipo = 'albaran'
       and exists (
         select 1 from filtrada x
          where x.tipo = 'factura'
            and x.unidad = a.unidad
            and x.cant = a.cant
            and x.nom_n = a.nom_n
            and (x.prov_n = a.prov_n
                 or (length(x.prov_n) >= 4 and length(a.prov_n) >= 4
                     and (position(x.prov_n in a.prov_n) > 0 or position(a.prov_n in x.prov_n) > 0)))
            and x.fecha between a.fecha - 7 and a.fecha + 75)
  ),
  c as (
    select * from filtrada where id not in (select id from ya_facturados)
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where imp > 0 and cant > 0)
             / nullif(sum(cant) filter (where imp > 0 and cant > 0), 0) as precio,
           count(*) as lineas,
           count(distinct doc) as compras,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           sum(cant) filter (where tipo = 'albaran') as cant_alb,
           sum(imp) filter (where tipo = 'albaran') as imp_alb
      from c
     group by unidad
  ),
  por_prov as (
    select prov_n, unidad,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where imp > 0 and cant > 0)
             / nullif(sum(cant) filter (where imp > 0 and cant > 0), 0) as precio,
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
           row_number() over (
             order by u.imp desc nulls last, u.cant desc nulls last, p.unidad,
                      case when v_orden = 'cantidad' then p.cant end desc nulls last,
                      case when v_orden = 'precio' then p.precio end asc nulls last,
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
           count(*) filter (where imp is null or imp = 0) as sin_importe,
           count(*) filter (where cant is null or cant = 0) as sin_cantidad,
           count(distinct doc) filter (where fd) as fecha_dudosa,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           coalesce(bool_and(exacta), false) as todas_exactas,
           coalesce(bool_or(exacta), false) as alguna_exacta
      from c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'buscado',  p_texto,
    'excluido', nullif(trim(coalesce(p_excluir, '')), ''),
    'periodo',  case when p_desde is not null or p_hasta is not null
                     then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
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
    'total', (
      select case when m.lineas > 0 then jsonb_build_object(
               'importe',     trim_scale(round(m.imp, 2)),
               'lineas',      m.lineas,
               'compras',     m.compras,
               'proveedores', m.proveedores) end
        from marco m),
    'por_unidad', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'unidad',       u.unidad,
               'cantidad',     trim_scale(round(u.cant, 3)),
               'importe',      trim_scale(round(u.imp, 2)),
               'precio_medio', trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)),
               'lineas',       u.lineas,
               'compras',      u.compras,
               'de_albaranes', case when u.lin_alb > 0 then jsonb_build_object(
                                 'cantidad', trim_scale(round(u.cant_alb, 3)),
                                 'importe',  trim_scale(round(u.imp_alb, 2))) end))
             order by u.imp desc nulls last, u.cant desc nulls last, u.unidad)
        from por_unidad u),
    'por_proveedor', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',    o.proveedor,
               'unidad',       o.unidad,
               'cantidad',     trim_scale(round(o.cant, 3)),
               'importe',      trim_scale(round(o.imp, 2)),
               'precio_medio', trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)),
               'compras',      o.compras,
               'primera',      o.primera,
               'ultima',       case when o.ultima <> o.primera then o.ultima end,
               'tipo',         o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'truncado',    (select case when max(n) > v_lim then true end from ordenada),
    'filas_total', (select case when max(n) > v_lim then max(n) end from ordenada),
    'incluye_albaranes', (select case when m.lin_alb > 0 then true end from marco m),
    'criterio', (
      select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Suma facturas y albaranes (lo recibido); no cuenta el albaran cuya linea ya esta en una factura del proveedor.' end
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
                        'productos', (select jsonb_agg(distinct b2.nombre) from (select nombre from base limit 5) b2)))
                 from base b) end
        from marco m)
  )) into resultado;

  return resultado::json;
end;
$function$;

comment on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector) is
  'Chatbot de facturas: compras de un producto (cuánto, a quién, a qué precio). Búsqueda exacta → raíz (centollo = centolla) → aproximada (pg_trgm) → sugerencias (trigram/embedding, sin sumar). Agrega por unidad y por proveedor sin mezclar unidades; importes de línea SIN IVA; suma facturas y albaranes salvo el albarán ya facturado (mismo proveedor, producto, unidad y cantidad, -7..+75 días).';

-- Permisos: como las demás *_agente.
revoke all on function public.palabras_producto_agente(text) from public, anon;
revoke all on function public.raiz_producto_agente(text) from public, anon;
revoke all on function public.raices_producto_agente(text) from public, anon;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector) from public, anon;
grant execute on function public.palabras_producto_agente(text) to authenticated, service_role;
grant execute on function public.raiz_producto_agente(text) to authenticated, service_role;
grant execute on function public.raices_producto_agente(text) to authenticated, service_role;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comprobaciones finales (si fallan, no se aplica nada). Contra la propia
-- tabla, para que valgan aunque cambien los datos.
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  n int;
  v_cant numeric;
  v_imp  numeric;
begin
  if raiz_producto_agente('centollo') <> raiz_producto_agente('centolla')
     or raiz_producto_agente('centollas') <> 'centoll'
     or raiz_producto_agente('jamones') <> 'jamon'
     or raiz_producto_agente('cg') <> 'congel'
     or raiz_producto_agente('tomates') <> raiz_producto_agente('tomate') then
    raise exception 'MIGRACIÓN ABORTADA: raiz_producto_agente no da las raíces esperadas.';
  end if;

  -- «centollo» encuentra todas las centollas en kg de la tabla y suma lo mismo.
  select sum(pf.cantidad) into v_cant
    from productos_factura pf
   where normalizar_texto(pf.nombre) ~ '\mcentoll(a|o|as|os)\M' and pf.unidad = 'kg';
  if v_cant is not null then
    j := compras_producto_agente('centollo')::jsonb;
    select sum((u ->> 'cantidad')::numeric) into v_imp
      from jsonb_array_elements(j -> 'por_unidad') u where u ->> 'unidad' = 'kg';
    if coalesce(j ->> 'coincidencia', '') not in ('raiz', 'exacta+raiz') or v_imp is distinct from v_cant then
      raise exception 'MIGRACIÓN ABORTADA: «centollo» no encuentra las centollas (tabla % kg): %', v_cant, j;
    end if;
  end if;

  -- Sin coincidencias: vacío, sin sumas.
  j := compras_producto_agente('zzqxw inexistente')::jsonb;
  if not (j ->> 'sin_datos')::boolean or j ? 'total' or j ? 'error' then
    raise exception 'MIGRACIÓN ABORTADA: búsqueda sin coincidencias: %', j;
  end if;

  -- Argumentos inválidos: error legible.
  if not compras_producto_agente('nata', '2026-02-01', '2026-01-01')::jsonb ? 'error'
     or not compras_producto_agente('nata', null, null, 'pedido')::jsonb ? 'error' then
    raise exception 'MIGRACIÓN ABORTADA: compras_producto_agente no valida argumentos.';
  end if;

  -- Ninguna ejecutable por anon.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('palabras_producto_agente', 'raiz_producto_agente', 'raices_producto_agente', 'compras_producto_agente')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then
    raise exception 'MIGRACIÓN ABORTADA: % funciones ejecutables por anon.', n;
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): tiene que salir «chatbot_compras_producto: aplicada | {…}».
select 'chatbot_compras_producto: aplicada | '
       || compras_producto_agente('centollo', '2025-01-01', '2026-12-31')::text as resultado;
