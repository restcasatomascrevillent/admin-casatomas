-- =====================================================================
-- FASE 2 -- RLS atada a los permisos de seccion del panel
-- Proyecto Supabase: jeamoczmbfsnwkfjxcyo
-- Generada: 2026-09-18
--
-- PROBLEMA QUE RESUELVE
--   Antes de esta migracion, has_section_permission() existia y tenia
--   CERO usos en las 297 politicas del esquema public. Las tablas de
--   negocio se protegian con `TO authenticated USING (true)` o
--   `USING (auth.uid() IS NOT NULL)`, de modo que CUALQUIER usuario
--   autenticado -- incluido uno cuyo `sub` no existe en auth.users --
--   leia y escribia todo. Medido en produccion antes del cambio, con
--   `set local role authenticated` y sub 000...0ff (inexistente):
--     reservas 110, trabajadores 10, facturas 5, proveedores 1,
--     blacklist 1, n8n_chat_histories 438, turnos 727,
--     asignaciones_area 1396, historial_precios 26, email_eventos 17.
--   Exactamente lo mismo que ve un admin. Los permisos por seccion del
--   panel eran cosmeticos: solo decidian que se pinta en el sidebar.
--
-- QUE HACE
--   Reescribe las politicas de las 26 tablas con datos personales o de
--   negocio para que pasen por el permiso de seccion del panel:
--     SELECT                -> public.can_read_section('<seccion>')
--     INSERT/UPDATE/DELETE  -> public.can_write_section('<seccion>')
--   Ambas delegan en has_section_permission(), que ya devuelve true
--   cuando is_admin(): los 2 usuarios `admin` conservan acceso total.
--
-- QUE NO TOCA (verificado leyendo el codigo de las webs publicas)
--   - La carta y el contenido publico: Platos, Vinos, Cocteles,
--     Bebidas, menus_diarios, tapas, novedades, resenas y configBotWeb.
--     casa-tomas-story y touza los leen como `anon` sin sesion, y el
--     chatbot lee configBotWeb por REST directa (AIChatbot.tsx).
--   - El INSERT anonimo de `reservas` (formulario de Touza,
--     Reservado.tsx:54, insert sin .select()): se conserva, acotado
--     explicitamente al rol `anon`.
--   - La Fase 1 (20260918084909_cerrar_fuga_rls_anonima.sql): esta
--     migracion solo anade restricciones, no reabre nada de aquello.
--
-- SERVICE_ROLE
--   Verificado: `select rolbypassrls from pg_roles where
--   rolname='service_role'` -> true. El webhook telefonico
--   (restaurante-phone/api/vapi-webhook.js) y las Edge Functions
--   saltan la RLS por completo y NO se ven afectados. Aun asi cada
--   tabla recibe una politica explicita `TO service_role`, para que el
--   dia que alguien le quite BYPASSRLS nada se rompa en silencio.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- BLOQUE 1 -- Las dos funciones de permiso que usaran las politicas.
--
-- Son envoltorios de has_section_permission() sin el parametro
-- _user_id, para que las politicas queden legibles y, sobre todo, para
-- tener UN UNICO punto donde cambiar la semantica de escritura.
--
-- Son STABLE y reciben un literal constante, asi que PostgreSQL las
-- evalua una vez por consulta (InitPlan), no una vez por fila.
-- `(select auth.uid())` fuerza ese mismo cacheo del uid.
-- ---------------------------------------------------------------------

