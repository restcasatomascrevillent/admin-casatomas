-- =====================================================================
-- Cerrar fuga de datos personales accesible con la anon key (publica)
-- Proyecto Supabase: jeamoczmbfsnwkfjxcyo
-- Generada: 2026-09-18T08:49:09
--
-- CONTEXTO
--   La anon key viaja en el bundle de las webs publicas, asi que
--   cualquiera puede emitir consultas con el rol `anon`. Se detecto:
--     1) 13 de 17 vistas sin `security_invoker` -> se ejecutan con los
--        permisos de su creador (postgres) y anulan la RLS de las
--        tablas base. `vista_reservas_pendientes` devolvia 20 filas con
--        nombre, telefono y email de clientes a un usuario anonimo.
--     2) Politicas SELECT con USING (true) alcanzables por anon en
--        facturas, blacklist, call_logs, proveedores, productos_factura,
--        productos_catalogo, phone_system_config, configuracion_reservas,
--        ocupacion_diaria, BebidasVENTA y ComidaVENTA.
--     3) `menus_diarios` y `tapas` sin RLS y con GRANT ALL a anon ->
--        lectura Y ESCRITURA anonima.
--
-- SE CONSERVA (verificado leyendo el codigo de las webs publicas):
--   casa-tomas-story lee sin sesion: Platos, Vinos, Bebidas,
--     menus_diarios, tapas, novedades, resenas y configBotWeb
--     (esta ultima via REST directa en AIChatbot.tsx).
--   touza-restaurant-website lee sin sesion: Platos, Vinos, Bebidas,
--     Cocteles; e INSERTA en `reservas` desde el formulario.
--   Ninguna de las dos webs consulta NINGUNA vista -> activar
--   security_invoker no puede dejarlas sin datos.
--   El webhook telefonico y las Edge Functions usan SERVICE_ROLE_KEY,
--   que salta la RLS: no les afecta nada de esta migracion.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- BLOQUE 1 -- security_invoker en las 13 vistas que no lo tenian.
-- Con security_invoker=on la vista se ejecuta con los permisos de quien
-- consulta, de modo que la RLS de las tablas base vuelve a aplicarse.
-- Las otras 4 vistas ya lo tenian y no se tocan.
-- ---------------------------------------------------------------------
alter view public."chat_facturas_conversaciones" set (security_invoker = on);
alter view public."chat_facturas_mensajes" set (security_invoker = on);
alter view public."vista_calidad_audio" set (security_invoker = on);
alter view public."vista_estadisticas_mensuales" set (security_invoker = on);
alter view public."vista_estadisticas_semanales" set (security_invoker = on);
alter view public."vista_gastos_mensuales" set (security_invoker = on);
alter view public."vista_gastos_proveedor_mes" set (security_invoker = on);
alter view public."vista_ocupacion" set (security_invoker = on);
alter view public."vista_ocupacion_hoy" set (security_invoker = on);
alter view public."vista_productos_top" set (security_invoker = on);
alter view public."vista_proveedores_resumen" set (security_invoker = on);
alter view public."vista_reservas_pendientes" set (security_invoker = on);
alter view public."vista_ultimos_documentos" set (security_invoker = on);

-- ---------------------------------------------------------------------
-- BLOQUE 2 -- Retirar la lectura anonima de tablas con datos personales
-- o internos. En PostgreSQL el rol `public` incluye a `anon`, asi que
-- una politica sobre `public` con USING (true) es lectura anonima.
-- Cada una de estas tablas conserva su politica equivalente para
-- `authenticated`, por lo que el panel de admin no se ve afectado.
-- ---------------------------------------------------------------------

-- BebidasVENTA: expone precio_coste; solo la usa el panel de admin
drop policy if exists "Productos activados públicos" on public."BebidasVENTA";

-- ComidaVENTA: expone precio_coste; solo la usa el panel de admin
drop policy if exists "Productos activados públicos" on public."ComidaVENTA";

-- blacklist: telefonos de clientes vetados (dato personal)
drop policy if exists "Service can read blacklist" on public."blacklist";

-- call_logs: registros de llamadas con telefono y transcripcion (dato personal)
drop policy if exists "Allow read call_logs" on public."call_logs";

-- configuracion_reservas: parametros internos de reservas; ninguna web los consulta
drop policy if exists "Public can read configuracion_reservas" on public."configuracion_reservas";

-- email_eventos: INSERT anonimo: permitia falsificar eventos de email. service_role salta la RLS, no necesita esta politica
drop policy if exists "Service role puede insertar eventos" on public."email_eventos";

-- facturas: facturas de proveedores (dato economico interno)
drop policy if exists "Permitir lectura facturas" on public."facturas";

