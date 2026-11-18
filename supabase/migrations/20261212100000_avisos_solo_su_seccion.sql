-- Avisos: cada uno solo para quien ve su sección (18/11/2026, petición del dueño: «hay que revisar qué
-- avisos salen según qué usuario tiene permisos, al usuario camarero le salen [avisos] que no le
-- deberían salir»).
--
-- Por qué. `notificaciones_dashboard` tenía DOS políticas SELECT permisivas, y Postgres las suma (OR):
--   - notificaciones_dashboard_select_seccion (20260918120000): ver «dashboard» → TODOS los avisos.
--   - notificaciones_dashboard_select_por_seccion_aviso (20261124100000): ver la sección del aviso.
-- La primera anulaba a la segunda. La plantilla «Camarero» (Panel principal + Reservas, sin Facturas)
-- veía en la campana y en /avisos las alertas de Facturas (subidas de precio, albaranes sin factura,
-- importes inusuales, margen bajo…) y le sumaban en la cifra roja. Medido el 18/11/2026: en
-- producción, el usuario de Reservas sin Facturas tenía a la vista unos 25 avisos de Facturas sin
-- revisar. El módulo «Avisos» del Dashboard ya los filtraba en el navegador; la campana y /avisos no.
--
-- Qué cambia.
-- 1. Fuera `notificaciones_dashboard_select_seccion`: leer un aviso exige ver SU sección (la política
--    por sección de 20261124100000 se queda como única SELECT para `authenticated`).
-- 2. `seccion_aviso` cubre todos los tipos que se crean hoy:
--      reservas  · reserva_nueva, reserva_cancelada, reserva_sin_asignar, solicitud_pendiente,
--                  propuesta_aceptada / _rechazada / _fallida (solicitudes de espacios),
--                  email_fallido (correos de reserva que no salen), mesa_borrada_con_asignaciones
--      facturas  · facturas_*, subida_precio, original_sin_drive (sin cambios)
--      marketing · instagram_* (encargos de Instagram y story del jueves de tapas: RRSS)
--      solo_super_admin · peticion_*, ia_modelo*, sistema (presupuesto del chatbot web, tráfico web),
--                  llamada (Asistente telefónico: vive en Super Admin)
--    Un tipo que no esté en la lista lo ve solo el super admin (antes: cualquiera con el panel
--    principal), para que un aviso nuevo no se cuele a quien no debe. «solo_super_admin» no es una
--    sección real: `has_section_permission` da true al super admin y false a todos los demás.
-- Lo que NO cambia: insertar, borrar y la RPC `marcar_avisos_revisados` (ya usa `seccion_aviso`, así
-- que marca exactamente lo que cada uno ve), ni las restrictivas de sesión bloqueada, modelos de IA y
-- peticiones. Realtime aplica la misma RLS: la campana deja de recibir en vivo lo que no puede leer.
--
-- Vuelta atrás: supabase/rollbacks/20261212100000_avisos_solo_su_seccion_ROLLBACK.sql
-- Panel: src/lib/dashboard/avisosDashboard.ts (`seccionDeAviso`) repite esta misma lista.

-- 1. Sección de cada tipo de aviso ---------------------------------------------------------------
create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in (
      'reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente',
      'propuesta_aceptada', 'propuesta_rechazada', 'propuesta_fallida',
      'email_fallido', 'mesa_borrada_con_asignaciones'
    ) then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    when p_tipo like 'instagram\_%' then 'marketing'
    else 'solo_super_admin'
  end
$$;

revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- 2. Leer: solo los avisos de las secciones que se ven -------------------------------------------
-- (Se recrea por si faltara; es la misma de 20261124100000.)
drop policy if exists notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard;
create policy notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard
  for select to authenticated
  using ((select public.can_read_section(public.seccion_aviso(tipo))));

drop policy if exists notificaciones_dashboard_select_seccion on public.notificaciones_dashboard;

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select polname from pg_policy
--    where polrelid = 'public.notificaciones_dashboard'::regclass and polcmd = 'r';
--     -- solo notificaciones_dashboard_select_por_seccion_aviso
--   select t, public.seccion_aviso(t) from unnest(array['reserva_nueva','email_fallido',
--     'facturas_precio_sube','instagram_encargo','sistema','tipo_nuevo']) t;
--     -- reservas, reservas, facturas, marketing, solo_super_admin, solo_super_admin
