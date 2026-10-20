-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   La aplica el dueño a mano en el SQL Editor de Supabase, DESPUÉS de   ##
-- ##   20260923210000_solicitud_propuesta_espacio.sql (redefine una         ##
-- ##   función que crea esa migración). Idempotente: CREATE OR REPLACE.     ##
-- ##   No toca datos.                                                       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- DECISIÓN DEL DUEÑO (2026-09-23): una reserva que da de alta el personal
-- NUNCA nace 'confirmada' sin que el cliente lo sepa. "No hace falta
-- [confirmación automática]; solo le decimos que tiene la reserva y que la
-- confirme."
--
-- Qué cambia en fn_aceptar_propuesta_solicitud respecto a 20260923210000:
--   1. p_via = 'telefono' ("Registrar que aceptó por teléfono" en el panel)
--      crea la reserva como 'verificada', no 'confirmada'. El panel dispara
--      después notify-reservation-change -> emails-reserva, que para
--      'verificada' manda la plantilla 'propuesta' ("Confirma tu reserva"):
--      el cliente pulsa "Sí, confirmo mi asistencia" y pasa a 'confirmada'
--      (+ correo de confirmación). Mismo camino que un alta manual.
--      Motivo: un "sí" por teléfono no deja constancia escrita ni comprueba
--      que el email apuntado sea correcto; el correo de confirmación hace
--      las dos cosas.
--   2. p_via = 'email' (el cliente pulsó "Aceptar" en el correo de la
--      propuesta) sigue creando 'confirmada': el cliente YA confirmó.
--   3. p_via = 'telefono' exige teléfono y email en la solicitud (el panel
--      los pide en ese paso y los guarda antes de llamar): error
--      'falta_contacto' si no están.
--   4. Negocio: siempre 'casa_tomas'. Touza no tiene reservas (decisión del
--      dueño); antes se tomaba de la marca de la sala propuesta.
--   Lista negra: igual que antes ('pendiente' + en_blacklist, sin correo).
--
-- Compatibilidad: el panel no depende de esta migración. Sin ella, aceptar
-- por teléfono sigue creando 'confirmada' y el correo que sale es el de
-- confirmación (el tipo de correo lo decide emails-reserva según el estado
-- de la reserva); con ella, sale "Confirma tu reserva".
-- ===========================================================================

begin;

