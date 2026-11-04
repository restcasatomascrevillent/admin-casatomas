set client_encoding = 'UTF8';
-- ROLLBACK de 20261104111000_permiso_reservas_configuracion.sql (permiso propio
-- de Reservas › Configuración). Aplicar a mano SOLO si hay que deshacerlo.
--
-- Deja las políticas y fn_restaurar_version_plantilla como estaban (las de la
-- demo el 04/11/2026): configuracion_reservas se escribe con el rol admin
-- (is_admin), configuracion_turnos con 'reservas' o con el rol admin, y las
-- plantillas se leen y escriben con la sección 'reservas'.
--
-- No borra los permisos 'reservas_configuracion' de user_permissions ni la
-- entrada de los roles preconfigurados: sin la migración no hacen nada, y si
-- se vuelve a aplicar no se siembra otra vez (ya hay permisos de la sección).
-- Antes de aplicarlo, volver a publicar el panel y emails-reserva de antes
-- (el panel nuevo esconde Configuración a quien no tiene la sección, y
-- /enviar-prueba pediría una sección que ya no protege nada).
begin;
set local lock_timeout = '5s';

-- configuracion_reservas
drop policy if exists configuracion_reservas_update_seccion on public.configuracion_reservas;
drop policy if exists "Admins can manage configuracion_reservas" on public.configuracion_reservas;
create policy "Admins can manage configuracion_reservas"
  on public.configuracion_reservas for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- configuracion_turnos
drop policy if exists configuracion_turnos_insert_seccion on public.configuracion_turnos;
create policy configuracion_turnos_insert_seccion
  on public.configuracion_turnos for insert to authenticated
  with check ((select public.can_write_section('reservas')));
drop policy if exists configuracion_turnos_update_seccion on public.configuracion_turnos;
create policy configuracion_turnos_update_seccion
  on public.configuracion_turnos for update to authenticated
  using ((select public.can_write_section('reservas')))
  with check ((select public.can_write_section('reservas')));
drop policy if exists configuracion_turnos_delete_seccion on public.configuracion_turnos;
create policy configuracion_turnos_delete_seccion
  on public.configuracion_turnos for delete to authenticated
  using ((select public.can_write_section('reservas')));
drop policy if exists "Admins pueden actualizar configuración de turnos" on public.configuracion_turnos;
create policy "Admins pueden actualizar configuración de turnos"
  on public.configuracion_turnos for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists "Admins pueden crear configuración de turnos" on public.configuracion_turnos;
create policy "Admins pueden crear configuración de turnos"
  on public.configuracion_turnos for insert to authenticated
  with check (public.is_admin(auth.uid()));
drop policy if exists "Admins pueden eliminar configuración de turnos" on public.configuracion_turnos;
create policy "Admins pueden eliminar configuración de turnos"
  on public.configuracion_turnos for delete to authenticated
  using (public.is_admin(auth.uid()));

-- plantillas_email_reserva
drop policy if exists plantillas_email_reserva_select_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_select_seccion
  on public.plantillas_email_reserva for select to authenticated
  using (public.can_read_section('reservas'));
drop policy if exists plantillas_email_reserva_insert_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_insert_seccion
  on public.plantillas_email_reserva for insert to authenticated
  with check (public.can_write_section('reservas'));
drop policy if exists plantillas_email_reserva_update_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_update_seccion
  on public.plantillas_email_reserva for update to authenticated
  using (public.can_write_section('reservas')) with check (public.can_write_section('reservas'));
drop policy if exists plantillas_email_reserva_delete_seccion on public.plantillas_email_reserva;
create policy plantillas_email_reserva_delete_seccion
  on public.plantillas_email_reserva for delete to authenticated
  using (public.can_write_section('reservas'));

-- fn_restaurar_version_plantilla, tal cual 20260920010000
create or replace function public.fn_restaurar_version_plantilla(
  p_tipo text,
  p_version_a_restaurar integer,
  p_actor uuid default auth.uid()
)
returns public.plantillas_email_reserva
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_origen public.plantillas_email_reserva;
  v_siguiente integer;
  v_nueva public.plantillas_email_reserva;
begin
  -- SECURITY DEFINER se ejecuta como el propietario de la función, que por
  -- defecto SALTA la RLS de la tabla (no está en FORCE ROW LEVEL SECURITY).
  -- El GRANT EXECUTE de más abajo por sí solo dejaría entrar a cualquier
  -- `authenticated`, no solo a quien tiene permiso de la sección 'reservas'
  -- en el panel — se repite aquí a propósito el mismo chequeo que ya hacen
  -- las políticas RLS del resto del esquema.
  if not public.can_write_section('reservas') then
    raise exception 'No tienes permiso de escritura en la sección reservas';
  end if;

  select * into v_origen
    from public.plantillas_email_reserva
    where tipo = p_tipo and version = p_version_a_restaurar;

  if not found then
    raise exception 'No existe la version % de la plantilla %', p_version_a_restaurar, p_tipo;
  end if;

  select coalesce(max(version), 0) + 1 into v_siguiente
    from public.plantillas_email_reserva
    where tipo = p_tipo;

  update public.plantillas_email_reserva set es_actual = false where tipo = p_tipo and es_actual;

  insert into public.plantillas_email_reserva (
    tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal,
    texto_boton_secundario, pie, color_acento, color_oscuro, logo_url, bloques,
    nota_version, creado_por
  ) values (
    v_origen.tipo, v_siguiente, true, v_origen.asunto, v_origen.saludo, v_origen.cuerpo,
    v_origen.texto_boton_principal, v_origen.texto_boton_secundario, v_origen.pie,
    v_origen.color_acento, v_origen.color_oscuro, v_origen.logo_url, v_origen.bloques,
    'Restaurada desde la version ' || p_version_a_restaurar, p_actor
  )
  returning * into v_nueva;

  return v_nueva;
end;
$$;
comment on function public.fn_restaurar_version_plantilla(text, integer, uuid) is
  'Contrato para el panel: "volver atrás" = duplicar el contenido de una version antigua como version nueva y marcarla actual. Nunca reescribe una version ya guardada.';
revoke all on function public.fn_restaurar_version_plantilla(text, integer, uuid) from public, anon;
grant execute on function public.fn_restaurar_version_plantilla(text, integer, uuid) to authenticated, service_role;

do $$
begin
  raise notice 'permiso_reservas_configuracion: deshecha';
end;
$$;

commit;
