set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · chatbot ronda 8 («el cocinero»): buscador único de       ##
-- ##   producto, vínculo albarán→factura, unidades, ficha de proveedor,    ##
-- ##   IVA por tipo y serie de precios para la gráfica (08/10/2026)        ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (prueba de la ronda 8): el modelo mandaba tipo='factura' a
-- gasto_por_categoria (marisco 39,80 € en vez de 1.353,85 €); historial y
-- variación buscaban el producto de otra forma que compras (gambas no daba el
-- Gambón, surimi no daba «CG. PUNTAS Y RECORTE KRISSIA», salmonete daba
-- espinas); y el dueño pide no contar dos veces albarán y factura y no
-- comparar precios en unidades distintas. Indicación permanente: SQL precisa,
-- reglas cortas, ahorrar tokens.
--
-- DEPENDE DE (aplicadas): 20261007150000, 20261007170000, 20261007180000,
-- 20261008100000.
--
-- QUÉ CAMBIA
--   Tablas:
--   · facturas.facturado_en_id (albarán → factura que lo incluye). Lo rellenan
--     dos triggers (facturas y productos_factura) y aquí se rellena con lo que
--     ya hay: albaran_ref de las líneas de la factura o número del albarán,
--     normalizados (sin «V/», puntos, espacios ni ceros a la izquierda), y el
--     mismo proveedor canónico (proveedor_id). Hoy no vincula nada (no hay
--     solapes), pero Luga ML/101511 trae 8 referencias.
--   · mensajes_chat.adjuntos jsonb, expuesta al final de la vista
--     chat_facturas_mensajes (sigue security_invoker y actualizable).
--   Funciones nuevas (SECURITY INVOKER salvo las de vínculo):
--   · numero_documento_normalizado, unidad_agente (kg, ud, caja, l, m),
--     es_subproducto_agente, lineas_producto_agente (buscador único).
--   · ficha_proveedor_agente(p_texto), serie_precios_agente(p_texto, p_desde,
--     p_hasta, p_unidad) — contrato con la UI de la gráfica.
--   · vincular_albaranes_proveedor + 2 funciones de trigger (SECURITY DEFINER,
--     sin EXECUTE para nadie).
--   RPC reescritas:
--   · compras_producto_agente: + p_unidad (firma nueva: DROP + CREATE),
--     buscador único, por_proveedor con ultima, ultimo_precio, precio_min y
--     precio_max, sin líneas a 0 €, sin albaranes facturados y total con
--     en_facturas / en_albaranes_sin_factura.
--   · historial_precios_agente: buscador único, filas idénticas agrupadas,
--     proveedor canónico, comparativa por proveedor y unidad.
--   · variacion_precios_agente: producto con el buscador único.
--   · lineas_precio_agente: sin albaranes facturados.
--   · ranking_agente: + p_unidad y p_categoria (firma nueva), sin albaranes
--     facturados.
--   · gasto_categorias_agente: sin albaranes facturados, total con reparto.
--   · consulta_flexible_agente: agrupar 'iva_pct' (base y cuota por tipo).
--   Antes de cambiar nada comprueba el md5 (sin CR) de las 7 definiciones de
--   producción (o la marca de esta migración: se puede ejecutar dos veces).
--
-- PASOS (desde adminpanelct/, POR TERMINAL; NO en el SQL Editor):
--   1. npx supabase db query --linked -f supabase/migrations/20261008120000_chatbot_ronda8_cocinero.sql
--      Tiene que imprimir «chatbot_ronda8_cocinero: aplicada | marisco
--      1353.85 | gambas GAMBON ZARADO XXL (C/2K- 45U aprox) -Gegarri- |
--      surimi 2 | salmonete solo_subproductos». Simulacro con ROLLBACK
--      contra producción el 08/10/2026: migración (dos veces) + test +
--      rollback OK.
--   2. npx supabase db query --linked -f supabase/tests/chatbot_ronda8_cocinero_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «chatbot_ronda8_cocinero_test: OK».
--   3. npx supabase functions deploy chat-facturas --project-ref jeamoczmbfsnwkfjxcyo
--   Deshacer: supabase/rollbacks/20261008120000_chatbot_ronda8_cocinero_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa ────────────────────────────────────────────────
do $$
declare
  r record;
  v_def text;
begin
  if to_regclass('public.proveedores') is null or to_regclass('public.mensajes_chat') is null
     or to_regclass('public.chat_facturas_mensajes') is null then
    raise exception 'chatbot_ronda8_cocinero: faltan proveedores, mensajes_chat o chat_facturas_mensajes. No se ha cambiado nada.';
  end if;
  for r in select * from (values
    ('compras_producto_agente(text, date, date, text, integer, text, text, vector)',
     'compras_producto_agente(text, date, date, text, integer, text, text, vector, text)', '89d326d18d6ca6cdba7c439edc33833b'),
    ('ranking_agente(text, text, integer, date, date, text, boolean)',
     'ranking_agente(text, text, integer, date, date, text, boolean, text, text)', 'cc7a17968fc5d9e898b550f36b96fd73'),
    ('historial_precios_agente(text, integer)', null, '3d1793a5c9e9508d008cd53a72fd96c6'),
    ('variacion_precios_agente(date, date, numeric, text, text, integer, text)', null, '62a98fde7dd2440af39172ba3f1b55e5'),
    ('lineas_precio_agente(bigint, bigint[])', null, 'd2072826ea7517dc15919c91a9c9fa27'),
    ('gasto_categorias_agente(text, date, date, text, text)', null, '59266604303f44c2a5c6529dc59be166'),
    ('consulta_flexible_agente(jsonb)', null, '100778a67622de7b309394a50818d2f3')
  ) t(fn, fn_nueva, md5) loop
    v_def := replace(pg_get_functiondef(to_regprocedure('public.' || r.fn)), chr(13), '');
    if v_def is null and r.fn_nueva is not null then
      -- Firma cambiada en una ejecución anterior: vale si la nueva lleva la marca.
      v_def := replace(pg_get_functiondef(to_regprocedure('public.' || r.fn_nueva)), chr(13), '');
      if v_def is not null and position('20261008120000_chatbot_ronda8_cocinero' in v_def) > 0 then
        continue;
      end if;
    end if;
    if v_def is null then
      raise exception 'chatbot_ronda8_cocinero: no existe %. No se ha cambiado nada.', r.fn;
    end if;
    if md5(v_def) <> r.md5 and position('20261008120000_chatbot_ronda8_cocinero' in v_def) = 0 then
      raise exception 'chatbot_ronda8_cocinero: % no es la esperada (md5 %). No se ha cambiado nada.', r.fn, md5(v_def);
    end if;
  end loop;
end;
$$;

-- ─── 1. Columnas ───────────────────────────────────────────────────────────
alter table public.facturas
  add column if not exists facturado_en_id bigint references public.facturas(id) on delete set null;
comment on column public.facturas.facturado_en_id is
  'Albarán: factura que lo incluye (albaran_ref de sus líneas o número, normalizados, y mismo proveedor_id). '
  'Lo mantienen los triggers trg_facturas_vincular_albaranes y trg_productos_factura_vincular_albaranes. '
  'El chatbot no cuenta un albarán con este campo relleno (20261008120000).';
create index if not exists facturas_facturado_en_id_idx on public.facturas (facturado_en_id)
  where facturado_en_id is not null;

alter table public.mensajes_chat add column if not exists adjuntos jsonb;
comment on column public.mensajes_chat.adjuntos is
  'Adjuntos de la respuesta del chatbot de facturas, p. ej. [{tipo:''serie_precio'', datos:<serie_precios_agente>}] (20261008120000).';

create or replace view public.chat_facturas_mensajes with (security_invoker = on) as
 SELECT id,
    conversacion_id,
    session_id,
    role AS rol,
    content AS contenido,
    created_at,
    adjuntos
   FROM mensajes_chat;

-- ─── 2. Utilidades ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.numero_documento_normalizado(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 20261008120000_chatbot_ronda8_cocinero: «V/ 775.630» = «775630» = «0775630».
  select nullif(ltrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '^\s*v\s*/', ''), '[^a-z0-9]', '', 'g'), '0'), '')
$function$;

