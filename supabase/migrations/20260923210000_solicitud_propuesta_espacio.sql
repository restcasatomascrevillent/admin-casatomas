-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   La aplica el dueño a mano en el SQL Editor de Supabase. Es           ##
-- ##   ADITIVA e IDEMPOTENTE: se puede ejecutar dos veces sin error. No     ##
-- ##   borra ni renombra nada.                                              ##
-- ##                                                                       ##
-- ===========================================================================
--
-- SOLICITUD DEL BOT -> PROPUESTA AL CLIENTE -> ACEPTACIÓN -> RESERVA
--
-- Flujo del dueño: cuando el bot no pudo cerrar una reserva, el restaurante
-- le manda al cliente una PROPUESTA (día / hora / sala / personas). Cuando el
-- cliente la ACEPTA, se convierte en reserva, y en ese momento TODO tiene que
-- estar ya guardado en la solicitud — también la sala.
--
-- Qué añade:
--   1. solicitudes_pendientes:
--        espacio_propuesto_id   sala propuesta (antes solo vivía en el diálogo)
--        propuesta_estado       borrador | enviada | aceptada | rechazada | caducada
--        propuesta_enviada_at   cuándo salió el último correo de propuesta
--                               (entra en la huella del enlace firmado: reenviar
--                               invalida el enlace anterior)
--        propuesta_respondida_at, propuesta_respuesta_via (email | telefono)
--        propuesta_error        último motivo por el que no se pudo aceptar
--        reserva_id             reserva creada al aceptar
--   2. reservas.solicitud_id   enlace de vuelta a la solicitud + índice ÚNICO
--                              parcial: una solicitud produce como mucho UNA
--                              reserva aunque el cliente pulse dos veces.
--   3. fn_aceptar_propuesta_solicitud(uuid, text)  -> jsonb
--      fn_rechazar_propuesta_solicitud(uuid, text) -> jsonb
--      Transacción única: bloquea la solicitud (FOR UPDATE), crea la reserva
--      con todos los datos guardados, respeta el trigger de aforo
--      (trg_validar_capacidad) y marca la solicitud. SECURITY INVOKER: el panel
--      pasa por la RLS de siempre (can_write_section('reservas')); la Edge
--      Function emails-reserva la llama con service_role.
--
-- POR QUÉ NO SE REUTILIZA TAL CUAL LA CONTRAOFERTA DE emails-reserva
--   La contraoferta existente trabaja sobre una fila de `reservas` ya creada
--   (estado 'verificada'): su token firma reserva.id, su huella es
--   estado|hora|espacio_id de la reserva, y su registro de envíos
--   (envios_email_reserva.reserva_id NOT NULL, FK a reservas) exige que la
--   reserva exista. Aquí la reserva NO debe existir hasta que el cliente
--   acepte (regla del dueño), así que se reutiliza todo lo demás —plantilla
--   'propuesta', firma HMAC (tokens.ts), envío a Resend con Idempotency-Key,
--   páginas HTML, campana del panel— y solo cambia el "sujeto" (la solicitud)
--   y lo que pasa al aceptar (INSERT de la reserva en vez de UPDATE de estado).
--   El token es sin estado (HMAC), así que no hace falta columna de token.
--
-- Estado de la reserva al aceptar: 'confirmada' (el cliente ya ha aceptado).
-- Si el teléfono/email está en la lista negra, entra 'pendiente' con
-- en_blacklist = true para revisión manual (misma regla que el alta del panel).
--
-- RLS: no se crean políticas nuevas. Las columnas nuevas heredan las de su
-- tabla (20260918120000_rls_por_permisos_de_seccion.sql):
--   solicitudes_pendientes / reservas -> can_read/can_write_section('reservas')
--   notificaciones_dashboard           -> service_role (la escribe la función
--                                         solo cuando actúa el cliente, vía
--                                         Edge Function con service_role).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Columnas en solicitudes_pendientes
-- ---------------------------------------------------------------------------
alter table public.solicitudes_pendientes
  add column if not exists espacio_propuesto_id uuid
    references public.espacios_reserva(id) on delete set null,
  add column if not exists propuesta_estado text not null default 'borrador',
  add column if not exists propuesta_enviada_at timestamptz,
  add column if not exists propuesta_respondida_at timestamptz,
  add column if not exists propuesta_respuesta_via text,
  add column if not exists propuesta_error text,
  add column if not exists reserva_id uuid
    references public.reservas(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_propuesta_estado_valido') then
    alter table public.solicitudes_pendientes
      add constraint solicitudes_propuesta_estado_valido
      check (propuesta_estado in ('borrador', 'enviada', 'aceptada', 'rechazada', 'caducada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_propuesta_via_valida') then
    alter table public.solicitudes_pendientes
      add constraint solicitudes_propuesta_via_valida
      check (propuesta_respuesta_via is null or propuesta_respuesta_via in ('email', 'telefono'));
  end if;
end $$;

-- Índices de las FK (Postgres no los crea solo; sin ellos, borrar un espacio
-- o una reserva recorre la tabla entera).
create index if not exists idx_solicitudes_espacio_propuesto
  on public.solicitudes_pendientes (espacio_propuesto_id)
  where espacio_propuesto_id is not null;
create index if not exists idx_solicitudes_reserva
  on public.solicitudes_pendientes (reserva_id)
  where reserva_id is not null;

comment on column public.solicitudes_pendientes.espacio_propuesto_id is
  'Sala propuesta por el personal (diálogo Gestionar). Se copia a reservas.espacio_id al aceptar.';
comment on column public.solicitudes_pendientes.propuesta_estado is
  'borrador | enviada | aceptada | rechazada | caducada. Guardar cambios tras enviar vuelve a borrador (el enlace del correo deja de valer).';
comment on column public.solicitudes_pendientes.propuesta_enviada_at is
  'Último envío del correo de propuesta. Forma parte de la huella del enlace firmado (emails-reserva/propuesta-solicitud.ts).';
comment on column public.solicitudes_pendientes.propuesta_respuesta_via is
  'Cómo respondió el cliente: email (enlace del correo) | telefono (registrado por el personal).';
comment on column public.solicitudes_pendientes.propuesta_error is
  'Último motivo por el que no se pudo aceptar (sin_aforo, fecha_pasada...). Se limpia al aceptar.';
comment on column public.solicitudes_pendientes.reserva_id is
  'Reserva creada al aceptar la propuesta.';

-- ---------------------------------------------------------------------------
-- 2. reservas.solicitud_id
-- ---------------------------------------------------------------------------
alter table public.reservas
  add column if not exists solicitud_id uuid
    references public.solicitudes_pendientes(id) on delete set null;

-- Único parcial: sirve de índice de la FK Y de candado contra la doble
-- aceptación (dos clics, o correo + teléfono a la vez).
create unique index if not exists uq_reservas_solicitud_id
  on public.reservas (solicitud_id)
  where solicitud_id is not null;

comment on column public.reservas.solicitud_id is
  'Solicitud del bot de la que sale esta reserva (propuesta aceptada o conversión desde el panel).';

-- ---------------------------------------------------------------------------
-- 3. Normalización de teléfono (misma regla que normalizePhone() de
--    restaurante-phone/api/vapi-webhook.js:142)
-- ---------------------------------------------------------------------------
create or replace function public.fn_normalizar_telefono(p_telefono text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_telefono is null then ''
    else (
      with limpio as (
        select regexp_replace(p_telefono, '[\s\-\(\)\+\.]', '', 'g') as t
      ), sin0034 as (
        select case when t like '0034%' then substr(t, 5) else t end as t from limpio
      )
      select case when t like '34%' and length(t) = 11 then substr(t, 3) else t end from sin0034
    )
  end
$$;

comment on function public.fn_normalizar_telefono(text) is
  'Quita formato y prefijo +34/0034 (misma regla que normalizePhone del bot). Para comparar teléfonos.';

-- ---------------------------------------------------------------------------
-- 4. Aceptar la propuesta -> crea la reserva
-- ---------------------------------------------------------------------------
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
  v_marca text;
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

  -- Negocio: el de la sala propuesta; sin sala, Casa Tomás (default de reservas.marca).
  select coalesce(e.caracteristicas->>'marca', 'casa_tomas') into v_marca
    from public.espacios_reserva e where e.id = s.espacio_propuesto_id;
  v_marca := coalesce(v_marca, 'casa_tomas');

  select exists (
    select 1 from public.blacklist b
    where (b.tipo = 'telefono' and s.telefono is not null
           and public.fn_normalizar_telefono(b.valor) = public.fn_normalizar_telefono(s.telefono))
       or (b.tipo = 'email' and s.email is not null
           and lower(trim(b.valor)) = lower(trim(s.email)))
  ) into v_blacklist;

  v_estado := case when v_blacklist then 'pendiente' else 'confirmada' end;

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
            case when v_blacklist then ' (en lista negra: queda pendiente de revisión)' else '' end,
            v_reserva_id, 'reserva');
  end if;

  return jsonb_build_object('ok', true, 'reserva_id', v_reserva_id, 'estado', v_estado,
                            'en_blacklist', v_blacklist);
end;
$$;

comment on function public.fn_aceptar_propuesta_solicitud(uuid, text) is
  'Crea la reserva (confirmada; pendiente si lista negra) con los datos guardados en la solicitud y la marca resuelta/aceptada. Idempotente. Devuelve jsonb {ok, reserva_id, estado} o {ok:false, error}.';

-- ---------------------------------------------------------------------------
-- 5. Rechazar la propuesta
-- ---------------------------------------------------------------------------
create or replace function public.fn_rechazar_propuesta_solicitud(
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
begin
  if p_via not in ('email', 'telefono') then
    return jsonb_build_object('ok', false, 'error', 'via_invalida');
  end if;

  select * into s from public.solicitudes_pendientes where id = p_solicitud_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_encontrada');
  end if;
  if s.propuesta_estado = 'rechazada' then
    return jsonb_build_object('ok', true, 'ya_rechazada', true);
  end if;
  if s.propuesta_estado = 'aceptada' then
    return jsonb_build_object('ok', false, 'error', 'ya_aceptada');
  end if;
  if p_via = 'email' and s.propuesta_estado <> 'enviada' then
    return jsonb_build_object('ok', false, 'error', 'propuesta_no_vigente');
  end if;

  -- La solicitud sigue abierta ('contactado'): el personal puede llamar y
  -- proponer otra cosa, o descartarla.
  update public.solicitudes_pendientes
    set propuesta_estado = 'rechazada',
        propuesta_respondida_at = now(),
        propuesta_respuesta_via = p_via,
        estado = case when estado = 'pendiente' then 'contactado' else estado end,
        updated_at = now()
    where id = s.id;

  if p_via = 'email' then
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo)
    values ('propuesta_rechazada', 'Un cliente rechazó la propuesta',
            coalesce(s.nombre, 'Cliente') || ' (' || coalesce(s.telefono, 'sin teléfono') ||
            ') no puede venir a lo propuesto. La solicitud sigue abierta.',
            s.id, 'solicitud');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.fn_rechazar_propuesta_solicitud(uuid, text) is
  'Marca la propuesta como rechazada (la solicitud queda abierta como contactado). Idempotente.';

-- Solo personal autenticado (sujeto a RLS, SECURITY INVOKER) y service_role.
revoke all on function public.fn_aceptar_propuesta_solicitud(uuid, text) from public, anon;
revoke all on function public.fn_rechazar_propuesta_solicitud(uuid, text) from public, anon;
grant execute on function public.fn_aceptar_propuesta_solicitud(uuid, text) to authenticated, service_role;
grant execute on function public.fn_rechazar_propuesta_solicitud(uuid, text) to authenticated, service_role;
revoke all on function public.fn_normalizar_telefono(text) from public, anon;
grant execute on function public.fn_normalizar_telefono(text) to authenticated, service_role;

commit;

-- ===========================================================================
-- VERIFICACIÓN (ejecutar tras aplicar; solo lectura)
-- ===========================================================================
-- 1. Columnas:
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'solicitudes_pendientes'
--     and (column_name like 'propuesta%' or column_name in ('espacio_propuesto_id', 'reserva_id'));
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'reservas' and column_name = 'solicitud_id';
-- 2. Todas las solicitudes existentes quedan en 'borrador':
--   select propuesta_estado, count(*) from public.solicitudes_pendientes group by 1;
-- 3. Normalización:
--   select public.fn_normalizar_telefono('+34 612 34 56 78'),   -- 612345678
--          public.fn_normalizar_telefono('0034612345678');      -- 612345678
-- 4. Funciones y permisos:
--   select proname, prosecdef from pg_proc
--   where proname in ('fn_aceptar_propuesta_solicitud', 'fn_rechazar_propuesta_solicitud');
--   -- prosecdef = false (SECURITY INVOKER)
-- 5. Prueba en seco (no deja rastro) con una solicitud real abierta:
--   begin;
--   select public.fn_aceptar_propuesta_solicitud('<id de solicitud>', 'telefono');
--   rollback;
--
-- ===========================================================================
-- ROLLBACK (solo si hiciera falta; borra los datos de propuesta guardados)
-- ===========================================================================
--   begin;
--   drop function if exists public.fn_aceptar_propuesta_solicitud(uuid, text);
--   drop function if exists public.fn_rechazar_propuesta_solicitud(uuid, text);
--   drop function if exists public.fn_normalizar_telefono(text);
--   drop index if exists public.uq_reservas_solicitud_id;
--   alter table public.reservas drop column if exists solicitud_id;
--   drop index if exists public.idx_solicitudes_espacio_propuesto;
--   drop index if exists public.idx_solicitudes_reserva;
--   alter table public.solicitudes_pendientes
--     drop constraint if exists solicitudes_propuesta_estado_valido,
--     drop constraint if exists solicitudes_propuesta_via_valida,
--     drop column if exists espacio_propuesto_id,
--     drop column if exists propuesta_estado,
--     drop column if exists propuesta_enviada_at,
--     drop column if exists propuesta_respondida_at,
--     drop column if exists propuesta_respuesta_via,
--     drop column if exists propuesta_error,
--     drop column if exists reserva_id;
--   commit;
-- El panel sigue funcionando sin estas columnas (degrada: la sala no se
-- guarda y los botones de propuesta se ocultan).
-- ===========================================================================
