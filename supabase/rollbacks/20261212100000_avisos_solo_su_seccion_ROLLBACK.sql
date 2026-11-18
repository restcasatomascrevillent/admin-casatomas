-- Vuelta atrás de supabase/migrations/20261212100000_avisos_solo_su_seccion.sql
--
-- No hace falta revertir el panel antes: el panel solo lee la tabla y la RLS decide qué devuelve.
--
-- - Vuelve la política `notificaciones_dashboard_select_seccion`: quien ve el panel principal vuelve
--   a leer TODOS los avisos (también los de secciones que no tiene: el fallo del camarero).
-- - `seccion_aviso` vuelve a como la dejó 20261129100000_peticiones.sql (peticiones a
--   «solo_super_admin», el resto de tipos desconocidos a «dashboard»).
-- - La política SELECT por sección de 20261124100000 se queda. Idempotente.

create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    else 'dashboard'
  end
$$;

revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

drop policy if exists notificaciones_dashboard_select_seccion on public.notificaciones_dashboard;
create policy notificaciones_dashboard_select_seccion on public.notificaciones_dashboard
  for select to authenticated
  using ((select public.can_read_section('dashboard')));
