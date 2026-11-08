set client_encoding = 'UTF8';
-- 20261107600000_chat_facturas_busqueda_rapida (07/11/2026)
--
-- «¿Cuántos kilos de gamba roja he comprado y a cuánto el kilo?»: la herramienta
-- volumen_comprado del chatbot de Facturas tardaba ~8,5 s en la demo y PostgREST
-- corta a los 8 s (statement_timeout del rol authenticator): el copiloto decía
-- «no he podido consultar» con TODOS los modelos (docs/facturas/EVAL-MODELOS.md).
-- «aceite» o «merluza», 6-7 s.
--
-- Causa (medido en la demo, «gamba roja»): asociar_termino_agente 4,1 s y
-- lineas_producto_base_agente 1,0 s; lineas_producto_agente llama a las dos y
-- volumen_comprado_agente vuelve a llamar a asociar_termino_agente.
--   · asociar_termino_agente evaluaba raices_producto_agente(texto) por cada fila
--     del catálogo y otra vez por cada alias (EXISTS correlado). Es una función
--     SQL con SET search_path: Postgres no la «inlinea» ni la pliega a constante.
--   · lineas_producto_base_agente buscaba con un OR de tres condiciones por fila
--     (no usa el índice GIN) y llamaba a es_subproducto_agente por cada línea.
--
-- Ahora (mismo resultado; test: supabase/tests/chat_facturas_busqueda_rapida_test.sql,
-- que compara la versión vieja y la nueva con md5 para 20 textos):
--   · asociar_termino_agente: raíces calculadas una vez en variables.
--   · lineas_producto_base_agente: candidatas por GIN (raices_nombre), catálogo y
--     alias → líneas por producto_id; derivada/aproximada sobre el vocabulario.
-- lineas_producto_agente, volumen_comprado_agente y el resto de llamadores
-- (compras_producto_agente, historial_precios_agente, variacion_precios_agente,
-- serie_precios_agente, asociar_pregunta_agente) no cambian: se aceleran solos.
-- Rollback: supabase/rollbacks/20261107600000_chat_facturas_busqueda_rapida_ROLLBACK.sql
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.asociar_termino_agente(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261107100000_chat_facturas_asociacion: «cerveza» → familia Cervezas;
-- «cerveza de barril» → familia + formato barril; «gamba roja» → producto de
-- Marisco; «cruzcampo» → producto de Cervezas (por el catálogo); «mostaza de
-- cerveza» → producto de Despensa (el catálogo manda sobre la palabra suelta).
-- 20261107600000_chat_facturas_busqueda_rapida: raíces calculadas UNA vez
-- (antes raices_producto_agente se evaluaba por cada fila del catálogo y de los
-- alias: 2,5-4 s). Mismo resultado.
declare
  c_relleno constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'u', 'con', 'para', 'en', 'al', 'a', 'por', 'un', 'una',
    'unos', 'unas', 'mi', 'mis', 'me', 'te', 'se', 'su', 'sus', 'que', 'cual', 'cuales', 'como', 'donde', 'cuando',
    'cuanto', 'cuanta', 'cuantos', 'cuantas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'he', 'ha', 'hemos', 'han',
    'hay', 'es', 'son', 'estoy', 'estamos', 'tenemos', 'tengo', 'sale', 'salen', 'sali', 'cuesta', 'cuestan',
    'hazme', 'haz', 'dame', 'dime', 'ensename', 'muestrame', 'quiero', 'saber', 'compara', 'comparar', 'comparativa',
    'comparacion', 'frente', 'entre', 'contra', 'versus', 'vs', 'mas', 'menos', 'muy', 'caro', 'cara', 'caros', 'caras',
    'barato', 'barata', 'baratos', 'baratas', 'mejor', 'peor', 'precio', 'precios', 'coste', 'costo', 'importe', 'gasto',
    'gastos', 'gastado', 'gastamos', 'gaste', 'compra', 'compras', 'comprado', 'comprados', 'comprada', 'compradas',
    'compro', 'compramos', 'comprando', 'comprar', 'proveedor', 'proveedores', 'distribuidor', 'litro', 'litros', 'l',
    'lt', 'lts', 'kilo', 'kilos', 'kg', 'kgs', 'g', 'gr', 'gramo', 'gramos', 'ml', 'cl', 'unidad', 'unidades', 'ud', 'uds',
    'caja', 'cajas', 'formato', 'formatos', 'envase', 'envases', 'tipo', 'tipos', 'total', 'medio', 'media', 'cada',
    'todo', 'toda', 'todos', 'todas', 'ultimo', 'ultima', 'ultimos', 'ultimas', 'mes', 'meses', 'ano', 'anos', 'semana',
    'semanas', 'dia', 'dias', 'hoy', 'ayer', 'año', 'años', 'periodo', 'desde', 'hasta', 'euros', 'euro', 'iva', 'factura',
    'facturas', 'albaran', 'albaranes', 'documento', 'documentos', 'categoria', 'categorias', 'familia', 'familias',
    'producto', 'productos', 'marca', 'marcas', 'evolucion', 'variacion', 'subido', 'bajado', 'sin', 'si', 'no', 'y',
    'cuantas', 'vez', 'veces', 'ahora', 'antes', 'despues', 'otro', 'otra', 'otros', 'otras', 'tambien', 'solo'];
  v_pal  text[];
  v_txt  text[] := '{}';
  v_desc text[] := '{}';
  v_fams bigint[] := '{}';
  v_prod bigint[] := '{}';
  v_fmt  text;
  v_fmtc bigint;
  v_cat  bigint;
  v_tipo text;
  v_ori  text;
  w      text;
  t      record;
  k      record;
  v_rw   text;
  v_r    text[];
