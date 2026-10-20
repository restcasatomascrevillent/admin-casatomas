set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005150000_productos_factura_bultos.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005150000_productos_factura_bultos_ROLLBACK.sql
--
-- ANTES:
--   · Si está aplicada 20261005151000_luga_54_cantidades_kg.sql, deshacerla
--     primero (supabase/rollbacks/20261005151000_luga_54_cantidades_kg_ROLLBACK.sql):
--     este rollback ABORTA si la factura 54 sigue con sus líneas en kg.
--   · Volver a desplegar la versión anterior de procesar-factura y ocr-trabajo
--     no es obligatorio: la nueva reintenta sin `bultos` si falta la columna.
--
-- Qué hace:
--   · Copia los bultos que haya (id de línea → bultos) a la tabla
--     public.productos_factura_bultos_respaldo, para no perderlos, y quita la
--     columna productos_factura.bultos. Las líneas ya guardadas por peso se
--     quedan con cantidad = kilos y unidad 'kg' (es lo correcto; solo se
--     pierde ver las unidades en el panel).
--   · Devuelve ocr_sustituir_factura a la definición EXACTA de 20261005120000
--     (md5 de pg_get_functiondef sin retornos de carro 4e2fe6990ea147a39e9e7888fb163d34)
--     y lo comprueba.
--   Imprime «productos_factura_bultos: revertida».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.facturas_sustituciones
              where resumen_antes->>'migracion' = '20261005151000'
                and exists (select 1 from public.productos_factura where factura_id = 54 and unidad = 'kg')) then
    raise exception 'ROLLBACK ABORTADO: la factura 54 sigue corregida a kg (20261005151000). Ejecuta antes su rollback. No se ha cambiado nada.';
  end if;
end;
$$;

-- 1. Respaldo de los bultos y fuera la columna.
create table if not exists public.productos_factura_bultos_respaldo (
  producto_id bigint primary key,
  factura_id  bigint not null,
  bultos      numeric not null,
  copiado_at  timestamptz not null default now()
);
comment on table public.productos_factura_bultos_respaldo is
  'Bultos de productos_factura guardados al revertir 20261005150000 (para poder restaurarlos).';
alter table public.productos_factura_bultos_respaldo enable row level security;
revoke all on public.productos_factura_bultos_respaldo from anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'bultos') then
    execute $q$
      insert into public.productos_factura_bultos_respaldo (producto_id, factura_id, bultos)
      select id, factura_id, bultos from public.productos_factura where bultos is not null
      on conflict (producto_id) do update set bultos = excluded.bultos, copiado_at = now()
    $q$;
  end if;
end;
$$;

alter table public.productos_factura drop column if exists bultos;

-- 2. ocr_sustituir_factura: texto exacto de 20261005120000.
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
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         nullif(left(l->>'albaran_ref', 100), '')
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

revoke all on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;

do $$
declare v_md5 text;
begin
  -- Sin retornos de carro: un fichero con CRLF (checkout de Windows) deja los
  -- retornos de carro dentro del cuerpo de la función y cambiaría el md5 sin cambiar nada.
  v_md5 := md5(replace(pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure), chr(13), ''));
  if v_md5 <> '4e2fe6990ea147a39e9e7888fb163d34' then
    raise exception 'ROLLBACK ABORTADO: ocr_sustituir_factura no ha quedado como la original (md5 %). No se ha cambiado nada.', v_md5;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

select 'productos_factura_bultos: revertida' as resultado,
       (select count(*) from public.productos_factura_bultos_respaldo) as bultos_respaldados;
