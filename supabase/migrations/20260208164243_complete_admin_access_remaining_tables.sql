-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208164243).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- ACCESO COMPLETO ADMIN PANEL - TABLAS RESTANTES
-- =====================================================
-- Macro para crear políticas completas (SELECT, INSERT, UPDATE, DELETE)

-- 1. ASIGNACIONES_AREA
CREATE POLICY "Auth can manage asignaciones_area" ON public.asignaciones_area FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. ASIGNACIONES_MESA
CREATE POLICY "Auth can manage asignaciones_mesa" ON public.asignaciones_mesa FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. CAMPANAS_MARKETING
CREATE POLICY "Auth can manage campanas_marketing" ON public.campanas_marketing FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. CARRITO
CREATE POLICY "Auth can manage carrito" ON public.carrito FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. CONFIG_GOOGLE_PLACES
CREATE POLICY "Auth can manage config_google_places" ON public.config_google_places FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. CONFIG_REDES_SOCIALES
CREATE POLICY "Auth can manage config_redes_sociales" ON public.config_redes_sociales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. CONFIGURACION_TURNOS
CREATE POLICY "Auth can manage configuracion_turnos" ON public.configuracion_turnos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. DASHBOARD_CONFIG
CREATE POLICY "Auth can manage dashboard_config" ON public.dashboard_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 9. EMAIL_EVENTOS
CREATE POLICY "Auth can manage email_eventos" ON public.email_eventos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 10. ESTADISTICAS_REDES
CREATE POLICY "Auth can manage estadisticas_redes" ON public.estadisticas_redes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 11. FAVORITOS
CREATE POLICY "Auth can manage favoritos" ON public.favoritos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 12. GDPR_AUDIT_LOG
CREATE POLICY "Auth can manage gdpr_audit_log" ON public.gdpr_audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 13. GDPR_CONFIG
CREATE POLICY "Auth can manage gdpr_config" ON public.gdpr_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 14. HISTORIAL_AJUSTES_PRECIOS
CREATE POLICY "Auth can manage historial_ajustes_precios" ON public.historial_ajustes_precios FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 15. HISTORIAL_PRECIOS
CREATE POLICY "Auth can manage historial_precios" ON public.historial_precios FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 16. IMAGENES_BASE64
CREATE POLICY "Auth can manage imagenes_base64" ON public.imagenes_base64 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 17. NOTICIAS_HOSTELERIA
CREATE POLICY "Auth can manage noticias_hosteleria" ON public.noticias_hosteleria FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 18. PLANOS_ESPACIO
CREATE POLICY "Auth can manage planos_espacio" ON public.planos_espacio FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 19. PRODUCTOS_CATALOGO
CREATE POLICY "Auth can manage productos_catalogo" ON public.productos_catalogo FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 20. PUBLICACIONES_REDES
CREATE POLICY "Auth can manage publicaciones_redes" ON public.publicaciones_redes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 21. RESENAS
CREATE POLICY "Auth can manage resenas" ON public.resenas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 22. SELL_USERS
CREATE POLICY "Auth can manage sell_users" ON public.sell_users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Tablas adicionales que podrían estar faltando
CREATE POLICY "Auth can manage ocupacion_diaria" ON public.ocupacion_diaria FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage registro_horas" ON public.registro_horas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage asignaciones_sala" ON public.asignaciones_sala FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage lineas_pedido" ON public.lineas_pedido FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage movimientos_stock" ON public.movimientos_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage alertas_stock" ON public.alertas_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth can manage newsletter_envios" ON public.newsletter_envios FOR ALL TO authenticated USING (true) WITH CHECK (true);