CREATE OR REPLACE FUNCTION public.unidad_agente(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 20261008120000_chatbot_ronda8_cocinero: unidad legible y comparable (kg, ud, caja, l, m).
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when lower(btrim(p)) ~ '^(kg|kgs|kilo|kilos|kilogramos?)$' then 'kg'
    when lower(btrim(p)) ~ '^(ud|uds|u|un|und|unid|unidad|unidades|pieza|piezas)$' then 'ud'
    when lower(btrim(p)) ~ '^(ca|caj|cj|caja|cajas)$' then 'caja'
    when lower(btrim(p)) ~ '^(l|lt|lts|litro|litros)$' then 'l'
    when lower(btrim(p)) ~ '^(m|metro|metros)$' then 'm'
    else lower(btrim(p)) end
$function$;

CREATE OR REPLACE FUNCTION public.es_subproducto_agente(p_nombre text, p_raices text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 20261008120000_chatbot_ronda8_cocinero: subproducto = la palabra de
  -- subproducto va ANTES que lo buscado («espinas de salmonete»); en «Surimi
  -- Krissia puntas y recortes» va después y no lo es.
  with w as (
    select raiz_producto_agente(x) as r, n
      from unnest(palabras_producto_agente(p_nombre)) with ordinality t(x, n))
  select coalesce(
    (select min(n) from w
      where r = any(array['espin', 'rasp', 'recort', 'retal', 'cabez', 'carcas', 'hues', 'despoj', 'piel', 'cascar']))
      < coalesce((select min(n) from w where r = any(p_raices)), 1000000),
    false)
$function$;

-- ─── 3. Buscador único de producto ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lineas_producto_agente(p_texto text, p_excluir text DEFAULT NULL::text)
 RETURNS TABLE(ids bigint[], metodo text, subproductos text[], palabras text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: buscador único de producto
-- (compras_producto, historial_precios, variacion_precios, serie_precios).
-- En cascada: 1) texto: todas las raíces en el nombre de la línea, en el de su
-- producto del catálogo o en un alias (centollo = Centolla; «helado de
-- frambuesa» = la línea «Frambuesa»; surimi = «CG. PUNTAS Y RECORTE
-- KRISSIA»); 2) derivada: aumentativo/diminutivo (gambas = Gambón); 3)
-- aproximada: erratas por trigramas (merlusa ~ merluza). Sin servicios salvo
-- que se pidan; sin subproductos (espinas de salmonete, recortes…) salvo que se
-- pidan: sus nombres van en «subproductos».
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
               case when raices_producto_agente(pf.nombre) @> v_rai or pc.nombre is null
                    then pf.nombre::text else pc.nombre end, v_rai) as es_sub
        from productos_factura pf
        left join productos_catalogo pc on pc.id = pf.producto_id
       where (raices_producto_agente(pf.nombre) @> v_rai
              or raices_producto_agente(pc.nombre) @> v_rai
              or exists (select 1 from productos_alias a
                          where a.producto_id = pf.producto_id
                            and raices_producto_agente(a.texto_normalizado) @> v_rai))
         and not ((raices_producto_agente(pf.nombre) || raices_producto_agente(pc.nombre)) && v_excl)
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
                select 1 from unnest(palabras_producto_agente(pf.nombre) || palabras_producto_agente(pc.nombre)) nw
                 where raiz_producto_agente(nw) = r
                    or (length(r) >= 4 and nw ~ ('^' || r || '(on|ones|ito|itos|ita|itas|illo|illos|illa|illas)$'))))
       and not ((raices_producto_agente(pf.nombre) || raices_producto_agente(pc.nombre)) && v_excl)
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
                select 1 from unnest(palabras_producto_agente(pf.nombre) || palabras_producto_agente(pc.nombre)) nw
                 where raiz_producto_agente(nw) = raiz_producto_agente(qw)
                    or (length(qw) >= 4 and abs(length(nw) - length(qw)) <= 2
                        and extensions.similarity(qw, nw) >= 0.4)))
       and not ((raices_producto_agente(pf.nombre) || raices_producto_agente(pc.nombre)) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)))
       and (v_sub or not es_subproducto_agente(coalesce(pc.nombre, pf.nombre::text), v_rai));
    if v_ids is not null then
      v_met := 'aproximada';
    end if;
  end if;

  return query select v_ids, v_met, v_subs, v_pal;
end;
$function$;

-- ─── 4. Vínculo albarán → factura ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vincular_albaranes_proveedor(p_proveedor_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: rehace facturado_en_id de los
-- albaranes de UN proveedor canónico. Vínculo: el número del albarán
-- normalizado = un albaran_ref normalizado de una línea de una factura del
-- mismo proveedor_id (la más reciente si hay varias).
declare
  n int;
begin
  if p_proveedor_id is null then
    return 0;
  end if;
  with v as (
    select a.id,
           (select fx.id
              from productos_factura l
              join facturas fx on fx.id = l.factura_id
             where fx.tipo = 'factura'
               and fx.proveedor_id = a.proveedor_id
               and numero_documento_normalizado(l.albaran_ref) = numero_documento_normalizado(a.numero_documento)
             order by fx.fecha desc nulls last, fx.id desc
             limit 1) as fid
      from facturas a
     where a.tipo = 'albaran' and a.proveedor_id = p_proveedor_id
  )
  update facturas a set facturado_en_id = v.fid
    from v
   where a.id = v.id and a.facturado_en_id is distinct from v.fid;
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_facturas_vincular_albaranes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: alta o cambio de número, proveedor o tipo.
begin
  perform vincular_albaranes_proveedor(new.proveedor_id);
  if tg_op = 'UPDATE' and old.proveedor_id is distinct from new.proveedor_id then
    perform vincular_albaranes_proveedor(old.proveedor_id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_productos_factura_vincular_albaranes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: líneas con albaran_ref (alta, cambio o borrado).
begin
  if tg_op in ('INSERT', 'UPDATE') and new.albaran_ref is not null then
    perform vincular_albaranes_proveedor((select f.proveedor_id from facturas f where f.id = new.factura_id));
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.albaran_ref is not null then
    perform vincular_albaranes_proveedor((select f.proveedor_id from facturas f where f.id = old.factura_id));
  end if;
  return null;
end;
$function$;

-- Después de trg_facturas_asignar_proveedor (BEFORE: pone proveedor_id).
drop trigger if exists trg_facturas_vincular_albaranes on public.facturas;
create trigger trg_facturas_vincular_albaranes
  after insert or update of numero_documento, proveedor_id, tipo on public.facturas
  for each row execute function public.trg_facturas_vincular_albaranes();
drop trigger if exists trg_productos_factura_vincular_albaranes on public.productos_factura;
create trigger trg_productos_factura_vincular_albaranes
  after insert or update of albaran_ref, factura_id or delete on public.productos_factura
  for each row execute function public.trg_productos_factura_vincular_albaranes();

-- Relleno con lo que ya existe.
select vincular_albaranes_proveedor(id) from public.proveedores;

-- ─── 5. lineas_precio_agente (variación de precios): sin albaranes facturados
CREATE OR REPLACE FUNCTION public.lineas_precio_agente(p_producto_id bigint DEFAULT NULL::bigint, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(id bigint, factura_id bigint, producto_id bigint, unidad text, cantidad numeric, precio numeric, fecha date, tipo text, numero text, proveedor text, prov_n text, created_at timestamp without time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 20261008120000_chatbot_ronda8_cocinero: fuera el albarán ya facturado (facturado_en_id).
  with l as (
    select pf.id, pf.factura_id, pf.producto_id,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.numero_documento::text as numero, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           pf.created_at
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_producto_id is null or pf.producto_id = p_producto_id)
       and (p_ids is null or pf.id = any(p_ids))
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  )
  select l.* from l
   where l.precio > 0
     and not (l.tipo = 'albaran' and exists (
           select 1
             from productos_factura x
             join facturas fx on fx.id = x.factura_id
            where fx.tipo = 'factura'
              and x.producto_id = l.producto_id
              and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = l.unidad
              and x.cantidad = l.cantidad
              and fx.fecha between l.fecha - 7 and l.fecha + 75
              and mismo_proveedor_agente(
                    coalesce(nullif(fx.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(fx.proveedor), ''), '?'),
                    l.prov_n)))
$function$;

-- ─── 6. compras_producto_agente (+ p_unidad: firma nueva) ──────────────────
drop function if exists public.compras_producto_agente(text, date, date, text, integer, text, text, vector);
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: buscador único (lineas_producto_agente),
-- p_unidad, por_proveedor con ultima, ultimo_precio, precio_min y precio_max, sin
-- líneas a 0 €, sin albaranes facturados (facturado_en_id) y total con
-- en_facturas / en_albaranes_sin_factura.
declare
  c_max_variantes constant int := 15;
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_uni    text := unidad_agente(p_unidad);
  v_tipo   text;
  v_pal    text[];
  v_frase  text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_aprox  boolean;
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
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo, f.fecha,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,   -- nombre canónico
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal or palabras_producto_agente(pc.nombre) @> v_pal as exacta
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(v_ids)
       and coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) is distinct from 0   -- líneas a 0 €: fuera
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)                         -- albarán ya facturado
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
       and (v_uni is null or unidad = v_uni)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor (sin
  -- vínculo guardado): tampoco se cuenta.
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
    select *, case when imp > 0 and cant > 0 then imp / cant end as pu
      from filtrada where id not in (select id from ya_facturados)
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
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
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
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
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
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
               'precio_medio', trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)),
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
               'precio_medio',  trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)),
               'ultimo_precio', trim_scale(round(o.ult_precio, case when o.ult_precio < 1 then 4 else 2 end)),
               'precio_min',    trim_scale(round(o.p_min, case when o.p_min < 1 then 4 else 2 end)),
               'precio_max',    trim_scale(round(o.p_max, case when o.p_max < 1 then 4 else 2 end)),
               'compras',       o.compras,
               'primera',       o.primera,
               'ultima',        o.ultima,
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
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

  return resultado::json;
end;
$function$;

