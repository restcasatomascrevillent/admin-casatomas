-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

DROP POLICY IF EXISTS "Authenticated users can delete notificaciones" ON public.notificaciones_dashboard;
