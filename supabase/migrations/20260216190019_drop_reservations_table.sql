-- Reconstruida desde supabase_migrations.schema_migrations (version 20260216190019).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


ALTER PUBLICATION supabase_realtime DROP TABLE reservations;
DROP TABLE IF EXISTS reservations;
