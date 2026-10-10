set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261010150000_ocr_paginas_duplicados.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261010150000_ocr_paginas_duplicados_ROLLBACK.sql
--
-- Devuelve ocr_despachar, ocr_factura_existente, verificar_duplicado_factura,
-- ocr_sustituir_factura, ocr_cerrar_pagina, ocr_fallo_pagina y
-- ocr_terminar_trabajo a sus definiciones EXACTAS de producción del
-- 10/10/2026 (las de antes de la migración) y borra ocr_resumen_factura_datos,
-- ocr_resumen_factura, ocr_anadir_pagina y ocr_despachar_cola.
-- Efectos: el antiduplicados vuelve a casar SOLO por número (vuelve el caso
-- B-16385), «Sustituir» vuelve a permitirse entre páginas, sin tope de
-- consolidaciones ni de piezas. Los documentos pendientes de «Añadir como
-- página» quedan como duplicados sin botón (procesar-factura devuelve un error
-- claro al intentar añadir). Antes, conviene volver a desplegar las
-- procesar-factura y ocr-trabajo anteriores (las nuevas funcionan igual, sin
-- ofrecer «Añadir como página»).
-- Imprime «ocr_paginas_duplicados: revertida | 0». Se puede ejecutar dos veces.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── Definiciones originales (producción, 10/10/2026) ───────────────────────
CREATE OR REPLACE FUNCTION public.ocr_despachar(p_trabajo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c_url    constant text := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/ocr-trabajo';
  v_secreto text;
  t        public.ocr_trabajos%rowtype;
  p        public.ocr_trabajo_paginas%rowtype;
  v_vuelo  integer;
  n        integer := 0;
begin
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_secreto is null or v_secreto = '' then
    return 0;
  end if;

  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found or t.estado not in ('pendiente', 'pagina1', 'paginas') then
    return 0;
  end if;

  if t.estado = 'pendiente' then
    update public.ocr_trabajos set estado = 'pagina1' where id = t.id;
    t.estado := 'pagina1';
  end if;

  if t.estado = 'pagina1' then
    select * into p from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
    if not found or p.estado in ('completada', 'fallida') then
      update public.ocr_trabajos set estado = 'paginas' where id = t.id;
      t.estado := 'paginas';
    elsif p.estado = 'pendiente' and p.no_antes_de <= now()
          and (p.despachada_at is null or p.despachada_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end if;
  end if;

  if t.estado = 'paginas' then
    select count(*) into v_vuelo from public.ocr_trabajo_paginas
     where trabajo_id = t.id and estado = 'procesando';
    for p in
      select * from public.ocr_trabajo_paginas
       where trabajo_id = t.id and estado = 'pendiente' and no_antes_de <= now()
         and (despachada_at is null or despachada_at < now() - interval '30 seconds')
       order by numero
       limit greatest(0, 4 - v_vuelo)
    loop
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end loop;

    if not exists (select 1 from public.ocr_trabajo_paginas
                    where trabajo_id = t.id and estado in ('pendiente', 'procesando'))
       and (t.consolidar_despachado_at is null or t.consolidar_despachado_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'consolidar', 'trabajo_id', t.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajos set consolidar_despachado_at = now() where id = t.id;
      n := n + 1;
    end if;
  end if;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_factura_existente(p_numero text, p_proveedor text, p_cif text, p_fecha date, p_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dup json;
  v_id bigint;
  v_motivo text;
  v_num text := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_cif text := upper(regexp_replace(coalesce(p_cif, ''), '[^A-Za-z0-9]', '', 'g'));
  v_prov text := lower(trim(coalesce(p_proveedor, '')));
  f record;
begin
  v_dup := public.verificar_duplicado_factura(coalesce(p_numero, ''), coalesce(p_proveedor, ''), p_fecha, coalesce(p_total, 0));
  if (v_dup->>'es_duplicado')::boolean then
    v_id := (v_dup->'factura_existente'->>'id')::bigint;
    v_motivo := v_dup->>'motivo';
  elsif v_num <> '' then
    select fa.id into v_id
      from public.facturas fa
     where upper(regexp_replace(fa.numero_documento, '[^A-Za-z0-9]', '', 'g')) = v_num
       and (v_prov = '' or fa.proveedor is null
            or lower(fa.proveedor) like '%' || v_prov || '%' or v_prov like '%' || lower(fa.proveedor) || '%'
            or (v_cif <> '' and upper(regexp_replace(coalesce(fa.cif, ''), '[^A-Za-z0-9]', '', 'g')) = v_cif))
     order by fa.id
     limit 1;
    v_motivo := 'numero_normalizado';
  end if;
  if v_id is null then
    return null;
  end if;

  select fa.id, fa.numero_documento, fa.proveedor, fa.cif, fa.fecha, fa.total, fa.total_origen, fa.tipo,
         fa.archivo_path, fa.updated_at, fa.paginas,
         (select count(*) from public.productos_factura p where p.factura_id = fa.id) as lineas,
         (select count(*) from public.historial_precios h where h.factura_id = fa.id) as historial,
         coalesce(jsonb_array_length(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion end), 0) as alertas,
         (select count(*) from jsonb_array_elements(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end) a
           where a->>'severidad' = 'alta') as alertas_graves
    into f
    from public.facturas fa where fa.id = v_id;
  return jsonb_build_object(
    'id', f.id, 'numero_documento', f.numero_documento, 'proveedor', f.proveedor, 'cif', f.cif,
    'fecha', f.fecha, 'total', f.total, 'total_origen', f.total_origen, 'tipo', f.tipo,
    'lineas', f.lineas, 'historial', f.historial, 'alertas', f.alertas, 'alertas_graves', f.alertas_graves,
    'archivo_path', f.archivo_path, 'paginas', f.paginas, 'updated_at', f.updated_at, 'motivo', v_motivo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  factura_existente RECORD;
  resultado json;
BEGIN
  RAISE NOTICE 'Buscando: % | % | % | %', p_numero_documento, p_proveedor, p_fecha, p_total;

  -- 1. Buscar SOLO por número de documento (más confiable)
  SELECT * INTO factura_existente
  FROM facturas
  WHERE LOWER(TRIM(numero_documento)) = LOWER(TRIM(p_numero_documento))
  LIMIT 1;

  IF FOUND THEN
    RAISE NOTICE 'Duplicado encontrado por número: %', factura_existente.id;
    SELECT json_build_object(
      'es_duplicado', true,
      'motivo', 'numero_documento',
      'factura_existente', row_to_json(factura_existente)
    ) INTO resultado;
    RETURN resultado;
  END IF;

  -- 2. Buscar por proveedor PARCIAL + fecha + total
  -- Usa ILIKE para búsqueda parcial
  SELECT * INTO factura_existente
  FROM facturas
  WHERE (
    LOWER(proveedor) LIKE '%' || LOWER(TRIM(p_proveedor)) || '%'
    OR LOWER(TRIM(p_proveedor)) LIKE '%' || LOWER(proveedor) || '%'
  )
  AND fecha = p_fecha
  AND ABS(total - p_total) < 0.01
  LIMIT 1;

  IF FOUND THEN
    RAISE NOTICE 'Duplicado encontrado por datos: %', factura_existente.id;
    SELECT json_build_object(
      'es_duplicado', true,
      'motivo', 'datos_coincidentes',
      'factura_existente', row_to_json(factura_existente)
    ) INTO resultado;
    RETURN resultado;
  END IF;

  -- No es duplicado
  RAISE NOTICE 'No es duplicado';
  SELECT json_build_object(
    'es_duplicado', false,
    'motivo', null,
    'factura_existente', null
  ) INTO resultado;

  RETURN resultado;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_sustituir_factura(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_hist_borrado integer;
  v_hist_creado integer;
  v_insertadas integer;
  v_sust_id bigint;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'SUSTITUCIÓN ABORTADA: el trabajo % está «%», no «duplicado».', p_trabajo_id, t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % tiene ahora % líneas (al confirmar tenía %). Vuelve a intentarlo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % se ha modificado después de confirmar. Vuelve a intentarlo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'SUSTITUCIÓN ABORTADA: p_lineas no es una lista';
  end if;
  if coalesce(p_cabecera->>'numero_documento', '') = '' then
    raise exception 'SUSTITUCIÓN ABORTADA: la cabecera nueva no trae número de documento';
  end if;

  -- 1. Copia de auditoría (sin embeddings: pesan y se regeneran).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
                from public.historial_precios h where h.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('total', fa.total, 'lineas', v_lineas_antes, 'alertas', fa.alertas_validacion,
                       'esperado', p_esperado))
  returning id into v_sust_id;

  -- 2. Historial y líneas viejas.
  delete from public.historial_precios where factura_id = p_factura_id;
  get diagnostics v_hist_borrado = row_count;
  delete from public.productos_factura where factura_id = p_factura_id;

  -- 3. Cabecera nueva, mismo id. (Antes que las líneas: el trigger del
  --    historial lee proveedor y fecha de facturas.)
  update public.facturas
     set tipo = p_cabecera->>'tipo',
         proveedor = p_cabecera->>'proveedor',
         cif = p_cabecera->>'cif',
         numero_documento = p_cabecera->>'numero_documento',
         fecha = (p_cabecera->>'fecha')::date,
         subtotal = (p_cabecera->>'subtotal')::numeric,
         iva = (p_cabecera->>'iva')::numeric,
         total = (p_cabecera->>'total')::numeric,
         total_origen = p_cabecera->>'total_origen',
         observaciones = p_cabecera->>'observaciones',
         resumen = p_cabecera->>'resumen',
         embedding = case when p_cabecera ? 'embedding' and p_cabecera->>'embedding' is not null
                          then (p_cabecera->>'embedding')::vector else null end,
         alertas_validacion = null,
         verificada = false,
         procesado_en = now(),
         paginas = coalesce((p_cabecera->>'paginas')::smallint, 1),
         ocr_trabajo_id = p_trabajo_id,
         archivo_path = coalesce(p_archivo_path, archivo_path),
         drive_url = case when p_archivo_path is not null then null else drive_url end
   where id = p_factura_id;

  -- 4. Líneas nuevas.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref,
     bultos,                                                     -- 20261005150000
     iva_pct)                                                    -- 20261006105000
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,                                -- 20261005150000
         (l->>'iva_pct')::numeric                                -- 20261006105000
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;
  select count(*) into v_hist_creado from public.historial_precios where factura_id = p_factura_id;

  -- 5. Trabajo cerrado.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', p_cabecera->'total', 'lineas', v_insertadas,
                                              'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado)
   where id = v_sust_id;

  return jsonb_build_object('factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
                            'lineas_antes', v_lineas_antes, 'lineas', v_insertadas,
                            'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_cerrar_pagina(p_pagina_id bigint, p_resultado jsonb, p_recuento jsonb, p_verificacion jsonb, p_motivos jsonb, p_filas_extraidas integer, p_filas_contadas integer, p_relecturas integer, p_duracion_ms integer, p_tokens_entrada integer, p_tokens_salida integer, p_coste numeric, p_contexto jsonb, p_modelo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pg public.ocr_trabajo_paginas%rowtype;
begin
  update public.ocr_trabajo_paginas
     set estado = 'completada', lease_hasta = null, resultado = p_resultado, recuento = p_recuento,
         verificacion_pie = p_verificacion, motivos = p_motivos,
         filas_extraidas = least(p_filas_extraidas, 32767), filas_contadas = least(p_filas_contadas, 32767),
         relecturas = greatest(relecturas, least(coalesce(p_relecturas, 0), 1)),
         duracion_ms = p_duracion_ms, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
         coste_usd = p_coste, error = null
   where id = p_pagina_id and estado = 'procesando'
  returning * into pg;
  if not found then
    return false;
  end if;

  update public.ocr_trabajos
     set coste_usd = coste_usd + coalesce(p_coste, 0),
         modelo = coalesce(p_modelo, modelo),
         contexto_p1 = case when pg.numero = 1 and p_contexto is not null then p_contexto else contexto_p1 end,
         estado = case when estado = 'pagina1' and pg.numero = 1 then 'paginas' else estado end
   where id = pg.trabajo_id;

  perform public.ocr_despachar(pg.trabajo_id);
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_fallo_pagina(p_pagina_id bigint, p_error text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pg public.ocr_trabajo_paginas%rowtype;
  v_estado text;
begin
  select * into pg from public.ocr_trabajo_paginas where id = p_pagina_id for update;
  if not found or pg.estado not in ('procesando', 'pendiente') then
    return null;
  end if;
  v_estado := case when pg.intentos >= 3 then 'fallida' else 'pendiente' end;
  update public.ocr_trabajo_paginas
     set estado = v_estado, lease_hasta = null, despachada_at = null,
         no_antes_de = now() + make_interval(secs => 30 * greatest(pg.intentos, 1)),
         error = left(coalesce(p_error, 'error desconocido'), 2000)
   where id = p_pagina_id;
  if v_estado = 'fallida' and pg.numero = 1 then
    update public.ocr_trabajos set estado = 'paginas' where id = pg.trabajo_id and estado = 'pagina1';
  end if;
  perform public.ocr_despachar(pg.trabajo_id);
  return v_estado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_terminar_trabajo(p_trabajo_id uuid, p_estado text, p_resultado jsonb, p_factura_id bigint, p_error text, p_documento_pendiente jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_estado not in ('completado', 'duplicado', 'fallido') then
    raise exception 'ocr_terminar_trabajo: estado % no permitido', p_estado;
  end if;
  update public.ocr_trabajos
     set estado = p_estado, resultado = p_resultado, factura_id = p_factura_id,
         error = left(p_error, 2000), documento_pendiente = p_documento_pendiente,
         terminado_at = now(), lease_hasta = null
   where id = p_trabajo_id and estado not in ('completado', 'duplicado', 'fallido', 'cancelado');
  return found;
end;
$function$;


drop function if exists public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text);
drop function if exists public.ocr_despachar_cola();
drop function if exists public.ocr_resumen_factura(bigint);
drop function if exists public.ocr_resumen_factura_datos(bigint);

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.ocr_despachar(uuid)', 'cb09899229a4372f551998b731c52742'),
      ('public.ocr_factura_existente(text, text, text, date, numeric)', '30a4fe8988a23dad78561e05b2b3dc3d'),
      ('public.verificar_duplicado_factura(character varying, character varying, date, numeric)', '69e6a1df6a8a8d33250972acaf58219d'),
      ('public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text)', '45c7b70a2875427c111c89a3b7f538b7'),
      ('public.ocr_cerrar_pagina(bigint, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer, integer, integer, numeric, jsonb, text)', 'e49895be9e85dcda27264615e05c3b9c'),
      ('public.ocr_fallo_pagina(bigint, text)', '7e4008d18dbf7dcb0870a40e6a097990'),
      ('public.ocr_terminar_trabajo(uuid, text, jsonb, bigint, text, jsonb)', 'd93c5c4c00865d85a7919343399833e1')
    ) as x(firma, md5_esperado)
  loop
    if md5(replace(pg_get_functiondef(to_regprocedure(r.firma)), chr(13), '')) <> r.md5_esperado then
      raise exception 'ocr_paginas_duplicados ROLLBACK: % no ha quedado como la original. Se deshace todo.', r.firma;
    end if;
  end loop;
end;
$$;

commit;

select 'ocr_paginas_duplicados: revertida | '
       || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and position('20261010150000_ocr_paginas_duplicados' in p.prosrc) > 0) as resultado;