-- ─── 7. historial_precios_agente ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.historial_precios_agente(p_producto text, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: buscador único, filas idénticas
-- agrupadas (mismo documento, producto, unidad y precio), proveedor canónico,
-- comparativa por proveedor Y unidad, sin albaranes facturados ni precio 0.
declare
  resultado json;
  v_limite  integer := least(greatest(coalesce(p_limite, 30), 1), 100);
  h record;
begin
  select * into h from lineas_producto_agente(p_producto);
  if coalesce(cardinality(h.palabras), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.', 'compras', '[]'::json);
  end if;
  if h.ids is null then
    return jsonb_strip_nulls(jsonb_build_object(
      'producto_consultado', p_producto,
      'compras_encontradas', 0,
      'compras', '[]'::jsonb,
      'subproductos', to_jsonb(h.subproductos),
      'nota', case when h.subproductos is not null then
                'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto: dilo y pregunta si es eso.' end))::json;
  end if;

  with l as (
    select pf.id,
           coalesce(pc.nombre, pf.nombre::text) as producto,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(f.proveedor_id::text, nullif(f.proveedor_normalizado::text, ''), f.proveedor::text, '?') as prov_k,
           f.tipo::text as tipo, f.numero_documento::text as numero, f.fecha,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           pf.cantidad,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           round(coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0))::numeric, 4) as precio,
           pf.total
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(h.ids)
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  g as (   -- filas idénticas en una sola
    select producto, var, proveedor, prov_k, tipo, numero, fecha, bool_or(fd) as fd, unidad, precio,
           sum(cantidad) as cantidad, round(sum(total)::numeric, 2) as importe, count(*) as veces, min(id) as id
      from l
     where precio > 0
     group by producto, var, proveedor, prov_k, tipo, numero, fecha, unidad, precio
  ),
  compras as (
    select g.*, count(*) over () as lineas_totales
      from g
     order by fecha desc nulls last, id desc
     limit v_limite
  ),
  marco as (
    select count(*)::int                     as n,
           coalesce(max(lineas_totales), 0)::int as lineas_totales,
           min(fecha)                        as f_min,
           max(fecha)                        as f_max,
           count(distinct fecha)::int        as fechas_distintas,
           count(distinct var)::int          as variantes,
           count(distinct prov_k)::int       as proveedores,
           count(distinct unidad)::int       as unidades
      from compras
  ),
  extremos as (
    select m.n, m.f_min, m.f_max, m.fechas_distintas, m.proveedores, m.unidades,
           round(avg(c.precio) filter (where c.fecha = m.f_min), 4) as precio_inicial,
           round(avg(c.precio) filter (where c.fecha = m.f_max), 4) as precio_actual
      from compras c cross join marco m
     group by m.n, m.f_min, m.f_max, m.fechas_distintas, m.proveedores, m.unidades
  ),
  -- Por proveedor y unidad: su propia evolución (primera frente a última fecha).
  prov as (
    select prov_k, unidad,
           max(proveedor)              as proveedor,
           count(*)                    as veces,
           round(min(precio), 2)       as precio_min,
           round(max(precio), 2)       as precio_max,
           round(avg(precio), 2)       as precio_medio,
           min(fecha)                  as primera_compra,
           max(fecha)                  as ultima_compra,
           count(distinct fecha)       as fechas
      from compras
     group by prov_k, unidad
  ),
  prov_var as (
    select p.*,
           case when p.fechas >= 2 then
             (select round(avg(c.precio), 4) from compras c
               where c.prov_k = p.prov_k and c.unidad = p.unidad and c.fecha = p.primera_compra) end as precio_primera,
           case when p.fechas >= 2 then
             (select round(avg(c.precio), 4) from compras c
               where c.prov_k = p.prov_k and c.unidad = p.unidad and c.fecha = p.ultima_compra) end as precio_ultima
      from prov p
  )
  select (jsonb_strip_nulls(jsonb_build_object(
    'producto_consultado', p_producto,
    'coincidencia',        case when h.metodo in ('derivada', 'aproximada') then 'aproximada' end,
    'compras_devueltas',   (select n from marco),
    'compras_encontradas', (select lineas_totales from marco),
    'truncado',            (select lineas_totales > n from marco),
    'aviso', (
      select case when m.lineas_totales > m.n then
        'RESULTADO PARCIAL: hay ' || m.lineas_totales || ' compras de este producto y solo se devuelven las '
        || m.n || ' MAS RECIENTES (desde ' || m.f_min || '). No es el historico completo.'
      end from marco m),
    'precios', 'precio unitario de linea, SIN IVA',
    'variantes_distintas', (select case when variantes > 1 then variantes end from marco),
    'nota_coincidencia', (
      select case when m.variantes > 1 then
        'Mezcla ' || m.variantes || ' articulos distintos: desglosa por articulo en vez de dar un unico precio medio.'
      end from marco m),
    'comparativa_entre_proveedores', (select case when proveedores > 1 then true end from marco),
    'unidades_mezcladas', (select case when unidades > 1 then true end from marco),
    'subproductos_excluidos', to_jsonb(h.subproductos),
    'por_proveedor', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',      x.proveedor,
               'unidad',         x.unidad,
               'veces',          x.veces,
               'precio_min',     x.precio_min,
               'precio_max',     case when x.precio_max <> x.precio_min then x.precio_max end,
               'precio_medio',   case when x.veces > 1 then x.precio_medio end,
               'primera_compra', x.primera_compra,
               'ultima_compra',  case when x.ultima_compra <> x.primera_compra then x.ultima_compra end,
               'variacion_pct',  case when x.precio_primera is not null and x.precio_primera <> 0
                                      then round((x.precio_ultima - x.precio_primera) / x.precio_primera * 100, 2) end))
             order by x.unidad, x.precio_medio), '[]'::jsonb)
      from prov_var x),
    'nota_variacion', (
      select case
        when e.n < 2 then
          'Solo hay una compra: no hay evolucion de precio que medir.'
        when e.unidades > 1 then
          'Unidades distintas (caja, kg, ud...): no compares precios entre ellas; da el de cada proveedor en su unidad.'
        when e.proveedores > 1 then
          'Compras de ' || e.proveedores || ' proveedores: es una COMPARATIVA entre proveedores, NO una subida ni '
          || 'una bajada. La evolucion de cada uno esta en por_proveedor.variacion_pct.'
        when e.fechas_distintas < 2 then
          'Todas las compras son de la misma fecha (' || e.f_min || '): no hay evolucion de precio.'
      end from extremos e),
    'compras', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'producto',  producto,
               'proveedor', proveedor,
               'tipo',      tipo,
               'numero',    numero,
               'fecha',     fecha,
               'fecha_dudosa', case when fd then true end,
               'cantidad',  trim_scale(cantidad),
               'unidad',    unidad,
               'precio_unitario', trim_scale(precio),
               'importe',   importe,
               'veces',     case when veces > 1 then veces end))
             order by fecha asc, id asc), '[]'::jsonb)
      from compras)
  ))
  -- Variación global solo con UN proveedor y UNA unidad. Fuera del
  -- strip_nulls: "variacion": null tiene que verse.
  || jsonb_build_object(
    'variacion', (
      select case
        when e.n < 2 or e.fechas_distintas < 2 or e.proveedores > 1 or e.unidades > 1 then null
        else jsonb_build_object(
          'precio_inicial', e.precio_inicial,
          'fecha_inicial',  e.f_min,
          'precio_actual',  e.precio_actual,
          'fecha_actual',   e.f_max,
          'diferencia',     round(e.precio_actual - e.precio_inicial, 4),
          'variacion_pct',  case when e.precio_inicial is null or e.precio_inicial = 0 then null
                                 else round((e.precio_actual - e.precio_inicial) / e.precio_inicial * 100, 2) end)
        end
      from extremos e)
  ))::json into resultado;

  return coalesce(resultado, json_build_object('compras_encontradas', 0, 'compras', '[]'::json));
end;
$function$;

-- ─── 8. variacion_precios_agente: producto con el buscador único ────────────
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: el producto se busca con lineas_producto_agente
-- (mismo buscador que compras e historial); lineas_precio_agente ya no cuenta albaranes facturados.
declare
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_ids     bigint[];
  v_subs    text[];
  resultado jsonb;
