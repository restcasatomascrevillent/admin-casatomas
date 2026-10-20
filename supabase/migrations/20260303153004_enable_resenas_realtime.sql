-- Reconstruida desde supabase_migrations.schema_migrations (version 20260303153004).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Habilitar publicación Realtime para la tabla resenas
ALTER PUBLICATION supabase_realtime ADD TABLE resenas;
-- También para config_google_places (para el widget de estado de sync)
ALTER PUBLICATION supabase_realtime ADD TABLE config_google_places;