-- ocupacion_diaria: metricas de ocupacion del negocio; ninguna web las consulta
drop policy if exists "Público puede ver ocupación" on public."ocupacion_diaria";

-- phone_system_config: ids de VAPI, webhook_url y telefono de desvio (infraestructura)
drop policy if exists "Allow public read" on public."phone_system_config";

-- productos_catalogo: catalogo de compras con precio_actual (coste interno)
drop policy if exists "Permitir lectura catalogo" on public."productos_catalogo";

-- productos_factura: lineas de factura (dato economico interno)
drop policy if exists "Permitir lectura productos" on public."productos_factura";

-- proveedores: CIF, direccion, telefono y email de proveedores (dato personal)
drop policy if exists "Permitir lectura proveedores" on public."proveedores";

-- ---------------------------------------------------------------------
-- BLOQUE 3 -- menus_diarios y tapas: activar RLS conservando la lectura
-- publica (casa-tomas-story las muestra sin sesion) y cortando la
-- escritura anonima. Columnas: (id, fecha, menu|tapas, idiom) -> no
-- contienen ningun dato personal, por eso la lectura puede ser publica.
-- ---------------------------------------------------------------------

alter table public."menus_diarios" enable row level security;

-- Lectura publica: la necesita casa-tomas-story (EspaciosSection.tsx).
create policy "Lectura publica de menus_diarios" on public."menus_diarios"
  for select to anon, authenticated using (true);

-- Gestion solo para usuarios autenticados del panel.
create policy "Authenticated gestiona menus_diarios" on public."menus_diarios"
  for all to authenticated using (true) with check (true);

-- Sin escritura anonima: se retiran los GRANT de escritura heredados.
revoke insert, update, delete, truncate on public."menus_diarios" from anon;

alter table public."tapas" enable row level security;

-- Lectura publica: la necesita casa-tomas-story (EspaciosSection.tsx).
create policy "Lectura publica de tapas" on public."tapas"
  for select to anon, authenticated using (true);

-- Gestion solo para usuarios autenticados del panel.
create policy "Authenticated gestiona tapas" on public."tapas"
  for all to authenticated using (true) with check (true);

-- Sin escritura anonima: se retiran los GRANT de escritura heredados.
revoke insert, update, delete, truncate on public."tapas" from anon;

-- ---------------------------------------------------------------------
-- BLOQUE 4 -- Defensa en profundidad sobre las VISTAS.
-- Las vistas no tienen RLS propia; con el BLOQUE 1 ya devuelven 0 filas
-- a anon, pero ademas se le retira el privilegio para que el acceso
-- falle de raiz. Ninguna web publica consulta vistas (verificado por
-- grep de .from()/.rpc() en los dos repos), y `authenticated` conserva
-- intactos sus privilegios, que es lo que usa el panel de admin.
-- ---------------------------------------------------------------------
revoke all on public."chat_facturas_conversaciones" from anon;
revoke all on public."chat_facturas_mensajes" from anon;
revoke all on public."vista_calidad_audio" from anon;
revoke all on public."vista_estadisticas_mensuales" from anon;
revoke all on public."vista_estadisticas_semanales" from anon;
revoke all on public."vista_gastos_mensuales" from anon;
revoke all on public."vista_gastos_proveedor_mes" from anon;
revoke all on public."vista_ocupacion" from anon;
revoke all on public."vista_ocupacion_hoy" from anon;
revoke all on public."vista_productos_top" from anon;
revoke all on public."vista_productos_vendidos" from anon;
revoke all on public."vista_proveedores_resumen" from anon;
revoke all on public."vista_reservas_pendientes" from anon;
revoke all on public."vista_stock_consolidado" from anon;
revoke all on public."vista_turnos_con_areas" from anon;
revoke all on public."vista_ultimos_documentos" from anon;
revoke all on public."vista_ventas_diarias" from anon;

-- ---------------------------------------------------------------------
-- BLOQUE 5 -- Retirar el SELECT de anon en las tablas internas.
-- Supabase concede por defecto ALL a anon sobre todo el esquema public,
-- de modo que la RLS es la unica barrera. Aqui se quita tambien el
-- privilegio en las tablas sin ningun consumidor anonimo, para que una
-- politica mal escrita en el futuro no vuelva a abrir la fuga.
-- ---------------------------------------------------------------------
revoke select on public."BebidasVENTA" from anon;
revoke select on public."ComidaVENTA" from anon;
revoke select on public."blacklist" from anon;
revoke select on public."call_logs" from anon;
revoke select on public."configuracion_reservas" from anon;
revoke select on public."email_eventos" from anon;
revoke select on public."facturas" from anon;
revoke select on public."notificaciones_dashboard" from anon;
revoke select on public."ocupacion_diaria" from anon;
revoke select on public."phone_system_config" from anon;
revoke select on public."productos_catalogo" from anon;
revoke select on public."productos_factura" from anon;
revoke select on public."proveedores" from anon;
revoke select on public."solicitudes_pendientes" from anon;
revoke select on public."trabajadores" from anon;

