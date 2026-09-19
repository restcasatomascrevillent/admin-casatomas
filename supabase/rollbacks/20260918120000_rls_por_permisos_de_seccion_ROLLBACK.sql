-- =====================================================================
-- ROLLBACK de 20260918120000_rls_por_permisos_de_seccion.sql
-- Restaura el estado EXACTO anterior a la Fase 2, es decir, el estado
-- que dejo la Fase 1 (20260918084909_cerrar_fuga_rls_anonima.sql).
--
-- ATENCION: ejecutar esto devuelve a CUALQUIER usuario autenticado el
-- acceso total de lectura y escritura a reservas, trabajadores,
-- facturas, blacklist, llamadas y newsletter. Usar solo si el panel se
-- rompe y hay que volver atras.
--
-- NO revierte la Fase 1. NO borra can_read_section()/can_write_section()
-- (un DROP FUNCTION fallaria si alguna politica quedase viva); las deja
-- creadas y sin uso, que es inocuo.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Retirar las politicas creadas por la Fase 2.
-- ---------------------------------------------------------------------
drop policy if exists "reservas_select_seccion" on public."reservas";
drop policy if exists "reservas_insert_seccion" on public."reservas";
drop policy if exists "reservas_update_seccion" on public."reservas";
drop policy if exists "reservas_delete_seccion" on public."reservas";
drop policy if exists "reservas_service_role" on public."reservas";
drop policy if exists "solicitudes_pendientes_select_seccion" on public."solicitudes_pendientes";
drop policy if exists "solicitudes_pendientes_insert_seccion" on public."solicitudes_pendientes";
drop policy if exists "solicitudes_pendientes_update_seccion" on public."solicitudes_pendientes";
drop policy if exists "solicitudes_pendientes_delete_seccion" on public."solicitudes_pendientes";
drop policy if exists "solicitudes_pendientes_service_role" on public."solicitudes_pendientes";
drop policy if exists "blacklist_select_seccion" on public."blacklist";
drop policy if exists "blacklist_insert_seccion" on public."blacklist";
drop policy if exists "blacklist_update_seccion" on public."blacklist";
drop policy if exists "blacklist_delete_seccion" on public."blacklist";
drop policy if exists "blacklist_service_role" on public."blacklist";
drop policy if exists "notificaciones_dashboard_select_seccion" on public."notificaciones_dashboard";
drop policy if exists "notificaciones_dashboard_insert_seccion" on public."notificaciones_dashboard";
drop policy if exists "notificaciones_dashboard_update_seccion" on public."notificaciones_dashboard";
drop policy if exists "notificaciones_dashboard_delete_seccion" on public."notificaciones_dashboard";
drop policy if exists "notificaciones_dashboard_service_role" on public."notificaciones_dashboard";
drop policy if exists "trabajadores_select_seccion" on public."trabajadores";
drop policy if exists "trabajadores_insert_seccion" on public."trabajadores";
drop policy if exists "trabajadores_update_seccion" on public."trabajadores";
drop policy if exists "trabajadores_delete_seccion" on public."trabajadores";
drop policy if exists "trabajadores_service_role" on public."trabajadores";
drop policy if exists "turnos_select_seccion" on public."turnos";
drop policy if exists "turnos_insert_seccion" on public."turnos";
drop policy if exists "turnos_update_seccion" on public."turnos";
drop policy if exists "turnos_delete_seccion" on public."turnos";
drop policy if exists "turnos_service_role" on public."turnos";
drop policy if exists "registro_horas_select_seccion" on public."registro_horas";
drop policy if exists "registro_horas_insert_seccion" on public."registro_horas";
drop policy if exists "registro_horas_update_seccion" on public."registro_horas";
drop policy if exists "registro_horas_delete_seccion" on public."registro_horas";
drop policy if exists "registro_horas_service_role" on public."registro_horas";
drop policy if exists "areas_trabajo_select_seccion" on public."areas_trabajo";
drop policy if exists "areas_trabajo_insert_seccion" on public."areas_trabajo";
drop policy if exists "areas_trabajo_update_seccion" on public."areas_trabajo";
drop policy if exists "areas_trabajo_delete_seccion" on public."areas_trabajo";
drop policy if exists "areas_trabajo_service_role" on public."areas_trabajo";
drop policy if exists "asignaciones_area_select_seccion" on public."asignaciones_area";
drop policy if exists "asignaciones_area_insert_seccion" on public."asignaciones_area";
drop policy if exists "asignaciones_area_update_seccion" on public."asignaciones_area";
drop policy if exists "asignaciones_area_delete_seccion" on public."asignaciones_area";
drop policy if exists "asignaciones_area_service_role" on public."asignaciones_area";
drop policy if exists "facturas_select_seccion" on public."facturas";
drop policy if exists "facturas_insert_seccion" on public."facturas";
drop policy if exists "facturas_update_seccion" on public."facturas";
drop policy if exists "facturas_delete_seccion" on public."facturas";
drop policy if exists "facturas_service_role" on public."facturas";
drop policy if exists "productos_factura_select_seccion" on public."productos_factura";
drop policy if exists "productos_factura_insert_seccion" on public."productos_factura";
drop policy if exists "productos_factura_update_seccion" on public."productos_factura";
drop policy if exists "productos_factura_delete_seccion" on public."productos_factura";
drop policy if exists "productos_factura_service_role" on public."productos_factura";
drop policy if exists "proveedores_select_seccion" on public."proveedores";
drop policy if exists "proveedores_insert_seccion" on public."proveedores";
drop policy if exists "proveedores_update_seccion" on public."proveedores";
drop policy if exists "proveedores_delete_seccion" on public."proveedores";
drop policy if exists "proveedores_service_role" on public."proveedores";
drop policy if exists "productos_catalogo_select_seccion" on public."productos_catalogo";
drop policy if exists "productos_catalogo_insert_seccion" on public."productos_catalogo";
drop policy if exists "productos_catalogo_update_seccion" on public."productos_catalogo";
drop policy if exists "productos_catalogo_delete_seccion" on public."productos_catalogo";
drop policy if exists "productos_catalogo_service_role" on public."productos_catalogo";
drop policy if exists "documentos_select_seccion" on public."documentos";
drop policy if exists "documentos_insert_seccion" on public."documentos";
drop policy if exists "documentos_update_seccion" on public."documentos";
drop policy if exists "documentos_delete_seccion" on public."documentos";
drop policy if exists "documentos_service_role" on public."documentos";
drop policy if exists "items_documento_select_seccion" on public."items_documento";
drop policy if exists "items_documento_insert_seccion" on public."items_documento";
drop policy if exists "items_documento_update_seccion" on public."items_documento";
drop policy if exists "items_documento_delete_seccion" on public."items_documento";
drop policy if exists "items_documento_service_role" on public."items_documento";
drop policy if exists "historial_precios_select_seccion" on public."historial_precios";
drop policy if exists "historial_precios_insert_seccion" on public."historial_precios";
drop policy if exists "historial_precios_update_seccion" on public."historial_precios";
drop policy if exists "historial_precios_delete_seccion" on public."historial_precios";
drop policy if exists "historial_precios_service_role" on public."historial_precios";
drop policy if exists "conversaciones_select_seccion" on public."conversaciones";
drop policy if exists "conversaciones_insert_seccion" on public."conversaciones";
drop policy if exists "conversaciones_update_seccion" on public."conversaciones";
drop policy if exists "conversaciones_delete_seccion" on public."conversaciones";
drop policy if exists "conversaciones_service_role" on public."conversaciones";
drop policy if exists "mensajes_chat_select_seccion" on public."mensajes_chat";
drop policy if exists "mensajes_chat_insert_seccion" on public."mensajes_chat";
drop policy if exists "mensajes_chat_update_seccion" on public."mensajes_chat";
drop policy if exists "mensajes_chat_delete_seccion" on public."mensajes_chat";
drop policy if exists "mensajes_chat_service_role" on public."mensajes_chat";
drop policy if exists "n8n_chat_histories_select_seccion" on public."n8n_chat_histories";
drop policy if exists "n8n_chat_histories_insert_seccion" on public."n8n_chat_histories";
drop policy if exists "n8n_chat_histories_update_seccion" on public."n8n_chat_histories";
drop policy if exists "n8n_chat_histories_delete_seccion" on public."n8n_chat_histories";
drop policy if exists "n8n_chat_histories_service_role" on public."n8n_chat_histories";
drop policy if exists "call_logs_select_seccion" on public."call_logs";
drop policy if exists "call_logs_insert_seccion" on public."call_logs";
drop policy if exists "call_logs_update_seccion" on public."call_logs";
drop policy if exists "call_logs_delete_seccion" on public."call_logs";
drop policy if exists "call_logs_service_role" on public."call_logs";
drop policy if exists "phone_system_config_select_seccion" on public."phone_system_config";
drop policy if exists "phone_system_config_insert_seccion" on public."phone_system_config";
drop policy if exists "phone_system_config_update_seccion" on public."phone_system_config";
drop policy if exists "phone_system_config_delete_seccion" on public."phone_system_config";
drop policy if exists "phone_system_config_service_role" on public."phone_system_config";
drop policy if exists "newsletter_suscriptores_select_seccion" on public."newsletter_suscriptores";
drop policy if exists "newsletter_suscriptores_insert_seccion" on public."newsletter_suscriptores";
drop policy if exists "newsletter_suscriptores_update_seccion" on public."newsletter_suscriptores";
drop policy if exists "newsletter_suscriptores_delete_seccion" on public."newsletter_suscriptores";
drop policy if exists "newsletter_suscriptores_service_role" on public."newsletter_suscriptores";
drop policy if exists "newsletter_envios_select_seccion" on public."newsletter_envios";
drop policy if exists "newsletter_envios_insert_seccion" on public."newsletter_envios";
drop policy if exists "newsletter_envios_update_seccion" on public."newsletter_envios";
drop policy if exists "newsletter_envios_delete_seccion" on public."newsletter_envios";
drop policy if exists "newsletter_envios_service_role" on public."newsletter_envios";
drop policy if exists "campanas_marketing_select_seccion" on public."campanas_marketing";
drop policy if exists "campanas_marketing_insert_seccion" on public."campanas_marketing";
drop policy if exists "campanas_marketing_update_seccion" on public."campanas_marketing";
drop policy if exists "campanas_marketing_delete_seccion" on public."campanas_marketing";
drop policy if exists "campanas_marketing_service_role" on public."campanas_marketing";
drop policy if exists "email_eventos_select_seccion" on public."email_eventos";
drop policy if exists "email_eventos_insert_seccion" on public."email_eventos";
drop policy if exists "email_eventos_update_seccion" on public."email_eventos";
drop policy if exists "email_eventos_delete_seccion" on public."email_eventos";
drop policy if exists "email_eventos_service_role" on public."email_eventos";
drop policy if exists "historial_ajustes_precios_select_seccion" on public."historial_ajustes_precios";
drop policy if exists "historial_ajustes_precios_insert_seccion" on public."historial_ajustes_precios";
drop policy if exists "historial_ajustes_precios_update_seccion" on public."historial_ajustes_precios";
drop policy if exists "historial_ajustes_precios_delete_seccion" on public."historial_ajustes_precios";
drop policy if exists "historial_ajustes_precios_service_role" on public."historial_ajustes_precios";
drop policy if exists "reservas_insert_anon_formulario_web" on public."reservas";

