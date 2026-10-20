set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · productos_factura.iva_pct: el tipo de IVA impreso en     ##
-- ##   cada línea (10, 4, 21…), para deducir el total CON IVA cuando el    ##
-- ##   pie de totales no se ve.                                            ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (06/10/2026, factura 54 · Luga ML/101511)
--   La captura de Luga no llega al pie de totales, así que procesar-factura
--   dedujo el total sumando las líneas: 3.787,53, que es la BASE (sin IVA). El
--   chatbot lo presentaba como «IVA incluido» y lo sumaba al gasto. Pero la
--   tabla de Luga trae una columna «IVA» por fila (10 % casi todo, 4 % el pan
--   sin gluten y las rosquillas): con el tipo de cada línea el total SÍ se
--   puede calcular (4.162,54). procesar-factura lee ahora ese tipo (`iva_pct`
--   por línea) y, si TODAS las líneas lo traen, deduce base + IVA (una cuota
--   por tipo, redondeada a céntimos) = total; si falta en alguna, guarda la
--   base en `subtotal` y deja el total vacío (aviso «falta_iva»).
--   Se guarda el tipo en cada línea para que el cálculo sea reproducible
--   desde la base de datos (y corregible en una línea concreta), no solo un
--   número en un aviso.
--
-- QUÉ CAMBIA
--   1. productos_factura: + iva_pct numeric NULL, con CHECK 0..30
--      (productos_factura_iva_pct_rango; los tipos españoles de IVA/IGIC van
--      de 0 a 21). NULL = el documento no imprime el tipo por línea. Sin
--      default: no reescribe la tabla (159 líneas hoy, todas quedan NULL).
--   2. ocr_sustituir_factura: idéntica a la de 20261005150000 (la de
--      producción: md5 de pg_get_functiondef sin retornos de carro
--      b6acd1d934bb9c1f2aeafebfb17f1071, comprobado el 06/10/2026) salvo que
--      inserta también `iva_pct` (l->>'iva_pct'). Mismos permisos (CREATE OR
--      REPLACE los conserva: EXECUTE solo service_role).
--   NO toca filas. La corrección de la factura 54 va aparte:
--   20261006110000_luga_54_total_con_iva.sql (necesita esta columna).
--
-- ORDEN DE DESPLIEGUE: indiferente. procesar-factura nueva solo manda
-- `iva_pct` cuando hay valor y, si la columna aún no existe, reintenta sin
-- ella (igual que con `bultos`); la RPC antigua ignora la clave.
--
-- PASOS (desde adminpanelct/, POR TERMINAL)
--   1. npx supabase db query --linked -f supabase/migrations/20261006105000_productos_factura_iva_pct.sql
--      Tiene que imprimir «productos_factura_iva_pct: aplicada | 0».
--   2. npx supabase db query --linked -f supabase/tests/productos_factura_iva_pct_test.sql
--      (BEGIN … ROLLBACK: no deja nada escrito).
--   Deshacer: supabase/rollbacks/20261006105000_productos_factura_iva_pct_ROLLBACK.sql
--   Idempotente: se puede ejecutar dos veces. ABORTA sin tocar nada si
--   ocr_sustituir_factura no es ni la de 20261005150000 ni la de esta
--   migración.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa (aborta sin tocar nada) ─────────────────────────
do $$
declare
  v_def text;
begin
  if to_regprocedure('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'productos_factura_iva_pct: falta ocr_sustituir_factura (aplica antes 20261005120000 y 20261005150000)';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'bultos') then
    raise exception 'productos_factura_iva_pct: falta productos_factura.bultos (aplica antes 20261005150000_productos_factura_bultos.sql)';
  end if;
  v_def := replace(pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure), chr(13), '');
  if md5(v_def) <> 'b6acd1d934bb9c1f2aeafebfb17f1071' and position('iva_pct' in v_def) = 0 then
    raise exception 'productos_factura_iva_pct: ocr_sustituir_factura no es la de 20261005150000 (md5 %). No se ha cambiado nada.', md5(v_def);
  end if;
end;
$$;

-- ─── 1. Columna ─────────────────────────────────────────────────────────────
alter table public.productos_factura add column if not exists iva_pct numeric;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.productos_factura'::regclass and conname = 'productos_factura_iva_pct_rango') then
    alter table public.productos_factura
      add constraint productos_factura_iva_pct_rango check (iva_pct is null or (iva_pct >= 0 and iva_pct <= 30));
  end if;
end;
$$;
comment on column public.productos_factura.iva_pct is
  'Tipo de IVA de la línea en % (10, 4, 21, 0) tal como lo imprime el documento en una columna por fila '
  '(Luga: «IVA 10» / «IVA 4»). NULL si el documento no lo trae por línea. procesar-factura lo usa para '
  'deducir el total con IVA cuando el pie no se ve (base + una cuota por tipo, redondeada a céntimos).';

-- ─── 2. Sustitución en sitio: también el tipo de IVA de cada línea ──────────
-- Texto de 20261005150000 con UN cambio: la columna `iva_pct` en el INSERT de
-- las líneas nuevas (marcado «20261006105000»).
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
$$;

-- Permisos: CREATE OR REPLACE los conserva; se repiten por si la función se
-- hubiera creado de cero (idempotente).
revoke all on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'iva_pct'
                    and data_type = 'numeric' and is_nullable = 'YES' and column_default is null) then
    raise exception 'productos_factura_iva_pct: la columna iva_pct no ha quedado como numeric NULL sin default';
  end if;
  if position('iva_pct' in pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'productos_factura_iva_pct: ocr_sustituir_factura no inserta iva_pct';
  end if;
  if position('bultos' in pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'productos_factura_iva_pct: ocr_sustituir_factura ha perdido bultos';
  end if;
  if has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute') then
    raise exception 'productos_factura_iva_pct: authenticated no debería poder ejecutar ocr_sustituir_factura';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verificación (solo lectura): tiene que salir «productos_factura_iva_pct: aplicada | 0»
-- (0 líneas con tipo hasta que se aplique 20261006110000 o entre un documento nuevo).
select 'productos_factura_iva_pct: aplicada' as resultado,
       (select count(*) from public.productos_factura where iva_pct is not null) as lineas_con_iva_pct;
