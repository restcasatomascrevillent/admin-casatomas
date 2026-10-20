-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221191523).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- 1. Recrear vista_ocupacion_hoy sin espacios_reserva
DROP VIEW IF EXISTS vista_ocupacion_hoy CASCADE;
CREATE VIEW vista_ocupacion_hoy AS
SELECT
  COALESCE(COUNT(*), 0)::int                                     AS total_reservas,
  COALESCE(SUM(numero_comensales), 0)::int                       AS total_comensales,
  COUNT(*) FILTER (WHERE estado = 'confirmada')::int             AS reservas_confirmadas,
  COUNT(*) FILTER (WHERE estado = 'pendiente')::int              AS reservas_pendientes,
  COUNT(*) FILTER (WHERE estado = 'cancelada')::int              AS reservas_canceladas,
  COALESCE(SUM(numero_comensales) FILTER (WHERE estado = 'confirmada'), 0)::int AS comensales_confirmados
FROM reservas
WHERE fecha = CURRENT_DATE;

-- 2. Eliminar política RLS que exponía reservas a anónimos
DROP POLICY IF EXISTS "Public can read reservas" ON reservas;
