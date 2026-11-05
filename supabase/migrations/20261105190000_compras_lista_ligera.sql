set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105190000_compras_lista_ligera — Facturas › Compras carga en < 1 s (05/11/2026)
-- ===========================================================================
-- PROBLEMA
--   La lista de Documentos pedía `facturas` con TODAS sus `productos_factura`
--   embebidas, por tandas de 1.000 y en serie: con el histórico (1.904
--   documentos, 12.456 líneas) eran ≈ 5,9 MB y ~8,5 s hasta tener la lista
--   completa. Las líneas solo hacían falta para tres cosas que se calculaban
--   en el navegador recorriéndolas todas: el aviso de precio atípico, el
--   «regalado» y la búsqueda por producto.
--
-- QUÉ HACE (solo lectura; SECURITY INVOKER: manda la RLS de Facturas)
--   1. documentos_lista(): TODAS las cabeceras en una respuesta compacta
--      (una fila = un array), con lo que la lista, los chips y los contadores
--      necesitan ya calculado en el servidor: nº de líneas, avisos (código y
--      severidad), regalado del documento y si tiene precio atípico.
--   2. buscar_documentos_compras(texto): ids de los documentos en los que
--      aparece CADA palabra buscada en la cabecera (número, proveedor, CIF,
--      observaciones) o en alguna línea (nombre o producto del catálogo).
--      Mismo criterio que el buscador del panel (sin tildes ni mayúsculas,
--      por trozos de palabra).
--   3. documento_compras(id): la ficha de UN documento con sus líneas, la
--      categoría de cada una y su precio de referencia (media del mismo
--      producto, mismo proveedor y mismo tipo de documento, sin ella misma).
--   Criterios idénticos a los del panel (formatters.tsx / resumenCompras.ts):
--   precio atípico = precio unitario > 2 × la media de las DEMÁS líneas con el
--   mismo nombre del mismo proveedor y tipo, sin portes ni cargos (servicios)
--   ni precios ≤ 0. Regalado = Σ (importe bruto − importe) > 0,005.
--   Idempotente. No cambia ningún dato.
-- ===========================================================================

set lock_timeout = '10s';
set statement_timeout = '10min';  -- añadir la columna reescribe productos_factura y recalcula TODAS sus columnas
                                  -- generadas (también raices_nombre): ~2 min con 12.500 líneas. Por psql, no
                                  -- por el API (corta a los 100 s; si se usa, comprobar en pg_stat_activity que acabó).

-- Texto para buscar y comparar: sin tildes, en minúsculas y con los espacios
-- colapsados (igual que normalizarBusqueda() / plano() del panel).
create or replace function public.texto_busqueda_compras(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_texto, ''))), '\s+', ' ', 'g'))
$$;

