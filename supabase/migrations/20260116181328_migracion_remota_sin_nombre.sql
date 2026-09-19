-- Reconstruida desde supabase_migrations.schema_migrations (version 20260116181328).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Extender tabla newsletter_envios con tipo y estado
ALTER TABLE newsletter_envios 
ADD COLUMN IF NOT EXISTS tipo_newsletter text DEFAULT 'anuncio',
ADD COLUMN IF NOT EXISTS estado text DEFAULT 'pendiente';

-- Añadir comentario para documentar los estados
COMMENT ON COLUMN newsletter_envios.estado IS 'Estados: pendiente, enviando, enviado, error';
COMMENT ON COLUMN newsletter_envios.tipo_newsletter IS 'Tipos: anuncio, nuevo_menu, oferta';