-- ---------------------------------------------------------------------
-- 2) Recrear, una a una, las politicas que habia antes de la Fase 2
--    (copiadas literalmente del snapshot de pg_policies tomado antes
--    de aplicar nada: SNAPSHOT_policies_ANTES.json).
-- ---------------------------------------------------------------------

-- reservas (5 politicas)
create policy "Only authenticated can read reservas" on public."reservas"
  as permissive for select to authenticated
  using (true);
create policy "Público puede crear reservas" on public."reservas"
  as permissive for insert to public
  with check (true);
create policy "Solo usuarios autenticados pueden actualizar reservas" on public."reservas"
  as permissive for update to authenticated,service_role
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden eliminar reservas" on public."reservas"
  as permissive for delete to authenticated
  using ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver reservas" on public."reservas"
  as permissive for select to authenticated
  using ((auth.uid() IS NOT NULL));

-- solicitudes_pendientes (5 politicas)
create policy "Authenticated users can insert solicitudes" on public."solicitudes_pendientes"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can update solicitudes" on public."solicitudes_pendientes"
  as permissive for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can view solicitudes" on public."solicitudes_pendientes"
  as permissive for select to authenticated
  using (true);
create policy "Service role can insert solicitudes" on public."solicitudes_pendientes"
  as permissive for insert to service_role
  with check (true);
