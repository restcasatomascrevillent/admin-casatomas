set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · productos_factura.bultos: las unidades de una línea      ##
-- ##   que se factura por kilos (o litros).                                ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (dueño, 05/10/2026, factura 54 · Luga ML/101511)
--   La tabla de Luga trae «Uds | Kilos | Precio | Dto% | Importe | IVA» y,
--   cuando hay kilos, el precio es POR KILO (12 uds · 24,00 kg · 4,14 → 99,46).
--   El OCR guardaba cantidad = Uds y 19 de 54 líneas no cuadraban. Desde ahora
--   procesar-factura guarda en `cantidad` la magnitud por la que se multiplica
--   el precio (24, unidad 'kg') y las unidades en `bultos` (12), para no
--   perderlas (magnitudes.ts). El panel lo pinta «12 ud · 24 kg».
--
-- QUÉ CAMBIA
--   1. productos_factura: + bultos numeric NULL (solo líneas guardadas por
--      peso; null en el resto). Sin default, sin reescritura de la tabla.
--   2. ocr_sustituir_factura: idéntica a la de 20261005120000 (md5 de
--      pg_get_functiondef en prod 4e2fe6990ea147a39e9e7888fb163d34) salvo que
--      inserta también `bultos` (l->>'bultos'). Mismos permisos (CREATE OR
--      REPLACE los conserva: EXECUTE solo service_role).
--   NO toca filas. La corrección de la factura 54 va aparte:
--   20261005151000_luga_54_cantidades_kg.sql.
--
-- ORDEN DE DESPLIEGUE: indiferente. procesar-factura nueva reintenta sin
-- `bultos` si la columna no existe, y el panel nuevo pide la columna y, si no
-- existe, repite la consulta sin ella.
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005150000_productos_factura_bultos.sql
--      Tiene que imprimir «productos_factura_bultos: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/productos_factura_bultos_test.sql
--      (BEGIN … ROLLBACK: no deja nada escrito).
--   Deshacer: supabase/rollbacks/20261005150000_productos_factura_bultos_ROLLBACK.sql
--   Idempotente: se puede ejecutar dos veces.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa (aborta sin tocar nada) ─────────────────────────
do $$
begin
  if to_regprocedure('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'productos_factura_bultos: falta ocr_sustituir_factura (aplica antes 20261005120000_ocr_trabajos_multipagina.sql)';
  end if;
end;
$$;

-- ─── 1. Columna ─────────────────────────────────────────────────────────────
alter table public.productos_factura add column if not exists bultos numeric;
comment on column public.productos_factura.bultos is
  'Unidades/bultos de una línea facturada por peso o volumen (Luga: 12 uds · 24 kg). '
  'En ese caso cantidad = kilos (o litros), unidad = kg/l y precio_unitario es por kilo. '
  'NULL si la línea se factura por unidades (cantidad ya son las unidades).';

-- ─── 2. Sustitución en sitio: también las unidades/bultos ───────────────────
-- Texto de 20261005120000 con UN cambio: la columna `bultos` en el INSERT de
-- las líneas nuevas (marcado «20261005150000»).
create or replace function public.ocr_sustituir_factura(
  p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb,
  p_esperado jsonb, p_archivo_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
     bultos)                                                     -- 20261005150000
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
         (l->>'bultos')::numeric                                 -- 20261005150000
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
$$;

-- Permisos: CREATE OR REPLACE los conserva; se repiten por si la función se
-- hubiera creado de cero (idempotente).
revoke all on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'bultos'
                    and data_type = 'numeric' and is_nullable = 'YES') then
    raise exception 'productos_factura_bultos: la columna bultos no ha quedado como numeric NULL';
  end if;
  if position('bultos' in pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'productos_factura_bultos: ocr_sustituir_factura no inserta bultos';
  end if;
  if has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute') then
    raise exception 'productos_factura_bultos: authenticated no debería poder ejecutar ocr_sustituir_factura';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura): tiene que salir «productos_factura_bultos: aplicada».
select 'productos_factura_bultos: aplicada' as resultado,
       (select count(*) from public.productos_factura where bultos is not null) as lineas_con_bultos;