-- ---------------------------------------------------------------------
-- BLOQUE 6 -- Sin escritura anonima en todo el esquema public.
-- Se revoca la escritura en bloque y se devuelve unicamente donde hay
-- un consumidor anonimo legitimo respaldado por una politica RLS:
--   - reservas         : formulario de touza-restaurant-website
--                        (Reservado.tsx, insert sin .select()).
--   - visitas_producto : politica "Cualquiera puede registrar visitas".
-- El SELECT no se toca aqui, asi que la carta publica sigue leyendose.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon;

grant insert on public."reservas" to anon;
grant insert on public."visitas_producto" to anon;

-- ---------------------------------------------------------------------
-- BLOQUE 7 -- Funciones SECURITY DEFINER invocables por `anon`.
--
-- Una funcion SECURITY DEFINER se ejecuta con los permisos de su dueno
-- (`postgres`), de modo que IGNORA la RLS. Todas estas tenian EXECUTE
-- para PUBLIC y para anon, asi que cualquiera con la anon key podia
-- invocarlas por /rest/v1/rpc/<nombre> y esquivar todo lo anterior.
-- Comprobado en produccion antes del arreglo: una llamada anonima a
-- ejecutar_consulta_chatbot devolvia current_user=postgres y
-- count(*) de reservas = 110.
--
-- Se retira EXECUTE a PUBLIC y a anon, y se mantiene explicitamente
-- para `authenticated` y `service_role`, que son los que usan el panel
-- de admin, el webhook telefonico y las Edge Functions.
--
-- NOTA: NO se tocan is_admin(), get_user_role() ni
-- has_section_permission(): las invocan las propias politicas RLS y
-- quitarles permisos podria romper la evaluacion de las politicas.
-- ---------------------------------------------------------------------

-- ejecutar_consulta_chatbot: CRITICO: ejecuta SQL arbitrario como `postgres`. El filtro solo
--     mira que la primera palabra sea SELECT, asi que
--     `select nombre, telefono, email from reservas` lo atraviesa y
--     devuelve los 110 clientes saltandose por completo la RLS.
revoke all on function public.ejecutar_consulta_chatbot(query_sql text) from public, anon;
grant execute on function public.ejecutar_consulta_chatbot(query_sql text) to authenticated, service_role;

-- buscar_contexto_chatbot: devuelve filas completas de `facturas` (proveedor, CIF, importes).
revoke all on function public.buscar_contexto_chatbot(embedding_query vector) from public, anon;
grant execute on function public.buscar_contexto_chatbot(embedding_query vector) to authenticated, service_role;

-- verificar_duplicado_factura: devuelve la fila completa de la factura encontrada (row_to_json).
revoke all on function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric) from public, anon;
grant execute on function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric) to authenticated, service_role;

-- ejecutar_limpieza_gdpr: DESTRUCTIVA: hace UPDATE masivo sobre `reservas` anonimizando
--     clientes segun gdpr_config.
revoke all on function public.ejecutar_limpieza_gdpr() from public, anon;
grant execute on function public.ejecutar_limpieza_gdpr() to authenticated, service_role;

-- cleanup_old_security_logs: DESTRUCTIVA: hace DELETE sobre security_log y rate_limit_log
--     (permitiria borrar el rastro de auditoria).
revoke all on function public.cleanup_old_security_logs() from public, anon;
grant execute on function public.cleanup_old_security_logs() to authenticated, service_role;

-- withdraw_stock_inventory: DESTRUCTIVA: descuenta stock e inserta movimientos.
revoke all on function public.withdraw_stock_inventory(p_product_id uuid, p_quantity integer) from public, anon;
grant execute on function public.withdraw_stock_inventory(p_product_id uuid, p_quantity integer) to authenticated, service_role;

-- recalcular_ocupacion_historica: DESTRUCTIVA: reescribe ocupacion_diaria y permite abuso de CPU.
revoke all on function public.recalcular_ocupacion_historica(fecha_desde date, fecha_hasta date) from public, anon;
grant execute on function public.recalcular_ocupacion_historica(fecha_desde date, fecha_hasta date) to authenticated, service_role;

-- append_tool_call_log: permite escribir en los logs de llamadas.
revoke all on function public.append_tool_call_log(p_call_id text, p_new_tools jsonb) from public, anon;
grant execute on function public.append_tool_call_log(p_call_id text, p_new_tools jsonb) to authenticated, service_role;

commit;
