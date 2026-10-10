set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261010150000_ocr_paginas_duplicados
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- Arreglos de la revisión de lectura del 10/10/2026 (48 fotos subidas a la vez):
--
-- 1. PÁGINAS SUELTAS DE UN MISMO DOCUMENTO. La página 2/2 de un albarán llegó
--    como «duplicado sustituible» de la 1/2 y «Sustituir» borró la página 1
--    (factura 352). Ahora:
--    · `ocr_factura_existente` devuelve además las páginas de las líneas de la
--      existente, sus importes de línea, si su trabajo de OCR sigue en marcha
--      y cuándo se creó (las Edge Functions deciden con eso si es OTRA página
--      y ofrecen «Añadir como página x» en vez de «Sustituir»).
--    · RPC nueva `ocr_anadir_pagina(...)` (SOLO service_role): AÑADE las
--      líneas de la página a la factura existente sin borrar las suyas, con su
--      número de página y orden a continuación; recalcula la cabecera (el pie
--      impreso de la última página manda; dos totales deducidos se suman;
--      fecha, CIF y proveedor solo rellenan huecos; `paginas` = total del
--      documento) y deja copia de auditoría en `facturas_sustituciones`
--      (resumen_antes.operacion = 'anadir_pagina').
--    · `ocr_resumen_factura(bigint)` (can_read_section('facturas')): lo que el
--      panel relee de la existente al abrir «Sustituir»/«Añadir».
-- 2. DUPLICADOS. `verificar_duplicado_factura` y `ocr_factura_existente`
--    casaban SOLO por número (el albarán A26/60875 de Nicolás y Valero con el
--    número B-16385 mal leído se descartó contra el de Congelados Pinto, 338).
--    Ahora el mismo número exige además el MISMO proveedor (proveedor_id
--    resuelto sin crear nada, o CIF normalizado, nunca el de Casa Tomás) o,
--    si no hay proveedor, el mismo total y fecha.
-- 3. «SUSTITUIR». `ocr_sustituir_factura` aborta también si la existente no
--    tiene líneas, si su trabajo de OCR no ha terminado o si el documento
--    nuevo es otra página; los mensajes dicen «revisa y confirma de nuevo».
-- 4. CARGA MASIVA. `ocr_despachar` no despacha más de 3 consolidaciones a la
--    vez ni más de 12 piezas leyéndose en todo el sistema; la nueva
--    `ocr_despachar_cola()` (SOLO service_role) da paso a los que esperan y la
--    llaman `ocr_cerrar_pagina`, `ocr_fallo_pagina` y `ocr_terminar_trabajo`
--    al liberar hueco (el cron de cada minuto sigue de respaldo).
--
-- Reescribe 7 funciones; antes comprueba su md5 (sin CR) contra el de
-- producción del 10/10/2026 (o que ya lleven la marca de esta migración):
-- si no cuadra, aborta sin tocar nada. Idempotente.
--
-- ORDEN: aplicar esta migración y después desplegar procesar-factura y
-- ocr-trabajo. Las funciones nuevas toleran la migración sin aplicar (sin los
-- campos nuevos no ofrecen «Añadir como página»; «Añadir» falla con un error
-- claro), pero hasta aplicarla el antiduplicados sigue casando solo por número.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010150000_ocr_paginas_duplicados.sql
--      Tiene que imprimir «ocr_paginas_duplicados: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/ocr_paginas_duplicados_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «ocr_paginas_duplicados_test: OK».
--   Deshacer: supabase/rollbacks/20261010150000_ocr_paginas_duplicados_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_def text;
  r record;