-- Línea que no es mercancía (portes, logística, punto verde…): la misma lista
-- que esLineaDeServicio() del panel. Recibe el texto ya normalizado.
create or replace function public.es_servicio_compras(p_normalizado text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(p_normalizado, '') ~
    '\y(portes?|transportes?|envios?|gastos? de (envio|gestion|transporte)|gestion y logistica|logistica|punto verde|ecoembes|canon|recargos?|fianzas?|depositos?)\y'
$$;

-- Nombre de cada línea ya normalizado (columna GENERADA: se mantiene sola al
-- insertar o renombrar). Agrupar precios y buscar no recalcula 12.500 nombres.
alter table public.productos_factura
  add column if not exists nombre_busqueda text generated always as (public.texto_busqueda_compras(nombre::text)) stored;

-- ─── 1. La lista ────────────────────────────────────────────────────────────
-- { v: 1, proveedores: { "<id>": "<nombre>" }, docs: [[…], …] }
-- Cada documento (del más reciente al más antiguo) es un array en este orden:
--   0 id · 1 tipo · 2 numero_documento · 3 proveedor · 4 proveedor_id · 5 cif ·
--   6 fecha · 7 facturado_en_id · 8 local · 9 subtotal · 10 total ·
--   11 total_origen · 12 drive_url · 13 archivo_path · 14 verificada ·
--   15 verificacion_origen · 16 nº de líneas · 17 avisos [[codigo, severidad]…] o null ·
--   18 regalado [importe sin IVA, estimado, nº de regalos] o null · 19 precio atípico
create or replace function public.documentos_lista()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  with lineas as (
    select pf.factura_id,
           pf.importe_bruto,
           pf.importe_bruto_estimado,
           pf.importe_bruto - coalesce(pf.total, coalesce(pf.precio_unitario, 0) * coalesce(pf.cantidad, 0)) as diferencia,
           coalesce(pf.total, coalesce(pf.precio_unitario, 0) * coalesce(pf.cantidad, 0)) as importe
      from productos_factura pf
  ),
  por_doc as (
    select factura_id,
           count(*) as n,
           sum(diferencia) filter (where diferencia > 0.005) as regalado,
           coalesce(bool_or(importe_bruto_estimado) filter (where diferencia > 0.005), false) as estimado,
           count(*) filter (where diferencia > 0.005 and importe_bruto > 0.005 and abs(importe) < 0.005) as regalos
      from lineas
     group by factura_id
  ),
  precios as (
    select pf.factura_id, f.tipo, f.proveedor_normalizado as prov,
           pf.nombre_busqueda as nom, pf.precio_unitario as p
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where coalesce(f.proveedor_normalizado, '') <> ''
       and pf.precio_unitario > 0
  ),
  medias as (
    select tipo, prov, nom, sum(p) as suma, count(*) as n
      from precios
     group by tipo, prov, nom
    having count(*) > 1
  ),
  candidatos as materialized (
    select pr.factura_id, pr.nom
      from precios pr
      join medias m using (tipo, prov, nom)
     where pr.p > 2 * (m.suma - pr.p) / (m.n - 1)
  ),
  atipicos as (
    -- Los portes y cargos no cuentan (se mira solo en los pocos candidatos).
    select distinct c.factura_id from candidatos c where not public.es_servicio_compras(c.nom)
  )
  select json_build_object(
    'v', 1,
    'proveedores', coalesce((
      select json_object_agg(p.id, p.nombre)
        from proveedores p
       where p.id in (select f.proveedor_id from facturas f where f.proveedor_id is not null)
    ), '{}'::json),
    'docs', coalesce((
      select json_agg(json_build_array(
               f.id, f.tipo, f.numero_documento, f.proveedor, f.proveedor_id, f.cif,
               f.fecha, f.facturado_en_id, f.local, f.subtotal, f.total,
               f.total_origen, f.drive_url, f.archivo_path, coalesce(f.verificada, false), f.verificacion_origen,
               coalesce(d.n, 0),
               case when jsonb_typeof(f.alertas_validacion) = 'array' and jsonb_array_length(f.alertas_validacion) > 0 then
                 (select json_agg(json_build_array(a ->> 'codigo', a ->> 'severidad'))
                    from jsonb_array_elements(f.alertas_validacion) a)
               end,
               case when d.regalado > 0 then json_build_array(round(d.regalado, 2), d.estimado, d.regalos) end,
               a.factura_id is not null
             ) order by f.fecha desc nulls last, f.id desc)
        from facturas f
        left join por_doc d on d.factura_id = f.id
        left join atipicos a on a.factura_id = f.id
    ), '[]'::json)
  )
$$;

-- ─── 2. Buscar por producto / línea ─────────────────────────────────────────
create or replace function public.buscar_documentos_compras(p_texto text)
returns bigint[]
language sql
stable
security invoker
set search_path = public
as $$
  -- Una palabra no tiene espacios, así que para saber si está DENTRO de un texto
  -- basta con quitarle tildes y mayúsculas (colapsar espacios no cambia nada).
  with palabras as (
    select coalesce(array_agg(distinct w), '{}'::text[]) as ws
      from unnest(string_to_array(public.texto_busqueda_compras(left(p_texto, 200)), ' ')) w
     where w <> ''
  ),
  catalogo as (
    select pc.id, lower(public.unaccent('public.unaccent'::regdictionary, pc.nombre)) as t
      from productos_catalogo pc
  ),
  coincidencias as (
    -- Cabecera: número, proveedor, CIF y observaciones.
    select f.id, w
      from facturas f, palabras p, unnest(p.ws) w
     where position(w in lower(public.unaccent('public.unaccent'::regdictionary,
             concat_ws(' ', f.numero_documento, f.proveedor, f.cif, f.observaciones)))) > 0
    union
    -- Líneas: su nombre o el de su producto del catálogo.
    select pf.factura_id, w
      from productos_factura pf
      left join catalogo c on c.id = pf.producto_id
      cross join palabras p
      cross join unnest(p.ws) w
     where position(w in pf.nombre_busqueda) > 0
        or position(w in coalesce(c.t, '')) > 0
  )
  select coalesce(array_agg(x.id order by x.id), '{}'::bigint[])
    from (
      select c.id
        from coincidencias c
       group by c.id
      having count(distinct c.w) = (select cardinality(ws) from palabras)
    ) x
$$;

-- ─── 3. La ficha de un documento ───────────────────────────────────────────
-- Cabecera completa + líneas (en el orden impreso: por id) con categoría y
-- `media_referencia` (null = sin con qué comparar, servicio o sin proveedor).
-- null si el documento no existe o no se puede ver.
create or replace function public.documento_compras(p_id bigint)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  with doc as (
    select f.id, f.tipo, f.numero_documento, f.proveedor, f.proveedor_normalizado, f.proveedor_id, f.cif, f.fecha,
           f.facturado_en_id, f.local, f.subtotal, f.iva, f.total, f.total_origen, f.observaciones, f.drive_url,
           f.archivo_path, f.alertas_validacion, f.procesado_en, f.created_at, f.verificada, f.verificacion_origen
      from facturas f
     where f.id = p_id
  ),
  referencia as (
    select pf.nombre_busqueda as nom, sum(pf.precio_unitario) as suma, count(*) as n
      from doc
      join facturas f2 on f2.tipo = doc.tipo and f2.proveedor_normalizado = doc.proveedor_normalizado
      join productos_factura pf on pf.factura_id = f2.id
     where coalesce(doc.proveedor_normalizado, '') <> ''
       and pf.precio_unitario > 0
     group by 1
  ),
  lineas as (
    select pf.id, pf.nombre, pf.precio_unitario, pf.cantidad, pf.unidad, pf.total, pf.bultos,
           pf.descuento_pct, pf.importe_bruto, pf.importe_bruto_estimado, pf.producto_id,
           pc.nombre as canonico, c.nombre as categoria, cp.nombre as categoria_padre,
           pf.nombre_busqueda as nom
      from productos_factura pf
      left join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join categorias_producto cp on cp.id = c.padre_id
     where pf.factura_id = p_id
  )
  select json_build_object(
    'id', d.id, 'tipo', d.tipo, 'numero_documento', d.numero_documento, 'proveedor', d.proveedor,
    'proveedor_normalizado', d.proveedor_normalizado, 'proveedor_id', d.proveedor_id, 'cif', d.cif, 'fecha', d.fecha,
    'facturado_en_id', d.facturado_en_id, 'local', d.local, 'subtotal', d.subtotal, 'iva', d.iva, 'total', d.total,
    'total_origen', d.total_origen, 'observaciones', d.observaciones, 'drive_url', d.drive_url,
    'archivo_path', d.archivo_path, 'alertas_validacion', d.alertas_validacion, 'procesado_en', d.procesado_en,
    'created_at', d.created_at, 'verificada', d.verificada, 'verificacion_origen', d.verificacion_origen,
    'productos', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'nombre', l.nombre, 'precio_unitario', l.precio_unitario, 'cantidad', l.cantidad,
               'unidad', l.unidad, 'total', l.total, 'bultos', l.bultos, 'descuento_pct', l.descuento_pct,
               'importe_bruto', l.importe_bruto, 'importe_bruto_estimado', l.importe_bruto_estimado,
               'producto_id', l.producto_id, 'producto_canonico', l.canonico,
               'categoria', case when l.categoria is null then null else json_build_object(
                 'nombre', l.categoria,
                 'ruta', case when l.categoria_padre is null then l.categoria else l.categoria_padre || ' › ' || l.categoria end) end,
               'media_referencia', case
                 when coalesce(d.proveedor_normalizado, '') = '' or public.es_servicio_compras(l.nom) then null
                 else (r.suma - case when l.precio_unitario > 0 then l.precio_unitario else 0 end)
                      / nullif(r.n - case when l.precio_unitario > 0 then 1 else 0 end, 0)
               end
             ) order by l.id)
        from lineas l
        left join referencia r on r.nom = l.nom
    ), '[]'::json)
  )
  from doc d
$$;

-- ─── Permisos: solo usuarios del panel (la RLS decide qué ven) ──────────────
revoke all on function public.texto_busqueda_compras(text) from public, anon;
revoke all on function public.es_servicio_compras(text) from public, anon;
revoke all on function public.documentos_lista() from public, anon;
revoke all on function public.buscar_documentos_compras(text) from public, anon;
revoke all on function public.documento_compras(bigint) from public, anon;
grant execute on function public.texto_busqueda_compras(text) to authenticated, service_role;
grant execute on function public.es_servicio_compras(text) to authenticated, service_role;
grant execute on function public.documentos_lista() to authenticated, service_role;
grant execute on function public.buscar_documentos_compras(text) to authenticated, service_role;
grant execute on function public.documento_compras(bigint) to authenticated, service_role;