create or replace function public.fn_aceptar_propuesta_solicitud(
  p_solicitud_id uuid,
  p_via text default 'telefono'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.solicitudes_pendientes%rowtype;
  v_hora time;
  v_blacklist boolean;
  v_estado text;
  v_reserva_id uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if p_via not in ('email', 'telefono') then
    return jsonb_build_object('ok', false, 'error', 'via_invalida');
  end if;

  select * into s from public.solicitudes_pendientes where id = p_solicitud_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_encontrada');
  end if;

  -- Idempotente: si ya se aceptó, se devuelve la reserva existente.
  if s.propuesta_estado = 'aceptada' and s.reserva_id is not null then
    return jsonb_build_object('ok', true, 'ya_aceptada', true, 'reserva_id', s.reserva_id,
      'estado', (select estado from public.reservas where id = s.reserva_id));
  end if;

  if s.estado in ('resuelta', 'descartada') then
    return jsonb_build_object('ok', false, 'error', 'solicitud_cerrada');
  end if;

  -- Por correo solo vale la propuesta vigente (la huella del enlace ya la
  -- comprobó la Edge Function; esto cubre "se cambió/rechazó entre medias").
  if p_via = 'email' and s.propuesta_estado <> 'enviada' then
    return jsonb_build_object('ok', false, 'error', 'propuesta_no_vigente');
  end if;

  -- Alta desde el panel: teléfono y email obligatorios (al cliente se le
  -- manda el correo para que confirme).
  if p_via = 'telefono'
     and (coalesce(btrim(s.telefono), '') = '' or coalesce(btrim(s.email), '') = '') then
    return jsonb_build_object('ok', false, 'error', 'falta_contacto');
  end if;

  if s.fecha_solicitada is null or s.hora_solicitada is null
     or coalesce(s.numero_comensales, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'propuesta_incompleta');
  end if;

  begin
    v_hora := s.hora_solicitada::time;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'propuesta_incompleta');
  end;

  if s.fecha_solicitada < v_hoy then
    update public.solicitudes_pendientes
      set propuesta_estado = case when propuesta_estado = 'enviada' then 'caducada' else propuesta_estado end,
          propuesta_error = 'fecha_pasada',
          updated_at = now()
      where id = s.id;
    if p_via = 'email' then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
      values ('propuesta_fallida', 'Propuesta aceptada fuera de plazo',
              coalesce(s.nombre, 'Cliente') || ' (' || coalesce(s.telefono, 'sin teléfono') ||
              ') pulsó aceptar, pero el día propuesto ya ha pasado. Llámale.',
              s.id, 'solicitud', 'alta');
    end if;
    return jsonb_build_object('ok', false, 'error', 'fecha_pasada');
  end if;

  select exists (
    select 1 from public.blacklist b
    where (b.tipo = 'telefono' and s.telefono is not null
           and public.fn_normalizar_telefono(b.valor) = public.fn_normalizar_telefono(s.telefono))
       or (b.tipo = 'email' and s.email is not null
           and lower(trim(b.valor)) = lower(trim(s.email)))
  ) into v_blacklist;

  v_estado := case
    when v_blacklist then 'pendiente'
    when p_via = 'email' then 'confirmada'   -- el cliente ya confirmó en el correo
    else 'verificada'                        -- el panel le manda "Confirma tu reserva"
  end;

  begin
    insert into public.reservas (
      nombre, telefono, email, fecha, hora, numero_comensales, notas_cliente,
      espacio_id, estado, canal, en_blacklist, marca, solicitud_id
    ) values (
      s.nombre, s.telefono, s.email, s.fecha_solicitada, v_hora, s.numero_comensales, s.notas_cliente,
      s.espacio_propuesto_id, v_estado, 'telefono', v_blacklist, 'casa_tomas', s.id
    )
    returning id into v_reserva_id;
  exception
    when unique_violation then
      -- Otra transacción ya creó la reserva de esta solicitud.
      select id into v_reserva_id from public.reservas where solicitud_id = s.id;
      return jsonb_build_object('ok', true, 'ya_aceptada', true, 'reserva_id', v_reserva_id);
    when check_violation then
      -- trg_validar_capacidad (aforo del turno) o un CHECK de la tabla.
      update public.solicitudes_pendientes
        set propuesta_error = case when sqlerrm like 'Aforo%' then 'sin_aforo' else 'datos_invalidos' end,
            updated_at = now()
        where id = s.id;
      if p_via = 'email' then
        insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
        values ('propuesta_fallida', 'Un cliente aceptó la propuesta pero no hay aforo',
                coalesce(s.nombre, 'Cliente') || ' (' || coalesce(s.telefono, 'sin teléfono') || ') aceptó ' ||
                to_char(s.fecha_solicitada, 'DD/MM') || ' ' || left(s.hora_solicitada, 5) || ', ' ||
                s.numero_comensales || ' pers., pero el turno se ha llenado. No se ha creado la reserva: llámale.',
                s.id, 'solicitud', 'alta');
      end if;
      return jsonb_build_object('ok', false,
        'error', case when sqlerrm like 'Aforo%' then 'sin_aforo' else 'datos_invalidos' end,
        'mensaje', sqlerrm);
  end;

  update public.solicitudes_pendientes
    set estado = 'resuelta',
        propuesta_estado = 'aceptada',
        propuesta_respondida_at = now(),
        propuesta_respuesta_via = p_via,
        propuesta_error = null,
        reserva_id = v_reserva_id,
        updated_at = now()
    where id = s.id;

  if p_via = 'email' then
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo)
    values ('propuesta_aceptada', 'Propuesta aceptada: nueva reserva',
            coalesce(s.nombre, 'Cliente') || ' aceptó ' || to_char(s.fecha_solicitada, 'DD/MM') || ' ' ||
            left(s.hora_solicitada, 5) || ', ' || s.numero_comensales || ' pers.' ||
            case when v_blacklist then ' (en lista negra: queda pendiente de revisión)' else '' end,
            v_reserva_id, 'reserva');
  end if;

  return jsonb_build_object('ok', true, 'reserva_id', v_reserva_id, 'estado', v_estado,
                            'en_blacklist', v_blacklist);
end;
$$;

comment on function public.fn_aceptar_propuesta_solicitud(uuid, text) is
  'Crea la reserva (Casa Tomás) con los datos guardados en la solicitud y la marca resuelta/aceptada. Vía email: confirmada. Vía teléfono (panel): verificada, el cliente recibe "Confirma tu reserva"; exige teléfono y email. Lista negra: pendiente. Idempotente. Devuelve jsonb {ok, reserva_id, estado} o {ok:false, error}.';

-- CREATE OR REPLACE conserva los GRANT de 20260923210000; se repiten por si
-- se aplicara en otro orden en un entorno nuevo.
revoke all on function public.fn_aceptar_propuesta_solicitud(uuid, text) from public, anon;
grant execute on function public.fn_aceptar_propuesta_solicitud(uuid, text) to authenticated, service_role;

commit;

-- ===========================================================================
-- VERIFICACIÓN (solo lectura / sin rastro)
-- ===========================================================================
--   select obj_description('public.fn_aceptar_propuesta_solicitud(uuid, text)'::regprocedure);
--   -- debe mencionar "verificada"
--   begin;
--   select public.fn_aceptar_propuesta_solicitud('<id de solicitud abierta con email>', 'telefono');
--   -- -> {"ok": true, "estado": "verificada", ...}
--   rollback;
--
-- ROLLBACK: volver a ejecutar la sección 4 de 20260923210000 (crea 'confirmada').
-- ===========================================================================
