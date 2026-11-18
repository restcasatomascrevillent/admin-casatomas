set client_encoding = 'UTF8';
-- 20261212520000_tickets_documentos_sistema_y_recientes · ROLLBACK: vuelve a los disparadores de 20261212420000 y a peticiones_al_crear anterior.
set lock_timeout = '5s';

do $mig$
declare
  v_def text := pg_get_functiondef('public.peticiones_al_crear'::regproc);
begin
  v_def := replace(v_def, $b$  v_uid uuid := case when new.origen is not null then null else (select auth.uid()) end;$b$, $a$  v_uid uuid := (select auth.uid());$a$);
  v_def := replace(v_def, $b$  if new.origen is not null then
    new.creado_por := null;   -- el defecto de la columna es auth.uid(): aquí no
    new.creado_por_email := null;
  end if;
  if v_uid is not null then$b$, $a$  if v_uid is not null then$a$);
  execute v_def;
end
$mig$;

create or replace function public.facturas_ticket_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.import_clave is null and new.verificada is not true then
      perform public.documento_ticket_revisar(new.id);
    end if;
  exception when others then
    -- Un ticket nunca debe impedir guardar el documento.
    raise warning 'facturas_ticket_revision: no se pudo crear el ticket del documento %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.facturas_ticket_revision() from public, anon, authenticated;


-- ─── 4. Disparador sobre ocr_trabajos: lectura fallida ──────────────────────
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
  end;
  return null;
end;
$$;
revoke all on function public.ocr_trabajos_ticket_fallo() from public, anon, authenticated;



