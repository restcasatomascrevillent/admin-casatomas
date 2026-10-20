-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

-- Espacios se une a Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google,
-- Plantillas Email y Tráfico web: pasa a gestionarse exclusivamente desde el
-- Super Admin y deja de ser una funcionalidad activable/desactivable del
-- Admin Panel normal (ya no tiene ruta ni permiso allí).
DELETE FROM public.admin_feature_toggles WHERE section_key = 'espacios';