-- Lectura: admin siempre; el resto necesita can_view en la seccion.
create or replace function public.can_read_section(_section text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_section_permission((select auth.uid()), _section, 'view')
$$;

comment on function public.can_read_section(text) is
  'RLS: true si el usuario actual puede VER esa seccion del panel. Admin siempre true.';

-- ---------------------------------------------------------------------
-- DECISION SOBRE can_edit  (punto 4 del encargo)
--
-- La escritura se ata a TENER LA SECCION (can_view), no a can_edit.
--
-- Motivo, medido en la BD de produccion:
--   - Las 26 filas de user_permissions reparten 13 secciones entre 2
--     usuarios, y TODAS tienen can_edit = false.
--   - El panel escribe `can_edit: false` A PELO en 16 sitios de 5
--     ficheros, asi que hoy es IMPOSIBLE conceder can_edit desde la UI:
--       src/hooks/useUserRolePresets.ts:26,45  (`normalizePermissions`)
--       src/hooks/useUsersManagement.ts:211,240,311
--       src/components/usuarios/ListaUsuarios.tsx:83,101,174
--       src/components/usuarios/InvitarUsuario.tsx:35,56,73
--       src/components/usuarios/ConfigurarRolesModal.tsx:46,109
--     Ademas `useCanAccessSection(section,'edit')` solo aparece en su
--     propia definicion y en los tests: ningun componente lo invoca.
--   - El unico usuario no-admin (`staff`, a14cbb89-...) tiene
--     can_view=true y can_edit=false en las 13 secciones.
--   => Atar la escritura a can_edit lo dejaria sin poder guardar NADA
--      en el instante de aplicar la migracion. Eso es una caida de
--      servicio, no una mejora de seguridad.
--
-- Por eso la separacion lectura/escritura se implementa de forma
-- ESTRUCTURAL (politicas separadas + funcion separada) aunque hoy las
-- dos funciones evaluen lo mismo. Cuando la UI deje de forzar
-- can_edit:false y los admin puedan concederlo de verdad, basta con
-- ejecutar el CREATE OR REPLACE que hay al final de este fichero: una
-- sola sentencia cambia a la vez el comportamiento de TODAS las
-- politicas de escritura de la base de datos.
-- ---------------------------------------------------------------------
create or replace function public.can_write_section(_section text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- 'view' A PROPOSITO. Ver el bloque de comentario de arriba.
  -- Para exigir can_edit: cambiar 'view' por 'edit' aqui, y nada mas.
  select public.has_section_permission((select auth.uid()), _section, 'view')
$$;

comment on function public.can_write_section(text) is
  'RLS: true si el usuario actual puede ESCRIBIR en esa seccion. Hoy exige can_view porque el panel escribe can_edit=false a pelo en 16 sitios de 5 ficheros; cambiar a edit cuando se corrija el frontend.';

-- Las politicas se evaluan con los privilegios del rol que consulta,
-- asi que `authenticated` necesita EXECUTE. A `anon` y a PUBLIC se les
-- retira: ninguna politica de este fichero aplica al rol anon.
revoke all on function public.can_read_section(text)  from public, anon;
revoke all on function public.can_write_section(text) from public, anon;
grant execute on function public.can_read_section(text)  to authenticated, service_role;
grant execute on function public.can_write_section(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- NOTA SOBRE EL ROL `manager` (punto 5 del encargo)
--   El enum app_role tiene admin/manager/staff, pero `manager` tiene 0
--   usuarios y 0 apariciones en politicas o funciones. No se elimina.
--   Con este modelo queda COHERENTE sin nada especifico: is_admin()
--   solo mira role='admin', y has_section_permission() no mira el rol
--   en absoluto, solo user_permissions. Es decir, un `manager` se rige
--   exactamente por sus filas de user_permissions, igual que un
--   `staff`. Si manana se empieza a usar, funciona sin tocar ni una
--   sola politica.
-- ---------------------------------------------------------------------

-- =====================================================================
-- BLOQUE 2 -- SECCION `reservas`  (3 tablas)
-- =====================================================================

-- --- reservas : Datos personales de clientes (nombre, telefono, email). /reservas
--     politicas previas: 5
drop policy if exists "Only authenticated can read reservas" on public."reservas";  -- era SELECT TO authenticated
--     [se sustituye mas abajo] "Público puede crear reservas" (INSERT)
drop policy if exists "Solo usuarios autenticados pueden actualizar reservas" on public."reservas";  -- era UPDATE TO authenticated,service_role
drop policy if exists "Solo usuarios autenticados pueden eliminar reservas" on public."reservas";  -- era DELETE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden ver reservas" on public."reservas";  -- era SELECT TO authenticated
create policy "reservas_select_seccion" on public."reservas"
  for select to authenticated
  using (public.can_read_section('reservas'));
create policy "reservas_insert_seccion" on public."reservas"
  for insert to authenticated
  with check (public.can_write_section('reservas'));
create policy "reservas_update_seccion" on public."reservas"
  for update to authenticated
  using (public.can_write_section('reservas'))
  with check (public.can_write_section('reservas'));
create policy "reservas_delete_seccion" on public."reservas"
  for delete to authenticated
  using (public.can_write_section('reservas'));
create policy "reservas_service_role" on public."reservas"
  for all to service_role using (true) with check (true);

-- `reservas` conserva ademas el INSERT anonimo del formulario publico de
-- touza-restaurant-website (Reservado.tsx:54). La politica original era
-- `TO public`, que incluye tambien a `authenticated`: se sustituye por
-- una acotada al rol `anon`, de modo que un usuario logueado SIN la
-- seccion `reservas` ya no puede crear reservas desde el panel.
-- El GRANT INSERT a anon lo dio la Fase 1 (bloque 6) y se mantiene.
drop policy if exists "Público puede crear reservas" on public."reservas";
create policy "reservas_insert_anon_formulario_web" on public."reservas"
  for insert to anon
  with check (true);

-- --- solicitudes_pendientes : Lo que el bot no resolvio; lleva telefono/email. Pestana Solicitudes
--     politicas previas: 5
drop policy if exists "Authenticated users can insert solicitudes" on public."solicitudes_pendientes";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can update solicitudes" on public."solicitudes_pendientes";  -- era UPDATE TO authenticated
drop policy if exists "Authenticated users can view solicitudes" on public."solicitudes_pendientes";  -- era SELECT TO authenticated
drop policy if exists "Service role can insert solicitudes" on public."solicitudes_pendientes";  -- era INSERT TO service_role
drop policy if exists "Service role can select solicitudes" on public."solicitudes_pendientes";  -- era SELECT TO service_role
create policy "solicitudes_pendientes_select_seccion" on public."solicitudes_pendientes"
  for select to authenticated
  using (public.can_read_section('reservas'));
create policy "solicitudes_pendientes_insert_seccion" on public."solicitudes_pendientes"
  for insert to authenticated
  with check (public.can_write_section('reservas'));
create policy "solicitudes_pendientes_update_seccion" on public."solicitudes_pendientes"
  for update to authenticated
  using (public.can_write_section('reservas'))
  with check (public.can_write_section('reservas'));
create policy "solicitudes_pendientes_delete_seccion" on public."solicitudes_pendientes"
  for delete to authenticated
  using (public.can_write_section('reservas'));
create policy "solicitudes_pendientes_service_role" on public."solicitudes_pendientes"
  for all to service_role using (true) with check (true);

-- --- blacklist : Telefonos vetados (dato personal). Pestana Blacklist
--     politicas previas: 5
drop policy if exists "Authenticated users can delete blacklist" on public."blacklist";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert blacklist" on public."blacklist";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can update blacklist" on public."blacklist";  -- era UPDATE TO authenticated
drop policy if exists "Authenticated users can view blacklist" on public."blacklist";  -- era SELECT TO authenticated
drop policy if exists "Only authenticated can read blacklist" on public."blacklist";  -- era SELECT TO authenticated
create policy "blacklist_select_seccion" on public."blacklist"
  for select to authenticated
  using (public.can_read_section('reservas'));
create policy "blacklist_insert_seccion" on public."blacklist"
  for insert to authenticated
  with check (public.can_write_section('reservas'));
create policy "blacklist_update_seccion" on public."blacklist"
  for update to authenticated
  using (public.can_write_section('reservas'))
  with check (public.can_write_section('reservas'));
create policy "blacklist_delete_seccion" on public."blacklist"
  for delete to authenticated
  using (public.can_write_section('reservas'));
create policy "blacklist_service_role" on public."blacklist"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 3 -- SECCION `dashboard`  (1 tabla)
-- =====================================================================

-- --- notificaciones_dashboard : Campana del header: visible desde cualquier pagina del panel
--     politicas previas: 5
drop policy if exists "Authenticated users can insert notificaciones" on public."notificaciones_dashboard";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can update notificaciones" on public."notificaciones_dashboard";  -- era UPDATE TO authenticated
drop policy if exists "Authenticated users can view notificaciones" on public."notificaciones_dashboard";  -- era SELECT TO authenticated
drop policy if exists "Service role can insert notificaciones" on public."notificaciones_dashboard";  -- era INSERT TO service_role
drop policy if exists "Service role can select notificaciones" on public."notificaciones_dashboard";  -- era SELECT TO service_role
create policy "notificaciones_dashboard_select_seccion" on public."notificaciones_dashboard"
  for select to authenticated
  using (public.can_read_section('dashboard'));
create policy "notificaciones_dashboard_insert_seccion" on public."notificaciones_dashboard"
  for insert to authenticated
  with check (public.can_write_section('dashboard'));
create policy "notificaciones_dashboard_update_seccion" on public."notificaciones_dashboard"
  for update to authenticated
  using (public.can_write_section('dashboard'))
  with check (public.can_write_section('dashboard'));
create policy "notificaciones_dashboard_delete_seccion" on public."notificaciones_dashboard"
  for delete to authenticated
  using (public.can_write_section('dashboard'));
create policy "notificaciones_dashboard_service_role" on public."notificaciones_dashboard"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 4 -- SECCION `trabajadores`  (5 tablas)
-- =====================================================================

-- --- trabajadores : Datos personales de empleados. /trabajadores
--     politicas previas: 4
drop policy if exists "Solo usuarios autenticados pueden actualizar trabajadores" on public."trabajadores";  -- era UPDATE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden crear trabajadores" on public."trabajadores";  -- era INSERT TO authenticated
drop policy if exists "Solo usuarios autenticados pueden eliminar trabajadores" on public."trabajadores";  -- era DELETE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden ver trabajadores" on public."trabajadores";  -- era SELECT TO authenticated
create policy "trabajadores_select_seccion" on public."trabajadores"
  for select to authenticated
  using (public.can_read_section('trabajadores'));
create policy "trabajadores_insert_seccion" on public."trabajadores"
  for insert to authenticated
  with check (public.can_write_section('trabajadores'));
create policy "trabajadores_update_seccion" on public."trabajadores"
  for update to authenticated
  using (public.can_write_section('trabajadores'))
  with check (public.can_write_section('trabajadores'));
create policy "trabajadores_delete_seccion" on public."trabajadores"
  for delete to authenticated
  using (public.can_write_section('trabajadores'));
create policy "trabajadores_service_role" on public."trabajadores"
  for all to service_role using (true) with check (true);

-- --- turnos : Cuadrante de turnos. Pestana Turnos
--     politicas previas: 4
drop policy if exists "Solo usuarios autenticados pueden actualizar turnos" on public."turnos";  -- era UPDATE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden crear turnos" on public."turnos";  -- era INSERT TO authenticated
drop policy if exists "Solo usuarios autenticados pueden eliminar turnos" on public."turnos";  -- era DELETE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden ver turnos" on public."turnos";  -- era SELECT TO authenticated
create policy "turnos_select_seccion" on public."turnos"
  for select to authenticated
  using (public.can_read_section('trabajadores'));
create policy "turnos_insert_seccion" on public."turnos"
  for insert to authenticated
  with check (public.can_write_section('trabajadores'));
create policy "turnos_update_seccion" on public."turnos"
  for update to authenticated
  using (public.can_write_section('trabajadores'))
  with check (public.can_write_section('trabajadores'));
create policy "turnos_delete_seccion" on public."turnos"
  for delete to authenticated
  using (public.can_write_section('trabajadores'));
create policy "turnos_service_role" on public."turnos"
  for all to service_role using (true) with check (true);

-- --- registro_horas : Horas fichadas (base de la nomina)
--     politicas previas: 4
drop policy if exists "Auth can manage registro_horas" on public."registro_horas";  -- era ALL TO authenticated
drop policy if exists "Solo usuarios autenticados pueden actualizar registros" on public."registro_horas";  -- era UPDATE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden crear registros" on public."registro_horas";  -- era INSERT TO authenticated
drop policy if exists "Solo usuarios autenticados pueden ver registro de horas" on public."registro_horas";  -- era SELECT TO authenticated
create policy "registro_horas_select_seccion" on public."registro_horas"
  for select to authenticated
  using (public.can_read_section('trabajadores'));
create policy "registro_horas_insert_seccion" on public."registro_horas"
  for insert to authenticated
  with check (public.can_write_section('trabajadores'));
create policy "registro_horas_update_seccion" on public."registro_horas"
  for update to authenticated
  using (public.can_write_section('trabajadores'))
  with check (public.can_write_section('trabajadores'));
create policy "registro_horas_delete_seccion" on public."registro_horas"
  for delete to authenticated
  using (public.can_write_section('trabajadores'));
create policy "registro_horas_service_role" on public."registro_horas"
  for all to service_role using (true) with check (true);

-- --- areas_trabajo : Areas del cuadrante
--     politicas previas: 8
drop policy if exists "Authenticated users can delete areas_trabajo" on public."areas_trabajo";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert areas_trabajo" on public."areas_trabajo";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read areas_trabajo" on public."areas_trabajo";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update areas_trabajo" on public."areas_trabajo";  -- era UPDATE TO authenticated
drop policy if exists "Solo usuarios autenticados pueden actualizar áreas de trabajo" on public."areas_trabajo";  -- era UPDATE TO public
drop policy if exists "Solo usuarios autenticados pueden crear áreas de trabajo" on public."areas_trabajo";  -- era INSERT TO public
drop policy if exists "Solo usuarios autenticados pueden eliminar áreas de trabajo" on public."areas_trabajo";  -- era DELETE TO public
drop policy if exists "Solo usuarios autenticados pueden ver áreas de trabajo" on public."areas_trabajo";  -- era SELECT TO public
create policy "areas_trabajo_select_seccion" on public."areas_trabajo"
  for select to authenticated
  using (public.can_read_section('trabajadores'));
create policy "areas_trabajo_insert_seccion" on public."areas_trabajo"
  for insert to authenticated
  with check (public.can_write_section('trabajadores'));
create policy "areas_trabajo_update_seccion" on public."areas_trabajo"
  for update to authenticated
  using (public.can_write_section('trabajadores'))
  with check (public.can_write_section('trabajadores'));
create policy "areas_trabajo_delete_seccion" on public."areas_trabajo"
  for delete to authenticated
  using (public.can_write_section('trabajadores'));
create policy "areas_trabajo_service_role" on public."areas_trabajo"
  for all to service_role using (true) with check (true);

-- --- asignaciones_area : Asignacion trabajador-area por turno
--     politicas previas: 4
drop policy if exists "Auth can manage asignaciones_area" on public."asignaciones_area";  -- era ALL TO authenticated
drop policy if exists "Solo usuarios autenticados pueden crear asignaciones de área" on public."asignaciones_area";  -- era INSERT TO public
drop policy if exists "Solo usuarios autenticados pueden eliminar asignaciones de áre" on public."asignaciones_area";  -- era DELETE TO public
drop policy if exists "Solo usuarios autenticados pueden ver asignaciones de área" on public."asignaciones_area";  -- era SELECT TO public
create policy "asignaciones_area_select_seccion" on public."asignaciones_area"
  for select to authenticated
  using (public.can_read_section('trabajadores'));
create policy "asignaciones_area_insert_seccion" on public."asignaciones_area"
  for insert to authenticated
  with check (public.can_write_section('trabajadores'));
create policy "asignaciones_area_update_seccion" on public."asignaciones_area"
  for update to authenticated
  using (public.can_write_section('trabajadores'))
  with check (public.can_write_section('trabajadores'));
create policy "asignaciones_area_delete_seccion" on public."asignaciones_area"
  for delete to authenticated
  using (public.can_write_section('trabajadores'));
create policy "asignaciones_area_service_role" on public."asignaciones_area"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 5 -- SECCION `facturas`  (10 tablas)
-- =====================================================================

-- --- facturas : Facturas de proveedor (dato economico interno). /facturas
--     politicas previas: 5
drop policy if exists "Authenticated users can delete facturas" on public."facturas";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert facturas" on public."facturas";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read facturas" on public."facturas";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update facturas" on public."facturas";  -- era UPDATE TO authenticated
drop policy if exists "Permitir inserción facturas" on public."facturas";  -- era INSERT TO public
create policy "facturas_select_seccion" on public."facturas"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "facturas_insert_seccion" on public."facturas"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "facturas_update_seccion" on public."facturas"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "facturas_delete_seccion" on public."facturas"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "facturas_service_role" on public."facturas"
  for all to service_role using (true) with check (true);

-- --- productos_factura : Lineas de factura
--     politicas previas: 5
drop policy if exists "Authenticated users can delete productos_factura" on public."productos_factura";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert productos_factura" on public."productos_factura";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read productos_factura" on public."productos_factura";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update productos_factura" on public."productos_factura";  -- era UPDATE TO authenticated
drop policy if exists "Permitir inserción productos" on public."productos_factura";  -- era INSERT TO public
create policy "productos_factura_select_seccion" on public."productos_factura"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "productos_factura_insert_seccion" on public."productos_factura"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "productos_factura_update_seccion" on public."productos_factura"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "productos_factura_delete_seccion" on public."productos_factura"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "productos_factura_service_role" on public."productos_factura"
  for all to service_role using (true) with check (true);

-- --- proveedores : CIF, direccion, telefono y email de proveedores (dato personal)
--     politicas previas: 4
drop policy if exists "Authenticated users can delete proveedores" on public."proveedores";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert proveedores" on public."proveedores";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read proveedores" on public."proveedores";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update proveedores" on public."proveedores";  -- era UPDATE TO authenticated
create policy "proveedores_select_seccion" on public."proveedores"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "proveedores_insert_seccion" on public."proveedores"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "proveedores_update_seccion" on public."proveedores"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "proveedores_delete_seccion" on public."proveedores"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "proveedores_service_role" on public."proveedores"
  for all to service_role using (true) with check (true);

-- --- productos_catalogo : Catalogo de compras con precio_actual (coste interno)
--     politicas previas: 1
drop policy if exists "Auth can manage productos_catalogo" on public."productos_catalogo";  -- era ALL TO authenticated
create policy "productos_catalogo_select_seccion" on public."productos_catalogo"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "productos_catalogo_insert_seccion" on public."productos_catalogo"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "productos_catalogo_update_seccion" on public."productos_catalogo"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "productos_catalogo_delete_seccion" on public."productos_catalogo"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "productos_catalogo_service_role" on public."productos_catalogo"
  for all to service_role using (true) with check (true);

-- --- documentos : Albaranes. Pestana Albaranes
--     politicas previas: 4
drop policy if exists "Authenticated users can delete documentos" on public."documentos";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert documentos" on public."documentos";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read documentos" on public."documentos";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update documentos" on public."documentos";  -- era UPDATE TO authenticated
create policy "documentos_select_seccion" on public."documentos"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "documentos_insert_seccion" on public."documentos"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "documentos_update_seccion" on public."documentos"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "documentos_delete_seccion" on public."documentos"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "documentos_service_role" on public."documentos"
  for all to service_role using (true) with check (true);

-- --- items_documento : Lineas de albaran
--     politicas previas: 4
drop policy if exists "Authenticated users can delete items_documento" on public."items_documento";  -- era DELETE TO authenticated
drop policy if exists "Authenticated users can insert items_documento" on public."items_documento";  -- era INSERT TO authenticated
drop policy if exists "Authenticated users can read items_documento" on public."items_documento";  -- era SELECT TO authenticated
drop policy if exists "Authenticated users can update items_documento" on public."items_documento";  -- era UPDATE TO authenticated
create policy "items_documento_select_seccion" on public."items_documento"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "items_documento_insert_seccion" on public."items_documento"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "items_documento_update_seccion" on public."items_documento"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "items_documento_delete_seccion" on public."items_documento"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "items_documento_service_role" on public."items_documento"
  for all to service_role using (true) with check (true);

-- --- historial_precios : Historico de precios de compra (FK factura_id)
--     politicas previas: 2
drop policy if exists "Permitir inserción a autenticados" on public."historial_precios";  -- era INSERT TO authenticated
drop policy if exists "Permitir select a autenticados" on public."historial_precios";  -- era SELECT TO authenticated
create policy "historial_precios_select_seccion" on public."historial_precios"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "historial_precios_insert_seccion" on public."historial_precios"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "historial_precios_update_seccion" on public."historial_precios"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "historial_precios_delete_seccion" on public."historial_precios"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "historial_precios_service_role" on public."historial_precios"
  for all to service_role using (true) with check (true);

-- --- conversaciones : Chat IA de facturas (vista chat_facturas_conversaciones)
--     politicas previas: 1
drop policy if exists "conversaciones_auth_only" on public."conversaciones";  -- era ALL TO authenticated
create policy "conversaciones_select_seccion" on public."conversaciones"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "conversaciones_insert_seccion" on public."conversaciones"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "conversaciones_update_seccion" on public."conversaciones"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "conversaciones_delete_seccion" on public."conversaciones"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "conversaciones_service_role" on public."conversaciones"
  for all to service_role using (true) with check (true);

-- --- mensajes_chat : Chat IA de facturas (vista chat_facturas_mensajes)
--     politicas previas: 1
drop policy if exists "mensajes_chat_auth_only" on public."mensajes_chat";  -- era ALL TO authenticated
create policy "mensajes_chat_select_seccion" on public."mensajes_chat"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "mensajes_chat_insert_seccion" on public."mensajes_chat"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "mensajes_chat_update_seccion" on public."mensajes_chat"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "mensajes_chat_delete_seccion" on public."mensajes_chat"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "mensajes_chat_service_role" on public."mensajes_chat"
  for all to service_role using (true) with check (true);

-- --- n8n_chat_histories : Historico del chatbot de facturas en n8n (438 mensajes)
--     politicas previas: 1
drop policy if exists "n8n_chat_auth_only" on public."n8n_chat_histories";  -- era ALL TO authenticated
create policy "n8n_chat_histories_select_seccion" on public."n8n_chat_histories"
  for select to authenticated
  using (public.can_read_section('facturas'));
create policy "n8n_chat_histories_insert_seccion" on public."n8n_chat_histories"
  for insert to authenticated
  with check (public.can_write_section('facturas'));
create policy "n8n_chat_histories_update_seccion" on public."n8n_chat_histories"
  for update to authenticated
  using (public.can_write_section('facturas'))
  with check (public.can_write_section('facturas'));
create policy "n8n_chat_histories_delete_seccion" on public."n8n_chat_histories"
  for delete to authenticated
  using (public.can_write_section('facturas'));
create policy "n8n_chat_histories_service_role" on public."n8n_chat_histories"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 6 -- SECCION `asistente_telefonico`  (2 tablas)
-- =====================================================================

-- --- call_logs : Llamadas: numero, transcripcion y coste (dato personal)
--     politicas previas: 2
drop policy if exists "Auth can view call_logs" on public."call_logs";  -- era SELECT TO authenticated
drop policy if exists "Authenticated can read call_logs" on public."call_logs";  -- era SELECT TO public
create policy "call_logs_select_seccion" on public."call_logs"
  for select to authenticated
  using (public.can_read_section('asistente_telefonico'));
create policy "call_logs_insert_seccion" on public."call_logs"
  for insert to authenticated
  with check (public.can_write_section('asistente_telefonico'));
create policy "call_logs_update_seccion" on public."call_logs"
  for update to authenticated
  using (public.can_write_section('asistente_telefonico'))
  with check (public.can_write_section('asistente_telefonico'));
create policy "call_logs_delete_seccion" on public."call_logs"
  for delete to authenticated
  using (public.can_write_section('asistente_telefonico'));
create policy "call_logs_service_role" on public."call_logs"
  for all to service_role using (true) with check (true);

-- --- phone_system_config : IDs de VAPI, webhook_url y telefono de desvio
--     politicas previas: 2
drop policy if exists "Auth can manage phone_system_config" on public."phone_system_config";  -- era ALL TO authenticated
drop policy if exists "Only authenticated can read phone config" on public."phone_system_config";  -- era SELECT TO authenticated
create policy "phone_system_config_select_seccion" on public."phone_system_config"
  for select to authenticated
  using (public.can_read_section('asistente_telefonico'));
create policy "phone_system_config_insert_seccion" on public."phone_system_config"
  for insert to authenticated
  with check (public.can_write_section('asistente_telefonico'));
create policy "phone_system_config_update_seccion" on public."phone_system_config"
  for update to authenticated
  using (public.can_write_section('asistente_telefonico'))
  with check (public.can_write_section('asistente_telefonico'));
create policy "phone_system_config_delete_seccion" on public."phone_system_config"
  for delete to authenticated
  using (public.can_write_section('asistente_telefonico'));
create policy "phone_system_config_service_role" on public."phone_system_config"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 7 -- SECCION `marketing`  (4 tablas)
-- =====================================================================

-- --- newsletter_suscriptores : Emails de suscriptores (dato personal). /marketing
--     politicas previas: 3
drop policy if exists "Usuarios autenticados pueden actualizar suscriptores" on public."newsletter_suscriptores";  -- era UPDATE TO authenticated
drop policy if exists "Usuarios autenticados pueden insertar suscriptores" on public."newsletter_suscriptores";  -- era INSERT TO authenticated
drop policy if exists "Usuarios autenticados pueden ver suscriptores" on public."newsletter_suscriptores";  -- era SELECT TO authenticated
create policy "newsletter_suscriptores_select_seccion" on public."newsletter_suscriptores"
  for select to authenticated
  using (public.can_read_section('marketing'));
create policy "newsletter_suscriptores_insert_seccion" on public."newsletter_suscriptores"
  for insert to authenticated
  with check (public.can_write_section('marketing'));
create policy "newsletter_suscriptores_update_seccion" on public."newsletter_suscriptores"
  for update to authenticated
  using (public.can_write_section('marketing'))
  with check (public.can_write_section('marketing'));
create policy "newsletter_suscriptores_delete_seccion" on public."newsletter_suscriptores"
  for delete to authenticated
  using (public.can_write_section('marketing'));
create policy "newsletter_suscriptores_service_role" on public."newsletter_suscriptores"
  for all to service_role using (true) with check (true);

-- --- newsletter_envios : Historial de envios
--     politicas previas: 3
drop policy if exists "Auth can manage newsletter_envios" on public."newsletter_envios";  -- era ALL TO authenticated
drop policy if exists "Usuarios autenticados pueden insertar envíos" on public."newsletter_envios";  -- era INSERT TO authenticated
drop policy if exists "Usuarios autenticados pueden ver historial de envíos" on public."newsletter_envios";  -- era SELECT TO authenticated
create policy "newsletter_envios_select_seccion" on public."newsletter_envios"
  for select to authenticated
  using (public.can_read_section('marketing'));
create policy "newsletter_envios_insert_seccion" on public."newsletter_envios"
  for insert to authenticated
  with check (public.can_write_section('marketing'));
create policy "newsletter_envios_update_seccion" on public."newsletter_envios"
  for update to authenticated
  using (public.can_write_section('marketing'))
  with check (public.can_write_section('marketing'));
create policy "newsletter_envios_delete_seccion" on public."newsletter_envios"
  for delete to authenticated
  using (public.can_write_section('marketing'));
create policy "newsletter_envios_service_role" on public."newsletter_envios"
  for all to service_role using (true) with check (true);

-- --- campanas_marketing : Campanas y presupuesto
--     politicas previas: 5
drop policy if exists "Auth can manage campanas_marketing" on public."campanas_marketing";  -- era ALL TO authenticated
drop policy if exists "Usuarios autenticados pueden actualizar campañas" on public."campanas_marketing";  -- era UPDATE TO public
drop policy if exists "Usuarios autenticados pueden crear campañas" on public."campanas_marketing";  -- era INSERT TO public
drop policy if exists "Usuarios autenticados pueden eliminar campañas" on public."campanas_marketing";  -- era DELETE TO public
drop policy if exists "Usuarios autenticados pueden ver campañas" on public."campanas_marketing";  -- era SELECT TO public
create policy "campanas_marketing_select_seccion" on public."campanas_marketing"
  for select to authenticated
  using (public.can_read_section('marketing'));
create policy "campanas_marketing_insert_seccion" on public."campanas_marketing"
  for insert to authenticated
  with check (public.can_write_section('marketing'));
create policy "campanas_marketing_update_seccion" on public."campanas_marketing"
  for update to authenticated
  using (public.can_write_section('marketing'))
  with check (public.can_write_section('marketing'));
create policy "campanas_marketing_delete_seccion" on public."campanas_marketing"
  for delete to authenticated
  using (public.can_write_section('marketing'));
create policy "campanas_marketing_service_role" on public."campanas_marketing"
  for all to service_role using (true) with check (true);

-- --- email_eventos : Aperturas y clics con email_destinatario (dato personal)
--     politicas previas: 2
drop policy if exists "Auth can manage email_eventos" on public."email_eventos";  -- era ALL TO authenticated
drop policy if exists "Usuarios autenticados pueden ver eventos de email" on public."email_eventos";  -- era SELECT TO public
create policy "email_eventos_select_seccion" on public."email_eventos"
  for select to authenticated
  using (public.can_read_section('marketing'));
create policy "email_eventos_insert_seccion" on public."email_eventos"
  for insert to authenticated
  with check (public.can_write_section('marketing'));
create policy "email_eventos_update_seccion" on public."email_eventos"
  for update to authenticated
  using (public.can_write_section('marketing'))
  with check (public.can_write_section('marketing'));
create policy "email_eventos_delete_seccion" on public."email_eventos"
  for delete to authenticated
  using (public.can_write_section('marketing'));
create policy "email_eventos_service_role" on public."email_eventos"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE 8 -- SECCION `gestor_carta`  (1 tabla)
-- =====================================================================

-- --- historial_ajustes_precios : Ajustes masivos de precios de la carta (AjustePreciosModal)
--     politicas previas: 4
drop policy if exists "Auth can manage historial_ajustes_precios" on public."historial_ajustes_precios";  -- era ALL TO authenticated
drop policy if exists "Usuarios autenticados pueden crear entradas en historial" on public."historial_ajustes_precios";  -- era INSERT TO public
drop policy if exists "Usuarios autenticados pueden eliminar historial" on public."historial_ajustes_precios";  -- era DELETE TO public
drop policy if exists "Usuarios autenticados pueden ver historial" on public."historial_ajustes_precios";  -- era SELECT TO public
create policy "historial_ajustes_precios_select_seccion" on public."historial_ajustes_precios"
  for select to authenticated
  using (public.can_read_section('gestor_carta'));
create policy "historial_ajustes_precios_insert_seccion" on public."historial_ajustes_precios"
  for insert to authenticated
  with check (public.can_write_section('gestor_carta'));
create policy "historial_ajustes_precios_update_seccion" on public."historial_ajustes_precios"
  for update to authenticated
  using (public.can_write_section('gestor_carta'))
  with check (public.can_write_section('gestor_carta'));
create policy "historial_ajustes_precios_delete_seccion" on public."historial_ajustes_precios"
  for delete to authenticated
  using (public.can_write_section('gestor_carta'));
create policy "historial_ajustes_precios_service_role" on public."historial_ajustes_precios"
  for all to service_role using (true) with check (true);

-- =====================================================================
-- BLOQUE FINAL -- Defensa en profundidad: retirar el SELECT de `anon`.
--
-- Supabase concede por defecto privilegios a `anon` sobre todo el
-- esquema public, de modo que la RLS es la unica barrera. La Fase 1 ya
-- limpio una parte; aqui se retira el SELECT en las tablas de esta
-- migracion que todavia lo conservaban y que NINGUNA web publica
-- consulta (verificado por grep de `.from(` en casa-tomas-story y
-- touza-restaurant-website: solo usan Platos, Vinos, Cocteles, Bebidas,
-- menus_diarios, tapas, novedades, resenas, configBotWeb y el INSERT de
-- reservas).
--
-- `reservas` NO aparece en esta lista a proposito: su INSERT anonimo es
-- el unico camino de escritura publica del sistema y no merece la pena
-- arriesgarlo por un privilegio que la RLS ya neutraliza (comprobado:
-- `set local role anon; select count(*) from reservas` -> 0).
-- =====================================================================
revoke select on public."areas_trabajo"             from anon;
revoke select on public."asignaciones_area"         from anon;
revoke select on public."campanas_marketing"        from anon;
revoke select on public."conversaciones"            from anon;
revoke select on public."documentos"                from anon;
revoke select on public."historial_ajustes_precios" from anon;
revoke select on public."historial_precios"         from anon;
revoke select on public."items_documento"           from anon;
revoke select on public."mensajes_chat"             from anon;
revoke select on public."n8n_chat_histories"        from anon;
revoke select on public."newsletter_envios"         from anon;
revoke select on public."newsletter_suscriptores"   from anon;
revoke select on public."registro_horas"            from anon;
revoke select on public."turnos"                    from anon;

commit;

-- =====================================================================
-- PENDIENTE PARA UNA FASE POSTERIOR (no se aplica aqui)
--
-- ATENCION: esto y el arreglo del frontend son UNA SOLA pieza. Hay que
-- soltarlos JUNTOS, nunca por separado: si se cambia la funcion sin
-- arreglar antes los 16 `can_edit: false` de los 5 ficheros listados
-- arriba, todos los no-admin se quedan sin poder guardar nada.
--
-- Cuando el panel permita conceder can_edit de verdad, ejecutar
-- UNICAMENTE esto para que toda la escritura pase a exigir can_edit:
--
--   create or replace function public.can_write_section(_section text)
--   returns boolean language sql stable security definer
--   set search_path to 'public'
--   as $$
--     select public.has_section_permission((select auth.uid()), _section, 'edit')
--   $$;
--
-- Antes de ejecutarlo hay que conceder can_edit a quien deba escribir,
-- o todos los no-admin se quedaran en solo lectura.
-- =====================================================================
