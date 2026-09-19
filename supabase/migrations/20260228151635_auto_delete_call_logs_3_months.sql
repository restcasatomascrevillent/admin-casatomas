-- Reconstruida desde supabase_migrations.schema_migrations (version 20260228151635).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Activar pg_cron si no está activo
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Eliminar el job si ya existía para evitar duplicados
SELECT cron.unschedule('delete-old-call-logs') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'delete-old-call-logs'
);

-- Job: borrar call_logs con más de 3 meses de antigüedad
-- Se ejecuta cada día a las 3:00 AM (hora del servidor, UTC)
SELECT cron.schedule(
  'delete-old-call-logs',
  '0 3 * * *',
  $$
    DELETE FROM public.call_logs
    WHERE started_at < NOW() - INTERVAL '3 months';
  $$
);
