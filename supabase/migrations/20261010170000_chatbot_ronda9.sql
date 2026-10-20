set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · chatbot ronda 9: «albarán ya facturado» con UNA regla,   ##
-- ##   albaranes sin factura, variantes con su precio y sugerencias        ##
-- ##   solo con parecido claro (10/10/2026)                                ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (prueba real del chatbot, 10/10/2026, 15 preguntas):
--   · Narejos: la factura 5299 (5/10) cita el albarán 14.877 (1/10, 20
--     mejillones × 4,50) y la nota SN-20261010-NAREJOS (10/10, id 407, 20
--     mejillones × 4,50) NO es ese albarán. Las RPC por producto y categoría
--     la daban por facturada porque la línea coincidía (heurística de
--     producto, cantidad y precio): marisco 2.073,90 € en vez de 2.163,90 €, y
--     «gasto con Narejos» no cuadraba con «marisco» (P13 frente a P15).
--   · «Albaranes sin factura» no tenía herramienta (el modelo respondía con
--     albaranes sin total).
--   · Atún rojo (42 €/kg) y kama/parpatana (23 €/kg) salían con una media de
--     39,11 €/kg; el aceite de girasol alto oleico (1,96) y refinado (1,70)
--     con una media de 1,87 €/l.
--   · «Pulpo de roca» sugería arroz Molino Roca, rabo de ternera, langosta...
--
-- DEPENDE DE (aplicadas): 20261008120000_chatbot_ronda8_cocinero,
-- 20261008140000_productos_contenido_unidad y
-- 20261010110000_albaranes_factura_cotejo (facturas.facturado_origen).
--
-- QUÉ CAMBIA
--   Funciones nuevas (SECURITY INVOKER; sin EXECUTE para anon):
--   · albaranes_facturados_agente(): ÚNICA regla de albarán ya facturado.
--     Cuenta como facturado SOLO si (a) facturas.facturado_en_id lo dice, o
--     (b) una factura del mismo proveedor cita su número (albaran_ref
--     normalizado); nunca por coincidencia de producto/cantidad/precio y
--     nunca si el albarán es de fecha POSTERIOR a la factura. Un albarán
--     desvinculado a mano (facturado_origen = 'manual' sin factura) no cuenta.
--   · albaranes_sin_factura_agente(p_proveedor, p_desde, p_hasta): lo que no
--     está en esa regla, con número, proveedor canónico, fecha, importe (con
--     IVA) y días desde la entrega.
--   RPC reescritas (8; comprueba antes el md5 sin CR de producción):
--   · compras_producto_agente y gasto_categorias_agente: fuera la heurística
--     por coincidencia de líneas; el albarán facturado se saca con la regla
--     única (con tipo = albaranes se cuentan todos, como antes). compras_producto:
--     por_variante (precio de cada variante) cuando dos variantes de la misma
--     unidad difieren más de un 15 %, y entonces no da media global (ni por
--     unidad ni en las filas por proveedor con varias variantes); sugerencias
--     solo con parecido claro (embedding >= 0.5; texto >= 0.5 en la frase y en
--     la primera palabra) y, sin ninguna, «no hay compras» sin sugerir nada.
--   · historial_precios_agente: regla única + por_variante si mezcla artículos.
--   · lineas_precio_agente, serie_precios_agente, ranking_agente,
--     ficha_proveedor_agente: regla única en vez de solo facturado_en_id.
--   · filtrar_documentos_agente: el aviso de «sin factura» remite a la
--     herramienta nueva.
--   Los listados por documento (filtrar_documentos, consulta_flexible,
--   resumen_periodo, estadisticas_globales) siguen enseñando todos los
--   albaranes: son listas, no gasto por producto.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; NO en el SQL Editor):
--   1. npx supabase db query --linked -f supabase/migrations/20261010170000_chatbot_ronda9.sql
--      Tiene que imprimir «chatbot_ronda9: aplicada | marisco ... | narejos ...».
--   2. npx supabase db query --linked -f supabase/tests/chatbot_ronda9_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «chatbot_ronda9_test: OK».
--   3. npx supabase functions deploy chat-facturas --project-ref jeamoczmbfsnwkfjxcyo
--      (la herramienta albaranes_sin_factura llama a la RPC nueva).
--   Deshacer: supabase/rollbacks/20261010170000_chatbot_ronda9_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa ────────────────────────────────────────────────
do $$
declare
  r record;
  v_def text;
