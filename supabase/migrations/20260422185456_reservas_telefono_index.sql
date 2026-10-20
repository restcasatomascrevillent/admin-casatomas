-- Reconstruida desde supabase_migrations.schema_migrations (version 20260422185456).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Índice faltante en reservas.telefono — crítico para lookupCallerContext() del webhook
-- (blacklist ya tiene unique (tipo, valor), no necesita índice extra)
CREATE INDEX IF NOT EXISTS idx_reservas_telefono
  ON reservas (telefono)
  WHERE estado IN ('pendiente', 'verificada', 'confirmada');

CREATE INDEX IF NOT EXISTS idx_reservas_fecha_estado
  ON reservas (fecha, estado);
