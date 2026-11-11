-- Avisos: «Revisado» funciona para quien ve la sección, y fuera el aviso «sin mesa» (11/11/2026,
-- petición del dueño: «cuando le das a revisado no va, además se llenan de mierda con reserva sin
-- mesa (ese aviso no tiene que salir)… solo tienen que salir los avisos de nueva reserva para
-- verificar y en caso de que alguien la cancele»).
--
-- 1. Por qué «Revisado» no hacía nada. La política UPDATE de `notificaciones_dashboard` exige
--    EDITAR la sección «dashboard». Quien tiene Reservas pero solo «Ver» en el panel principal
--    pulsaba «Revisado», la RLS filtraba la fila en silencio (0 filas, sin error), el botón se
--    ponía en «Revisado» y al releer volvía a estar sin revisar. Ahora se marca con la RPC
--    `marcar_avisos_revisados`, que exige VER la sección a la que pertenece cada aviso (Reservas
--    para los de reservas, Facturas para los de facturas) y solo cambia `leida`.
-- 2. Ver los avisos por su sección. Hasta ahora leerlos exigía ver «dashboard»: alguien con
--    Facturas y sin el panel principal tenía el botón «Avisos» de Facturas siempre a cero. Se
--    añade una política SELECT por la sección de cada aviso (la de «dashboard» se queda).
-- 3. Fuera «Reserva sin sala / sin mesas»: se quita el cron `reservas-aviso-sin-asignar` (lo
--    creaba cada 15 minutos) y se dan por revisados los que quedan. La función y su tabla de
--    avisos enviados se conservan para la vuelta atrás.
--
-- Vuelta atrás: supabase/rollbacks/20261124100000_avisos_revisado_por_seccion_ROLLBACK.sql

-- 1. Sección a la que pertenece cada tipo de aviso -----------------------------------------------
-- Misma lista que el panel (src/lib/avisos.ts → TIPOS_POR_FILTRO y SECCIONES_AVISOS).
create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    else 'dashboard'
  end
$$;

revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- 2. Leer los avisos de las secciones que se ven -------------------------------------------------
drop policy if exists notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard;
create policy notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard
  for select to authenticated
  using ((select public.can_read_section(public.seccion_aviso(tipo))));

-- 3. Marcar como revisados -----------------------------------------------------------------------
-- p_ids: esos avisos. p_tipos: todos los sin revisar de esos tipos (el «Marcar todos» de una
-- sección). Sin ninguno de los dos: todos los que el usuario puede ver (la campana).
-- Devuelve cuántos ha marcado (0 si ya estaban revisados o no son de una sección que vea).
create or replace function public.marcar_avisos_revisados(p_ids uuid[] default null, p_tipos text[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_permitida boolean;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'Hay que iniciar sesión para revisar avisos' using errcode = '42501';
  end if;
  -- La misma barrera que la política restrictiva «acceso_panel_no_bloqueado» (SECURITY DEFINER
  -- se salta la RLS): una sesión bloqueada no marca nada.
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'select private.sesion_panel_permitida()' into v_permitida;
    if not coalesce(v_permitida, false) then
      raise exception 'Sesión del panel no permitida' using errcode = '42501';
    end if;
  end if;

  update public.notificaciones_dashboard n
     set leida = true
   where n.leida = false
     and (p_ids is null or n.id = any(p_ids))
     and (p_tipos is null or n.tipo = any(p_tipos))
     and public.has_section_permission(v_uid, public.seccion_aviso(n.tipo), 'view')
     -- Los de modelos de IA son solo del super admin (política notificaciones_ia_modelos_solo_super_admin).
     and (n.tipo not like 'ia\_modelo%' or public.is_super_admin(v_uid));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.marcar_avisos_revisados(uuid[], text[]) from public, anon;
grant execute on function public.marcar_avisos_revisados(uuid[], text[]) to authenticated, service_role;

-- 4. Fuera el aviso «Reserva sin sala / sin mesas» -----------------------------------------------
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'reservas-aviso-sin-asignar';
  end if;
end;
$$;

update public.notificaciones_dashboard
   set leida = true
 where tipo = 'reserva_sin_asignar'
   and leida = false;

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select count(*) from cron.job where jobname = 'reservas-aviso-sin-asignar';           -- 0
--   select count(*) from notificaciones_dashboard where tipo = 'reserva_sin_asignar' and not leida;  -- 0
--   select proname from pg_proc where proname in ('marcar_avisos_revisados', 'seccion_aviso');      -- las dos