begin
  if to_regprocedure('public.numero_documento_normalizado(text)') is null
     or to_regprocedure('public.normalizar_proveedor_base(text)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'facturas' and column_name = 'facturado_origen') then
    raise exception 'chatbot_ronda9: falta 20261008120000_chatbot_ronda8_cocinero o 20261010110000_albaranes_factura_cotejo. No se ha cambiado nada.';
  end if;
  for r in select * from (values
    ('compras_producto_agente(text, date, date, text, integer, text, text, vector, text)', 'a16adc974e61469496d794742002ca34'),
    ('gasto_categorias_agente(text, date, date, text, text)', 'b2c7b0f79ddfecc65d537cd2d5e72eca'),
    ('historial_precios_agente(text, integer)', '7839ef76bad315272b07703072db235b'),
    ('lineas_precio_agente(bigint, bigint[], boolean)', 'cd062e736e2be3763c9e53d663799599'),
    ('ranking_agente(text, text, integer, date, date, text, boolean, text, text)', '5a262bae2c0b2771f2af56a1c68c8ff1'),
    ('serie_precios_agente(text, date, date, text)', '5fe8e1833330e64bbf0bf2badc84f962'),
    ('ficha_proveedor_agente(text)', 'ffee3faae53196da6e88ea23a621c058'),
    ('filtrar_documentos_agente(text, text, text, date, date, text, integer)', 'bad62f16b71b19b8a3311c1c9154ad0e')
  ) t(fn, md5) loop
    v_def := replace(pg_get_functiondef(to_regprocedure('public.' || r.fn)), chr(13), '');
    if v_def is null then
      raise exception 'chatbot_ronda9: no existe %. No se ha cambiado nada.', r.fn;
    end if;
    if md5(v_def) <> r.md5 and position('20261010170000_chatbot_ronda9' in v_def) = 0 then
      raise exception 'chatbot_ronda9: % no es la esperada (md5 %). No se ha cambiado nada.', r.fn, md5(v_def);
    end if;
  end loop;
end;
$$;

-- ─── 1. Funciones nuevas ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.albaranes_facturados_agente()
 RETURNS TABLE(albaran_id bigint, factura_id bigint, motivo text)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
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
    if v_ids is null then
      return json_build_object('buscado', p_proveedor, 'sin_datos', true,
                               'nota', 'Ningun proveedor se llama asi (nombre, alias ni nombre comercial).');
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

revoke all on function public.albaranes_facturados_agente() from public, anon;
revoke all on function public.albaranes_sin_factura_agente(text, date, date) from public, anon;
grant execute on function public.albaranes_facturados_agente() to authenticated, service_role;
grant execute on function public.albaranes_sin_factura_agente(text, date, date) to authenticated, service_role;

comment on function public.albaranes_facturados_agente() is
  'Albaranes ya facturados: facturado_en_id, o una factura del mismo proveedor que cita su numero (nunca por coincidencia de lineas, nunca si el albaran es posterior a la factura). 20261010170000.';

-- ─── 2. compras_producto_agente ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número, nunca por coincidencia de líneas); por_variante cuando las variantes tienen precios distintos; sugerencias solo con parecido claro.
-- 20261008120000_chatbot_ronda8_cocinero: buscador único (lineas_producto_agente),
-- p_unidad, por_proveedor con ultima, ultimo_precio, precio_min y precio_max, sin
-- líneas a 0 €, sin albaranes facturados (facturado_en_id) y total con
-- en_facturas / en_albaranes_sin_factura.
-- 20261008140000_productos_contenido_unidad: + precio_comparable (todo en €/kg, €/l o €/ud) cuando
-- todas las líneas se pueden convertir a la misma unidad y alguna es un envase.
declare
  c_max_variantes constant int := 15;
  c_sim_semantica constant float8 := 0.5;   -- sugerencias por embedding: parecido mínimo
  c_sim_texto     constant float8 := 0.5;   -- sugerencias por texto: frase y primera palabra
  c_dif_variantes constant numeric := 1.15; -- precios de variantes «distintos»: más de un 15 %
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
            having max(1 - (pf.embedding <=> p_embedding)) >= c_sim_semantica
            union all
            select pf.nombre::text, 2,
                   max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' ')))
              from productos_factura pf
             group by pf.nombre
            having max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
               and max(extensions.strict_word_similarity(v_pal[1], array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
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
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo, f.fecha,
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
       and coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) is distinct from 0   -- líneas a 0 €: fuera
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
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
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
           exists (select 1 from prov_multi pm where pm.prov_n = p.prov_n and pm.unidad = p.unidad) as multi,
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
  ),
  -- Precio comparable: solo si TODAS las líneas con precio se pueden pasar a la
  -- misma unidad base (kg, l, ud) y alguna es un envase (caja, cubo, bote...).
  cmp_marco as (
    select min(unidad_base) as ub,
           coalesce(bool_and(unidad_base is not null) and min(unidad_base) = max(unidad_base) and bool_or(conv), false) as ok
      from c
     where pu is not null
  ),
  cmp_prov as (
    select prov_n,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(imp) / nullif(sum(cant * factor), 0) as precio,
           (array_agg(pu / factor order by fecha desc nulls last, doc desc))[1] as ult_precio,
           min(pu / factor) as p_min,
           max(pu / factor) as p_max,
           count(distinct doc) as compras,
           max(fecha) as ultima,
           string_agg(distinct ctxt, ' / ') filter (where conv) as desde,
           row_number() over (order by sum(imp) / nullif(sum(cant * factor), 0), (array_agg(proveedor))[1]) as rn
      from c
     where pu is not null
     group by prov_n
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
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'precio_comparable', (
      select case when cm.ok and not (select ok from var_dist) then jsonb_build_object(
               'unidad_base', cm.ub,
               'criterio', 'Todo convertido a €/' || cm.ub || ' dividiendo el precio del envase por su contenido (convertido_desde). '
                           || 'Compara con ESTOS precios y di de donde viene la conversion.',
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

  return resultado::json;
end;
$function$;

-- ─── 3. gasto_categorias_agente ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número, nunca por coincidencia de líneas); con tipo albaranes se cuentan todos.
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
           coalesce(m.orden, c.orden) as orden,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv         on pv.id = f.proveedor_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán ya facturado (vínculo o factura que cita su número): fuera, salvo que se pidan solo albaranes.
  ya_facturados as (select id from base where fact and v_tipo is null),
  todo as (select * from base where not fact or v_tipo = 'albaran'),
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

-- ─── 4. historial_precios_agente ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.historial_precios_agente(p_producto text, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente(); por_variante cuando mezcla varios artículos.
-- 20261008120000_chatbot_ronda8_cocinero: buscador único, filas idénticas
-- agrupadas (mismo documento, producto, unidad y precio), proveedor canónico,
-- comparativa por proveedor Y unidad, sin albaranes facturados ni precio 0.
-- 20261008140000_productos_contenido_unidad: si todas las compras se pueden pasar a la misma unidad base
-- (kg, l, ud) y alguna es un envase, precio y unidad van convertidos (convertido_desde).
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

  with l0 as (
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
           pf.total,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(h.ids)
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
  ),
  l1 as (
    select l0.*,
           coalesce(bool_and(l0.unidad_base is not null) filter (where l0.precio > 0) over ()
                    and min(l0.unidad_base) filter (where l0.precio > 0) over () = max(l0.unidad_base) filter (where l0.precio > 0) over ()
                    and bool_or(l0.conv) filter (where l0.precio > 0) over (), false) as ok
      from l0
  ),
  l as (
    select l1.id, l1.producto, l1.var, l1.proveedor, l1.prov_k, l1.tipo, l1.numero, l1.fecha, l1.fd,
           case when l1.ok then l1.cantidad * l1.factor else l1.cantidad end as cantidad,
           case when l1.ok then l1.unidad_base else l1.unidad end as unidad,
           case when l1.ok then round(l1.precio / l1.factor, 4) else l1.precio end as precio,
           l1.total,
           case when l1.ok and l1.conv then l1.ctxt end as desde
      from l1
  ),
  g as (   -- filas idénticas en una sola
    select producto, var, proveedor, prov_k, tipo, numero, fecha, bool_or(fd) as fd, unidad, precio,
           sum(cantidad) as cantidad, round(sum(total)::numeric, 2) as importe, count(*) as veces, min(id) as id,
           max(desde) as desde
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
  ),
  var_g as (   -- cada artículo con su precio (si mezcla varios)
    select var, min(producto) as producto, unidad, count(*) as veces,
           round(min(precio), 2) as precio_min, round(max(precio), 2) as precio_max,
           (array_agg(precio order by fecha desc nulls last, id desc))[1] as ultimo_precio,
           max(fecha) as ultima_compra
      from compras
     group by var, unidad
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
    'convertido_a', (select max(unidad) from compras where desde is not null),
    'variantes_distintas', (select case when variantes > 1 then variantes end from marco),
    'por_variante', (
      select case when m.variantes > 1 then (
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'producto', x.producto, 'unidad', x.unidad, 'veces', x.veces,
                        'precio_min', x.precio_min,
                        'precio_max', case when x.precio_max <> x.precio_min then x.precio_max end,
                        'ultimo_precio', trim_scale(x.ultimo_precio), 'ultima_compra', x.ultima_compra))
                      order by x.veces desc, x.producto)
               from (select * from var_g order by veces desc, producto limit 8) x) end
        from marco m),
    'nota_coincidencia', (
      select case when m.variantes > 1 then
        'Mezcla ' || m.variantes || ' articulos distintos: da cada uno con su precio (por_variante), no un unico precio medio.'
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
               'convertido_desde', desde,
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

-- ─── 5. lineas_precio_agente ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lineas_precio_agente(p_producto_id bigint DEFAULT NULL::bigint, p_ids bigint[] DEFAULT NULL::bigint[], p_base boolean DEFAULT false)
 RETURNS TABLE(id bigint, factura_id bigint, producto_id bigint, unidad text, cantidad numeric, precio numeric, fecha date, tipo text, numero text, proveedor text, prov_n text, created_at timestamp without time zone, convertida boolean, convertido_desde text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número).
-- 20261008140000_productos_contenido_unidad: + p_base (precio en €/kg, €/l o €/ud cuando todo el producto es convertible),
-- 20261008140000_productos_contenido_unidad: convertida y convertido_desde. Con p_base = false (por defecto) devuelve lo de siempre.
  -- 20261008120000_chatbot_ronda8_cocinero: fuera el albarán ya facturado (facturado_en_id).
  with l as (
    select pf.id, pf.factura_id, pf.producto_id,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.numero_documento::text as numero, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           pf.created_at,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.producto_id is not null
       and (p_producto_id is null or pf.producto_id = p_producto_id)
       and (p_ids is null or pf.id = any(p_ids))
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
  ),
  v as (
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
  ),
  -- Con p_base: si TODAS las líneas del producto se pueden pasar a la misma unidad
  -- base (kg, l, ud) y alguna es un envase, precio y cantidad van en esa unidad.
  k as (
    select v.*,
           coalesce(p_base
                    and bool_and(v.unidad_base is not null) over w
                    and min(v.unidad_base) over w = max(v.unidad_base) over w
                    and bool_or(v.conv) over w, false) as ok
      from v
    window w as (partition by v.producto_id)
  )
  select k.id, k.factura_id, k.producto_id,
         case when k.ok then k.unidad_base else k.unidad end,
         case when k.ok then k.cantidad * k.factor else k.cantidad end,
         case when k.ok then round(k.precio / k.factor, 4) else k.precio end,
         k.fecha, k.tipo, k.numero, k.proveedor, k.prov_n, k.created_at,
         k.ok and k.conv,
         case when k.ok and k.conv then k.ctxt end
    from k
$function$;

-- ─── 6. ranking_agente ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ranking_agente(p_criterio text, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'desc'::text, p_incluir_servicios boolean DEFAULT false, p_unidad text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número).
-- 20261008120000_chatbot_ronda8_cocinero: p_unidad y p_categoria (criterios de
-- líneas) y sin albaranes facturados (facturado_en_id).
-- 20261008140000_productos_contenido_unidad: en precio_unitario con p_unidad kg o l, un producto cuyas líneas se
-- pueden pasar todas a esa unidad y alguna es un envase se ordena y se muestra
-- en €/kg o €/l (convertido_desde en la fila). Sin p_unidad: como siempre.
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
  v_conv  boolean := false;
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
    with l0 as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             coalesce('c' || pf.producto_id, coalesce(pf.nombre_normalizado, lower(pf.nombre))) as grupo,
             pf.cantidad, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
             pf.precio_unitario, pf.total,
             f.tipo, coalesce((select pv.nombre from proveedores pv where pv.id = f.proveedor_id), f.proveedor) as proveedor,
             f.numero_documento, f.fecha,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))           as servicio,
             bl.unidad_base, bl.factor, bl.convertida as conv,
             contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
        left join productos_catalogo pc on pc.id = pf.producto_id
        left join categorias_producto c on c.id = pc.categoria_id
        cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
        cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
         and (v_cat is null or c.id = v_cat or c.padre_id = v_cat)
    ),
    l1 as (
      select l0.*,
             coalesce(v_crit = 'precio_unitario' and v_uni in ('kg', 'l')
                      and bool_and(l0.unidad_base is not null) filter (where l0.precio_unitario > 0) over w
                      and min(l0.unidad_base) filter (where l0.precio_unitario > 0) over w
                          = max(l0.unidad_base) filter (where l0.precio_unitario > 0) over w
                      and bool_or(l0.conv) filter (where l0.precio_unitario > 0) over w, false) as ok
        from l0
      window w as (partition by l0.grupo)
    ),
    l as (
      select l1.id, l1.nombre, l1.clave,
             case when l1.ok then trim_scale(l1.cantidad * l1.factor) else l1.cantidad end as cantidad,
             case when l1.ok then l1.unidad_base else l1.unidad end as unidad,
             case when l1.ok then round(l1.precio_unitario / l1.factor, 4) else l1.precio_unitario end as precio_unitario,
             l1.total, l1.tipo, l1.proveedor, l1.numero_documento, l1.fecha,
             case when v_crit = 'precio_unitario'
                  then (case when l1.ok then round(l1.precio_unitario / l1.factor, 4) else l1.precio_unitario end)
                  else l1.total end as valor,
             l1.servicio,
             case when l1.ok and l1.conv then l1.ctxt end as desde
        from l1
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
                 'convertido_desde', desde,
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

    v_conv := position('convertido_desde' in v_filas::text) > 0;
    v_txt := case when v_crit = 'precio_unitario'
                  then 'Precio unitario de linea SIN IVA'
                       || case when v_conv then ' (los envases, convertidos a €/kg o €/l: ver convertido_desde)' else '' end
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
         and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
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
         and not (tipo = 'albaran' and id in (select albaran_id from albaranes_facturados_agente()))
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
         and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
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

-- ─── 7. serie_precios_agente ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.serie_precios_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_unidad text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número).
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
-- 20261008140000_productos_contenido_unidad: si todas las compras se pueden pasar a la misma unidad base
-- (kg, l, ud) y alguna es un envase, los precios van en esa unidad y se añade
-- convertido_desde («caja de 10 kg»). Contrato con la UI intacto (solo una clave más).
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

  with l0 as (
    select f.fecha,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.cantidad as cant,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           coalesce(pv.nombre, f.proveedor)::text as prov,
           coalesce(pc.nombre, pf.nombre::text) as nom,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(h.ids)
       and f.fecha is not null
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) > 0
  ),
  l1 as (
    select l0.*,
           coalesce(bool_and(l0.unidad_base is not null) over ()
                    and min(l0.unidad_base) over () = max(l0.unidad_base) over ()
                    and bool_or(l0.conv) over ()
                    and (p_unidad is null or unidad_agente(p_unidad) = min(l0.unidad_base) over ()), false) as ok
      from l0
  ),
  l as (
    select l1.fecha,
           case when l1.ok then l1.unidad_base else l1.unidad end as unidad,
           case when l1.ok then l1.cant * l1.factor else l1.cant end as cant,
           case when l1.ok then l1.precio / l1.factor else l1.precio end as precio,
           l1.prov, l1.nom, l1.var,
           case when l1.ok and l1.conv then l1.ctxt end as desde
      from l1
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
                        from orden))
         || coalesce((select jsonb_build_object('convertido_desde', z.d)
                        from (select string_agg(distinct l.desde, ' / ') as d
                                from l join u on l.unidad = u.uni) z
                       where z.d is not null), '{}'::jsonb) end
    into resultado;

  return coalesce(resultado, jsonb_build_object('sin_datos', true, 'buscado', p_texto));
