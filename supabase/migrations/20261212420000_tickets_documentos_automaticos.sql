set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212420000_tickets_documentos_automaticos · Facturas (18/11/2026)
-- Decisión del dueño: cuando el sistema FALLA al meter un documento (proveedor sin identificar, fecha no legible o imposible,
-- total que no cuadra de forma grave, lectura fallida) se crea SOLO un ticket para que lo revisen los desarrolladores.
--
-- Reutiliza el sistema que ya existe: «Tickets» del Super Admin (tabla `peticiones`), que al abrir un ticket sin analizar lo
-- analiza la IA (analizar-peticion) y que se puede enviar a Linear a mano (enviar_linear). NO hay otro sistema.
--
--   · peticiones.origen / clave_origen: de dónde viene un ticket automático y su clave única (`doc:<factura_id>`,
--     `ocr:<trabajo_id>`): un ticket por documento, sin duplicar aunque el documento se actualice varias veces.
--   · documento_ticket_revisar(factura_id): decide los motivos (alertas_validacion + proveedor + fecha) y crea el ticket
--     (módulo facturas, prioridad alta o normal, con el enlace al panel `/facturas?doc=N`, el enlace de Drive y los avisos).
--   · Disparadores: AFTER INSERT/UPDATE en facturas (el OCR guarda las alertas en un segundo paso) y AFTER UPDATE de
--     ocr_trabajos cuando pasa a «fallido». Nunca rompen el guardado del documento. No tocan lo importado en bloque
--     (import_clave) ni lo ya verificado a mano.
--   · Tope de 40 tickets automáticos al día: pasado el tope se crea UN ticket de aviso del lote.
--   · Sin datos antiguos: solo documentos nuevos o modificados desde ahora. documentos_tickets_pendientes(desde) los crea
--     para un periodo si el dueño lo pide (no se ejecuta aquí).
--
-- Rollback: supabase/rollbacks/20261212420000_tickets_documentos_automaticos_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.peticiones') is null then
    raise exception 'tickets_documentos_automaticos: falta 20261129100000_peticiones. No se ha cambiado nada.';
  end if;
  if to_regclass('public.facturas') is null or to_regclass('public.ocr_trabajos') is null then
    raise exception 'tickets_documentos_automaticos: faltan facturas u ocr_trabajos. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Origen y clave única de los tickets automáticos ─────────────────────
alter table public.peticiones add column if not exists origen text check (origen is null or char_length(origen) <= 40);
alter table public.peticiones add column if not exists clave_origen text check (clave_origen is null or char_length(clave_origen) <= 200);
comment on column public.peticiones.origen is 'NULL = enviado por una persona; «documento» / «ocr» = ticket automático de la revisión de documentos.';
comment on column public.peticiones.clave_origen is 'Clave única del ticket automático (doc:<factura_id>, ocr:<trabajo_id>): un ticket por documento.';
create unique index if not exists peticiones_clave_origen_uq on public.peticiones (clave_origen) where clave_origen is not null;