begin
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

  with l as (
    select x.*, p.nombre as producto
      from lineas_precio_agente() x
      join productos_catalogo p on p.id = x.producto_id
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or x.producto_id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       -- Servicios (portes, reparaciones…) fuera salvo que se pidan.
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- Última compra de cada producto y unidad dentro del periodo.
  ult_doc as (
    select distinct on (producto_id, unidad) producto_id, unidad, factura_id, fecha, tipo, proveedor, prov_n, producto
      from l
     where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)
     order by producto_id, unidad, fecha desc, factura_id desc
  ),
  ult as (
    select u.*,
           (select coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                              / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio))
              from l where l.factura_id = u.factura_id and l.producto_id = u.producto_id and l.unidad = u.unidad) as precio
      from ult_doc u
  ),
  cmp as (
    select u.*, r.precio as ref_precio, r.compras as ref_compras, r.desde as ref_desde, r.hasta as ref_hasta,
           r.proveedor as ref_proveedor, r.metodo,
           case when r.precio > 0 then round((u.precio / r.precio - 1) * 100, 1) end as var,
           r.precio is not null and not (u.prov_n = any(r.proveedores_n)) as cambio
      from ult u
      left join lateral precio_referencia_agente(u.producto_id, u.unidad, u.fecha, u.factura_id) r on true
  ),
  sel as (
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
    'criterio', 'Por producto y unidad: precio de la ultima compra frente a la media ponderada de las compras de los '
                || '90 dias anteriores (o de las 3 ultimas compras anteriores si en 90 dias hay menos de 2). '
                || 'Precios de linea SIN IVA.'
                || case when v_prods is not null then ' Producto pedido: todas sus unidades, sin umbral.' else '' end,
    'buscado',   p_producto,
    'categoria', v_cat.nombre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
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
                 'ref_antigua',    case when s.metodo = 'ultimas_compras' and s.ref_hasta < s.fecha - 90 then true end))
               order by s.rn)
          from sel s where s.rn <= v_lim), '[]'::jsonb),
    -- Producto pedido sin precio anterior con que comparar: su última compra
    -- (una_compra = solo hay una: no hay subida ni bajada posible).
    'sin_comparar', case when v_prods is not null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',   c.producto,
                 'unidad',     c.unidad,
                 'precio',     trim_scale(round(c.precio, 4)),
                 'fecha',      c.fecha,
                 'proveedor',  coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                          where f.id = c.factura_id), c.proveedor),
                 'una_compra', case when (select count(distinct l2.factura_id) from l l2
                                           where l2.producto_id = c.producto_id and l2.unidad = c.unidad) = 1 then true end))
               order by c.fecha desc, c.producto)
          from (select * from cmp where var is null order by fecha desc, producto limit v_lim) c) end,
    'total_productos', (select coalesce(max(n), 0) from sel),
    'truncado',  (select case when max(n) > v_lim then true end from sel),
    'comparados', (select count(*) from cmp where var is not null),
    'avisos', nullif(jsonb_strip_nulls(jsonb_build_object(
        'sin_referencia', nullif((select count(*) from cmp where var is null), 0),
        'pocas_compras',  nullif((select count(*) from sel where ref_compras = 1 and rn <= v_lim), 0),
        'cambio_proveedor', nullif((select count(*) from sel where cambio and rn <= v_lim), 0),
        'sin_clasificar', nullif((select count(*) from productos_factura pf join facturas f on f.id = pf.factura_id
                                   where pf.producto_id is null
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$;

-- ─── 9. ranking_agente (+ p_unidad y p_categoria: firma nueva) ─────────────
drop function if exists public.ranking_agente(text, text, integer, date, date, text, boolean);
CREATE OR REPLACE FUNCTION public.ranking_agente(p_criterio text, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'desc'::text, p_incluir_servicios boolean DEFAULT false, p_unidad text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: p_unidad y p_categoria (criterios de
-- líneas) y sin albaranes facturados (facturado_en_id).
declare
  c_criterios constant text[] := array['precio_unitario', 'importe_linea', 'cantidad', 'veces', 'gasto_proveedor', 'importe_documento'];
  v_crit  text := lower(trim(coalesce(p_criterio, '')));
  v_tipo  text := lower(trim(coalesce(p_tipo, '')));
  v_ord   text := lower(trim(coalesce(nullif(p_orden, ''), 'desc')));
  v_lim   int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_serv  boolean := coalesce(p_incluir_servicios, false);
  v_uni   text := unidad_agente(p_unidad);
  v_cat   bigint;
  v_catn  text;
  v_asc   boolean;
  v_filas json;
  v_total int;
  v_excl  json;
  v_sint  jsonb;
  v_ded   jsonb;
  v_txt   text;
  v_unid  json;
begin
  if not v_crit = any(c_criterios) then
    return json_build_object('error', format('Criterio "%s" no valido.', p_criterio), 'permitidos', to_json(c_criterios));
  end if;
  v_tipo := case when v_tipo like 'albar%' then 'albaran'
                 when v_tipo like 'factura%' then 'factura'
                 when v_tipo in ('', 'ambos', 'todos') then null
                 else '#' end;
  if v_tipo = '#' then
    return json_build_object('error', format('Tipo "%s" no valido.', p_tipo), 'permitidos', json_build_array('factura', 'albaran', null));
  end if;
  if v_ord not in ('asc', 'desc') then
    return json_build_object('error', format('Orden "%s" no valido.', p_orden), 'permitidos', json_build_array('asc', 'desc'));
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    v_cat := categoria_agente(p_categoria);
    if v_cat is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
    select nombre into v_catn from categorias_producto where id = v_cat;
    v_serv := true;   -- la categoría manda (también «servicios»)
  end if;
  v_asc := v_ord = 'asc';

  if v_crit in ('precio_unitario', 'importe_linea') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
             pf.precio_unitario, pf.total,
             f.tipo, coalesce((select pv.nombre from proveedores pv where pv.id = f.proveedor_id), f.proveedor) as proveedor,
             f.numero_documento, f.fecha,
             case when v_crit = 'precio_unitario' then pf.precio_unitario else pf.total end as valor,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))           as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
        left join productos_catalogo pc on pc.id = pf.producto_id
        left join categorias_producto c on c.id = pc.categoria_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
         and (v_cat is null or c.id = v_cat or c.padre_id = v_cat)
    ),
    validas as (select * from l where valor is not null and valor > 0 and (v_uni is null or unidad = v_uni)),
    uno as (  -- una fila por producto: su línea más cara (o más barata)
      select distinct on (clave) *
        from validas
       where v_serv or not servicio
       order by clave,
                case when v_asc then valor end asc,
                case when not v_asc then valor end desc,
                fecha desc, id
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            fecha desc, id) as n,
             count(*) over () as total_filas
        from uno
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',        nombre,
                 'precio_unitario', round(precio_unitario::numeric, case when abs(precio_unitario) < 1 then 4 else 2 end),
                 'cantidad',        cantidad,
                 'unidad',          unidad,
                 'importe',         round(total::numeric, 2),
                 'proveedor',       proveedor,
                 'numero',          numero_documento,
                 'fecha',           fecha,
                 'tipo',            tipo)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'mayores', (select json_agg(json_build_object('producto', s.nombre, 'valor', round(s.valor::numeric, 2)) order by s.valor desc)
                                from (select nombre, valor from validas where servicio order by valor desc limit 3) s))
              end
         from validas where servicio)
    into v_total, v_filas, v_excl;

    v_txt := case when v_crit = 'precio_unitario'
                  then 'Precio unitario de linea SIN IVA'
                  else 'Importe de linea (cantidad x precio) SIN IVA' end
             || '; una fila por producto con su valor mas ' || case when v_asc then 'bajo' else 'alto' end
             || '; sin valores vacios ni a 0'
             || case when v_cat is not null then '' when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit in ('cantidad', 'veces') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad, pf.total,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
        left join productos_catalogo pc on pc.id = pf.producto_id
        left join categorias_producto c on c.id = pc.categoria_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
         and (v_cat is null or c.id = v_cat or c.padre_id = v_cat)
         and (v_uni is null or unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) = v_uni)
    ),
    g as (
      -- cantidad: se agrupa por producto Y unidad (no se suman kg con unidades)
      select max(nombre)                                                  as producto,
             max(unidad)                                                  as unidad,
             count(*)                                                     as veces,
             case when v_crit = 'cantidad' or count(distinct unidad) <= 1
                  then round(sum(cantidad)::numeric, 2) end              as cantidad,
             round(sum(total)::numeric, 2)                                as importe,
             case when v_crit = 'cantidad' then sum(cantidad) else count(*)::numeric end as valor
        from l
       where (v_serv or not servicio)
         and (v_crit = 'veces' or (cantidad is not null and cantidad > 0))
       group by clave, case when v_crit = 'cantidad' then unidad end
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            importe desc nulls last, producto) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto', producto, 'cantidad', cantidad, 'unidad', unidad,
                 'veces', veces, 'importe', importe)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'nombres', (select json_agg(distinct s.nombre) from (select nombre from l where servicio limit 10) s))
              end
         from l where servicio),
      -- cantidad: el primero de CADA unidad (kg, ud, caja…), porque 172,7 kg y
      -- 156 ud no se pueden comparar entre si.
      (select case when v_crit = 'cantidad' and count(*) > 1 then
                json_agg(json_build_object('unidad', u.unidad, 'producto', u.producto, 'cantidad', u.cantidad) order by u.n)
              end
         from (select distinct on (coalesce(unidad, '?')) unidad, producto, cantidad, n
                 from o order by coalesce(unidad, '?'), n) u)
    into v_total, v_filas, v_excl, v_unid;

    v_txt := case when v_crit = 'cantidad'
                  then 'Cantidad total comprada de cada producto, en su unidad (kg con kg, ud con ud: unidades distintas no se comparan)'
                  else 'Numero de compras (lineas) de cada producto' end
             || case when v_cat is not null then '' when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit = 'gasto_proveedor' then
    v_tipo := coalesce(v_tipo, 'factura');
    with g as (
      select coalesce(max((select pv.nombre from proveedores pv where pv.id = facturas.proveedor_id)),
                      max(proveedor), proveedor_normalizado)               as proveedor,
             count(*)                                                     as documentos,
             round(coalesce(sum(total), 0)::numeric, 2)                   as importe,
             nullif(count(*) filter (where total is null), 0)             as sin_total,
             nullif(count(*) filter (where total_origen = 'deducido'), 0) as deducidos,
             coalesce(sum(total), 0)                                      as valor
        from facturas
       where tipo = v_tipo
         and (p_desde is null or fecha >= p_desde)
         and (p_hasta is null or fecha <= p_hasta)
         and not (tipo = 'albaran' and facturado_en_id is not null)
       group by proveedor_normalizado
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            documentos desc, proveedor) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'proveedor', proveedor, 'documentos', documentos, 'importe', importe, 'sin_total', sin_total,
                 'deducidos', deducidos)) order by n), '[]'::json)
         from o where n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := case when v_tipo = 'factura'
                  then 'Gasto por proveedor: suma del total (IVA incluido) de sus facturas'
                  else 'Valor de albaranes sin factura por proveedor (IVA incluido; NO es gasto facturado)' end
             || '; los documentos sin total no suman';

  else  -- importe_documento
    with o as (
      select f.id, f.total,
             row_number() over (order by case when v_asc then f.total end asc,
                                         case when not v_asc then f.total end desc,
                                         f.fecha desc, f.id) as n,
             count(*) over () as total_filas
        from facturas f
       where f.total is not null
         and (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
         from o join facturas f on f.id = o.id where o.n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := 'Documentos por total (IVA incluido)'
             || case when v_tipo is null then ', facturas y albaranes sin factura mezclados (mira "tipo")' else '' end
             || '; los documentos sin total no entran';
  end if;

  if v_crit in ('gasto_proveedor', 'importe_documento') and (v_uni is not null or v_cat is not null) then
    v_txt := v_txt || '; unidad y categoria no aplican a documentos';
  else
    if v_uni is not null then v_txt := v_txt || '; solo unidad ' || v_uni; end if;
    if v_cat is not null then v_txt := v_txt || '; categoria ' || v_catn; end if;
  end if;
  -- Un total deducido no se leyó del documento: el «IVA incluido» del
  -- criterio no vale para él si iva_conocido = false (prueba del 06/10, q03).
  if v_ded is not null then
    v_txt := v_txt || '; documentos_deducidos: total calculado desde las lineas (sin IVA si iva_conocido=false)';
  end if;
  if p_desde is not null or p_hasta is not null then
    v_txt := v_txt || format('; fechas %s a %s', coalesce(p_desde::text, 'inicio'), coalesce(p_hasta::text, 'hoy'));
  end if;

  return (jsonb_build_object(
            'criterio',    v_txt,
            'orden',       v_ord,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_excl is not null then jsonb_build_object('servicios_excluidos', v_excl) else '{}'::jsonb end
          || case when v_unid is not null then jsonb_build_object('primero_por_unidad', v_unid) else '{}'::jsonb end
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
         )::json;
end;
$function$;

-- ─── 10. gasto_categorias_agente: sin albaranes facturados, reparto ─────────
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: sin albaranes facturados (facturado_en_id) y
-- total con en_facturas / en_albaranes_sin_factura.
declare
  c_top        constant int := 8;
  c_max_cruce  constant int := 60;
  v_tipo   text;
  v_agr    text;
  v_cat    categorias_producto%rowtype;
  v_madre  text;
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
  v_agr := case
    when nullif(trim(coalesce(p_agrupar, '')), '') is null then null
    when lower(trim(p_agrupar)) like 'mes%' then 'mes'
    when lower(trim(p_agrupar)) like 'proveedor%' then 'proveedor'
    else '?' end;
  if v_agr = '?' then
    return json_build_object('error', 'agrupar debe ser mes, proveedor o null.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object(
        'error', format('No hay ninguna categoria "%s".', p_categoria),
        'categorias', (select json_agg(c.nombre || coalesce(' (' || (
                          select string_agg(s.nombre, ', ' order by s.orden, s.nombre)
                            from categorias_producto s where s.padre_id = c.id and s.activa) || ')', '')
                          order by c.orden, c.nombre)
                         from categorias_producto c where c.padre_id is null and c.activa));
    end if;
    select nombre into v_madre from categorias_producto where id = v_cat.padre_id;
  end if;

  with base as (
    select pf.id, pf.producto_id,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo::text as tipo, f.fecha, coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv         on pv.id = f.proveedor_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor (sin vínculo guardado): no se cuenta.
  ya_facturados as (
    select a.id from base a
     where a.tipo = 'albaran'
       and exists (select 1 from base x
                    where x.tipo = 'factura' and x.unidad = a.unidad and x.cant = a.cant and x.nom_n = a.nom_n
                      and mismo_proveedor_agente(x.prov_n, a.prov_n)
                      and x.fecha between a.fecha - 7 and a.fecha + 75)
  ),
  todo as (select * from base where id not in (select id from ya_facturados)),
  -- Lo que se pregunta: la categoría (con sus subcategorías) o todo.
  l as (
    select * from todo
     where v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id
  ),
  -- Fila de reparto: categoría madre y subcategoría (o sin clasificar / sin categoría).
  g as (
    select case when producto_id is null then 'Sin clasificar'
                when cat_id is null then 'Sin categoria'
                else madre end as grupo,
           case when cat_id is not null and cat_id <> madre_id then cat end as sub,
           orden, imp, id, doc,
           -- Clave del cruce y su etiqueta (el proveedor, agrupado por su nombre normalizado).
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else prov_n end as k,
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else proveedor end as etq
      from l
  ),
  marco as (
    select count(*) as lineas, count(distinct doc) as docs, count(distinct producto_id) as productos,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where tipo = 'albaran') as lin_alb
      from l
  ),
  total_periodo as (select sum(imp) as imp from todo),
  sin_clas as (
    select count(*) as lineas, sum(imp) as imp from todo where producto_id is null
  ),
  reparto as (
    select grupo, min(orden) as orden, sum(imp) as imp, count(*) as lineas,
           (select jsonb_agg(jsonb_build_object('categoria', s.sub, 'importe', trim_scale(round(s.imp, 2)), 'lineas', s.lineas)
                             order by s.imp desc nulls last, s.sub)
              from (select g2.sub, sum(g2.imp) as imp, count(*) as lineas
                      from g g2 where g2.grupo = g.grupo and g2.sub is not null group by g2.sub) s) as subs
      from g group by grupo
  ),
  top as (
    select producto, sum(imp) as imp,
           (select jsonb_object_agg(u.unidad, trim_scale(round(u.cant, 3)))
              from (select l2.unidad, sum(l2.cant) as cant from l l2 where l2.producto = l.producto group by l2.unidad) u) as cant,
           count(*) over () as n
      from l where producto is not null
     group by producto
  ),
  cruce as (
    select case when v_cat.id is null then grupo end as grupo,
           (array_agg(etq order by etq))[1] as clave,
           sum(imp) as imp, count(*) as lineas
      from g
     where v_agr is not null
     group by 1, k
  ),
  cruce_n as (
    select c.*, row_number() over (
             order by case when v_agr = 'mes' then c.clave end,
                      c.imp desc nulls last, c.grupo, c.clave) as rn,
           count(*) over () as n
      from cruce c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'categoria', case when v_cat.id is not null then v_cat.nombre end,
    'madre',     v_madre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'en_facturas',  case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
                'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end)) end
                from marco m cross join total_periodo tp),
    -- Sin categoría: madres con sus subcategorías. Con una madre: sus subcategorías.
    'categorias', case when v_cat.id is null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', r.grupo,
                 'importe',   trim_scale(round(r.imp, 2)),
                 'pct',       case when tp.imp > 0 then round(100 * r.imp / tp.imp, 1) end,
                 'lineas',    r.lineas,
                 'sub',       r.subs))
               order by r.imp desc nulls last, r.orden, r.grupo)
          from reparto r cross join total_periodo tp
         where r.grupo not in ('Sin clasificar', 'Sin categoria')) end,
    'subcategorias', case when v_cat.id is not null and v_cat.padre_id is null then (
        select r.subs from reparto r limit 1) end,
    'sin_categoria', case when v_cat.id is null then (
        select jsonb_build_object('importe', trim_scale(round(r.imp, 2)), 'lineas', r.lineas)
          from reparto r where r.grupo = 'Sin categoria') end,
    'top_productos', case when v_cat.id is not null then (
        select jsonb_agg(jsonb_build_object('producto', t.producto, 'importe', trim_scale(round(t.imp, 2)), 'cantidad', t.cant)
                         order by t.imp desc nulls last, t.producto)
          from (select * from top order by imp desc nulls last, producto limit c_top) t) end,
    'productos_total', case when v_cat.id is not null then (select case when max(n) > c_top then max(n) end from top) end,
    'cruce', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', c.grupo,
                 v_agr,        c.clave,
                 'importe',   trim_scale(round(c.imp, 2)),
                 'lineas',    c.lineas))
               order by c.rn)
          from cruce_n c where c.rn <= c_max_cruce),
    'cruce_truncado', (select case when max(n) > c_max_cruce then true end from cruce_n),
    'sin_clasificar', (select case when s.lineas > 0 then jsonb_build_object(
                         'lineas', s.lineas, 'importe', trim_scale(round(s.imp, 2))) end from sin_clas s),
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta.' end
        from marco m),
    'avisos', (select nullif(jsonb_strip_nulls(jsonb_build_object(
                 'sin_importe',             nullif(m.sin_importe, 0),
                 'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
                 from marco m),
    'nota', 'Importes de linea: base SIN IVA.',
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'ultima_compra', case when v_cat.id is not null and (select lineas from marco) = 0 then (
        select max(f.fecha)
          from productos_factura pf
          join facturas f on f.id = pf.factura_id
          join productos_catalogo p on p.id = pf.producto_id
          join categorias_producto c on c.id = p.categoria_id
         where c.id = v_cat.id or c.padre_id = v_cat.id) end
  )) into resultado;

  return resultado::json;
end;
$function$;

-- ─── 11. consulta_flexible_agente: agrupar 'iva_pct' ────────────────────────
CREATE OR REPLACE FUNCTION public.consulta_flexible_agente(p jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: agrupar 'iva_pct' (lineas): base (SIN IVA) y
-- cuota_iva por tipo de IVA, para la gestoría. Con iva_pct la fuente es siempre lineas.

declare
  c_claves   constant text[] := array['fuente', 'metricas', 'agrupar', 'filtros', 'orden_por', 'orden_dir', 'limite'];
  c_filtros  constant text[] := array['desde', 'hasta', 'proveedor', 'tipo', 'numero', 'producto', 'con_total',
                                      'verificada', 'con_alertas', 'excluir_servicios', 'importe_min', 'importe_max'];
  c_agrupar  constant text[] := array['proveedor', 'mes', 'anio', 'tipo', 'producto', 'unidad', 'verificada', 'alerta', 'dia_semana', 'iva_pct'];
  c_met_doc  constant text[] := array['count_documentos', 'count_con_total',
                                      'sum_total', 'avg_total', 'min_total', 'max_total',
                                      'sum_subtotal', 'avg_subtotal', 'min_subtotal', 'max_subtotal',
                                      'sum_iva', 'avg_iva', 'min_iva', 'max_iva'];
  c_met_lin  constant text[] := array['count_lineas', 'count_documentos',
                                      'sum_cantidad', 'avg_cantidad', 'min_cantidad', 'max_cantidad',
                                      'sum_precio_unitario', 'avg_precio_unitario', 'min_precio_unitario', 'max_precio_unitario',
                                      'sum_total_linea', 'avg_total_linea', 'min_total_linea', 'max_total_linea'];
  v_fuente   text;
  v_f        jsonb;
  v_lim      int := 10;
  v_dir      text;
  v_orden    text;
  v_metricas text[] := '{}';
  v_agrupar  text[] := '{}';
  v_sel      text[] := '{}';
  v_grp      text[] := '{}';
  v_where    text[] := array['true'];
  v_from     text;
  v_alerta   boolean := false;
  v_ivap     boolean := false;
  -- Tipo de IVA de la línea o, si falta, el del documento cuando es uno solo
  -- (iva/subtotal = 0, 4, 5, 10 o 21 %; con tipos mezclados queda null).
  c_tipo_iva constant text := 'coalesce(l.iva_pct, case when round(f.iva / nullif(f.subtotal, 0) * 100, 1) in (0, 4, 5, 10, 21) then round(f.iva / nullif(f.subtotal, 0) * 100, 1) end)';
  k          text;
  v_val      jsonb;
  v_expr     text;
  v_func     text;
  v_col      text;
  v_sql      text;
  v_filas    json;
  v_total    int;
  v_sint     json;
  v_lsin     int;
  v_import   boolean := false;
  v_lin_nul  text[] := '{}';
  v_ncon     text[] := '{}';
  v_fdud     json;
  v_iva      boolean := false;
  v_ded      json;
  v_siva     json;
  v_fila     text := 'to_jsonb(g)';
  f_desde date; f_hasta date; f_prov text; f_tipo text; f_num text; f_prod text;
  f_con_total boolean; f_verif boolean; f_alertas boolean; f_excl boolean; f_min numeric; f_max numeric;
begin
  -- Estructura y claves ----------------------------------------------------
  if p is null or jsonb_typeof(p) <> 'object' then
    return json_build_object('error', 'La consulta tiene que ser un objeto JSON.', 'permitidos', to_json(c_claves));
  end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any(c_claves) then
      return json_build_object('error', format('Clave "%s" no permitida.', k), 'permitidos', to_json(c_claves));
    end if;
  end loop;

  v_fuente := lower(coalesce(nullif(p ->> 'fuente', ''), 'documentos'));
  if v_fuente not in ('documentos', 'lineas') then
    return json_build_object('error', format('Fuente "%s" no permitida.', p ->> 'fuente'), 'permitidos', json_build_array('documentos', 'lineas'));
  end if;
  -- IVA por tipo: el tipo está en las líneas; la fuente es lineas aunque pidan documentos.
  if jsonb_typeof(p -> 'agrupar') = 'array' and (p -> 'agrupar') ? 'iva_pct' then
    v_ivap := true;
    v_fuente := 'lineas';
  end if;

  -- Métricas ----------------------------------------------------------------
  v_val := p -> 'metricas';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'metricas tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      continue when v_ivap and not k = any(c_met_lin);   -- base y cuota_iva van siempre
      if not k = any(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end) then
        return json_build_object('error', format('Metrica "%s" no permitida con fuente %s.', k, v_fuente),
                                 'permitidos', to_json(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end));
      end if;
      if not k = any(v_metricas) then v_metricas := v_metricas || k; end if;
    end loop;
  end if;
  if cardinality(v_metricas) = 0 then
    v_metricas := array[case when v_fuente = 'documentos' then 'count_documentos' else 'count_lineas' end];
  end if;
  if cardinality(v_metricas) > 4 then
    return json_build_object('error', 'Como maximo 4 metricas.');
  end if;

  -- Agrupaciones ------------------------------------------------------------
  v_val := p -> 'agrupar';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'agrupar tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      if not k = any(c_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" no permitida.', k), 'permitidos', to_json(c_agrupar));
      end if;
      if k in ('producto', 'unidad') and v_fuente <> 'lineas' then
        return json_build_object('error', format('Agrupar por "%s" solo con fuente lineas.', k));
      end if;
      if k = any(v_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" repetida.', k));
      end if;
      if k = any(v_metricas) then
        return json_build_object('error', 'Una agrupacion no puede llamarse igual que una metrica.');
      end if;
      v_agrupar := v_agrupar || k;
    end loop;
  end if;
  if cardinality(v_agrupar) > 3 then
    return json_build_object('error', 'Como maximo 3 agrupaciones.');
  end if;

  -- Filtros (valores tipados; solo se usan como parámetros) -----------------
  v_f := coalesce(p -> 'filtros', '{}'::jsonb);
  if jsonb_typeof(v_f) = 'null' then v_f := '{}'::jsonb; end if;
  if jsonb_typeof(v_f) <> 'object' then
    return json_build_object('error', 'filtros tiene que ser un objeto.', 'permitidos', to_json(c_filtros));
  end if;
  for k, v_val in select key, value from jsonb_each(v_f) loop
    if not k = any(c_filtros) then
      return json_build_object('error', format('Filtro "%s" no permitido.', k), 'permitidos', to_json(c_filtros));
    end if;
    continue when jsonb_typeof(v_val) = 'null';

    if k in ('desde', 'hasta') then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        return json_build_object('error', format('Filtro "%s": fecha AAAA-MM-DD.', k));
      end if;
      begin
        if k = 'desde' then f_desde := (v_val #>> '{}')::date; else f_hasta := (v_val #>> '{}')::date; end if;
      exception when others then
        return json_build_object('error', format('Filtro "%s": "%s" no es una fecha real.', k, v_val #>> '{}'));
      end;
    elsif k in ('proveedor', 'numero', 'producto', 'tipo') then
      if jsonb_typeof(v_val) <> 'string' or length(trim(v_val #>> '{}')) = 0 or length(v_val #>> '{}') > 100 then
        return json_build_object('error', format('Filtro "%s": texto de 1 a 100 caracteres.', k));
      end if;
      case k
        when 'proveedor' then f_prov := trim(v_val #>> '{}');
        when 'numero'    then f_num  := trim(v_val #>> '{}');
        when 'producto'  then f_prod := trim(v_val #>> '{}');
        else
          f_tipo := case when lower(v_val #>> '{}') like 'albar%' then 'albaran'
                         when lower(v_val #>> '{}') like 'factura%' then 'factura' end;
          if f_tipo is null then
            return json_build_object('error', 'Filtro "tipo": factura o albaran.');
          end if;
      end case;
    elsif k in ('con_total', 'verificada', 'con_alertas', 'excluir_servicios') then
      if jsonb_typeof(v_val) <> 'boolean' then
        return json_build_object('error', format('Filtro "%s": true o false.', k));
      end if;
      case k
        when 'con_total'   then f_con_total := (v_val #>> '{}')::boolean;
        when 'verificada'  then f_verif     := (v_val #>> '{}')::boolean;
        when 'con_alertas' then f_alertas   := (v_val #>> '{}')::boolean;
        else                    f_excl      := (v_val #>> '{}')::boolean;
      end case;
    else  -- importe_min / importe_max
      if jsonb_typeof(v_val) <> 'number' then
        return json_build_object('error', format('Filtro "%s": numero.', k));
      end if;
      if k = 'importe_min' then f_min := (v_val #>> '{}')::numeric; else f_max := (v_val #>> '{}')::numeric; end if;
    end if;
  end loop;

  if v_fuente = 'documentos' and (f_prod is not null or f_excl is not null) then
    return json_build_object('error', 'Los filtros producto y excluir_servicios solo valen con fuente lineas.');
  end if;
  if f_desde is not null and f_hasta is not null and f_desde > f_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', f_desde, f_hasta));
  end if;

  -- Orden y límite ----------------------------------------------------------
  v_orden := nullif(lower(trim(coalesce(p ->> 'orden_por', ''))), '');
  if v_orden is null then
    v_orden := case when v_ivap then 'base' else v_metricas[1] end;
  elsif not (v_orden = any(v_metricas) or v_orden = any(v_agrupar) or (v_ivap and v_orden in ('base', 'cuota_iva'))) then
    return json_build_object('error', format('orden_por "%s" tiene que ser una de las metricas o agrupaciones pedidas.', p ->> 'orden_por'),
                             'permitidos', to_json(v_metricas || v_agrupar));
  end if;
  v_dir := lower(coalesce(nullif(p ->> 'orden_dir', ''), 'desc'));
  if v_dir not in ('asc', 'desc') then
    return json_build_object('error', 'orden_dir: asc o desc.');
  end if;
  if p ? 'limite' and jsonb_typeof(p -> 'limite') <> 'null' then
    if jsonb_typeof(p -> 'limite') <> 'number' then
      return json_build_object('error', 'limite tiene que ser un numero.');
    end if;
    v_lim := least(greatest(floor((p ->> 'limite')::numeric)::int, 1), 50);
  end if;

  -- Construcción (solo fragmentos constantes) -------------------------------
  v_from := case when v_fuente = 'documentos'
                 then 'facturas f'
                 else 'productos_factura l join facturas f on f.id = l.factura_id' end;
  if 'alerta' = any(v_agrupar) then
    v_alerta := true;
    v_from := v_from || ' left join lateral jsonb_array_elements(case when jsonb_typeof(f.alertas_validacion) = ''array'''
                     || ' then f.alertas_validacion else ''[]''::jsonb end) a(el) on true';
  end if;

  foreach k in array v_agrupar loop
    case k
      when 'proveedor'  then v_grp := v_grp || 'f.proveedor_normalizado'::text;
                             v_sel := v_sel || format('coalesce(max((select pv.nombre from proveedores pv where pv.id = f.proveedor_id)), max(f.proveedor), f.proveedor_normalizado) as %I', k);
      when 'mes'        then v_grp := v_grp || 'to_char(f.fecha, ''YYYY-MM'')'::text;
                             v_sel := v_sel || format('to_char(f.fecha, ''YYYY-MM'') as %I', k);
      when 'anio'       then v_grp := v_grp || 'extract(year from f.fecha)::int'::text;
                             v_sel := v_sel || format('extract(year from f.fecha)::int as %I', k);
      when 'tipo'       then v_grp := v_grp || 'f.tipo'::text;
                             v_sel := v_sel || format('f.tipo as %I', k);
      when 'producto'   then v_grp := v_grp || 'coalesce(l.nombre_normalizado, lower(l.nombre))'::text;
                             v_sel := v_sel || format('max(l.nombre) as %I', k);
      when 'unidad'     then v_grp := v_grp || 'l.unidad'::text;
                             v_sel := v_sel || format('l.unidad as %I', k);
      when 'verificada' then v_grp := v_grp || 'coalesce(f.verificada, false)'::text;
                             v_sel := v_sel || format('coalesce(f.verificada, false) as %I', k);
      when 'alerta'     then v_grp := v_grp || 'coalesce(a.el ->> ''codigo'', ''sin_alertas'')'::text;
                             v_sel := v_sel || format('coalesce(a.el ->> ''codigo'', ''sin_alertas'') as %I', k);
      when 'dia_semana' then v_grp := v_grp || '(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int]'::text;
                             v_sel := v_sel || format('(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int] as %I', k);
      when 'iva_pct'    then v_grp := v_grp || c_tipo_iva;
                             v_sel := v_sel || format('trim_scale(%s) as %I', c_tipo_iva, k);
    end case;
  end loop;

  foreach k in array v_metricas loop
    if k = 'count_documentos' then
      v_expr := 'count(distinct f.id)';
    elsif k = 'count_con_total' then
      v_expr := 'count(distinct f.id) filter (where f.total is not null)';
    elsif k = 'count_lineas' then
      v_expr := 'count(l.id)';
    else
      v_func := case split_part(k, '_', 1) when 'sum' then 'sum' when 'avg' then 'avg' when 'min' then 'min' when 'max' then 'max' end;
      v_col := case substr(k, length(split_part(k, '_', 1)) + 2)
                 when 'total'           then 'f.total'
                 when 'subtotal'        then 'f.subtotal'
                 when 'iva'             then 'f.iva'
                 when 'cantidad'        then 'l.cantidad'
                 when 'precio_unitario' then 'l.precio_unitario'
                 when 'total_linea'     then 'l.total'
               end;
      if v_func is null or v_col is null then
        return json_build_object('error', format('Metrica "%s" no permitida.', k));
      end if;
      v_expr := format('round(%s(%s)::numeric, 2)', v_func, v_col);
      if v_col like 'f.%' then v_import := true; end if;
      if v_col = 'f.iva' then v_iva := true; end if;
      if v_col like 'l.%' and not v_col = any(v_lin_nul) then v_lin_nul := v_lin_nul || v_col; end if;
      -- Toda media lleva al lado cuantas filas entran en ella (n_con_total…):
      -- el modelo dividia por su cuenta entre TODOS los documentos.
      if v_func = 'avg' and not ('n_con_' || substr(k, 5)) = any(v_ncon) then
        v_ncon := v_ncon || ('n_con_' || substr(k, 5));
        v_sel := v_sel || format('count(%s) as %I', v_col, 'n_con_' || substr(k, 5));
      end if;
    end if;
    v_sel := v_sel || format('%s as %I', v_expr, k);
  end loop;

  -- IVA por tipo: base (suma de líneas SIN IVA) y cuota (base x tipo).
  if v_ivap then
    v_sel := v_sel || 'round(sum(l.total)::numeric, 2) as base'::text
                   || format('round(sum(l.total * %s / 100)::numeric, 2) as cuota_iva', c_tipo_iva)
                   || 'nullif(count(*) filter (where l.iva_pct is null), 0) as lineas_tipo_del_documento'::text;
    if not 'l.total' = any(v_lin_nul) then v_lin_nul := v_lin_nul || 'l.total'::text; end if;
  end if;

  -- Importes de documentos: cada fila dice cuantos de sus documentos no
  -- tienen total o lo tienen deducido (solo si > 0). Prueba del 06/10, n1: la
  -- fila de Garre llegaba con sum_total null y el modelo la omitia.
  if v_fuente = 'documentos' and v_import then
    v_sel := v_sel || 'nullif(count(distinct f.id) filter (where f.total is null), 0) as sin_total'::text
                   || 'nullif(count(distinct f.id) filter (where f.total_origen = ''deducido''), 0) as deducidos'::text;
    v_fila := '(to_jsonb(g) - array_remove(array[case when g.sin_total is null then ''sin_total'' end,'
              || ' case when g.deducidos is null then ''deducidos'' end], null::text))';
  end if;

  if f_desde is not null     then v_where := v_where || 'f.fecha >= $1'::text; end if;
  if f_hasta is not null     then v_where := v_where || 'f.fecha <= $2'::text; end if;
  if f_prov is not null      then v_where := v_where ||
       '(coalesce(f.proveedor_normalizado, '''') like ''%'' || coalesce(normalizar_proveedor($3), '''') || ''%'' or f.proveedor ilike ''%'' || $3 || ''%'')'::text; end if;
  if f_tipo is not null      then v_where := v_where || 'f.tipo = $4'::text; end if;
  if f_num is not null       then v_where := v_where ||
       ('(f.numero_documento ilike ''%'' || $5 || ''%'' or (length(regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')) > 0'
        || ' and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '''')), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')'
        || ' like ''%'' || regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''') || ''%''))')::text; end if;
  if f_prod is not null      then v_where := v_where ||
       'coalesce(l.nombre_normalizado, lower(l.nombre)) like ''%'' || coalesce(normalizar_nombre_producto($6), '''') || ''%'''::text; end if;
  if f_con_total is not null then v_where := v_where || '((f.total is not null) = $7)'::text; end if;
  if f_verif is not null     then v_where := v_where || '(coalesce(f.verificada, false) = $8)'::text; end if;
  if f_alertas is not null   then v_where := v_where || '((alertas_resumen_agente(f.alertas_validacion) is not null) = $9)'::text; end if;
  if f_excl                  then v_where := v_where || 'not es_linea_servicio_agente(coalesce(l.nombre_normalizado, l.nombre))'::text; end if;
  if f_min is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total >= $11' else 'l.total >= $11' end)::text; end if;
  if f_max is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total <= $12' else 'l.total <= $12' end)::text; end if;

  v_sql := format(
    'select coalesce(json_agg(t.fila order by t.ord), ''[]''::json), coalesce(max(t.n), 0)::int'
    || ' from (select %8$s as fila, row_number() over (order by g.%1$I %2$s nulls last) as ord, count(*) over () as n'
    || ' from (select %3$s from %4$s where %5$s %6$s) g) t'
    || ' where t.ord <= %7$s',
    v_orden,
    case when v_dir = 'asc' then 'asc' else 'desc' end,
    array_to_string(v_sel, ', '),
    v_from,
    array_to_string(v_where, ' and '),
    case when cardinality(v_grp) > 0 then 'group by ' || array_to_string(v_grp, ', ') else '' end,
    v_lim,
    v_fila);

  begin
    execute v_sql into v_filas, v_total
      using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;

    -- Avisos de cifras parciales en el mismo ámbito filtrado (solo con
    -- importes: un conteo no lleva ninguno).
    if v_fuente = 'documentos' and v_import then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total is null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_sint
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Totales deducidos (calculados desde las lineas, no leidos).
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha, ''iva_conocido'', f.iva is not null)'
        || ' order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total_origen = ''deducido'' and f.total is not null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_ded
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Con IVA: documentos con total pero sin IVA (no entran en la suma de IVA).
      if v_iva then
        execute format(
          'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
          || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
          || ' from facturas f where %s and f.iva is null and f.total is not null having count(*) > 0',
          array_to_string(v_where, ' and '))
          into v_siva
          using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      end if;
    elsif v_fuente = 'lineas' and cardinality(v_lin_nul) > 0 then
      execute format(
        'select count(*)::int from productos_factura l join facturas f on f.id = l.factura_id where %s and (%s)',
        array_to_string(v_where, ' and '),
        array_to_string(array(select c || ' is null' from unnest(v_lin_nul) c), ' or '))
        into v_lsin
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
    end if;

    -- Agrupar por fecha (mes, año, dia de la semana) con documentos cuya
    -- fecha es la de subida (alerta fecha_ausente): se dicen cuales.
    if v_agrupar && array['mes', 'anio', 'dia_semana'] then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', d.id, ''numero'', d.numero_documento,'
        || ' ''proveedor'', d.proveedor, ''fecha'', d.fecha) order by d.fecha, d.id))'
        || ' from (select distinct f.id, f.numero_documento, f.proveedor, f.fecha from %s where %s'
        || ' and fecha_dudosa_agente(f.alertas_validacion)) d having count(*) > 0',
        case when v_fuente = 'documentos' then 'facturas f' else 'productos_factura l join facturas f on f.id = l.factura_id' end,
        array_to_string(v_where, ' and '))
        into v_fdud
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
    end if;
  exception
    when query_canceled then
      return json_build_object('error', 'La consulta ha tardado demasiado. Acotala (fechas, proveedor) o usa una herramienta especifica.');
    when others then
      return json_build_object('error', 'No se ha podido ejecutar la consulta: ' || sqlerrm);
  end;

  return (jsonb_build_object(
            'criterio', format('%s de %s%s; filtros %s; orden %s %s',
                               array_to_string(v_metricas, ', '), v_fuente,
                               case when cardinality(v_agrupar) > 0 then ' por ' || array_to_string(v_agrupar, ', ') else '' end,
                               jsonb_strip_nulls(v_f)::text, v_orden, v_dir)
                        || case when v_ivap
                                then '; base = suma de lineas SIN IVA, cuota_iva = base x iva_pct; iva_pct de la linea o, si falta, el del documento con un solo tipo (lineas_tipo_del_documento); null = tipos mezclados o sin IVA'
                                when v_fuente = 'lineas' and cardinality(v_lin_nul) > 0
                                then '; precios e importes de linea SIN IVA'
                                when v_import and v_ded is not null and (v_ded::jsonb -> 'docs') @> '[{"iva_conocido": false}]'::jsonb
                                then '; total con IVA salvo documentos_deducidos sin IVA conocido, subtotal sin IVA'
                                when v_import and v_ded is not null
                                then '; total con IVA (documentos_deducidos: calculado desde las lineas, con IVA), subtotal sin IVA'
                                when v_import then '; total con IVA, subtotal sin IVA' else '' end
                        || case when v_alerta then '; un documento con varias alertas cuenta en cada una' else '' end
                        || case when cardinality(v_ncon) > 0 then '; cada media se calcula solo sobre n_con_*' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
          || case when v_siva is not null then jsonb_build_object('documentos_sin_iva', v_siva) else '{}'::jsonb end
          || case when coalesce(v_lsin, 0) > 0 then jsonb_build_object('lineas_sin_dato', v_lsin) else '{}'::jsonb end
          || case when v_fdud is not null then jsonb_build_object('fechas_dudosas', v_fdud) else '{}'::jsonb end
         )::json;
end;
$function$;

-- ─── 12. ficha_proveedor_agente ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ficha_proveedor_agente(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: ficha de UN proveedor buscado por su
-- nombre canónico, un alias o su nombre comercial (exacto antes que parcial).
-- gasto = total (IVA incluido) de facturas + albaranes sin factura; precios de
-- línea SIN IVA.
declare
  v_n     text := nullif(normalizar_proveedor_base(coalesce(p_texto, '')), '');
  v_id    bigint;
  v_otros jsonb;
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

  if v_id is null then
    return json_build_object('buscado', p_texto, 'sin_datos', true,
                             'nota', 'Ningun proveedor se llama asi (nombre, alias ni nombre comercial).');
  end if;

  with d as (
    select f.* from facturas f
     where f.proveedor_id = v_id
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  fechas as (select count(distinct fecha) as n, min(fecha) as primera, max(fecha) as ultima from d),
  l as (
    select coalesce(pc.nombre, pf.nombre::text) as producto,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as k,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) as imp,
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

-- ─── 13. serie_precios_agente (contrato con la UI de la gráfica) ───────────
CREATE OR REPLACE FUNCTION public.serie_precios_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_unidad text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: serie de precios de UN producto para
-- la gráfica del chat. Contrato (no cambiar sin la UI):
--   {producto, unidad, proveedores:[text], puntos:[['YYYY-MM-DD', precio, idx]],
--    n, min, max, ultimo, variacion_pct}   o   {sin_datos:true, buscado}
--   · idx = posición (desde 0) del proveedor en «proveedores».
--   · Un punto por fecha y proveedor: precio medio ponderado por cantidad, SIN IVA.
--   · Una sola unidad: p_unidad o la más comprada. Máx. 60 puntos (los más
--     recientes), en orden de fecha. Sin albaranes facturados ni precios a 0.
--   · producto = el artículo si es uno solo; si casan varios, el texto buscado.
--   · variacion_pct (primer punto → último) solo con un proveedor y un artículo.
declare
  h      record;
  resultado jsonb;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return jsonb_build_object('sin_datos', true, 'buscado', p_texto);
  end if;
  select * into h from lineas_producto_agente(p_texto);
  if h.ids is null then
    return jsonb_build_object('sin_datos', true, 'buscado', p_texto);
  end if;

  with l as (
    select f.fecha,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.cantidad as cant,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           coalesce(pv.nombre, f.proveedor)::text as prov,
           coalesce(pc.nombre, pf.nombre::text) as nom,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(h.ids)
       and f.fecha is not null
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) > 0
  ),
  u as (
    select coalesce(unidad_agente(p_unidad),
                    (select l.unidad from l group by l.unidad order by count(*) desc, l.unidad limit 1)) as uni
  ),
  pt as (
    select l.fecha, l.prov,
           coalesce(sum(l.precio * l.cant) filter (where l.cant > 0) / nullif(sum(l.cant) filter (where l.cant > 0), 0),
                    avg(l.precio)) as precio
      from l join u on l.unidad = u.uni
     group by l.fecha, l.prov
  ),
  ult as (
    select * from pt order by fecha desc, prov limit 60
  ),
  provs as (
    select prov, row_number() over (order by min(fecha), prov) - 1 as idx
      from ult group by prov
  ),
  orden as (
    select ult.fecha, ult.prov, round(ult.precio, 4) as precio, p.idx,
           row_number() over (order by ult.fecha, ult.prov) as rn,
           count(*) over () as n
      from ult join provs p using (prov)
  )
  select case when (select count(*) from orden) = 0 then null else jsonb_build_object(
    'producto',      (select case when count(distinct l.var) = 1 then min(l.nom) else p_texto end
                        from l join u on l.unidad = u.uni),
    'unidad',        (select uni from u),
    'proveedores',   (select jsonb_agg(prov order by idx) from provs),
    'puntos',        (select jsonb_agg(jsonb_build_array(to_char(fecha, 'YYYY-MM-DD'), trim_scale(precio), idx) order by rn) from orden),
    'n',             (select max(n) from orden),
    'min',           (select trim_scale(min(precio)) from orden),
    'max',           (select trim_scale(max(precio)) from orden),
    'ultimo',        (select trim_scale(precio) from orden order by rn desc limit 1),
    -- Solo con UN proveedor y UN artículo: entre proveedores o artículos es una comparativa.
    'variacion_pct', (select case when max(n) >= 2 and (array_agg(precio order by rn))[1] > 0
                                   and (select count(*) from provs) = 1
                                   and (select count(distinct l.var) from l join u on l.unidad = u.uni) = 1
                                  then round(((array_agg(precio order by rn desc))[1] / (array_agg(precio order by rn))[1] - 1) * 100, 1) end
                        from orden)) end
    into resultado;

  return coalesce(resultado, jsonb_build_object('sin_datos', true, 'buscado', p_texto));
end;
$function$;

-- ─── 14. Permisos ───────────────────────────────────────────────────────────
revoke all on function public.numero_documento_normalizado(text) from public, anon;
grant execute on function public.numero_documento_normalizado(text) to authenticated, service_role;
revoke all on function public.unidad_agente(text) from public, anon;
grant execute on function public.unidad_agente(text) to authenticated, service_role;
revoke all on function public.es_subproducto_agente(text, text[]) from public, anon;
grant execute on function public.es_subproducto_agente(text, text[]) to authenticated, service_role;
revoke all on function public.lineas_producto_agente(text, text) from public, anon;
grant execute on function public.lineas_producto_agente(text, text) to authenticated, service_role;
revoke all on function public.lineas_precio_agente(bigint, bigint[]) from public, anon;
grant execute on function public.lineas_precio_agente(bigint, bigint[]) to authenticated, service_role;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text) to authenticated, service_role;
revoke all on function public.historial_precios_agente(text, integer) from public, anon;
grant execute on function public.historial_precios_agente(text, integer) to authenticated, service_role;
revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) to authenticated, service_role;
revoke all on function public.ranking_agente(text, text, integer, date, date, text, boolean, text, text) from public, anon;
grant execute on function public.ranking_agente(text, text, integer, date, date, text, boolean, text, text) to authenticated, service_role;
revoke all on function public.gasto_categorias_agente(text, date, date, text, text) from public, anon;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text) to authenticated, service_role;
revoke all on function public.consulta_flexible_agente(jsonb) from public, anon;
grant execute on function public.consulta_flexible_agente(jsonb) to authenticated, service_role;
revoke all on function public.ficha_proveedor_agente(text) from public, anon;
grant execute on function public.ficha_proveedor_agente(text) to authenticated, service_role;
revoke all on function public.serie_precios_agente(text, date, date, text) from public, anon;
grant execute on function public.serie_precios_agente(text, date, date, text) to authenticated, service_role;
-- Vínculo: solo desde los triggers (SECURITY DEFINER).
revoke all on function public.vincular_albaranes_proveedor(bigint) from public, anon, authenticated;
revoke all on function public.trg_facturas_vincular_albaranes() from public, anon, authenticated;
revoke all on function public.trg_productos_factura_vincular_albaranes() from public, anon, authenticated;

-- ─── 15. Comprobaciones finales (si fallan, no se aplica nada) ─────────────
do $$
declare
  j jsonb;
  n int;
begin
  j := gasto_categorias_agente('marisco');
  if j ? 'error' or (j #>> '{total,importe}')::numeric < 1000 then
    raise exception 'chatbot_ronda8_cocinero: marisco con tipo null no suma facturas + albaranes: %', j;
  end if;
  j := compras_producto_agente('gambas');
  if j ? 'error' or coalesce(j ->> 'sin_datos', 'false') = 'true' then
    raise exception 'chatbot_ronda8_cocinero: gambas no encuentra el Gambón: %', j;
  end if;
  j := compras_producto_agente('salmonete');
  if j ->> 'coincidencia' is distinct from 'solo_subproductos' then
    raise exception 'chatbot_ronda8_cocinero: salmonete da subproductos como producto: %', j;
  end if;
  j := serie_precios_agente('centollo');
  if not (j ? 'puntos' or j ? 'sin_datos') then
    raise exception 'chatbot_ronda8_cocinero: serie_precios_agente fuera de contrato: %', j;
  end if;
  if historial_precios_agente('merluza')::jsonb ? 'error' or variacion_precios_agente()::jsonb ? 'error'
     or ranking_agente('precio_unitario', null, 5, null, null, 'desc', false, 'kg', null)::jsonb ? 'error'
     or ranking_agente('gasto_proveedor')::jsonb ? 'error'
     or ficha_proveedor_agente('luga')::jsonb ? 'error'
     or consulta_flexible_agente('{"fuente":"lineas","agrupar":["iva_pct"]}')::jsonb ? 'error'
     or consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_total"],"agrupar":["proveedor"]}')::jsonb ? 'error' then
    raise exception 'chatbot_ronda8_cocinero: alguna RPC devuelve error.';
  end if;
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('compras_producto_agente', 'historial_precios_agente', 'variacion_precios_agente', 'lineas_precio_agente',
                       'ranking_agente', 'gasto_categorias_agente', 'consulta_flexible_agente', 'ficha_proveedor_agente',
                       'serie_precios_agente', 'lineas_producto_agente')
     and (has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute')
          or position('20261008120000_chatbot_ronda8_cocinero' in pg_get_functiondef(p.oid)) = 0);
  if n <> 0 then
    raise exception 'chatbot_ronda8_cocinero: % funciones con permisos o cuerpo inesperados.', n;
  end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('compras_producto_agente', 'ranking_agente');
  if n <> 2 then
    raise exception 'chatbot_ronda8_cocinero: quedan % versiones de compras_producto/ranking (esperadas 2).', n;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura).
select format('chatbot_ronda8_cocinero: aplicada | marisco %s | gambas %s | surimi %s | salmonete %s',
              gasto_categorias_agente('marisco')::jsonb #>> '{total,importe}',
              compras_producto_agente('gambas')::jsonb #>> '{productos_coincidentes,0,nombre}',
              compras_producto_agente('surimi')::jsonb #>> '{total,lineas}',
              compras_producto_agente('salmonete')::jsonb ->> 'coincidencia') as resultado;