create policy "Service role can select solicitudes" on public."solicitudes_pendientes"
  as permissive for select to service_role
  using (true);

-- blacklist (5 politicas)
create policy "Authenticated users can delete blacklist" on public."blacklist"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert blacklist" on public."blacklist"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can update blacklist" on public."blacklist"
  as permissive for update to authenticated
  using (true);
create policy "Authenticated users can view blacklist" on public."blacklist"
  as permissive for select to authenticated
  using (true);
create policy "Only authenticated can read blacklist" on public."blacklist"
  as permissive for select to authenticated
  using (true);

-- notificaciones_dashboard (5 politicas)
create policy "Authenticated users can insert notificaciones" on public."notificaciones_dashboard"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can update notificaciones" on public."notificaciones_dashboard"
  as permissive for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can view notificaciones" on public."notificaciones_dashboard"
  as permissive for select to authenticated
  using (true);
create policy "Service role can insert notificaciones" on public."notificaciones_dashboard"
  as permissive for insert to service_role
  with check (true);
create policy "Service role can select notificaciones" on public."notificaciones_dashboard"
  as permissive for select to service_role
  using (true);

-- trabajadores (4 politicas)
create policy "Solo usuarios autenticados pueden actualizar trabajadores" on public."trabajadores"
  as permissive for update to authenticated
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden crear trabajadores" on public."trabajadores"
  as permissive for insert to authenticated
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden eliminar trabajadores" on public."trabajadores"
  as permissive for delete to authenticated
  using ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver trabajadores" on public."trabajadores"
  as permissive for select to authenticated
  using ((auth.uid() IS NOT NULL));