begin
  v_pal := array(select x from unnest(palabras_producto_agente(p_texto)) x where not (x = any(c_relleno)));
  foreach w in array v_pal loop
    v_rw := raiz_producto_agente(w);
    select tt.nivel, tt.formato, c.id as cid into t
      from terminos_agente tt
      left join categorias_producto c on c.clave = tt.categoria_clave and c.activa
     where tt.raices = array[v_rw]
     limit 1;
    if found then
      if t.formato is not null then
        v_fmt := coalesce(v_fmt, t.formato);
        if t.cid is null or t.nivel = 'familia' then   -- lata, botella / barril, tercio, caña
          if t.nivel = 'familia' then v_fmtc := coalesce(v_fmtc, t.cid); end if;
          continue;
        end if;
      end if;
      v_txt := v_txt || w;
      if t.nivel = 'familia' then v_fams := v_fams || t.cid; else v_prod := v_prod || t.cid; end if;
      continue;
    end if;
    -- Nombre de una categoría («conservas», «huevos», «embutidos»).
    select c.id into v_cat from categorias_producto c
     where c.activa and length(w) >= 4 and v_rw = any(raices_producto_agente(c.nombre))
     order by c.padre_id nulls last, c.id limit 1;
    v_txt := v_txt || w;
    if v_cat is not null then v_fams := v_fams || v_cat; v_cat := null; else v_desc := v_desc || w; end if;
  end loop;

  if cardinality(v_txt) = 0 then
    if v_fmtc is not null then
      v_tipo := 'familia'; v_cat := v_fmtc; v_ori := 'termino';
    else
      return json_build_object('tipo', case when v_fmt is not null then 'formato' else 'ninguno' end, 'formato', v_fmt);
    end if;
  elsif cardinality(v_desc) = 0 and cardinality(v_prod) = 0 then
    -- Solo palabras de familia: una familia, o la familia común («pescado y marisco»).
    select case when count(distinct x) = 1 then min(x) end into v_cat from unnest(v_fams) x;
    if v_cat is null then
      select case when count(distinct coalesce(c.padre_id, c.id)) = 1 then min(coalesce(c.padre_id, c.id)) end into v_cat
        from unnest(v_fams) x join categorias_producto c on c.id = x;
    end if;
    v_tipo := case when v_cat is not null then 'familia' else 'texto' end;
    v_ori := 'termino';
  else
    v_tipo := 'producto';
    v_r := raices_producto_agente(array_to_string(v_txt, ' '));
    -- El catálogo manda: «mostaza de cerveza» es de Despensa aunque diga cerveza.
    -- Sin Servicios: los envases retornables «Heineken» no hacen de Heineken un servicio.
    select z.cat, z.n, z.tot into k
      from (select pc.categoria_id as cat, count(*) as n, sum(count(*)) over () as tot
              from productos_catalogo pc
              join categorias_producto cc on cc.id = pc.categoria_id
             where cc.clave <> 'servicios' and coalesce(cc.padre_id, 0) <> (select id from categorias_producto where clave = 'servicios')
               and (pc.raices_nombre @> v_r
                    or pc.id in (select a.producto_id from productos_alias a where a.raices_texto @> v_r))
             group by 1) z
     order by z.n desc, z.cat limit 1;
    if k.cat is not null and k.n >= 0.6 * k.tot then
      v_cat := k.cat; v_ori := 'catalogo';
    elsif k.cat is not null then
      -- Varias categorías: la raíz común si la hay.
      select case when count(distinct coalesce(c.padre_id, c.id)) = 1 then min(coalesce(c.padre_id, c.id)) end into v_cat
        from productos_catalogo pc join categorias_producto c on c.id = pc.categoria_id
       where pc.raices_nombre @> v_r
         and c.clave <> 'servicios' and coalesce(c.padre_id, 0) <> (select id from categorias_producto where clave = 'servicios');
      v_ori := case when v_cat is not null then 'catalogo' end;
    end if;
    if v_cat is null then
      v_cat := coalesce(v_prod[1], v_fams[1], v_fmtc);
      v_ori := case when v_cat is not null then 'termino' end;
    end if;
    if v_cat is null then v_tipo := 'texto'; end if;
  end if;

  return (
    select json_build_object(
      'tipo', v_tipo,
      'categoria_id', c.id, 'categoria', c.nombre,
      'familia_id', coalesce(c.padre_id, c.id), 'familia', coalesce(p.nombre, c.nombre),
      'formato', v_fmt,
      'texto', case when v_tipo <> 'familia' then nullif(array_to_string(v_txt, ' '), '') end,
      'origen', v_ori)
      from (select 1) uno
      left join categorias_producto c on c.id = v_cat
      left join categorias_producto p on p.id = c.padre_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.lineas_producto_base_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105180000_productos_raices_precalculadas: raíces y palabras precalculadas por línea.
-- 20261107600000_chat_facturas_busqueda_rapida: mismo resultado, más rápido.
--   1. Texto: candidatas por el índice GIN de productos_factura.raices_nombre,
--      por el catálogo (productos_catalogo.raices_nombre → líneas por producto_id)
--      y por los alias (raices_texto → producto_id), en vez de un OR por fila.
--   2 y 3. Derivada / aproximada: las palabras que casan se buscan una vez en el
--      vocabulario (palabras distintas de líneas y catálogo) y las líneas se
--      filtran con && sobre palabras_nombre, en vez de raiz/similarity por fila.
--   es_subproducto_agente (SQL con SET search_path: no se «inlinea») solo se
--   llama si el nombre tiene alguna raíz de subproducto (raices_nombre && c_sub).
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

  -- 2. Derivada: cada raíz buscada es la palabra o su aumentativo/diminutivo
  --    (gamba → gambón, cebolla → cebollita). Sin -ino (langosta ≠ langostino)
  --    ni -ete (salmón ≠ salmonete).
  if v_ids is null then
    with voc as materialized (
           select v.w, raiz_producto_agente(v.w) as rz
             from (select unnest(palabras_nombre) as w from productos_factura
                   union
                   select unnest(palabras_nombre) from productos_catalogo) v),
         m as materialized (
           select r, coalesce(array_agg(voc.w) filter (where voc.w is not null), '{}'::text[]) as ws
             from unnest(v_rai) r
             left join voc on voc.rz = r
                           or (length(r) >= 4 and voc.w ~ ('^' || r || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))
            group by r)
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from m
              where not ((pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) && m.ws))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
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
    with voc as materialized (
           select v.w, raiz_producto_agente(v.w) as rz
             from (select unnest(palabras_nombre) as w from productos_factura
                   union
                   select unnest(palabras_nombre) from productos_catalogo) v),
         q as materialized (
           select distinct qw, raiz_producto_agente(qw) as rq from unnest(v_pal) qw),
         m as materialized (
           select q.qw, coalesce(array_agg(voc.w) filter (where voc.w is not null), '{}'::text[]) as ws
             from q
             left join voc on voc.rz = q.rq
                           or (length(q.qw) >= 4 and abs(length(voc.w) - length(q.qw)) <= 2
                               and extensions.similarity(q.qw, voc.w) >= 0.4)
            group by q.qw)
    select array_agg(pf.id order by pf.id) into v_ids
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
     where not exists (
             select 1 from m
              where not ((pf.palabras_nombre || coalesce(pc.palabras_nombre, '{}'::text[])) && m.ws))
       and not ((pf.raices_nombre || coalesce(pc.raices_nombre, '{}'::text[])) && v_excl)
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

revoke all on function public.asociar_termino_agente(text) from public, anon;
grant execute on function public.asociar_termino_agente(text) to authenticated, service_role;
revoke all on function public.lineas_producto_base_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_base_agente(text, text) to authenticated, service_role;

commit;

select 'chat_facturas_busqueda_rapida: aplicada' as resultado;
