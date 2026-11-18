set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212520000_tickets_documentos_sistema_y_recientes · Facturas (18/11/2026)
-- Revisión independiente de la release del chat (F1 y F6):
--  · F1 Un ticket automático (peticiones.origen no nulo) es del «Sistema (revisión automática de documentos)»: NO se atribuye a
--    quien edita el documento (creado_por = auth.uid() por defecto de la columna) y NO cuenta para su tope de 20 peticiones en 24 h.
--    Si aun así falla al crearlo, el fallo queda en fallos_internos (aviso a desarrolladores) en lugar de perderse en silencio.
--  · F6 El disparador solo crea ticket cuando el documento es NUEVO (insert) o cuando proveedor, fecha, total o avisos cambian de
--    verdad en un documento reciente (creado en los últimos 7 días). Un update masivo o una recalculación sobre documentos
--    antiguos, o que no cambia el valor, no crea tickets (antes: 32 de golpe).
-- Sin begin/commit propios (la batería --simular lo mete dentro de su transacción).
-- Requiere 20261212420000 (peticiones.origen). Rollback: supabase/rollbacks/20261212520000_tickets_documentos_sistema_y_recientes_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'peticiones' and column_name = 'origen') then
    raise exception '20261212520000: falta 20261212420000 (peticiones.origen). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── F1. peticiones_al_crear: lo automático no es de nadie ni cuenta para el tope ───────
do $mig$
declare
  v_def text;
  a1 text := $a$  v_uid uuid := (select auth.uid());$a$;
  a2 text := $a$  if v_uid is not null then$a$;
begin
  v_def := pg_get_functiondef('public.peticiones_al_crear'::regproc);
  if position('new.origen is not null' in v_def) > 0 then
    return; -- ya aplicado
  end if;
  if (length(v_def) - length(replace(v_def, a1, ''))) <> length(a1) or (length(v_def) - length(replace(v_def, a2, ''))) <> length(a2) then
    raise exception '20261212520000: peticiones_al_crear: el texto a cambiar no aparece exactamente una vez. No se ha cambiado nada.';
  end if;
  v_def := replace(v_def, a1, $b$  -- 20261212520000: un ticket automático (origen no nulo) no es de quien edita el documento: ni autor ni tope
  v_uid uuid := case when new.origen is not null then null else (select auth.uid()) end;$b$);
  v_def := replace(v_def, a2, $b$  if new.origen is not null then
    new.creado_por := null;   -- el defecto de la columna es auth.uid(): aquí no
    new.creado_por_email := null;
  end if;
  if v_uid is not null then$b$);
  execute v_def;
end
$mig$;

-- ─── F1 + F6. Disparador de facturas ────────────────────────────────────────
create or replace function public.facturas_ticket_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.import_clave is null and new.verificada is not true then
      if tg_op = 'INSERT' then
        perform public.documento_ticket_revisar(new.id);
      elsif coalesce(new.created_at, '-infinity'::timestamptz) > now() - interval '7 days'
        and (old.proveedor_id is distinct from new.proveedor_id
             or old.fecha is distinct from new.fecha
             or old.total is distinct from new.total
             or old.alertas_validacion is distinct from new.alertas_validacion) then
        perform public.documento_ticket_revisar(new.id);
      end if;
    end if;
  exception when others then
    -- Un ticket nunca debe impedir guardar el documento, pero tampoco perderse sin rastro.
    raise warning 'facturas_ticket_revision: no se pudo crear el ticket del documento %: %', new.id, sqlerrm;
    begin
      perform public.fallo_interno_registrar('ticket_documento_fallido',
        jsonb_build_object('factura_id', new.id, 'motivo', left(sqlerrm, 300)), null, 'doc:' || new.id);
    exception when others then
      raise warning 'facturas_ticket_revision: tampoco se pudo registrar el fallo: %', sqlerrm;
    end;
  end;
  return null;
end;
$$;
revoke all on function public.facturas_ticket_revision() from public, anon, authenticated;

create or replace function public.ocr_trabajos_ticket_fallo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.estado = 'fallido' and old.estado is distinct from 'fallido' then
      insert into public.peticiones (titulo, prioridad, modulo, descripcion, ruta, creado_por_nombre, origen, clave_origen)
      values (left('Lectura fallida: ' || new.nombre_original, 120), 'alta', 'facturas',
              left('REVISIÓN AUTOMÁTICA. El OCR no ha podido leer este archivo y no se ha creado ningún documento.' || E'\n\n'
                   || 'Archivo: ' || new.nombre_original || ' (' || new.origen || ', ' || new.num_paginas || ' pág.) · trabajo ' || new.id || E'\n'
                   || 'Motivo: ' || coalesce(nullif(btrim(new.error), ''), '(sin mensaje)') || E'\n'
                   || 'Original: ' || coalesce(new.original_path, '(no guardado)') || E'\n\n'
                   || 'Qué revisar: el motivo técnico (tiempo de espera de la base de datos, crédito de OpenAI, contrato de extracción) y volver a subir el archivo.', 4000),
              '/facturas', 'Sistema (revisión automática de documentos)', 'ocr', 'ocr:' || new.id)
      on conflict (clave_origen) where clave_origen is not null do nothing;
    end if;
  exception when others then
    raise warning 'ocr_trabajos_ticket_fallo: no se pudo crear el ticket del trabajo %: %', new.id, sqlerrm;
    begin
      perform public.fallo_interno_registrar('ticket_ocr_fallido',
        jsonb_build_object('trabajo_id', new.id, 'motivo', left(sqlerrm, 300)), null, 'ocr:' || new.id);
    exception when others then
      raise warning 'ocr_trabajos_ticket_fallo: tampoco se pudo registrar el fallo: %', sqlerrm;
    end;
  end;
  return null;
end;
$$;
revoke all on function public.ocr_trabajos_ticket_fallo() from public, anon, authenticated;

do $$ begin raise notice 'tickets_documentos_sistema_y_recientes: aplicada'; end $$;
