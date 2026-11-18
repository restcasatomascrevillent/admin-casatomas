set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212410000_chat_facturas_decisiones_dueno · ROLLBACK · Facturas (18/11/2026)
-- Decisiones del dueño sobre 4 casos de la batería del chat de Facturas:
--  · r109 «chuletón» a Nicolás y Valero: el proveedor factura chuleta/chuletero. Se CUENTAN (misma raíz, mismo tipo de producto,
--    mismo proveedor) y el chat AVISA con qué nombre se compra; el plato elaborado (tataki) no suma. compras_producto_agente.
--  · r114 «precio kilo gamba roja»: el último precio sale de la última compra con proveedor identificado; un documento más nuevo
--    sin identificar (SN-DESCONOCIDO) se menciona como dudoso. volumen_comprado_agente (ultima_compra / ultima_sin_identificar)
--    y compras_producto_agente (ultima_factura solo con proveedor; ultima_sin_identificar).
--  · n55 «litros de cerveza»: total + desglose_envase (barril / botella_lata / otros) en volumen_comprado_agente.
-- Parchea la definición VIVA de cada función con sustituciones de texto (como 20261211300000): vale con o sin los descuentos
-- (importe_neto) y aborta sin cambiar nada si el texto no es el esperado.
-- Deshace el parche.
-- ============================================================================
set lock_timeout = '5s';