begin
  if to_regclass('public.ocr_trabajos') is null
     or to_regclass('public.facturas_sustituciones') is null
     or to_regprocedure('public.proveedor_resolver(text, text, boolean)') is null
     or to_regprocedure('public.normalizar_cif(text)') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'iva_pct') then
    raise exception 'ocr_paginas_duplicados: faltan migraciones anteriores (ocr_trabajos_multipagina, proveedores_unificados o iva_pct). No se ha cambiado nada.';
  end if;
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
    if to_regprocedure(r.firma) is null then
      raise exception 'ocr_paginas_duplicados: no existe %. No se ha cambiado nada.', r.firma;
    end if;
    v_def := replace(pg_get_functiondef(to_regprocedure(r.firma)), chr(13), '');
    if md5(v_def) <> r.md5_esperado and position('20261010150000_ocr_paginas_duplicados' in v_def) = 0 then
      raise exception 'ocr_paginas_duplicados: % no es la esperada (md5 %). No se ha cambiado nada.', r.firma, md5(v_def);
    end if;
  end loop;
end;
$$;

-- ─── 1. Resumen de una factura (para decidir y para el panel) ──────────────
create or replace function public.ocr_resumen_factura_datos(p_factura_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 20261010150000_ocr_paginas_duplicados
  select jsonb_build_object(
    'id', fa.id, 'numero_documento', fa.numero_documento, 'proveedor', fa.proveedor,
    'proveedor_id', fa.proveedor_id, 'cif', fa.cif,
    'fecha', fa.fecha, 'total', fa.total, 'total_origen', fa.total_origen, 'tipo', fa.tipo,
    'lineas', (select count(*) from public.productos_factura p where p.factura_id = fa.id),
    'historial', (select count(*) from public.historial_precios h where h.factura_id = fa.id),
    'alertas', coalesce(jsonb_array_length(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion end), 0),
    'alertas_graves', (select count(*) from jsonb_array_elements(
                         case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end) a
                        where a->>'severidad' = 'alta'),
    'archivo_path', fa.archivo_path, 'paginas', fa.paginas,
    'updated_at', fa.updated_at, 'created_at', fa.created_at,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = fa.id and p.pagina is not null), '[]'::jsonb),
    'totales_lineas', coalesce((select jsonb_agg(x.total order by x.pagina, x.orden, x.id)
                                  from (select p.total, p.pagina, p.orden, p.id from public.productos_factura p
                                         where p.factura_id = fa.id order by p.pagina, p.orden, p.id limit 500) x), '[]'::jsonb),
    'trabajo_pendiente', exists (select 1 from public.ocr_trabajos t
                                  where t.id = fa.ocr_trabajo_id
                                    and t.estado not in ('completado', 'duplicado', 'fallido', 'cancelado'))
  )
  from public.facturas fa
  where fa.id = p_factura_id
$function$;

comment on function public.ocr_resumen_factura_datos(bigint) is
  'Resumen de una factura para decidir duplicados / páginas (líneas, páginas de sus líneas, importes de línea, '
  'si su trabajo de OCR sigue en marcha). Solo service_role. 20261010150000.';