-- ─── 2. Crear el ticket de un documento ─────────────────────────────────────
create or replace function public.documento_ticket_revisar(p_factura_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f        public.facturas%rowtype;
  v_alertas jsonb;
  v_motivos text[] := '{}';
  v_cortos  text[] := '{}';
  v_graves  text[] := array['total_ausente', 'total_no_deducible', 'total_documento_extremo', 'total_documento_irrisorio',
                            'importe_no_impreso', 'recuento_filas_discordante', 'importe_discordante_verificador', 'sin_lineas'];
  v_clave   text := 'doc:' || p_factura_id;
  v_hoy     integer;
  v_avisos  text;
  v_tipo    text;
  v_titulo  text;
  v_desc    text;
  v_prio    text := 'normal';
  v_id      uuid;
begin
  select * into f from public.facturas where id = p_factura_id;
  if not found or f.verificada is true or f.import_clave is not null then
    return null;
  end if;
  if exists (select 1 from public.peticiones p where p.clave_origen = v_clave) then
    return null;
  end if;
  v_alertas := case when jsonb_typeof(f.alertas_validacion) = 'array' then f.alertas_validacion else '[]'::jsonb end;

  if f.proveedor_id is null then
    v_motivos := array_append(v_motivos, 'Proveedor sin identificar: el documento no trae proveedor legible y se guardó con el número provisional ' || f.numero_documento || '.');
    v_cortos := array_append(v_cortos, 'proveedor sin identificar');
    v_prio := 'alta';
  end if;
  if f.fecha > current_date + 1 or f.fecha < date '2015-01-01'
     or exists (select 1 from jsonb_array_elements(v_alertas) a where a ->> 'codigo' = 'fecha_ausente') then
    v_motivos := array_append(v_motivos, case when f.fecha > current_date + 1 or f.fecha < date '2015-01-01'
                                   then 'Fecha imposible (' || to_char(f.fecha, 'DD/MM/YYYY') || ').'
                                   else 'Fecha no legible: se guardó la de subida (' || to_char(f.fecha, 'DD/MM/YYYY') || ').' end);
    v_cortos := array_append(v_cortos, 'fecha dudosa');
  end if;
  if exists (select 1 from jsonb_array_elements(v_alertas) a
              where a ->> 'codigo' = any (v_graves) or (a ->> 'codigo' like 'descuadre%' and a ->> 'severidad' = 'alta')) then
    v_motivos := array_append(v_motivos, 'El total no cuadra de forma grave o no se pudo leer (ver avisos del sistema).');
    v_cortos := array_append(v_cortos, 'total dudoso');
    v_prio := 'alta';
  end if;
  if cardinality(v_motivos) = 0 then
    return null;
  end if;

  -- Tope diario: pasado el tope, un único ticket de aviso del lote.
  select count(*) into v_hoy from public.peticiones p where p.origen in ('documento', 'ocr') and p.created_at > now() - interval '24 hours';
  if v_hoy >= 40 then
    insert into public.peticiones (titulo, prioridad, modulo, descripcion, ruta, creado_por_nombre, origen, clave_origen)
    values ('Muchos documentos con problemas hoy: revisar el listado de Facturas', 'alta', 'facturas',
            'La revisión automática ya ha creado 40 tickets en 24 horas. No se crean más hoy para no saturar: mira en Facturas los documentos con avisos '
            || '(sin proveedor identificado, fecha dudosa, total que no cuadra). Último documento que llegó: id ' || p_factura_id || '.',
            '/facturas', 'Sistema (revisión automática de documentos)', 'documento', 'doc-lote:' || to_char(current_date, 'YYYY-MM-DD'))
    on conflict (clave_origen) where clave_origen is not null do nothing;
    return null;
  end if;

  select string_agg('· ' || left(coalesce(a ->> 'mensaje', a ->> 'codigo'), 260), E'\n')
    into v_avisos
    from (select a from jsonb_array_elements(v_alertas) a
           where a ->> 'codigo' not in ('extraccion_historica', 'numero_ausente') order by (a ->> 'severidad' = 'alta') desc limit 6) x(a);
  v_tipo := case when f.tipo = 'albaran' then 'albarán' else 'factura' end;
  v_titulo := left('Revisar ' || v_tipo || ' ' || f.numero_documento || ' (' || coalesce(nullif(btrim(f.proveedor), ''), 'sin proveedor') || '): '
                   || array_to_string(v_cortos, ', '), 120);
  v_desc := left(
    'REVISIÓN AUTOMÁTICA. El sistema no ha podido meter bien este documento.' || E'\n\n'
    || 'Motivo:' || E'\n' || array_to_string(array(select '· ' || m from unnest(v_motivos) m), E'\n') || E'\n\n'
    || 'Documento: ' || v_tipo || ' ' || f.numero_documento || ' · proveedor: ' || coalesce(nullif(btrim(f.proveedor), ''), '(sin identificar)')
    || ' · fecha: ' || to_char(f.fecha, 'DD/MM/YYYY') || ' · total: ' || coalesce(f.total::text, 'sin total') || ' €'
    || ' · id ' || f.id || E'\n'
    || 'En el panel: /facturas?doc=' || f.id || E'\n'
    || 'Original en Drive: ' || coalesce(f.drive_url, '(no hay enlace)') || E'\n'
    || case when f.resumen is not null then E'\nLo que leyó el OCR: ' || left(f.resumen, 400) || E'\n' else '' end
    || case when v_avisos is not null then E'\nAvisos del sistema:\n' || v_avisos || E'\n' else '' end
    || E'\nQué revisar: abrir el original, corregir proveedor, fecha o total en la ficha y, si es un fallo del OCR, ver por qué no lo leyó.', 4000);

  insert into public.peticiones (titulo, prioridad, modulo, descripcion, ruta, creado_por_nombre, origen, clave_origen)
  values (v_titulo, v_prio, 'facturas', v_desc, '/facturas?doc=' || f.id, 'Sistema (revisión automática de documentos)', 'documento', v_clave)
  on conflict (clave_origen) where clave_origen is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.documento_ticket_revisar(bigint) from public, anon, authenticated;
grant execute on function public.documento_ticket_revisar(bigint) to service_role;

-- ─── 3. Disparador sobre facturas (el OCR guarda las alertas en un segundo paso) ──
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

drop trigger if exists trg_facturas_ticket_revision on public.facturas;
create trigger trg_facturas_ticket_revision after insert or update of proveedor_id, fecha, total, alertas_validacion on public.facturas
  for each row execute function public.facturas_ticket_revision();

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

drop trigger if exists trg_ocr_trabajos_ticket_fallo on public.ocr_trabajos;
create trigger trg_ocr_trabajos_ticket_fallo after update of estado on public.ocr_trabajos
  for each row execute function public.ocr_trabajos_ticket_fallo();

-- ─── 5. Tickets de documentos antiguos (solo si el dueño lo pide; no se ejecuta aquí) ──
create or replace function public.documentos_tickets_pendientes(p_desde date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in select id from public.facturas where fecha >= p_desde order by fecha desc loop
    if public.documento_ticket_revisar(r.id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.documentos_tickets_pendientes(date) from public, anon, authenticated;
grant execute on function public.documentos_tickets_pendientes(date) to service_role;

do $$ begin raise notice 'tickets_documentos_automaticos: aplicada'; end $$;