do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.compras_producto_agente'::regproc);
  if (length(v_def) - length(replace(v_def, $a0$  resultado jsonb;
  v_var   jsonb;      -- 20261212410000: variante cercana
  v_alt   bigint[];
  v_stem  text;
  v_names text[];
  v_elab  jsonb;$a0$, ''))) <> length($a0$  resultado jsonb;
  v_var   jsonb;      -- 20261212410000: variante cercana
  v_alt   bigint[];
  v_stem  text;
  v_names text[];
  v_elab  jsonb;$a0$) then
    raise exception '20261212410000: compras_producto_agente: el texto a cambiar (parche 1) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a0$  resultado jsonb;
  v_var   jsonb;      -- 20261212410000: variante cercana
  v_alt   bigint[];
  v_stem  text;
  v_names text[];
  v_elab  jsonb;$a0$, $b0$  resultado jsonb;$b0$);
  if (length(v_def) - length(replace(v_def, $a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- 20261212410000 (decision del dueño, r109): con un PROVEEDOR pedido y una sola palabra («chuletón»), si ese proveedor no
  -- factura esa palabra pero si una variante MUY cercana (misma raiz: chuleta, chuletero), se cuentan sus compras y se AVISA con
  -- que nombre se compra. Estrecho a proposito: raiz de >= 5 letras, la palabra es la CABEZA del nombre de la linea («CHULETA DE
  -- VACA», no «TATAKI DE CHULETA», que es un plato elaborado y va aparte sin sumar) y solo lineas de ESE proveedor.
  if cardinality(v_pal) = 1 and (v_prov_id is not null or cardinality(v_provw) > 0) then
    v_stem := raiz_variante_agente(v_pal[1]);
    if length(v_stem) >= 5 and not exists (
         select 1 from productos_factura pf
           join facturas f on f.id = pf.factura_id
           left join proveedores pv on pv.id = f.proveedor_id
          where pf.id = any(coalesce(v_ids, '{}'::bigint[]))
            and (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                      else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)) then
      select array_agg(q.id order by q.id) filter (where q.cabeza),
             array_agg(distinct regexp_replace(q.cab, 's$', '')) filter (where q.cabeza),
             jsonb_agg(distinct q.nom) filter (where q.alguna and not q.cabeza)
        into v_alt, v_names, v_elab
        from (select pf.id, pf.nombre::text as nom,
                     cabeza_nombre_agente(pf.nombre::text) as cab,
                     raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,
                     exists (select 1 from regexp_split_to_table(translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu'), '[^a-z0-9ñ]+') x
                              where raiz_variante_agente(x) = v_stem) as alguna
                from productos_factura pf
                join facturas f on f.id = pf.factura_id
                left join proveedores pv on pv.id = f.proveedor_id
               where (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                           else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)
                 and translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu') like '%' || left(v_stem, 5) || '%') q;
      if v_alt is not null then
        v_ids := v_alt;
        v_met := 'variante_cercana';
        v_aprox := true;
        v_var := jsonb_strip_nulls(jsonb_build_object(
          'pedido', p_texto,
          'se_compra_como', to_jsonb(v_names),
          'platos_elaborados_no_sumados', v_elab,
          'nota', 'Este proveedor NO factura «' || p_texto || '»: factura ' || array_to_string(v_names, ' / ')
                  || ' (misma raiz y mismo tipo de producto). Todo lo que sale (total, ultima_factura, por_proveedor, productos_coincidentes) '
                  || 'es de ESAS variantes. EMPIEZA AVISANDO: «No compras ' || p_texto || ' a este proveedor; compras ' || array_to_string(v_names, '/')
                  || ': …» y da cada una con su nombre real. Los platos elaborados (platos_elaborados_no_sumados) NO se suman: mencionalos aparte.'));
      end if;
    end if;
  end if;$a1$, ''))) <> length($a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- 20261212410000 (decision del dueño, r109): con un PROVEEDOR pedido y una sola palabra («chuletón»), si ese proveedor no
  -- factura esa palabra pero si una variante MUY cercana (misma raiz: chuleta, chuletero), se cuentan sus compras y se AVISA con
  -- que nombre se compra. Estrecho a proposito: raiz de >= 5 letras, la palabra es la CABEZA del nombre de la linea («CHULETA DE
  -- VACA», no «TATAKI DE CHULETA», que es un plato elaborado y va aparte sin sumar) y solo lineas de ESE proveedor.
  if cardinality(v_pal) = 1 and (v_prov_id is not null or cardinality(v_provw) > 0) then
    v_stem := raiz_variante_agente(v_pal[1]);
    if length(v_stem) >= 5 and not exists (
         select 1 from productos_factura pf
           join facturas f on f.id = pf.factura_id
           left join proveedores pv on pv.id = f.proveedor_id
          where pf.id = any(coalesce(v_ids, '{}'::bigint[]))
            and (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                      else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)) then
      select array_agg(q.id order by q.id) filter (where q.cabeza),
             array_agg(distinct regexp_replace(q.cab, 's$', '')) filter (where q.cabeza),
             jsonb_agg(distinct q.nom) filter (where q.alguna and not q.cabeza)
        into v_alt, v_names, v_elab
        from (select pf.id, pf.nombre::text as nom,
                     cabeza_nombre_agente(pf.nombre::text) as cab,
                     raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,
                     exists (select 1 from regexp_split_to_table(translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu'), '[^a-z0-9ñ]+') x
                              where raiz_variante_agente(x) = v_stem) as alguna
                from productos_factura pf
                join facturas f on f.id = pf.factura_id
                left join proveedores pv on pv.id = f.proveedor_id
               where (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                           else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)
                 and translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu') like '%' || left(v_stem, 5) || '%') q;
      if v_alt is not null then
        v_ids := v_alt;
        v_met := 'variante_cercana';
        v_aprox := true;
        v_var := jsonb_strip_nulls(jsonb_build_object(
          'pedido', p_texto,
          'se_compra_como', to_jsonb(v_names),
          'platos_elaborados_no_sumados', v_elab,
          'nota', 'Este proveedor NO factura «' || p_texto || '»: factura ' || array_to_string(v_names, ' / ')
                  || ' (misma raiz y mismo tipo de producto). Todo lo que sale (total, ultima_factura, por_proveedor, productos_coincidentes) '
                  || 'es de ESAS variantes. EMPIEZA AVISANDO: «No compras ' || p_texto || ' a este proveedor; compras ' || array_to_string(v_names, '/')
                  || ': …» y da cada una con su nombre real. Los platos elaborados (platos_elaborados_no_sumados) NO se suman: mencionalos aparte.'));
      end if;
    end if;
  end if;$a1$) then
    raise exception '20261212410000: compras_producto_agente: el texto a cambiar (parche 2) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- 20261212410000 (decision del dueño, r109): con un PROVEEDOR pedido y una sola palabra («chuletón»), si ese proveedor no
  -- factura esa palabra pero si una variante MUY cercana (misma raiz: chuleta, chuletero), se cuentan sus compras y se AVISA con
  -- que nombre se compra. Estrecho a proposito: raiz de >= 5 letras, la palabra es la CABEZA del nombre de la linea («CHULETA DE
  -- VACA», no «TATAKI DE CHULETA», que es un plato elaborado y va aparte sin sumar) y solo lineas de ESE proveedor.
  if cardinality(v_pal) = 1 and (v_prov_id is not null or cardinality(v_provw) > 0) then
    v_stem := raiz_variante_agente(v_pal[1]);
    if length(v_stem) >= 5 and not exists (
         select 1 from productos_factura pf
           join facturas f on f.id = pf.factura_id
           left join proveedores pv on pv.id = f.proveedor_id
          where pf.id = any(coalesce(v_ids, '{}'::bigint[]))
            and (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                      else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)) then
      select array_agg(q.id order by q.id) filter (where q.cabeza),
             array_agg(distinct regexp_replace(q.cab, 's$', '')) filter (where q.cabeza),
             jsonb_agg(distinct q.nom) filter (where q.alguna and not q.cabeza)
        into v_alt, v_names, v_elab
        from (select pf.id, pf.nombre::text as nom,
                     cabeza_nombre_agente(pf.nombre::text) as cab,
                     raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,
                     exists (select 1 from regexp_split_to_table(translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu'), '[^a-z0-9ñ]+') x
                              where raiz_variante_agente(x) = v_stem) as alguna
                from productos_factura pf
                join facturas f on f.id = pf.factura_id
                left join proveedores pv on pv.id = f.proveedor_id
               where (case when v_prov_id is not null then f.proveedor_id = v_prov_id
                           else not exists (select 1 from unnest(v_provw) w where position(w in lower(coalesce(pv.nombre, f.proveedor)::text)) = 0) end)
                 and translate(lower(pf.nombre::text), 'áéíóúü', 'aeiouu') like '%' || left(v_stem, 5) || '%') q;
      if v_alt is not null then
        v_ids := v_alt;
        v_met := 'variante_cercana';
        v_aprox := true;
        v_var := jsonb_strip_nulls(jsonb_build_object(
          'pedido', p_texto,
          'se_compra_como', to_jsonb(v_names),
          'platos_elaborados_no_sumados', v_elab,
          'nota', 'Este proveedor NO factura «' || p_texto || '»: factura ' || array_to_string(v_names, ' / ')
                  || ' (misma raiz y mismo tipo de producto). Todo lo que sale (total, ultima_factura, por_proveedor, productos_coincidentes) '
                  || 'es de ESAS variantes. EMPIEZA AVISANDO: «No compras ' || p_texto || ' a este proveedor; compras ' || array_to_string(v_names, '/')
                  || ': …» y da cada una con su nombre real. Los platos elaborados (platos_elaborados_no_sumados) NO se suman: mencionalos aparte.'));
      end if;
    end if;
  end if;$a1$, $b1$  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);$b1$);
  if (length(v_def) - length(replace(v_def, $a2$       where x.pu is not null and x.prov_id is not null   -- 20261212410000: solo proveedor identificado$a2$, ''))) <> length($a2$       where x.pu is not null and x.prov_id is not null   -- 20261212410000: solo proveedor identificado$a2$) then
    raise exception '20261212410000: compras_producto_agente: el texto a cambiar (parche 3) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a2$       where x.pu is not null and x.prov_id is not null   -- 20261212410000: solo proveedor identificado$a2$, $b2$       where x.pu is not null$b2$);
  if (length(v_def) - length(replace(v_def, $a3$    -- 20261212410000 (decision del dueño, r114): un documento MAS NUEVO sin proveedor identificado (SN-DESCONOCIDO, fecha o datos
    -- dudosos) no es referencia de precio: se menciona aparte como dudoso.
    'ultima_sin_identificar', (
      select jsonb_strip_nulls(jsonb_build_object(
               'fecha', x.fecha, 'numero', x.numero, 'documento_id', x.doc, 'tipo', x.tipo, 'producto', x.nombre,
               'cantidad', trim_scale(round(x.cant, 3)), 'unidad', x.unidad,
               'precio_unitario', trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)),
               'fecha_dudosa', case when x.fd then true end,
               'nota', 'Documento sin proveedor identificado, MAS NUEVO que ultima_factura: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.'))
        from c x
       where x.pu is not null and x.prov_id is null
         and (not exists (select 1 from c y where y.pu is not null and y.prov_id is not null)
              or (x.fecha, x.doc) > (select y.fecha, y.doc from c y where y.pu is not null and y.prov_id is not null
                                      order by y.fecha desc nulls last, y.doc desc, y.id desc limit 1))
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', ($a3$, ''))) <> length($a3$    -- 20261212410000 (decision del dueño, r114): un documento MAS NUEVO sin proveedor identificado (SN-DESCONOCIDO, fecha o datos
    -- dudosos) no es referencia de precio: se menciona aparte como dudoso.
    'ultima_sin_identificar', (
      select jsonb_strip_nulls(jsonb_build_object(
               'fecha', x.fecha, 'numero', x.numero, 'documento_id', x.doc, 'tipo', x.tipo, 'producto', x.nombre,
               'cantidad', trim_scale(round(x.cant, 3)), 'unidad', x.unidad,
               'precio_unitario', trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)),
               'fecha_dudosa', case when x.fd then true end,
               'nota', 'Documento sin proveedor identificado, MAS NUEVO que ultima_factura: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.'))
        from c x
       where x.pu is not null and x.prov_id is null
         and (not exists (select 1 from c y where y.pu is not null and y.prov_id is not null)
              or (x.fecha, x.doc) > (select y.fecha, y.doc from c y where y.pu is not null and y.prov_id is not null
                                      order by y.fecha desc nulls last, y.doc desc, y.id desc limit 1))
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', ($a3$) then
    raise exception '20261212410000: compras_producto_agente: el texto a cambiar (parche 4) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a3$    -- 20261212410000 (decision del dueño, r114): un documento MAS NUEVO sin proveedor identificado (SN-DESCONOCIDO, fecha o datos
    -- dudosos) no es referencia de precio: se menciona aparte como dudoso.
    'ultima_sin_identificar', (
      select jsonb_strip_nulls(jsonb_build_object(
               'fecha', x.fecha, 'numero', x.numero, 'documento_id', x.doc, 'tipo', x.tipo, 'producto', x.nombre,
               'cantidad', trim_scale(round(x.cant, 3)), 'unidad', x.unidad,
               'precio_unitario', trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)),
               'fecha_dudosa', case when x.fd then true end,
               'nota', 'Documento sin proveedor identificado, MAS NUEVO que ultima_factura: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.'))
        from c x
       where x.pu is not null and x.prov_id is null
         and (not exists (select 1 from c y where y.pu is not null and y.prov_id is not null)
              or (x.fecha, x.doc) > (select y.fecha, y.doc from c y where y.pu is not null and y.prov_id is not null
                                      order by y.fecha desc nulls last, y.doc desc, y.id desc limit 1))
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', ($a3$, $b3$    'como_leer', ($b3$);
  if (length(v_def) - length(replace(v_def, $a4$      'posibles_coincidencias', v_posj,
      'variante_cercana', v_var,
      'ultima_sin_identificar', resultado -> 'ultima_sin_identificar',$a4$, ''))) <> length($a4$      'posibles_coincidencias', v_posj,
      'variante_cercana', v_var,
      'ultima_sin_identificar', resultado -> 'ultima_sin_identificar',$a4$) then
    raise exception '20261212410000: compras_producto_agente: el texto a cambiar (parche 5) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a4$      'posibles_coincidencias', v_posj,
      'variante_cercana', v_var,
      'ultima_sin_identificar', resultado -> 'ultima_sin_identificar',$a4$, $b4$      'posibles_coincidencias', v_posj,$b4$);
  execute v_def;

  v_def := pg_get_functiondef('public.volumen_comprado_agente'::regproc);
  if (length(v_def) - length(replace(v_def, $a0$  -- 20261212410000 (decision del dueño, n55): desglose por tipo de envase. barril por un lado, botella/lata/pack por otro (cada uno
  -- con sus formatos); lo demas (garrafa, bidon, sin formato) en «otros». La suma es el total.
  desglose as (
    select g.grupo, round(sum(g.total), 2) as total, round(sum(g.envases)) as envases,
           json_agg(json_build_object('formato', coalesce(g.formato, 'sin formato'), 'total', g.total, 'envases', g.envases) order by g.total desc) as formatos
      from (select case when o.tipo like 'barril %' then 'barril'
                        when o.tipo is null or o.tipo ~ '^(bidón|garrafa)' then 'otros'
                        else 'botella_lata' end as grupo,
                   o.tipo as formato, round(sum(o.cantidad_base), 2) as total, round(sum(o.env_n)) as envases
              from ok o group by o.tipo) g
     group by g.grupo
  ),
  -- Ultima compra con PROVEEDOR IDENTIFICADO (fecha, proveedor, numero, € por litro/kilo) y, si hay un documento mas nuevo sin
  -- identificar (SN-DESCONOCIDO…), ese aparte como dudoso (decision del dueño, r114).
  ult_id as (
    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null
     order by o.fecha desc, o.doc_id desc, o.linea_id desc limit 1
  ),
  por_prov as ($a0$, ''))) <> length($a0$  -- 20261212410000 (decision del dueño, n55): desglose por tipo de envase. barril por un lado, botella/lata/pack por otro (cada uno
  -- con sus formatos); lo demas (garrafa, bidon, sin formato) en «otros». La suma es el total.
  desglose as (
    select g.grupo, round(sum(g.total), 2) as total, round(sum(g.envases)) as envases,
           json_agg(json_build_object('formato', coalesce(g.formato, 'sin formato'), 'total', g.total, 'envases', g.envases) order by g.total desc) as formatos
      from (select case when o.tipo like 'barril %' then 'barril'
                        when o.tipo is null or o.tipo ~ '^(bidón|garrafa)' then 'otros'
                        else 'botella_lata' end as grupo,
                   o.tipo as formato, round(sum(o.cantidad_base), 2) as total, round(sum(o.env_n)) as envases
              from ok o group by o.tipo) g
     group by g.grupo
  ),
  -- Ultima compra con PROVEEDOR IDENTIFICADO (fecha, proveedor, numero, € por litro/kilo) y, si hay un documento mas nuevo sin
  -- identificar (SN-DESCONOCIDO…), ese aparte como dudoso (decision del dueño, r114).
  ult_id as (
    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null
     order by o.fecha desc, o.doc_id desc, o.linea_id desc limit 1
  ),
  por_prov as ($a0$) then
    raise exception '20261212410000: volumen_comprado_agente: el texto a cambiar (parche 1) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a0$  -- 20261212410000 (decision del dueño, n55): desglose por tipo de envase. barril por un lado, botella/lata/pack por otro (cada uno
  -- con sus formatos); lo demas (garrafa, bidon, sin formato) en «otros». La suma es el total.
  desglose as (
    select g.grupo, round(sum(g.total), 2) as total, round(sum(g.envases)) as envases,
           json_agg(json_build_object('formato', coalesce(g.formato, 'sin formato'), 'total', g.total, 'envases', g.envases) order by g.total desc) as formatos
      from (select case when o.tipo like 'barril %' then 'barril'
                        when o.tipo is null or o.tipo ~ '^(bidón|garrafa)' then 'otros'
                        else 'botella_lata' end as grupo,
                   o.tipo as formato, round(sum(o.cantidad_base), 2) as total, round(sum(o.env_n)) as envases
              from ok o group by o.tipo) g
     group by g.grupo
  ),
  -- Ultima compra con PROVEEDOR IDENTIFICADO (fecha, proveedor, numero, € por litro/kilo) y, si hay un documento mas nuevo sin
  -- identificar (SN-DESCONOCIDO…), ese aparte como dudoso (decision del dueño, r114).
  ult_id as (
    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null
     order by o.fecha desc, o.doc_id desc, o.linea_id desc limit 1
  ),
  por_prov as ($a0$, $b0$  por_prov as ($b0$);
  if (length(v_def) - length(replace(v_def, $a1$    'productos', (select count(*) from por_prod),
    'desglose_envase', (select case when exists (select 1 from ok o where o.tipo is not null) then
                          json_agg(json_build_object('grupo', d.grupo, 'total', d.total, 'envases', d.envases, 'formatos', d.formatos) order by d.total desc) end
                          from desglose d),
    'ultima_compra', (select json_build_object('fecha', u.fecha, 'proveedor', u.proveedor_txt,
                                               'numero', (select f.numero_documento from facturas f where f.id = u.doc_id),
                                               'producto', coalesce(u.producto, u.nombre_linea), 'precio', round(u.pl, 2), 'unidad', (select m from med))
                        from ult_id u),
    'ultima_sin_identificar', (select json_build_object('fecha', s.fecha, 'numero', (select f.numero_documento from facturas f where f.id = s.doc_id),
                                          'producto', coalesce(s.producto, s.nombre_linea), 'precio', round(s.pl, 2), 'unidad', (select m from med),
                                          'nota', 'Documento SIN proveedor identificado y MAS NUEVO que ultima_compra: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.')
                                 from ok s
                                where s.proveedor_id is null and s.pl is not null
                                  and (not exists (select 1 from ult_id) or (s.fecha, s.doc_id) > (select i.fecha, i.doc_id from ult_id i))
                                order by s.fecha desc, s.doc_id desc, s.linea_id desc limit 1),$a1$, ''))) <> length($a1$    'productos', (select count(*) from por_prod),
    'desglose_envase', (select case when exists (select 1 from ok o where o.tipo is not null) then
                          json_agg(json_build_object('grupo', d.grupo, 'total', d.total, 'envases', d.envases, 'formatos', d.formatos) order by d.total desc) end
                          from desglose d),
    'ultima_compra', (select json_build_object('fecha', u.fecha, 'proveedor', u.proveedor_txt,
                                               'numero', (select f.numero_documento from facturas f where f.id = u.doc_id),
                                               'producto', coalesce(u.producto, u.nombre_linea), 'precio', round(u.pl, 2), 'unidad', (select m from med))
                        from ult_id u),
    'ultima_sin_identificar', (select json_build_object('fecha', s.fecha, 'numero', (select f.numero_documento from facturas f where f.id = s.doc_id),
                                          'producto', coalesce(s.producto, s.nombre_linea), 'precio', round(s.pl, 2), 'unidad', (select m from med),
                                          'nota', 'Documento SIN proveedor identificado y MAS NUEVO que ultima_compra: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.')
                                 from ok s
                                where s.proveedor_id is null and s.pl is not null
                                  and (not exists (select 1 from ult_id) or (s.fecha, s.doc_id) > (select i.fecha, i.doc_id from ult_id i))
                                order by s.fecha desc, s.doc_id desc, s.linea_id desc limit 1),$a1$) then
    raise exception '20261212410000: volumen_comprado_agente: el texto a cambiar (parche 2) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a1$    'productos', (select count(*) from por_prod),
    'desglose_envase', (select case when exists (select 1 from ok o where o.tipo is not null) then
                          json_agg(json_build_object('grupo', d.grupo, 'total', d.total, 'envases', d.envases, 'formatos', d.formatos) order by d.total desc) end
                          from desglose d),
    'ultima_compra', (select json_build_object('fecha', u.fecha, 'proveedor', u.proveedor_txt,
                                               'numero', (select f.numero_documento from facturas f where f.id = u.doc_id),
                                               'producto', coalesce(u.producto, u.nombre_linea), 'precio', round(u.pl, 2), 'unidad', (select m from med))
                        from ult_id u),
    'ultima_sin_identificar', (select json_build_object('fecha', s.fecha, 'numero', (select f.numero_documento from facturas f where f.id = s.doc_id),
                                          'producto', coalesce(s.producto, s.nombre_linea), 'precio', round(s.pl, 2), 'unidad', (select m from med),
                                          'nota', 'Documento SIN proveedor identificado y MAS NUEVO que ultima_compra: mencionalo como DUDOSO (aun sin revisar) y NO lo uses como precio de referencia.')
                                 from ok s
                                where s.proveedor_id is null and s.pl is not null
                                  and (not exists (select 1 from ult_id) or (s.fecha, s.doc_id) > (select i.fecha, i.doc_id from ult_id i))
                                order by s.fecha desc, s.doc_id desc, s.linea_id desc limit 1),$a1$, $b1$    'productos', (select count(*) from por_prod),$b1$);
  if (length(v_def) - length(replace(v_def, $a2$            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables). '
            || 'desglose_envase = el total partido por tipo de envase (barril / botella_lata / otros, cada uno con sus formatos): '
            || 'cuando haya mas de un grupo, da el TOTAL y debajo cada grupo con sus litros y envases (suman el total), p. ej. «30.152 l: barril 22.100 l, botella y lata 8.052 l». '
            || 'ultima_compra = la ultima con proveedor identificado (fecha, proveedor, numero, precio por litro/kilo): ESA es el precio de referencia. '
            || 'Si viene ultima_sin_identificar (documento mas nuevo sin proveedor), mencionala como dudosa y no la uses.'$a2$, ''))) <> length($a2$            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables). '
            || 'desglose_envase = el total partido por tipo de envase (barril / botella_lata / otros, cada uno con sus formatos): '
            || 'cuando haya mas de un grupo, da el TOTAL y debajo cada grupo con sus litros y envases (suman el total), p. ej. «30.152 l: barril 22.100 l, botella y lata 8.052 l». '
            || 'ultima_compra = la ultima con proveedor identificado (fecha, proveedor, numero, precio por litro/kilo): ESA es el precio de referencia. '
            || 'Si viene ultima_sin_identificar (documento mas nuevo sin proveedor), mencionala como dudosa y no la uses.'$a2$) then
    raise exception '20261212410000: volumen_comprado_agente: el texto a cambiar (parche 3) no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, $a2$            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables). '
            || 'desglose_envase = el total partido por tipo de envase (barril / botella_lata / otros, cada uno con sus formatos): '
            || 'cuando haya mas de un grupo, da el TOTAL y debajo cada grupo con sus litros y envases (suman el total), p. ej. «30.152 l: barril 22.100 l, botella y lata 8.052 l». '
            || 'ultima_compra = la ultima con proveedor identificado (fecha, proveedor, numero, precio por litro/kilo): ESA es el precio de referencia. '
            || 'Si viene ultima_sin_identificar (documento mas nuevo sin proveedor), mencionala como dudosa y no la uses.'$a2$, $b2$            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'$b2$);
  execute v_def;
end
$mig$;

drop function if exists public.raiz_variante_agente(text);
drop function if exists public.cabeza_nombre_agente(text);
