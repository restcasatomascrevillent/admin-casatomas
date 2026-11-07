set client_encoding = 'UTF8';
-- ROLLBACK de 20261107600000_chat_facturas_busqueda_rapida.
-- Vuelve asociar_termino_agente y lineas_producto_base_agente a la versión de
-- 20261107100000 (copiadas tal cual de la demo el 07/11/2026). No toca datos.
-- La búsqueda por texto vuelve a tardar 3-8 s (volumen_comprado de «gamba roja»
-- vuelve a cortarse a los 8 s en PostgREST).
--   supabase db query --linked -f supabase/rollbacks/20261107600000_chat_facturas_busqueda_rapida_ROLLBACK.sql
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
begin
  v_pal := array(select x from unnest(palabras_producto_agente(p_texto)) x where not (x = any(c_relleno)));
  foreach w in array v_pal loop
    select tt.nivel, tt.formato, c.id as cid into t
      from terminos_agente tt
      left join categorias_producto c on c.clave = tt.categoria_clave and c.activa
     where tt.raices = array[raiz_producto_agente(w)]
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
     where c.activa and length(w) >= 4 and raiz_producto_agente(w) = any(raices_producto_agente(c.nombre))
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
    -- El catálogo manda: «mostaza de cerveza» es de Despensa aunque diga cerveza.
    -- Sin Servicios: los envases retornables «Heineken» no hacen de Heineken un servicio.
    select z.cat, z.n, z.tot into k
      from (select pc.categoria_id as cat, count(*) as n, sum(count(*)) over () as tot
              from productos_catalogo pc
              join categorias_producto cc on cc.id = pc.categoria_id
             where cc.clave <> 'servicios' and coalesce(cc.padre_id, 0) <> (select id from categorias_producto where clave = 'servicios')
               and (pc.raices_nombre @> raices_producto_agente(array_to_string(v_txt, ' '))
                    or exists (select 1 from productos_alias a where a.producto_id = pc.id
                                  and a.raices_texto @> raices_producto_agente(array_to_string(v_txt, ' '))))
             group by 1) z
     order by z.n desc, z.cat limit 1;
    if k.cat is not null and k.n >= 0.6 * k.tot then
      v_cat := k.cat; v_ori := 'catalogo';
    elsif k.cat is not null then
      -- Varias categorías: la raíz común si la hay.
      select case when count(distinct coalesce(c.padre_id, c.id)) = 1 then min(coalesce(c.padre_id, c.id)) end into v_cat
        from productos_catalogo pc join categorias_producto c on c.id = pc.categoria_id
       where pc.raices_nombre @> raices_producto_agente(array_to_string(v_txt, ' '))
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
$function$;

revoke all on function public.asociar_termino_agente(text) from public, anon;
grant execute on function public.asociar_termino_agente(text) to authenticated, service_role;
revoke all on function public.lineas_producto_base_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_base_agente(text, text) to authenticated, service_role;

commit;
select 'chat_facturas_busqueda_rapida: deshecha' as resultado;
