-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   La aplica el dueño a mano en el SQL Editor de Supabase, DESPUÉS de   ##
-- ##   20260923210000 y 20260923220000 (ya aplicadas). Idempotente:          ##
-- ##   CREATE OR REPLACE de UNA función. No toca datos ni tablas.           ##
-- ##                                                                       ##
-- ===========================================================================
--
-- CORRECCIÓN DE UNA DECISIÓN (dueño, 2026-09-24): las reservas de "El
-- Reservado" (el espacio privado de Touza; la web de Touza tiene un
-- formulario "El Reservado") se ven y se gestionan EXACTAMENTE igual que las
-- de Casa Tomás: solicitud -> verificada -> el cliente confirma; mismos
-- correos, mismas herramientas de solicitud/propuesta. El 2026-09-23 se
-- había entendido lo contrario ("Touza no tiene reservas") y
-- 20260923220000_aceptar_telefono_pide_confirmacion.sql pasó a crear SIEMPRE
-- la reserva con marca 'casa_tomas'. Consecuencia: aceptar la propuesta de
-- una solicitud de El Reservado creaba una reserva de Casa Tomás, que
-- contaba contra el aforo del restaurante (trigger validar_capacidad_reserva,
-- aforo POR marca) y salía con la marca equivocada en el panel y el correo.
--
-- Qué hace: redefine public.fn_aceptar_propuesta_solicitud EXACTAMENTE como
-- la dejó 20260923220000 (vía teléfono -> 'verificada' + falta_contacto;
-- vía email -> 'confirmada'; lista negra -> 'pendiente'), salvo el negocio:
--   · sala propuesta -> su caracteristicas->>'marca' (sin etiqueta = casa_tomas)
--   · sin sala -> 'touza' si notas_cliente empieza por "Solicitud de El
--     Reservado" (primera línea que escribe Reservado.tsx de la web de Touza;
--     mismo criterio que reservas-web/plantillas.ts resolverMarcaPorNotas)
--   · si no -> 'casa_tomas'
-- Además devuelve 'marca' en el jsonb de éxito y la notificación del panel
-- indica "(Touza · El Reservado)" cuando toca.
--
-- 20260923210000 (fn_normalizar_telefono, fn_rechazar_propuesta_solicitud,
-- columnas/índices) NO asume ningún negocio: no se toca. Su versión de
-- fn_aceptar_propuesta_solicitud ya tomaba la marca de la sala, pero sin el
-- marcador de las notas; queda sustituida por esta.
--
-- Compatibilidad: el panel funciona antes y después. Antes de aplicarla,
-- "Registrar que aceptó por teléfono" (y el "Aceptar" del correo) en una
-- solicitud de El Reservado crea la reserva como Casa Tomás (ver la consulta
-- de VERIFICACIÓN para encontrarlas). "Convertir en reserva" no depende de
-- esta función: el panel inserta con la marca de la sala elegida.
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
  v_marca text;
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

  -- Negocio (corrige 20260923220000, que forzaba 'casa_tomas'): el de la
  -- sala propuesta (caracteristicas->>'marca'; sala sin etiqueta = Casa
  -- Tomás, igual que validar_capacidad_reserva); sin sala, el marcador que
  -- escribe el formulario "El Reservado" de la web de Touza al principio de
  -- notas_cliente; si no, Casa Tomás (DEFAULT de reservas.marca). Mismo
  -- orden que el panel (src/lib/reservas/negocios.ts, marcaDeSolicitud) y
  -- emails-reserva (marcaDeSolicitudParaCorreo). El aforo lo valida el
  -- trigger POR NEGOCIO con esta marca.
  if s.espacio_propuesto_id is not null then
    select coalesce(nullif(btrim(e.caracteristicas->>'marca'), ''), 'casa_tomas') into v_marca
      from public.espacios_reserva e where e.id = s.espacio_propuesto_id;
  end if;
  if v_marca is null and ltrim(coalesce(s.notas_cliente, '')) like 'Solicitud de El Reservado%' then
    v_marca := 'touza';
  end if;
  v_marca := coalesce(v_marca, 'casa_tomas');

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
      s.espacio_propuesto_id, v_estado, 'telefono', v_blacklist, v_marca, s.id
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
            case when v_marca = 'touza' then ' (Touza · El Reservado)' else '' end ||
            case when v_blacklist then ' (en lista negra: queda pendiente de revisión)' else '' end,
            v_reserva_id, 'reserva');
  end if;

  return jsonb_build_object('ok', true, 'reserva_id', v_reserva_id, 'estado', v_estado,
                            'en_blacklist', v_blacklist, 'marca', v_marca);
end;
$$;

comment on function public.fn_aceptar_propuesta_solicitud(uuid, text) is
  'Crea la reserva con los datos guardados en la solicitud y la marca resuelta/aceptada. Negocio: el de la sala propuesta; sin sala, touza si las notas empiezan por "Solicitud de El Reservado"; si no, casa_tomas. Vía email: confirmada. Vía teléfono (panel): verificada, el cliente recibe "Confirma tu reserva"; exige teléfono y email. Lista negra: pendiente. Idempotente. Devuelve jsonb {ok, reserva_id, estado, marca} o {ok:false, error}.';

-- CREATE OR REPLACE conserva los GRANT; se repiten por si se aplicara en otro
-- orden en un entorno nuevo.
revoke all on function public.fn_aceptar_propuesta_solicitud(uuid, text) from public, anon;
grant execute on function public.fn_aceptar_propuesta_solicitud(uuid, text) to authenticated, service_role;

commit;

-- ===========================================================================
-- VERIFICACIÓN (solo lectura / sin rastro)
-- ===========================================================================
--   select obj_description('public.fn_aceptar_propuesta_solicitud(uuid, text)'::regprocedure);
--   -- debe mencionar "Solicitud de El Reservado"
--
--   select position('v_marca' in prosrc) > 0 as usa_marca_resuelta
--   from pg_proc where oid = 'public.fn_aceptar_propuesta_solicitud(uuid, text)'::regprocedure;
--   -- -> true
--
--   -- Prueba sin rastro con una solicitud abierta de El Reservado (con email):
--   begin;
--   select public.fn_aceptar_propuesta_solicitud('<id solicitud El Reservado>', 'telefono');
--   -- -> {"ok": true, "estado": "verificada", "marca": "touza", ...}
--   rollback;
--
--   -- Reservas creadas mal mientras estuvo 20260923220000 (vienen de una
--   -- solicitud de El Reservado pero quedaron como Casa Tomás):
--   select r.id, r.nombre, r.fecha, r.hora, r.numero_comensales, r.estado
--   from public.reservas r
--   join public.solicitudes_pendientes s on s.id = r.solicitud_id
--   left join public.espacios_reserva e on e.id = r.espacio_id
--   where r.marca = 'casa_tomas'
--     and (e.caracteristicas->>'marca' = 'touza'
--          or (r.espacio_id is null
--              and ltrim(coalesce(s.notas_cliente, '')) like 'Solicitud de El Reservado%'));
--   -- Si sale alguna, corregirla a mano (revisa antes el aforo de Touza en ese turno):
--   --   update public.reservas set marca = 'touza' where id = '<id>';
--
-- ROLLBACK: volver a ejecutar 20260923220000_aceptar_telefono_pide_confirmacion.sql
-- (vuelve a forzar 'casa_tomas'; no recomendado).
-- ===========================================================================