end;
$function$;

-- ─── 8. ficha_proveedor_agente ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ficha_proveedor_agente(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: albarán facturado = albaranes_facturados_agente() (vínculo o factura que cita su número).
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
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
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

-- ─── 9. filtrar_documentos_agente ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.filtrar_documentos_agente(p_filtro text DEFAULT 'todos'::text, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'fecha_desc'::text, p_limite integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9: el aviso de «sin factura» remite a albaranes_sin_factura.
declare
  c_filtros constant text[] := array['todos', 'sin_total', 'sin_verificar', 'con_alertas', 'fecha_dudosa'];
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
begin
  -- «Sin factura», «sin facturar», «albaranes sin factura»…: no es un filtro de
  -- esta herramienta (albaranes_sin_factura). Se dice claro en vez de dejar que
  -- el modelo lo confunda con sin_total (prueba del 05/10, q19).
  if v_filtro ~ '(factur|albar|vincul|relacion|pagad|pago)' then
    return json_build_object(
      'error', 'Para albaranes sin factura / ya facturados usa la herramienta albaranes_sin_factura. No hay estado de pago: no se sabe que esta pagado. sin_total NO significa sin factura.');
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
  v_cuenta := v_filtro <> 'todos';

  if v_texto is not null then
    v_num  := nullif(regexp_replace(regexp_replace(lower(v_texto), '[^a-z0-9]', '', 'g'), '^0+', ''), '');
    v_prov := nullif(normalizar_proveedor(v_texto), '');
  end if;

  with m as (
    select f.*
      from facturas f
     where (v_tipo is null or f.tipo = v_tipo)
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_texto is null
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
                            'deducidos', case when not v_cuenta then nullif(count(*) filter (where tipo = 'albaran' and total_origen = 'deducido'), 0) end) end))
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
  into v_total, v_filas, v_sumas, v_sint, v_ded;

  return (jsonb_build_object(
            'criterio', format('filtro=%s%s%s%s%s; orden=%s', v_filtro,
                               case when v_texto is not null then '; texto=' || v_texto else '' end,
                               case when v_tipo is not null then '; tipo=' || v_tipo else '' end,
                               case when p_desde is not null then '; desde=' || p_desde else '' end,
                               case when p_hasta is not null then '; hasta=' || p_hasta else '' end,
                               v_orden)
                        || case when v_cuenta then '; solo conteo: para importes usa consulta_flexible' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim,
            'sumas',       coalesce(v_sumas, '{}'::jsonb))
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

-- ─── 10. Comprobación final ────────────────────────────────────────────────
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('compras_producto_agente', 'gasto_categorias_agente', 'historial_precios_agente', 'lineas_precio_agente', 'ranking_agente', 'serie_precios_agente', 'ficha_proveedor_agente', 'filtrar_documentos_agente')
     and (has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute')
          or position('20261010170000_chatbot_ronda9' in pg_get_functiondef(p.oid)) = 0);
  if n <> 0 then
    raise exception 'chatbot_ronda9: % funciones con permisos o cuerpo inesperados.', n;
  end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('albaranes_facturados_agente', 'albaranes_sin_factura_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 2 then
    raise exception 'chatbot_ronda9: las dos funciones nuevas no tienen los permisos esperados (%).', n;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura).
select format('chatbot_ronda9: aplicada | marisco %s | narejos %s',
              gasto_categorias_agente('marisco', date '2026-10-01', date '2026-10-31')::jsonb #>> '{total,importe}',
              ficha_proveedor_agente('narejos')::jsonb ->> 'gasto') as resultado;
