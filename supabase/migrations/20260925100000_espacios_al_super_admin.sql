-- Espacios se une a Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google,
-- Plantillas Email y Tráfico web: pasa a gestionarse exclusivamente desde el
-- Super Admin y deja de ser una funcionalidad activable/desactivable del
-- Admin Panel normal (ya no tiene ruta ni permiso allí).
DELETE FROM public.admin_feature_toggles WHERE section_key = 'espacios';