create or replace function public.ocr_resumen_factura(p_factura_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: lo que relee el panel al abrir
-- «Sustituir la existente» / «Añadir como página» (no la foto vieja).
begin
  if not public.can_read_section('facturas') then
    raise exception 'Sin permiso para ver facturas' using errcode = '42501';
  end if;
  return public.ocr_resumen_factura_datos(p_factura_id) - 'totales_lineas';
end;
$function$;

comment on function public.ocr_resumen_factura(bigint) is
  'Estado ACTUAL de una factura para el diálogo de «Sustituir» / «Añadir como página» (líneas, updated_at, avisos, '
  'trabajo de OCR en marcha). Exige can_read_section(''facturas''). 20261010150000.';

-- ─── 2. Duplicados: número + mismo proveedor ───────────────────────────────
create or replace function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: el número solo NO basta (el albarán
-- A26/60875 de Nicolás y Valero, leído con el nº B-16385, se casó con el de
-- Congelados Pinto). Mismo número + mismo proveedor (proveedor_id resuelto
-- sin crear nada) o, si no hay proveedor, mismo total y fecha.
declare
  factura_existente record;
  v_pid bigint := public.proveedor_resolver(p_proveedor, null, false);
  v_prov text := lower(btrim(coalesce(p_proveedor, '')));
  v_sin_proveedor boolean;
begin
  v_sin_proveedor := v_pid is null and v_prov = '';

  -- 1. Número + proveedor (o, sin proveedor, total y fecha).
  select * into factura_existente
    from facturas fa
   where lower(btrim(fa.numero_documento)) = lower(btrim(p_numero_documento))
     and ((v_pid is not null and fa.proveedor_id = v_pid)
          or ((v_sin_proveedor or fa.proveedor_id is null)
              and fa.fecha is not distinct from p_fecha
              and fa.total is not null and p_total is not null and abs(fa.total - p_total) < 0.01))
   order by fa.id
   limit 1;
  if found then
    return json_build_object('es_duplicado', true, 'motivo', 'numero_documento',
                             'factura_existente', row_to_json(factura_existente));
  end if;

  -- 2. Mismo proveedor + fecha + total (con total distinto de 0).
  if v_prov <> '' and coalesce(p_total, 0) <> 0 then
    select * into factura_existente
      from facturas fa
     where ((v_pid is not null and fa.proveedor_id = v_pid)
            or (coalesce(fa.proveedor, '') <> ''
                and (lower(fa.proveedor) like '%' || v_prov || '%' or v_prov like '%' || lower(fa.proveedor) || '%')))
       and fa.fecha = p_fecha
       and abs(fa.total - p_total) < 0.01
     order by fa.id
     limit 1;
    if found then
      return json_build_object('es_duplicado', true, 'motivo', 'datos_coincidentes',
                               'factura_existente', row_to_json(factura_existente));
    end if;
  end if;

  return json_build_object('es_duplicado', false, 'motivo', null, 'factura_existente', null);
end;
$function$;

create or replace function public.ocr_factura_existente(p_numero text, p_proveedor text, p_cif text, p_fecha date, p_total numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: número normalizado + MISMO proveedor
-- (proveedor_id resuelto sin crear nada, o CIF normalizado que no sea el de
-- Casa Tomás) o, si no hay proveedor, mismo total y fecha. Devuelve además lo
-- que hace falta para no ofrecer «Sustituir» entre páginas distintas.
declare
  v_num text := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_cif text := public.normalizar_cif(p_cif);
  v_pid bigint;
  v_sin_proveedor boolean;
  v_id bigint;
  v_motivo text;
begin
  if v_cif = 'B54583356' then
    v_cif := null;                     -- el CIF del cliente no identifica al proveedor
  end if;
  v_pid := public.proveedor_resolver(p_proveedor, v_cif, false);
  v_sin_proveedor := v_pid is null and v_cif is null and btrim(coalesce(p_proveedor, '')) = '';

  if v_num <> '' then
    select fa.id into v_id
      from public.facturas fa
     where upper(regexp_replace(coalesce(fa.numero_documento, ''), '[^A-Za-z0-9]', '', 'g')) = v_num
       and ((v_pid is not null and fa.proveedor_id = v_pid)
            or (v_cif is not null and public.normalizar_cif(fa.cif) = v_cif)
            or ((v_sin_proveedor or fa.proveedor_id is null)
                and fa.fecha is not distinct from p_fecha
                and fa.total is not null and p_total is not null and abs(fa.total - p_total) < 0.01))
     order by (fa.proveedor_id is not distinct from v_pid) desc, fa.id
     limit 1;
    v_motivo := 'numero_proveedor';
  end if;

  -- Sin número coincidente: mismo proveedor + fecha + total (≠ 0).
  if v_id is null and coalesce(p_total, 0) <> 0 and p_fecha is not null and (v_pid is not null or v_cif is not null) then
    select fa.id into v_id
      from public.facturas fa
     where fa.fecha = p_fecha
       and abs(fa.total - p_total) < 0.01
       and ((v_pid is not null and fa.proveedor_id = v_pid)
            or (v_cif is not null and public.normalizar_cif(fa.cif) = v_cif))
     order by fa.id
     limit 1;
    v_motivo := 'datos_coincidentes';
  end if;

  if v_id is null then
    return null;
  end if;
  return public.ocr_resumen_factura_datos(v_id) || jsonb_build_object('motivo', v_motivo);
end;
$function$;

-- ─── 3. Sustituir: más guardas y mensajes claros ───────────────────────────
create or replace function public.ocr_sustituir_factura(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
-- 20261010150000_ocr_paginas_duplicados: además aborta si la existente no
-- tiene líneas, si su trabajo de OCR no ha terminado o si el documento nuevo
-- es otra página de ella (eso se AÑADE con ocr_anadir_pagina, nunca se sustituye).
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
  if jsonb_typeof(t.documento_pendiente->'pagina') = 'object' then
    raise exception 'SUSTITUCIÓN ABORTADA: el documento nuevo es la página % de % de la factura %: se añade como página, no se sustituye.',
      t.documento_pendiente->'pagina'->>'actual', t.documento_pendiente->'pagina'->>'total', p_factura_id;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if v_lineas_antes = 0 then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % no tiene líneas (puede que aún se esté guardando). Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
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

-- ─── 4. Añadir una página a una factura existente ──────────────────────────
create or replace function public.ocr_anadir_pagina(
  p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_pagina integer, p_paginas_total integer,
  p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
-- 20261010150000_ocr_paginas_duplicados: AÑADE las líneas de la página
-- p_pagina (de p_paginas_total) a la factura existente, SIN borrar las suyas,
-- y recalcula la cabecera. Todo o nada; copia de auditoría en
-- facturas_sustituciones (resumen_antes.operacion = 'anadir_pagina').
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_orden integer;
  v_insertadas integer;
  v_sust_id bigint;
  v_total numeric := (p_cabecera->>'total')::numeric;
  v_origen text := nullif(p_cabecera->>'total_origen', '');
  v_impreso boolean;
  v_existente_impreso boolean;
  v_usar_nuevo boolean;
  v_sumar boolean;
  fb public.facturas%rowtype;
begin
  if p_pagina is null or p_paginas_total is null or p_paginas_total < 2 or p_paginas_total > 20
     or p_pagina < 1 or p_pagina > p_paginas_total then
    raise exception 'AÑADIDO ABORTADO: página % de % no válida', p_pagina, p_paginas_total;
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'AÑADIDO ABORTADO: ese documento ya no está pendiente (está «%»).', t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'AÑADIDO ABORTADO: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*), coalesce(max(orden), -1) into v_lineas_antes, v_orden
    from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'AÑADIDO ABORTADO: p_lineas no es una lista';
  end if;

  -- 1. Copia de auditoría (las líneas de antes no se tocan, pero la cabecera sí).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    '[]'::jsonb,
    jsonb_build_object('operacion', 'anadir_pagina', 'pagina', p_pagina, 'paginas_total', p_paginas_total,
                       'total', fa.total, 'total_origen', fa.total_origen, 'lineas', v_lineas_antes,
                       'alertas', fa.alertas_validacion, 'esperado', p_esperado, 'archivo_pagina', p_archivo_path))
  returning id into v_sust_id;

  -- 2. Cabecera. El pie IMPRESO manda: el de la página nueva si la existente
  --    no lo tiene o si la nueva es la última; dos totales deducidos se suman
  --    (cada uno es la suma de sus líneas); sin total en la existente, el nuevo.
  v_impreso := v_total is not null and coalesce(v_origen, '') <> 'deducido';
  v_existente_impreso := fa.total is not null and coalesce(fa.total_origen, '') <> 'deducido';
  v_usar_nuevo := v_total is not null
                  and (fa.total is null or (v_impreso and (not v_existente_impreso or p_pagina = p_paginas_total)));
  v_sumar := not v_usar_nuevo and v_total is not null and not v_impreso and not v_existente_impreso;
  update public.facturas
     set subtotal = case when v_usar_nuevo then (p_cabecera->>'subtotal')::numeric
                         when v_sumar and (subtotal is not null or p_cabecera->>'subtotal' is not null)
                           then coalesce(subtotal, 0) + coalesce((p_cabecera->>'subtotal')::numeric, 0)
                         else subtotal end,
         iva = case when v_usar_nuevo then (p_cabecera->>'iva')::numeric
                    when v_sumar and (iva is not null or p_cabecera->>'iva' is not null)
                      then coalesce(iva, 0) + coalesce((p_cabecera->>'iva')::numeric, 0)
                    else iva end,
         total = case when v_usar_nuevo then v_total when v_sumar then total + v_total else total end,
         total_origen = case when v_usar_nuevo then v_origen when v_sumar then 'deducido' else total_origen end,
         fecha = coalesce(fecha, (p_cabecera->>'fecha')::date),
         cif = coalesce(nullif(cif, ''), p_cabecera->>'cif'),
         proveedor = coalesce(nullif(proveedor, ''), p_cabecera->>'proveedor'),
         paginas = greatest(coalesce(paginas, 1), p_paginas_total)::smallint,
         archivo_path = coalesce(archivo_path, p_archivo_path),
         verificada = false,
         procesado_en = now()
   where id = p_factura_id;

  -- 3. Líneas de la página, a continuación de las que ya hay.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref, bultos, iva_pct)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         p_pagina::smallint,
         v_orden + ord::int,
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,
         (l->>'iva_pct')::numeric
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;

  -- 4. Trabajo cerrado: su documento ya está dentro de la factura.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  select * into fb from public.facturas where id = p_factura_id;
  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', fb.total, 'total_origen', fb.total_origen,
                                              'lineas', v_lineas_antes + v_insertadas, 'lineas_anadidas', v_insertadas)
   where id = v_sust_id;

  return jsonb_build_object(
    'factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
    'lineas_antes', v_lineas_antes, 'lineas_anadidas', v_insertadas, 'lineas', v_lineas_antes + v_insertadas,
    'total', fb.total, 'total_origen', fb.total_origen, 'paginas', fb.paginas,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = p_factura_id and p.pagina is not null), '[]'::jsonb),
    'alertas_antes', case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end);
