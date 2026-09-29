-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   La aplica el dueño. Va PRIMERO en el despliegue de                   ##
-- ##   reservas-sin-salas: antes que emails-reserva, reservas-web y los     ##
-- ##   dos bots, que escriben/leen la columna nueva. Idempotente.           ##
-- ##                                                                       ##
-- ===========================================================================
--
-- reservas-sin-salas (Fase A1): la marca de una SOLICITUD se guarda, no se
-- deduce de la sala.
--
-- Decisión del dueño (2026-09-29, engram sdd/reservas-sin-salas/decisiones):
-- en Casa Tomás el cliente reserva una hora y la sala es una decisión INTERNA
-- del restaurante. Hasta hoy la marca de una solicitud se deducía de la sala
-- propuesta (espacios_reserva.caracteristicas->>'marca') o, sin sala, del
-- marcador "Solicitud de El Reservado" en notas_cliente. Sin sala propuesta,
-- una solicitud del bot o de la web de Casa Tomás no tiene de dónde sacar su
-- negocio de forma fiable. Ahora cada solicitud lleva su marca.
--
-- Qué hace (sin begin/commit propio: la CLI envuelve cada migración):
--   1. solicitudes_pendientes.marca text NOT NULL DEFAULT 'casa_tomas'. DEFAULT
--      constante => solo metadatos, no reescribe la tabla.
--   2. CHECK solicitudes_pendientes_marca_valida (marca in ('casa_tomas',
--      'touza')), igual que reservas_marca_valida. Guardado por pg_constraint.
--   3. Backfill con la regla VIEJA (la que usaba fn_aceptar_propuesta_solicitud
--      desde 20260924090000): sala propuesta de Touza, o notas que empiezan por
--      "Solicitud de El Reservado" => 'touza'. Re-ejecutable: solo toca filas
--      que siguen en 'casa_tomas' y cumplen la regla.
--   4. fn_aceptar_propuesta_solicitud(uuid, text): mismo cuerpo que
--      20260924090000 salvo la derivación del negocio, que pasa a ser
--      `v_marca := s.marca`. Misma firma, SECURITY INVOKER, search_path y
--      GRANTs.
--
-- NO toca reservas, ni espacio_id, ni asignaciones_mesa.
-- Rollback: supabase/rollbacks/20260930100000_solicitudes_marca_ROLLBACK.sql
-- (revertir ANTES el código que escribe `marca`).
-- ===========================================================================

-- 1. Columna ------------------------------------------------------------------
alter table public.solicitudes_pendientes
  add column if not exists marca text not null default 'casa_tomas';

comment on column public.solicitudes_pendientes.marca is
  'Negocio de la solicitud: casa_tomas | touza (El Reservado). Lo escribe quien crea la solicitud (bots, reservas-web, panel); fn_aceptar_propuesta_solicitud lo copia a reservas.marca. Ya no se deduce de la sala (reservas-sin-salas, 20260930100000).';

-- 2. CHECK (guardado) ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'solicitudes_pendientes_marca_valida'
      and conrelid = 'public.solicitudes_pendientes'::regclass
  ) then
    alter table public.solicitudes_pendientes
      add constraint solicitudes_pendientes_marca_valida
      check (marca in ('casa_tomas', 'touza'));
  end if;
end;
$$;

-- 3. Backfill (idempotente) ---------------------------------------------------
update public.solicitudes_pendientes s
   set marca = 'touza'
 where s.marca = 'casa_tomas'
   and (
     exists (
       select 1 from public.espacios_reserva e
       where e.id = s.espacio_propuesto_id
         and btrim(e.caracteristicas->>'marca') = 'touza'
     )
     or ltrim(coalesce(s.notas_cliente, '')) like 'Solicitud de El Reservado%'
   );

-- 4. fn_aceptar_propuesta_solicitud lee la marca guardada ---------------------
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

  -- Negocio (reservas-sin-salas, 20260930100000): el GUARDADO en la
  -- solicitud. Ya no se deduce de la sala propuesta ni de las notas: la sala
  -- es una decisión interna del restaurante y puede no existir. Quien crea la
  -- solicitud (bots, reservas-web, panel) escribe la marca; las filas
  -- anteriores las rellenó el backfill de esta misma migración con la regla
  -- vieja. El aforo lo valida el trigger POR NEGOCIO con esta marca.
  v_marca := coalesce(nullif(btrim(s.marca), ''), 'casa_tomas');

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
  'Crea la reserva con los datos guardados en la solicitud y la marca resuelta/aceptada. Negocio: solicitudes_pendientes.marca (columna explícita desde 20260930100000; ya no se deduce de la sala ni de las notas). Vía email: confirmada. Vía teléfono (panel): verificada, el cliente recibe "Confirma tu reserva"; exige teléfono y email. Lista negra: pendiente. Idempotente. Devuelve jsonb {ok, reserva_id, estado, marca} o {ok:false, error}.';

-- CREATE OR REPLACE conserva los GRANT; se repiten por si se aplicara en otro
-- orden en un entorno nuevo.
revoke all on function public.fn_aceptar_propuesta_solicitud(uuid, text) from public, anon;
grant execute on function public.fn_aceptar_propuesta_solicitud(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- VERIFICACIÓN tras aplicar (solo lectura)
-- ===========================================================================
--   select marca, count(*) from public.solicitudes_pendientes group by 1;
--   -- todas con marca; las de El Reservado en 'touza'
--
--   select position('s.marca' in prosrc) > 0 as lee_marca_guardada
--   from pg_proc where oid = 'public.fn_aceptar_propuesta_solicitud(uuid, text)'::regprocedure;
--   -- -> true
--
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'solicitudes_pendientes_marca_valida';
--   -- -> CHECK ((marca = ANY (ARRAY['casa_tomas'::text, 'touza'::text])))
--
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'fn_aceptar_propuesta_solicitud';
--   -- -> authenticated, service_role (y postgres); NO anon ni PUBLIC
--
--   -- Prueba sin rastro (una solicitud abierta con email):
--   begin;
--   select public.fn_aceptar_propuesta_solicitud('<id>', 'telefono');
--   -- -> {"ok": true, "marca": <la de la solicitud>, ...}
--   rollback;
-- ===========================================================================
