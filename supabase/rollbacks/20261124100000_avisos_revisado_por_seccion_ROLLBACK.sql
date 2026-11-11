-- Vuelta atrás de supabase/migrations/20261124100000_avisos_revisado_por_seccion.sql
--
-- AVISO: revertir el panel PRIMERO. El panel llama a `marcar_avisos_revisados`: sin ella, «Revisado»
-- y «Marcar todos como revisados» fallan con PGRST202 (función no encontrada).
--
-- - Vuelve a programar el cron `reservas-aviso-sin-asignar` (cada 15 minutos). Las reservas que sigan
--   sin mesa dentro de la ventana y ya avisaron NO vuelven a avisar (avisos_reserva_enviados).
-- - Borra la RPC, la política SELECT por sección y `seccion_aviso`: leer avisos vuelve a exigir ver
--   «dashboard» y marcarlos, editarlo.
-- - Los avisos «sin mesa» que la migración dio por revisados se quedan revisados.

do $$
begin
  if to_regclass('cron.job') is not null
     and not exists (select 1 from cron.job where jobname = 'reservas-aviso-sin-asignar') then
    perform cron.schedule(
      'reservas-aviso-sin-asignar',
      '*/15 * * * *',
      $cmd$ select public.fn_avisar_reservas_sin_asignar(); $cmd$
    );
  end if;
end;
$$;

drop function if exists public.marcar_avisos_revisados(uuid[], text[]);
drop policy if exists notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard;
drop function if exists public.seccion_aviso(text);