end;
$function$;

comment on function public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text) is
  'Añade una página (líneas) leída aparte a una factura existente sin borrar nada y recalcula la cabecera; '
  'auditoría en facturas_sustituciones. Solo service_role. 20261010150000.';

-- ─── 5. Despacho con tope (carga masiva) ───────────────────────────────────
create or replace function public.ocr_despachar(p_trabajo_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
-- 20261010150000_ocr_paginas_duplicados: con 48 documentos a la vez la base
-- de datos se saturó (inserts de 40-100 s). Topes: 3 consolidaciones (guardar)
-- y 12 piezas leyéndose en todo el sistema; lo que no cabe espera y lo
-- despacha ocr_despachar_cola() al liberarse hueco (o el cron cada minuto).
declare
  c_url    constant text := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/ocr-trabajo';
  c_max_consolidaciones constant integer := 3;
  c_max_piezas          constant integer := 12;
  v_secreto text;
  t        public.ocr_trabajos%rowtype;
  p        public.ocr_trabajo_paginas%rowtype;
  v_vuelo  integer;
  v_hueco  integer;
  v_consol integer;
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

  -- Piezas que aún caben en todo el sistema (leyéndose o recién despachadas).
  select count(*) into v_hueco
    from public.ocr_trabajo_paginas
   where (estado = 'procesando' and lease_hasta > now())
      or (estado = 'pendiente' and despachada_at > now() - interval '30 seconds');
  v_hueco := greatest(0, c_max_piezas - v_hueco);

  if t.estado = 'pagina1' then
    select * into p from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
    if not found or p.estado in ('completada', 'fallida') then
      update public.ocr_trabajos set estado = 'paginas' where id = t.id;
      t.estado := 'paginas';
    elsif p.estado = 'pendiente' and p.no_antes_de <= now() and v_hueco > 0
          and (p.despachada_at is null or p.despachada_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      v_hueco := v_hueco - 1;
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
       limit least(greatest(0, 4 - v_vuelo), v_hueco)
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
      select count(*) into v_consol
        from public.ocr_trabajos
       where id <> t.id
         and ((estado = 'consolidando' and lease_hasta > now())
              or (estado = 'paginas' and consolidar_despachado_at > now() - interval '30 seconds'));
      if v_consol < c_max_consolidaciones then
        perform net.http_post(
          url := c_url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          body := jsonb_build_object('modo', 'consolidar', 'trabajo_id', t.id),
          timeout_milliseconds := 10000);
        update public.ocr_trabajos set consolidar_despachado_at = now() where id = t.id;
        n := n + 1;
      end if;
    end if;
  end if;
  return n;
end;
$function$;

create or replace function public.ocr_despachar_cola()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: da paso, por orden de llegada, a los
-- trabajos que esperan hueco (ocr_despachar aplica los topes). SKIP LOCKED:
-- nunca espera a otro worker.
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.ocr_trabajos
     where estado in ('pendiente', 'pagina1', 'paginas')
     order by created_at
     limit 30
     for update skip locked
  loop
    n := n + public.ocr_despachar(r.id);
  end loop;
  return n;
end;
$function$;

comment on function public.ocr_despachar_cola() is
  'Despacha, por orden de llegada, los trabajos de OCR que esperan hueco (topes de ocr_despachar). Solo service_role. 20261010150000.';

-- ─── 6. Quien libera hueco da paso a la cola ───────────────────────────────
create or replace function public.ocr_cerrar_pagina(p_pagina_id bigint, p_resultado jsonb, p_recuento jsonb, p_verificacion jsonb, p_motivos jsonb, p_filas_extraidas integer, p_filas_contadas integer, p_relecturas integer, p_duracion_ms integer, p_tokens_entrada integer, p_tokens_salida integer, p_coste numeric, p_contexto jsonb, p_modelo text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: al cerrar, da paso a la cola.
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
  perform public.ocr_despachar_cola();
  return true;
end;
$function$;

create or replace function public.ocr_fallo_pagina(p_pagina_id bigint, p_error text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: al fallar, da paso a la cola.
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
  perform public.ocr_despachar_cola();
  return v_estado;
end;
$function$;

create or replace function public.ocr_terminar_trabajo(p_trabajo_id uuid, p_estado text, p_resultado jsonb, p_factura_id bigint, p_error text, p_documento_pendiente jsonb default null::jsonb)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- 20261010150000_ocr_paginas_duplicados: al terminar (libera una
-- consolidación), da paso a la cola.
declare
  v_ok boolean;
begin
  if p_estado not in ('completado', 'duplicado', 'fallido') then
    raise exception 'ocr_terminar_trabajo: estado % no permitido', p_estado;
  end if;
  update public.ocr_trabajos
     set estado = p_estado, resultado = p_resultado, factura_id = p_factura_id,
         error = left(p_error, 2000), documento_pendiente = p_documento_pendiente,
         terminado_at = now(), lease_hasta = null
   where id = p_trabajo_id and estado not in ('completado', 'duplicado', 'fallido', 'cancelado');
  v_ok := found;
  if v_ok then
    perform public.ocr_despachar_cola();
  end if;
  return v_ok;
end;
$function$;

-- ─── 7. Permisos ───────────────────────────────────────────────────────────
revoke all on function public.ocr_resumen_factura_datos(bigint) from public, anon, authenticated;
revoke all on function public.ocr_resumen_factura(bigint) from public, anon;
revoke all on function public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.ocr_despachar_cola() from public, anon, authenticated;
grant execute on function public.ocr_resumen_factura_datos(bigint) to service_role;
grant execute on function public.ocr_resumen_factura(bigint) to authenticated, service_role;
grant execute on function public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.ocr_despachar_cola() to service_role;

commit;

select 'ocr_paginas_duplicados: aplicada'
       || ' | funciones con la marca ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                             where n.nspname = 'public'
                                               and position('20261010150000_ocr_paginas_duplicados' in p.prosrc) > 0)
       || ' | B-16385 de Nicolás y Valero casa con ' || coalesce((public.ocr_factura_existente(
            'B-16385', 'DISTRIBUCIONES GASTRONOMICAS NICOLAS Y VALERO SRL', 'B06805246', date '2026-10-06', 88.76) ->> 'id'), 'nada')
       as resultado;
