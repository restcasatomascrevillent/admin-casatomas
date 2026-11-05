set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105180000_productos_raices_precalculadas — buscar un producto rápido (05/11/2026)
-- ===========================================================================
-- PROBLEMA
--   lineas_producto_agente (usada por serie_precios_agente, compras_producto_agente,
--   historial_precios_agente, variacion_precios_agente… y por el «Precio de un
--   producto» de Análisis y la IA) calculaba raices_producto_agente(nombre) y
--   palabras_producto_agente(nombre) de TODAS las líneas en cada búsqueda:
--   ~0,8 ms por línea × 12.500 líneas del histórico × 2-3 veces ≈ 23 s. El panel
--   corta a los 8 s (statement_timeout) → «No se ha podido leer el precio».
--
-- QUÉ HACE
--   1. Columnas GENERADAS (STORED) con las raíces y palabras ya calculadas:
--      productos_factura.raices_nombre / palabras_nombre,
--      productos_catalogo.raices_nombre / palabras_nombre,
--      productos_alias.raices_texto. Las funciones son IMMUTABLE, así que se
--      mantienen solas al insertar o cambiar el nombre. Índice GIN en
--      productos_factura.raices_nombre.
--   2. lineas_producto_agente: mismo algoritmo y mismo resultado, leyendo esas
--      columnas en vez de recalcular.
--   Idempotente. No cambia ningún dato visible.
-- ===========================================================================

set lock_timeout = '10s';
set statement_timeout = '10min';  -- calcular las columnas de ~12.500 líneas tarda ~20 s

alter table public.productos_factura
  add column if not exists raices_nombre text[] generated always as (public.raices_producto_agente(nombre::text)) stored,
  add column if not exists palabras_nombre text[] generated always as (public.palabras_producto_agente(nombre::text)) stored;
alter table public.productos_catalogo
  add column if not exists raices_nombre text[] generated always as (public.raices_producto_agente(nombre::text)) stored,
  add column if not exists palabras_nombre text[] generated always as (public.palabras_producto_agente(nombre::text)) stored;
alter table public.productos_alias
  add column if not exists raices_texto text[] generated always as (public.raices_producto_agente(texto_normalizado::text)) stored;

create index if not exists productos_factura_raices_nombre_gin on public.productos_factura using gin (raices_nombre);

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

select 'productos_raices_precalculadas: aplicada | lineas ' || count(*) filter (where raices_nombre is not null) || '/' || count(*) as resultado
  from public.productos_factura;