-- turnos (4 politicas)
create policy "Solo usuarios autenticados pueden actualizar turnos" on public."turnos"
  as permissive for update to authenticated
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden crear turnos" on public."turnos"
  as permissive for insert to authenticated
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden eliminar turnos" on public."turnos"
  as permissive for delete to authenticated
  using ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver turnos" on public."turnos"
  as permissive for select to authenticated
  using ((auth.uid() IS NOT NULL));

-- registro_horas (4 politicas)
create policy "Auth can manage registro_horas" on public."registro_horas"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Solo usuarios autenticados pueden actualizar registros" on public."registro_horas"
  as permissive for update to authenticated
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden crear registros" on public."registro_horas"
  as permissive for insert to authenticated
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver registro de horas" on public."registro_horas"
  as permissive for select to authenticated
  using ((auth.uid() IS NOT NULL));

-- areas_trabajo (8 politicas)
create policy "Authenticated users can delete areas_trabajo" on public."areas_trabajo"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert areas_trabajo" on public."areas_trabajo"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read areas_trabajo" on public."areas_trabajo"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update areas_trabajo" on public."areas_trabajo"
  as permissive for update to authenticated
  using (true)
  with check (true);
create policy "Solo usuarios autenticados pueden actualizar áreas de trabajo" on public."areas_trabajo"
  as permissive for update to public
  using ((auth.uid() IS NOT NULL))
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden crear áreas de trabajo" on public."areas_trabajo"
  as permissive for insert to public
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden eliminar áreas de trabajo" on public."areas_trabajo"
  as permissive for delete to public
  using ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver áreas de trabajo" on public."areas_trabajo"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- asignaciones_area (4 politicas)
create policy "Auth can manage asignaciones_area" on public."asignaciones_area"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Solo usuarios autenticados pueden crear asignaciones de área" on public."asignaciones_area"
  as permissive for insert to public
  with check ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden eliminar asignaciones de áre" on public."asignaciones_area"
  as permissive for delete to public
  using ((auth.uid() IS NOT NULL));
create policy "Solo usuarios autenticados pueden ver asignaciones de área" on public."asignaciones_area"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- facturas (5 politicas)
create policy "Authenticated users can delete facturas" on public."facturas"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert facturas" on public."facturas"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read facturas" on public."facturas"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update facturas" on public."facturas"
  as permissive for update to authenticated
  using (true)
  with check (true);
create policy "Permitir inserción facturas" on public."facturas"
  as permissive for insert to public
  with check (((auth.role() = 'service_role'::text) OR (auth.role() = 'authenticated'::text)));

-- productos_factura (5 politicas)
create policy "Authenticated users can delete productos_factura" on public."productos_factura"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert productos_factura" on public."productos_factura"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read productos_factura" on public."productos_factura"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update productos_factura" on public."productos_factura"
  as permissive for update to authenticated
  using (true)
  with check (true);
create policy "Permitir inserción productos" on public."productos_factura"
  as permissive for insert to public
  with check (((auth.role() = 'service_role'::text) OR (auth.role() = 'authenticated'::text)));

-- proveedores (4 politicas)
create policy "Authenticated users can delete proveedores" on public."proveedores"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert proveedores" on public."proveedores"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read proveedores" on public."proveedores"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update proveedores" on public."proveedores"
  as permissive for update to authenticated
  using (true)
  with check (true);

-- productos_catalogo (1 politicas)
create policy "Auth can manage productos_catalogo" on public."productos_catalogo"
  as permissive for all to authenticated
  using (true)
  with check (true);

-- documentos (4 politicas)
create policy "Authenticated users can delete documentos" on public."documentos"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert documentos" on public."documentos"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read documentos" on public."documentos"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update documentos" on public."documentos"
  as permissive for update to authenticated
  using (true)
  with check (true);

