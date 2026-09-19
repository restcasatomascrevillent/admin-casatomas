-- Reconstruida desde supabase_migrations.schema_migrations (version 20260216190622).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- Permitir lectura pública de reservas (necesario para el panel del sistema telefónico)
CREATE POLICY "Public can read reservas" ON reservas
  FOR SELECT USING (true);
