-- =====================================================================
-- ROLLBACK de 20260918084909_cerrar_fuga_rls_anonima.sql
-- Restaura el estado EXACTO anterior a la migracion.
-- ATENCION: ejecutar esto REABRE la fuga de datos personales descrita
-- en la migracion. Usar solo si algo se rompio y hay que volver atras.
-- =====================================================================

begin;

-- BLOQUE 7 inverso -- devolver EXECUTE a PUBLIC y anon en las
-- funciones SECURITY DEFINER (REABRE el bypass total de la RLS).
grant execute on function public.ejecutar_consulta_chatbot(query_sql text) to public, anon;
grant execute on function public.buscar_contexto_chatbot(embedding_query vector) to public, anon;
grant execute on function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric) to public, anon;
grant execute on function public.ejecutar_limpieza_gdpr() to public, anon;
grant execute on function public.cleanup_old_security_logs() to public, anon;
grant execute on function public.withdraw_stock_inventory(p_product_id uuid, p_quantity integer) to public, anon;
grant execute on function public.recalcular_ocupacion_historica(fecha_desde date, fecha_hasta date) to public, anon;
grant execute on function public.append_tool_call_log(p_call_id text, p_new_tools jsonb) to public, anon;

-- BLOQUE 6 inverso -- devolver la escritura en bloque a anon.
grant insert, update, delete, truncate on all tables in schema public to anon;

-- BLOQUE 5 inverso -- devolver el SELECT de anon en tablas internas.
grant select on public."BebidasVENTA" to anon;
grant select on public."ComidaVENTA" to anon;
grant select on public."blacklist" to anon;
grant select on public."call_logs" to anon;
grant select on public."configuracion_reservas" to anon;
grant select on public."email_eventos" to anon;
grant select on public."facturas" to anon;
grant select on public."notificaciones_dashboard" to anon;
grant select on public."ocupacion_diaria" to anon;
grant select on public."phone_system_config" to anon;
grant select on public."productos_catalogo" to anon;
grant select on public."productos_factura" to anon;
grant select on public."proveedores" to anon;
grant select on public."solicitudes_pendientes" to anon;
grant select on public."trabajadores" to anon;

-- BLOQUE 4 inverso -- devolver los privilegios de anon sobre las vistas.
grant all on public."chat_facturas_conversaciones" to anon;
grant all on public."chat_facturas_mensajes" to anon;
grant all on public."vista_calidad_audio" to anon;
grant all on public."vista_estadisticas_mensuales" to anon;
grant all on public."vista_estadisticas_semanales" to anon;
grant all on public."vista_gastos_mensuales" to anon;
grant all on public."vista_gastos_proveedor_mes" to anon;
grant all on public."vista_ocupacion" to anon;
grant all on public."vista_ocupacion_hoy" to anon;
grant all on public."vista_productos_top" to anon;
grant all on public."vista_productos_vendidos" to anon;
grant all on public."vista_proveedores_resumen" to anon;
grant all on public."vista_reservas_pendientes" to anon;
grant all on public."vista_stock_consolidado" to anon;
grant all on public."vista_turnos_con_areas" to anon;
grant all on public."vista_ultimos_documentos" to anon;
grant all on public."vista_ventas_diarias" to anon;

-- BLOQUE 3 inverso -- menus_diarios y tapas vuelven a quedar sin RLS.
drop policy if exists "Lectura publica de menus_diarios" on public."menus_diarios";
drop policy if exists "Authenticated gestiona menus_diarios" on public."menus_diarios";
alter table public."menus_diarios" disable row level security;
grant insert, update, delete, truncate on public."menus_diarios" to anon;
drop policy if exists "Lectura publica de tapas" on public."tapas";
drop policy if exists "Authenticated gestiona tapas" on public."tapas";
alter table public."tapas" disable row level security;
grant insert, update, delete, truncate on public."tapas" to anon;

-- BLOQUE 2 inverso -- recrear las politicas anonimas eliminadas.
create policy "Productos activados públicos" on public."BebidasVENTA"
  for select to public using ((activado = true));
create policy "Productos activados públicos" on public."ComidaVENTA"
  for select to public using ((activado = true));
create policy "Service can read blacklist" on public."blacklist"
  for select to anon using (true);
create policy "Allow read call_logs" on public."call_logs"
  for select to public using (true);
create policy "Public can read configuracion_reservas" on public."configuracion_reservas"
  for select to public using (true);
create policy "Service role puede insertar eventos" on public."email_eventos"
  for insert to public with check (true);
create policy "Permitir lectura facturas" on public."facturas"
  for select to public using (true);
create policy "Público puede ver ocupación" on public."ocupacion_diaria"
  for select to public using (true);
create policy "Allow public read" on public."phone_system_config"
  for select to public using (true);
create policy "Permitir lectura catalogo" on public."productos_catalogo"
  for select to public using (true);
create policy "Permitir lectura productos" on public."productos_factura"
  for select to public using (true);
create policy "Permitir lectura proveedores" on public."proveedores"
  for select to public using (true);

-- BLOQUE 1 inverso -- quitar security_invoker de las 13 vistas.
alter view public."chat_facturas_conversaciones" reset (security_invoker);
alter view public."chat_facturas_mensajes" reset (security_invoker);
alter view public."vista_calidad_audio" reset (security_invoker);
alter view public."vista_estadisticas_mensuales" reset (security_invoker);
alter view public."vista_estadisticas_semanales" reset (security_invoker);
alter view public."vista_gastos_mensuales" reset (security_invoker);
alter view public."vista_gastos_proveedor_mes" reset (security_invoker);
alter view public."vista_ocupacion" reset (security_invoker);
alter view public."vista_ocupacion_hoy" reset (security_invoker);
alter view public."vista_productos_top" reset (security_invoker);
alter view public."vista_proveedores_resumen" reset (security_invoker);
alter view public."vista_reservas_pendientes" reset (security_invoker);
alter view public."vista_ultimos_documentos" reset (security_invoker);

commit;