-- items_documento (4 politicas)
create policy "Authenticated users can delete items_documento" on public."items_documento"
  as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert items_documento" on public."items_documento"
  as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read items_documento" on public."items_documento"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update items_documento" on public."items_documento"
  as permissive for update to authenticated
  using (true)
  with check (true);

-- historial_precios (2 politicas)
create policy "Permitir inserción a autenticados" on public."historial_precios"
  as permissive for insert to authenticated
  with check (true);
create policy "Permitir select a autenticados" on public."historial_precios"
  as permissive for select to authenticated
  using (true);

-- conversaciones (1 politicas)
create policy "conversaciones_auth_only" on public."conversaciones"
  as permissive for all to authenticated
  using (true)
  with check (true);

-- mensajes_chat (1 politicas)
create policy "mensajes_chat_auth_only" on public."mensajes_chat"
  as permissive for all to authenticated
  using (true)
  with check (true);

-- n8n_chat_histories (1 politicas)
create policy "n8n_chat_auth_only" on public."n8n_chat_histories"
  as permissive for all to authenticated
  using (true)
  with check (true);

-- call_logs (2 politicas)
create policy "Auth can view call_logs" on public."call_logs"
  as permissive for select to authenticated
  using (true);
create policy "Authenticated can read call_logs" on public."call_logs"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- phone_system_config (2 politicas)
create policy "Auth can manage phone_system_config" on public."phone_system_config"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Only authenticated can read phone config" on public."phone_system_config"
  as permissive for select to authenticated
  using (true);

-- newsletter_suscriptores (3 politicas)
create policy "Usuarios autenticados pueden actualizar suscriptores" on public."newsletter_suscriptores"
  as permissive for update to authenticated
  using (true);
create policy "Usuarios autenticados pueden insertar suscriptores" on public."newsletter_suscriptores"
  as permissive for insert to authenticated
  with check (true);
create policy "Usuarios autenticados pueden ver suscriptores" on public."newsletter_suscriptores"
  as permissive for select to authenticated
  using (true);

-- newsletter_envios (3 politicas)
create policy "Auth can manage newsletter_envios" on public."newsletter_envios"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden insertar envíos" on public."newsletter_envios"
  as permissive for insert to authenticated
  with check (true);
create policy "Usuarios autenticados pueden ver historial de envíos" on public."newsletter_envios"
  as permissive for select to authenticated
  using (true);

-- campanas_marketing (5 politicas)
create policy "Auth can manage campanas_marketing" on public."campanas_marketing"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden actualizar campañas" on public."campanas_marketing"
  as permissive for update to public
  using ((auth.uid() IS NOT NULL));
create policy "Usuarios autenticados pueden crear campañas" on public."campanas_marketing"
  as permissive for insert to public
  with check ((auth.uid() IS NOT NULL));
create policy "Usuarios autenticados pueden eliminar campañas" on public."campanas_marketing"
  as permissive for delete to public
  using ((auth.uid() IS NOT NULL));
create policy "Usuarios autenticados pueden ver campañas" on public."campanas_marketing"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- email_eventos (2 politicas)
create policy "Auth can manage email_eventos" on public."email_eventos"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden ver eventos de email" on public."email_eventos"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- historial_ajustes_precios (4 politicas)
create policy "Auth can manage historial_ajustes_precios" on public."historial_ajustes_precios"
  as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Usuarios autenticados pueden crear entradas en historial" on public."historial_ajustes_precios"
  as permissive for insert to public
  with check ((auth.uid() IS NOT NULL));
create policy "Usuarios autenticados pueden eliminar historial" on public."historial_ajustes_precios"
  as permissive for delete to public
  using ((auth.uid() IS NOT NULL));
create policy "Usuarios autenticados pueden ver historial" on public."historial_ajustes_precios"
  as permissive for select to public
  using ((auth.uid() IS NOT NULL));

-- ---------------------------------------------------------------------
-- 3) Devolver el SELECT de `anon` retirado por el bloque final.
-- ---------------------------------------------------------------------
grant select on public."areas_trabajo"             to anon;
grant select on public."asignaciones_area"         to anon;
grant select on public."campanas_marketing"        to anon;
grant select on public."conversaciones"            to anon;
grant select on public."documentos"                to anon;
grant select on public."historial_ajustes_precios" to anon;
grant select on public."historial_precios"         to anon;
grant select on public."items_documento"           to anon;
grant select on public."mensajes_chat"             to anon;
grant select on public."n8n_chat_histories"        to anon;
grant select on public."newsletter_envios"         to anon;
grant select on public."newsletter_suscriptores"   to anon;
grant select on public."registro_horas"            to anon;
grant select on public."turnos"                    to anon;

commit;
