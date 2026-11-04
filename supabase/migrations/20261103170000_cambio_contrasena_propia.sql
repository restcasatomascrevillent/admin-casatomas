-- ===========================================================================
--  «Mi cuenta» › Cambiar contraseña: límite de intentos y registro del cambio.
--
--  Lo usa SOLO la Edge Function `cambiar-mi-contrasena` (service_role con
--  `x-audit-source: cambiar-mi-contrasena`), que:
--    1. identifica al usuario por su JWT (nunca por el cuerpo),
--    2. llama a iniciar_cambio_contrasena(usuario)  -> {id, permitido[, motivo]},
--    3. comprueba la contraseña actual en Auth con un cliente aislado y revoca
--       esa sesión de comprobación,
--    4. cambia la contraseña con el JWT del propio usuario (PUT /auth/v1/user:
--       conserva su sesión y cierra las de sus otros dispositivos) dentro de
--       preparar_contexto_auditoria_auth, así el trigger de auth.users registra
--       el cambio de credenciales atribuido al usuario,
--    5. llama a finalizar_cambio_contrasena(id, usuario, resultado).
--
--  Límite (ventana de 15 min, misma que el login por email):
--    · como mucho 10 fallos de contraseña de la cuenta entre logins fallidos
--      (los que cuenta iniciar_intento_panel para su email) y cambios con la
--      contraseña actual incorrecta: si el login de esa cuenta está bloqueado,
--      el cambio también. Comprobar la contraseña aquí no es una vía para
--      saltarse el límite del login;
--    · y como mucho 5 intentos de cambio fallidos de la propia cuenta.
--    Cuentan los intentos pendientes (no terminados) y los de contraseña actual
--    incorrecta. NO cuentan los cambios correctos, los que fallan después de
--    comprobar bien la contraseña actual (nueva rechazada, error del servicio)
--    ni los propios intentos bloqueados (no alargan el bloqueo).
--
--  Concurrencia: mismo advisory lock por email que iniciar_intento_panel
--  ('panel-auth-email:' || email): logins y cambios simultáneos de la misma
--  cuenta se serializan y no superan el cupo.
--
--  Registro: una fila en audit_log (accion 'ejecutar', tabla
--  'acciones_servidor', registro_id 'cambiar-mi-contrasena') con el resultado
--  ('pendiente' -> 'completada' | 'fallida' + motivo). Nunca la contraseña.
--
--  search_path vacío; todo calificado. Idempotente.
--  Rollback: supabase/rollbacks/20261103170000_cambio_contrasena_propia_ROLLBACK.sql
-- ===========================================================================

begin;

create index if not exists idx_audit_log_cambio_contrasena
  on public.audit_log (actor_user_id, created_at)
  where tabla = 'acciones_servidor' and registro_id = 'cambiar-mi-contrasena';

create or replace function public.iniciar_cambio_contrasena(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_cuenta constant integer  := 10;                    -- fallos de la cuenta (login + cambio)
  c_max_cambio constant integer  := 5;                     -- de ellos, cambios fallidos
  c_ventana    constant interval := interval '15 minutes';
  v_headers  jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_email    text;
  v_n_login  bigint;
  v_n_cambio bigint;
  v_motivo   text;
  v_id       uuid;
begin
  if auth.role() is distinct from 'service_role'
     or v_headers->>'x-audit-source' is distinct from 'cambiar-mi-contrasena' then
    raise exception 'Solo cambiar-mi-contrasena';
  end if;

  select left(lower(btrim(coalesce(u.email, ''))), 255) into v_email
  from auth.users u where u.id = p_actor;
  if not found or v_email = '' then
    raise exception 'La cuenta no existe';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('panel-auth-email:' || v_email, 0));

  -- Mismo criterio que iniciar_intento_panel para el email.
  select count(*) into v_n_login from public.audit_log
  where tabla = 'accesos_panel'
    and detalles->>'email_introducido' = v_email
    and created_at > clock_timestamp() - c_ventana
    and coalesce(detalles->>'resultado', '') not in ('limite_intentos', 'correcto');

  select count(*) into v_n_cambio from public.audit_log
  where tabla = 'acciones_servidor'
    and registro_id = 'cambiar-mi-contrasena'
    and actor_user_id = p_actor
    and created_at > clock_timestamp() - c_ventana
    and (detalles->>'resultado' = 'pendiente'
         or detalles->>'motivo' = 'contrasena_actual_incorrecta');

  if v_n_login + v_n_cambio >= c_max_cuenta then
    v_motivo := 'cuenta';
  elsif v_n_cambio >= c_max_cambio then
    v_motivo := 'cambio';
  end if;

  insert into public.audit_log (actor_user_id, accion, tabla, registro_id, detalles)
  values (
    p_actor, 'ejecutar', 'acciones_servidor', 'cambiar-mi-contrasena',
    jsonb_build_object(
      'operacion', 'cambiar-mi-contrasena',
      'origen', 'cambiar-mi-contrasena',
      'tipo_evento', 'cambio_contrasena',
      'request_id', v_headers->>'x-audit-request-id',
      'resultado', case when v_motivo is null then 'pendiente' else 'fallida' end)
    || case when v_motivo is not null
         then jsonb_build_object('motivo', 'limite_intentos', 'limite', v_motivo, 'finalizado_en', clock_timestamp())
         else '{}'::jsonb end)
  returning id into v_id;

  if v_motivo is not null then
    return jsonb_build_object('id', v_id, 'permitido', false, 'motivo', v_motivo);
  end if;
  return jsonb_build_object('id', v_id, 'permitido', true);
end;
$$;

create or replace function public.finalizar_cambio_contrasena(p_id uuid, p_actor uuid, p_resultado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_motivo  text;
begin
  if auth.role() is distinct from 'service_role'
     or v_headers->>'x-audit-source' is distinct from 'cambiar-mi-contrasena' then
    raise exception 'Solo cambiar-mi-contrasena';
  end if;
  v_motivo := case
    when p_resultado in ('correcto', 'contrasena_actual_incorrecta', 'contrasena_rechazada', 'error_servicio')
      then p_resultado
    else 'error_servicio' end;

  update public.audit_log
  set detalles = detalles
    || jsonb_build_object(
         'resultado', case when v_motivo = 'correcto' then 'completada' else 'fallida' end,
         'finalizado_en', clock_timestamp())
    || case when v_motivo <> 'correcto' then jsonb_build_object('motivo', v_motivo) else '{}'::jsonb end
  where id = p_id
    and tabla = 'acciones_servidor'
    and registro_id = 'cambiar-mi-contrasena'
    and actor_user_id = p_actor
    and detalles->>'resultado' = 'pendiente'
    -- La misma petición que lo empezó (como finalizar_intento_panel).
    and request_id is not distinct from v_headers->>'x-audit-request-id';
  if not found then
    raise exception 'El intento no existe o ya terminó';
  end if;
end;
$$;

revoke all on function public.iniciar_cambio_contrasena(uuid) from public, anon, authenticated;
revoke all on function public.finalizar_cambio_contrasena(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.iniciar_cambio_contrasena(uuid) to service_role;
grant execute on function public.finalizar_cambio_contrasena(uuid, uuid, text) to service_role;

commit;
