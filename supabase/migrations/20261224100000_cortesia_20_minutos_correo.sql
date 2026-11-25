-- ============================================================================
-- 20 MINUTOS DE CORTESÍA en el correo que sale al VERIFICAR la reserva
-- ----------------------------------------------------------------------------
-- Decisión del dueño (25/11/2026): al verificar una reserva, el cliente debe
-- leer que tiene 20 minutos de cortesía y que, si no llega en ese tiempo, su
-- mesa queda liberada. Va en el correo 'propuesta' y en la plantilla de
-- WhatsApp equivalente (whatsapp-reservas/logica.ts, TEXTO_CORTESIA: mismo
-- texto).
--
-- Las plantillas de correo son editables desde el panel con historial
-- append-only, así que esto NO reescribe ninguna versión: copia la versión
-- vigente de 'propuesta' (con lo que se haya editado a mano), le añade el
-- párrafo al final del cuerpo y la guarda como versión nueva y actual. Si la
-- vigente ya habla de la cortesía, no hace nada (se puede aplicar dos veces).
-- Vuelta atrás: supabase/rollbacks/20261224100000_cortesia_20_minutos_correo_ROLLBACK.sql
-- (o «volver a esta versión» desde el editor de plantillas del panel).
-- ============================================================================

begin;

do $$
declare
  v_actual public.plantillas_email_reserva;
  v_siguiente integer;
begin
  select * into v_actual
    from public.plantillas_email_reserva
    where tipo = 'propuesta' and es_actual;

  if not found then
    raise notice 'No hay plantilla de correo ''propuesta'' vigente: no se cambia nada.';
    return;
  end if;

  if v_actual.cuerpo ilike '%minutos de cortesía%' then
    raise notice 'La plantilla ''propuesta'' ya menciona la cortesía: no se cambia nada.';
    return;
  end if;

  select coalesce(max(version), 0) + 1 into v_siguiente
    from public.plantillas_email_reserva
    where tipo = 'propuesta';

  update public.plantillas_email_reserva set es_actual = false where tipo = 'propuesta' and es_actual;

  insert into public.plantillas_email_reserva (
    tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal,
    texto_boton_secundario, pie, color_acento, color_oscuro, logo_url, bloques,
    nota_version, creado_por
  ) values (
    v_actual.tipo, v_siguiente, true, v_actual.asunto, v_actual.saludo,
    rtrim(v_actual.cuerpo) || E'\n\n' ||
      'Tienes 20 minutos de cortesía sobre la hora de tu reserva; si no has llegado en ese tiempo, tu mesa quedará liberada.',
    v_actual.texto_boton_principal, v_actual.texto_boton_secundario, v_actual.pie,
    v_actual.color_acento, v_actual.color_oscuro, v_actual.logo_url, v_actual.bloques,
    '20 minutos de cortesía (migración 20261224100000, sobre la versión ' || v_actual.version || ')',
    null
  );
end;
$$;

commit;
