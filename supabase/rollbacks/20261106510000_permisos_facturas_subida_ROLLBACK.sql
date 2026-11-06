set client_encoding = 'UTF8';
-- ROLLBACK de 20261106510000_permisos_facturas_subida.sql («Ver» solo consulta
-- y permiso «Facturas · Subida»). Aplicar a mano SOLO si hay que deshacerlo.
-- Idempotente: se puede aplicar dos veces, y la migración se puede volver a
-- aplicar después.
--
-- Deja como estaba (demo, 06/11/2026):
--   * Storage: subir a pendientes/{uid}/ con «Ver» en Facturas
--     (can_read_section('facturas')); sin lectura de lo propio por «Subida».
--   * El historial del chat de Facturas se vuelve a leer con «Ver».
--   * ocr_resumen_factura exige solo can_read_section('facturas').
--   * Sin las políticas *_subida, sin los triggers y sin las funciones nuevas.
--
-- NO borra facturas.subido_por (ni sus datos, que no tienen otra fuente; con
-- su default y su índice no molesta a nadie) ni los permisos 'facturas_subida'
-- de user_permissions (sin la migración no dan nada). Antes de aplicarlo,
-- volver a desplegar procesar-factura, chat-facturas y buscar-precios-mercado
-- de antes y publicar el panel de antes: el panel nuevo esconde «Cargar» a
-- quien solo tiene «Ver», y procesar-factura nueva no le dejaría subir.
begin;
set local lock_timeout = '5s';

-- Storage
drop policy if exists facturas_originales_select_subida on storage.objects;
drop policy if exists facturas_originales_pendientes_insert on storage.objects;
create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.can_read_section('facturas')
  );

-- RLS de lo propio
drop policy if exists facturas_select_subida on public.facturas;
drop policy if exists facturas_update_subida on public.facturas;
drop policy if exists productos_factura_select_subida on public.productos_factura;
drop policy if exists productos_factura_update_subida on public.productos_factura;
drop policy if exists productos_factura_insert_subida on public.productos_factura;
drop policy if exists historial_precios_insert_subida on public.historial_precios;
drop policy if exists ocr_trabajos_select_subida on public.ocr_trabajos;
drop policy if exists ocr_paginas_select_subida on public.ocr_trabajo_paginas;

-- Triggers
drop trigger if exists trg_00_facturas_subida_solo_lo_leido on public.facturas;
drop trigger if exists trg_00_productos_factura_subida_solo_lo_leido on public.productos_factura;
drop trigger if exists trg_00_facturas_subido_por on public.facturas;
drop function if exists public.facturas_subida_solo_lo_leido();
drop function if exists public.facturas_rellenar_subido_por();

-- Historial del chat: otra vez con «Ver»
do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('conversaciones', 'conversaciones_select_seccion'),
      ('mensajes_chat', 'mensajes_chat_select_seccion'),
      ('n8n_chat_histories', 'n8n_chat_histories_select_seccion')) as x(tabla, politica)
  loop
    if to_regclass('public.' || v.tabla) is not null then
      execute format('drop policy if exists %I on public.%I', v.politica, v.tabla);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''facturas'')))',
                     v.politica, v.tabla);
    end if;
  end loop;
end;
$$;

-- ocr_resumen_factura como en 20261010150000
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
revoke all on function public.ocr_resumen_factura(bigint) from public, anon;
grant execute on function public.ocr_resumen_factura(bigint) to authenticated, service_role;

-- Funciones de ayuda (ya sin políticas que las usen)
drop function if exists public.factura_original_es_mio(text);
drop function if exists public.ocr_trabajo_es_mio(uuid);
drop function if exists public.factura_subida_por_mi(bigint);
drop function if exists public.facturas_puede_subir();
drop function if exists public.facturas_puede_subir_usuario(uuid);

commit;

select 'permisos_facturas_subida: deshecha (subido_por se conserva)' as resultado;
