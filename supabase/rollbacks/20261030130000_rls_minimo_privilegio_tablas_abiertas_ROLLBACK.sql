set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261030130000_rls_minimo_privilegio_tablas_abiertas.sql
-- ===========================================================================
-- SE EJECUTA A MANO (psql / SQL editor) y solo para deshacer un despliegue que
-- salió mal. NO es una migración: no copiar a supabase/migrations/.
--
-- EFECTO: REABRE CT-REM-DB-02. Restaura las políticas «complete admin access»
-- (USING true / auth.uid() IS NOT NULL) y los GRANT revocados en ~30 tablas.
-- En salas/bew quita también las políticas de sección (las crea igual DB-04):
-- quedan las viejas, que siguen dando acceso al panel.
--
-- Estado al que vuelve: el de Git a0b8d3a reconstruido en el laboratorio PGlite
-- (políticas y GRANT copiados de remediacion-2026-10-30/evidencias/lab-bd,
-- fixture generado por gen-fixture-t4a.mjs). Orden si se revierten varias:
-- 140000 -> 130000 -> 120000 -> 110000 -> 100000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- novedades
do $r$ begin
  if to_regclass('public.novedades') is null then raise notice 'rollback: novedades no existe'; return; end if;
  execute $q$drop policy if exists novedades_select_seccion on public.novedades$q$;
  execute $q$drop policy if exists novedades_insert_seccion on public.novedades$q$;
  execute $q$drop policy if exists novedades_update_seccion on public.novedades$q$;
  execute $q$drop policy if exists novedades_delete_seccion on public.novedades$q$;
  execute $q$drop policy if exists "Authenticated users can delete novedades" on public.novedades$q$;
  execute $q$create policy "Authenticated users can delete novedades" on public.novedades as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can insert novedades" on public.novedades$q$;
  execute $q$create policy "Authenticated users can insert novedades" on public.novedades as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read novedades" on public.novedades$q$;
  execute $q$create policy "Authenticated users can read novedades" on public.novedades as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can update novedades" on public.novedades$q$;
  execute $q$create policy "Authenticated users can update novedades" on public.novedades as permissive for update to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar novedades" on public.novedades$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar novedades" on public.novedades as permissive for update to public using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden crear novedades" on public.novedades$q$;
  execute $q$create policy "Usuarios autenticados pueden crear novedades" on public.novedades as permissive for insert to public with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar novedades" on public.novedades$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar novedades" on public.novedades as permissive for delete to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver novedades" on public.novedades$q$;
  execute $q$create policy "Usuarios autenticados pueden ver novedades" on public.novedades as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant truncate on public.novedades to authenticated$q$;
end $r$;
-- menus_diarios
do $r$ begin
  if to_regclass('public.menus_diarios') is null then raise notice 'rollback: menus_diarios no existe'; return; end if;
  execute $q$drop policy if exists menus_diarios_insert_seccion on public.menus_diarios$q$;
  execute $q$drop policy if exists menus_diarios_update_seccion on public.menus_diarios$q$;
  execute $q$drop policy if exists menus_diarios_delete_seccion on public.menus_diarios$q$;
  execute $q$drop policy if exists "Authenticated gestiona menus_diarios" on public.menus_diarios$q$;
  execute $q$create policy "Authenticated gestiona menus_diarios" on public.menus_diarios as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant truncate on public.menus_diarios to authenticated$q$;
end $r$;
-- tapas
do $r$ begin
  if to_regclass('public.tapas') is null then raise notice 'rollback: tapas no existe'; return; end if;
  execute $q$drop policy if exists tapas_insert_seccion on public.tapas$q$;
  execute $q$drop policy if exists tapas_update_seccion on public.tapas$q$;
  execute $q$drop policy if exists tapas_delete_seccion on public.tapas$q$;
  execute $q$drop policy if exists "Authenticated gestiona tapas" on public.tapas$q$;
  execute $q$create policy "Authenticated gestiona tapas" on public.tapas as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant truncate on public.tapas to authenticated$q$;
end $r$;
-- imagenes_base64
do $r$ begin
  if to_regclass('public.imagenes_base64') is null then raise notice 'rollback: imagenes_base64 no existe'; return; end if;
  execute $q$drop policy if exists imagenes_base64_select_seccion on public.imagenes_base64$q$;
  execute $q$drop policy if exists imagenes_base64_insert_seccion on public.imagenes_base64$q$;
  execute $q$drop policy if exists imagenes_base64_update_seccion on public.imagenes_base64$q$;
  execute $q$drop policy if exists imagenes_base64_delete_seccion on public.imagenes_base64$q$;
  execute $q$drop policy if exists "Auth can manage imagenes_base64" on public.imagenes_base64$q$;
  execute $q$create policy "Auth can manage imagenes_base64" on public.imagenes_base64 as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar imágenes" on public.imagenes_base64$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar imágenes" on public.imagenes_base64 as permissive for update to public using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden crear imágenes" on public.imagenes_base64$q$;
  execute $q$create policy "Usuarios autenticados pueden crear imágenes" on public.imagenes_base64 as permissive for insert to public with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar imágenes" on public.imagenes_base64$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar imágenes" on public.imagenes_base64 as permissive for delete to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver imágenes" on public.imagenes_base64$q$;
  execute $q$create policy "Usuarios autenticados pueden ver imágenes" on public.imagenes_base64 as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant select on public.imagenes_base64 to anon$q$;
  execute $q$grant truncate on public.imagenes_base64 to authenticated$q$;
end $r$;
-- resenas
do $r$ begin
  if to_regclass('public.resenas') is null then raise notice 'rollback: resenas no existe'; return; end if;
  execute $q$drop policy if exists resenas_superadmin on public.resenas$q$;
  execute $q$drop policy if exists "Auth can manage resenas" on public.resenas$q$;
  execute $q$create policy "Auth can manage resenas" on public.resenas as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar reseñas" on public.resenas$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar reseñas" on public.resenas as permissive for update to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden crear reseñas" on public.resenas$q$;
  execute $q$create policy "Usuarios autenticados pueden crear reseñas" on public.resenas as permissive for insert to public with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar reseñas" on public.resenas$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar reseñas" on public.resenas as permissive for delete to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver reseñas" on public.resenas$q$;
  execute $q$create policy "Usuarios autenticados pueden ver reseñas" on public.resenas as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant truncate on public.resenas to authenticated$q$;
end $r$;
-- config_google_places
do $r$ begin
  if to_regclass('public.config_google_places') is null then raise notice 'rollback: config_google_places no existe'; return; end if;
  execute $q$drop policy if exists config_google_places_superadmin on public.config_google_places$q$;
  execute $q$drop policy if exists "Auth can manage config_google_places" on public.config_google_places$q$;
  execute $q$create policy "Auth can manage config_google_places" on public.config_google_places as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar configuración Google" on public.config_google_places$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar configuración Google" on public.config_google_places as permissive for update to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden crear configuración Google" on public.config_google_places$q$;
  execute $q$create policy "Usuarios autenticados pueden crear configuración Google" on public.config_google_places as permissive for insert to public with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver configuración Google" on public.config_google_places$q$;
  execute $q$create policy "Usuarios autenticados pueden ver configuración Google" on public.config_google_places as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant select on public.config_google_places to anon$q$;
  execute $q$grant truncate on public.config_google_places to authenticated$q$;
end $r$;
-- sell_users
do $r$ begin
  if to_regclass('public.sell_users') is null then raise notice 'rollback: sell_users no existe'; return; end if;
  execute $q$drop policy if exists sell_users_select_superadmin on public.sell_users$q$;
  execute $q$drop policy if exists "Auth can manage sell_users" on public.sell_users$q$;
  execute $q$create policy "Auth can manage sell_users" on public.sell_users as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.sell_users to anon$q$;
  execute $q$grant truncate on public.sell_users to authenticated$q$;
end $r$;
-- config_redes_sociales
do $r$ begin
  if to_regclass('public.config_redes_sociales') is null then raise notice 'rollback: config_redes_sociales no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage config_redes_sociales" on public.config_redes_sociales$q$;
  execute $q$create policy "Auth can manage config_redes_sociales" on public.config_redes_sociales as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.config_redes_sociales to anon$q$;
  execute $q$grant truncate on public.config_redes_sociales to authenticated$q$;
end $r$;
-- dashboard_config
do $r$ begin
  if to_regclass('public.dashboard_config') is null then raise notice 'rollback: dashboard_config no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage dashboard_config" on public.dashboard_config$q$;
  execute $q$create policy "Auth can manage dashboard_config" on public.dashboard_config as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.dashboard_config to anon$q$;
  execute $q$grant truncate on public.dashboard_config to authenticated$q$;
end $r$;
-- publicaciones_redes
do $r$ begin
  if to_regclass('public.publicaciones_redes') is null then raise notice 'rollback: publicaciones_redes no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage publicaciones_redes" on public.publicaciones_redes$q$;
  execute $q$create policy "Auth can manage publicaciones_redes" on public.publicaciones_redes as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.publicaciones_redes to anon$q$;
  execute $q$grant truncate on public.publicaciones_redes to authenticated$q$;
end $r$;
-- estadisticas_redes
do $r$ begin
  if to_regclass('public.estadisticas_redes') is null then raise notice 'rollback: estadisticas_redes no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage estadisticas_redes" on public.estadisticas_redes$q$;
  execute $q$create policy "Auth can manage estadisticas_redes" on public.estadisticas_redes as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.estadisticas_redes to anon$q$;
  execute $q$grant truncate on public.estadisticas_redes to authenticated$q$;
end $r$;
-- favoritos
do $r$ begin
  if to_regclass('public.favoritos') is null then raise notice 'rollback: favoritos no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage favoritos" on public.favoritos$q$;
  execute $q$create policy "Auth can manage favoritos" on public.favoritos as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.favoritos to anon$q$;
  execute $q$grant truncate on public.favoritos to authenticated$q$;
end $r$;
-- carrito
do $r$ begin
  if to_regclass('public.carrito') is null then raise notice 'rollback: carrito no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage carrito" on public.carrito$q$;
  execute $q$create policy "Auth can manage carrito" on public.carrito as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.carrito to anon$q$;
  execute $q$grant truncate on public.carrito to authenticated$q$;
end $r$;
-- noticias_hosteleria
do $r$ begin
  if to_regclass('public.noticias_hosteleria') is null then raise notice 'rollback: noticias_hosteleria no existe'; return; end if;
  execute $q$drop policy if exists "Auth can manage noticias_hosteleria" on public.noticias_hosteleria$q$;
  execute $q$create policy "Auth can manage noticias_hosteleria" on public.noticias_hosteleria as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant insert, update, delete, truncate on public.noticias_hosteleria to authenticated$q$;
end $r$;
-- alertas_stock
do $r$ begin
  if to_regclass('public.alertas_stock') is null then raise notice 'rollback: alertas_stock no existe'; return; end if;
  execute $q$drop policy if exists alertas_stock_superadmin on public.alertas_stock$q$;
  execute $q$drop policy if exists "Auth can manage alertas_stock" on public.alertas_stock$q$;
  execute $q$create policy "Auth can manage alertas_stock" on public.alertas_stock as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.alertas_stock to anon$q$;
  execute $q$grant truncate on public.alertas_stock to authenticated$q$;
end $r$;
-- lineas_pedido
do $r$ begin
  if to_regclass('public.lineas_pedido') is null then raise notice 'rollback: lineas_pedido no existe'; return; end if;
  execute $q$drop policy if exists lineas_pedido_superadmin on public.lineas_pedido$q$;
  execute $q$drop policy if exists "Auth can manage lineas_pedido" on public.lineas_pedido$q$;
  execute $q$create policy "Auth can manage lineas_pedido" on public.lineas_pedido as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.lineas_pedido to anon$q$;
  execute $q$grant truncate on public.lineas_pedido to authenticated$q$;
end $r$;
-- movimientos_stock
do $r$ begin
  if to_regclass('public.movimientos_stock') is null then raise notice 'rollback: movimientos_stock no existe'; return; end if;
  execute $q$drop policy if exists movimientos_stock_superadmin on public.movimientos_stock$q$;
  execute $q$drop policy if exists "Auth can manage movimientos_stock" on public.movimientos_stock$q$;
  execute $q$create policy "Auth can manage movimientos_stock" on public.movimientos_stock as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.movimientos_stock to anon$q$;
  execute $q$grant truncate on public.movimientos_stock to authenticated$q$;
end $r$;
-- BebidasVENTA
do $r$ begin
  if to_regclass('public."BebidasVENTA"') is null then raise notice 'rollback: BebidasVENTA no existe'; return; end if;
  execute $q$drop policy if exists bebidas_venta_superadmin on public."BebidasVENTA"$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar" on public."BebidasVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar" on public."BebidasVENTA" as permissive for update to authenticated using (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar" on public."BebidasVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar" on public."BebidasVENTA" as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden insertar" on public."BebidasVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden insertar" on public."BebidasVENTA" as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados ven todo" on public."BebidasVENTA"$q$;
  execute $q$create policy "Usuarios autenticados ven todo" on public."BebidasVENTA" as permissive for select to authenticated using (true)$q$;
  execute $q$grant truncate on public."BebidasVENTA" to authenticated$q$;
end $r$;
-- ComidaVENTA
do $r$ begin
  if to_regclass('public."ComidaVENTA"') is null then raise notice 'rollback: ComidaVENTA no existe'; return; end if;
  execute $q$drop policy if exists comida_venta_superadmin on public."ComidaVENTA"$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar" on public."ComidaVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar" on public."ComidaVENTA" as permissive for update to authenticated using (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar" on public."ComidaVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar" on public."ComidaVENTA" as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden insertar" on public."ComidaVENTA"$q$;
  execute $q$create policy "Usuarios autenticados pueden insertar" on public."ComidaVENTA" as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados ven todo" on public."ComidaVENTA"$q$;
  execute $q$create policy "Usuarios autenticados ven todo" on public."ComidaVENTA" as permissive for select to authenticated using (true)$q$;
  execute $q$grant truncate on public."ComidaVENTA" to authenticated$q$;
end $r$;
-- bew
do $r$ begin
  if to_regclass('public.bew') is null then raise notice 'rollback: bew no existe'; return; end if;
  execute $q$drop policy if exists bew_superadmin on public.bew$q$;
  execute $q$drop policy if exists bew_service_role on public.bew$q$;
  execute $q$drop policy if exists acceso_panel_no_bloqueado on public.bew$q$;
  execute $q$drop policy if exists "Authenticated users can delete bew" on public.bew$q$;
  execute $q$create policy "Authenticated users can delete bew" on public.bew as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can insert bew" on public.bew$q$;
  execute $q$create policy "Authenticated users can insert bew" on public.bew as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read bew" on public.bew$q$;
  execute $q$create policy "Authenticated users can read bew" on public.bew as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can update bew" on public.bew$q$;
  execute $q$create policy "Authenticated users can update bew" on public.bew as permissive for update to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.bew to anon$q$;
  execute $q$grant truncate on public.bew to authenticated$q$;
  execute $q$alter table public.bew disable row level security$q$;
end $r$;
-- salas
do $r$ begin
  if to_regclass('public.salas') is null then raise notice 'rollback: salas no existe'; return; end if;
  execute $q$drop policy if exists salas_select_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_insert_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_update_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_delete_seccion on public.salas$q$;
  execute $q$drop policy if exists salas_service_role on public.salas$q$;
  execute $q$drop policy if exists acceso_panel_no_bloqueado on public.salas$q$;
  execute $q$drop policy if exists "Solo usuarios autenticados pueden actualizar salas" on public.salas$q$;
  execute $q$create policy "Solo usuarios autenticados pueden actualizar salas" on public.salas as permissive for update to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Solo usuarios autenticados pueden crear salas" on public.salas$q$;
  execute $q$create policy "Solo usuarios autenticados pueden crear salas" on public.salas as permissive for insert to authenticated with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Solo usuarios autenticados pueden eliminar salas" on public.salas$q$;
  execute $q$create policy "Solo usuarios autenticados pueden eliminar salas" on public.salas as permissive for delete to authenticated using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant truncate on public.salas to authenticated$q$;
  execute $q$alter table public.salas disable row level security$q$;
end $r$;
-- ocupacion_diaria
do $r$ begin
  if to_regclass('public.ocupacion_diaria') is null then raise notice 'rollback: ocupacion_diaria no existe'; return; end if;
  execute $q$drop policy if exists ocupacion_diaria_select_seccion on public.ocupacion_diaria$q$;
  execute $q$drop policy if exists "Auth can manage ocupacion_diaria" on public.ocupacion_diaria$q$;
  execute $q$create policy "Auth can manage ocupacion_diaria" on public.ocupacion_diaria as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read ocupacion_diaria" on public.ocupacion_diaria$q$;
  execute $q$create policy "Authenticated users can read ocupacion_diaria" on public.ocupacion_diaria as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Solo usuarios autenticados pueden modificar ocupación" on public.ocupacion_diaria$q$;
  execute $q$create policy "Solo usuarios autenticados pueden modificar ocupación" on public.ocupacion_diaria as permissive for all to authenticated using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "System can manage ocupacion_diaria" on public.ocupacion_diaria$q$;
  execute $q$create policy "System can manage ocupacion_diaria" on public.ocupacion_diaria as permissive for all to public using (is_admin(auth.uid()))$q$;
  execute $q$grant insert, update, delete, truncate on public.ocupacion_diaria to authenticated$q$;
end $r$;
-- planos_espacio
do $r$ begin
  if to_regclass('public.planos_espacio') is null then raise notice 'rollback: planos_espacio no existe'; return; end if;
  execute $q$drop policy if exists planos_espacio_select_seccion on public.planos_espacio$q$;
  execute $q$drop policy if exists planos_espacio_insert_seccion on public.planos_espacio$q$;
  execute $q$drop policy if exists planos_espacio_update_seccion on public.planos_espacio$q$;
  execute $q$drop policy if exists planos_espacio_delete_seccion on public.planos_espacio$q$;
  execute $q$drop policy if exists "Auth can manage planos_espacio" on public.planos_espacio$q$;
  execute $q$create policy "Auth can manage planos_espacio" on public.planos_espacio as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden actualizar planos" on public.planos_espacio$q$;
  execute $q$create policy "Usuarios autenticados pueden actualizar planos" on public.planos_espacio as permissive for update to public using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden crear planos" on public.planos_espacio$q$;
  execute $q$create policy "Usuarios autenticados pueden crear planos" on public.planos_espacio as permissive for insert to public with check ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden eliminar planos" on public.planos_espacio$q$;
  execute $q$create policy "Usuarios autenticados pueden eliminar planos" on public.planos_espacio as permissive for delete to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver planos" on public.planos_espacio$q$;
  execute $q$create policy "Usuarios autenticados pueden ver planos" on public.planos_espacio as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$grant select on public.planos_espacio to anon$q$;
  execute $q$grant truncate on public.planos_espacio to authenticated$q$;
end $r$;
-- configuracion_turnos
do $r$ begin
  if to_regclass('public.configuracion_turnos') is null then raise notice 'rollback: configuracion_turnos no existe'; return; end if;
  execute $q$drop policy if exists configuracion_turnos_select_seccion on public.configuracion_turnos$q$;
  execute $q$drop policy if exists configuracion_turnos_insert_seccion on public.configuracion_turnos$q$;
  execute $q$drop policy if exists configuracion_turnos_update_seccion on public.configuracion_turnos$q$;
  execute $q$drop policy if exists configuracion_turnos_delete_seccion on public.configuracion_turnos$q$;
  execute $q$drop policy if exists "Auth can manage configuracion_turnos" on public.configuracion_turnos$q$;
  execute $q$create policy "Auth can manage configuracion_turnos" on public.configuracion_turnos as permissive for all to authenticated using (true) with check (true)$q$;
  execute $q$drop policy if exists "Usuarios autenticados pueden ver configuración de turnos" on public.configuracion_turnos$q$;
  execute $q$create policy "Usuarios autenticados pueden ver configuración de turnos" on public.configuracion_turnos as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$alter policy "Admins pueden actualizar configuración de turnos" on public.configuracion_turnos to public$q$;
  execute $q$alter policy "Admins pueden crear configuración de turnos" on public.configuracion_turnos to public$q$;
  execute $q$alter policy "Admins pueden eliminar configuración de turnos" on public.configuracion_turnos to public$q$;
  execute $q$grant select on public.configuracion_turnos to anon$q$;
  execute $q$grant truncate on public.configuracion_turnos to authenticated$q$;
end $r$;
-- configuracion_reservas
do $r$ begin
  if to_regclass('public.configuracion_reservas') is null then raise notice 'rollback: configuracion_reservas no existe'; return; end if;
  execute $q$drop policy if exists configuracion_reservas_select_seccion on public.configuracion_reservas$q$;
  execute $q$drop policy if exists "Authenticated users can read configuracion_reservas" on public.configuracion_reservas$q$;
  execute $q$create policy "Authenticated users can read configuracion_reservas" on public.configuracion_reservas as permissive for select to public using ((auth.uid() IS NOT NULL))$q$;
  execute $q$drop policy if exists "Only authenticated can read config" on public.configuracion_reservas$q$;
  execute $q$create policy "Only authenticated can read config" on public.configuracion_reservas as permissive for select to authenticated using (true)$q$;
  execute $q$alter policy "Admins can manage configuracion_reservas" on public.configuracion_reservas to public$q$;
  execute $q$grant truncate on public.configuracion_reservas to authenticated$q$;
end $r$;
-- chatbot_config
do $r$ begin
  if to_regclass('public.chatbot_config') is null then raise notice 'rollback: chatbot_config no existe'; return; end if;
  execute $q$drop policy if exists "Authenticated users can view chatbot config" on public.chatbot_config$q$;
  execute $q$create policy "Authenticated users can view chatbot config" on public.chatbot_config as permissive for select to authenticated using (true)$q$;
  execute $q$grant select on public.chatbot_config to anon$q$;
  execute $q$grant truncate on public.chatbot_config to authenticated$q$;
end $r$;
-- security_log
do $r$ begin
  if to_regclass('public.security_log') is null then raise notice 'rollback: security_log no existe'; return; end if;
  execute $q$drop policy if exists security_log_select_superadmin on public.security_log$q$;
  execute $q$drop policy if exists "Authenticated users can delete security logs" on public.security_log$q$;
  execute $q$create policy "Authenticated users can delete security logs" on public.security_log as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can insert security logs" on public.security_log$q$;
  execute $q$create policy "Authenticated users can insert security logs" on public.security_log as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read security logs" on public.security_log$q$;
  execute $q$create policy "Authenticated users can read security logs" on public.security_log as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can update security logs" on public.security_log$q$;
  execute $q$create policy "Authenticated users can update security logs" on public.security_log as permissive for update to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.security_log to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.security_log to authenticated$q$;
end $r$;
-- rate_limit_log
do $r$ begin
  if to_regclass('public.rate_limit_log') is null then raise notice 'rollback: rate_limit_log no existe'; return; end if;
  execute $q$drop policy if exists rate_limit_log_select_superadmin on public.rate_limit_log$q$;
  execute $q$drop policy if exists "Authenticated users can delete rate limits" on public.rate_limit_log$q$;
  execute $q$create policy "Authenticated users can delete rate limits" on public.rate_limit_log as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can insert rate limits" on public.rate_limit_log$q$;
  execute $q$create policy "Authenticated users can insert rate limits" on public.rate_limit_log as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read rate limits" on public.rate_limit_log$q$;
  execute $q$create policy "Authenticated users can read rate limits" on public.rate_limit_log as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can update rate limits" on public.rate_limit_log$q$;
  execute $q$create policy "Authenticated users can update rate limits" on public.rate_limit_log as permissive for update to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.rate_limit_log to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.rate_limit_log to authenticated$q$;
end $r$;
-- consultas_chatbot
do $r$ begin
  if to_regclass('public.consultas_chatbot') is null then raise notice 'rollback: consultas_chatbot no existe'; return; end if;
  execute $q$drop policy if exists consultas_chatbot_select_seccion on public.consultas_chatbot$q$;
  execute $q$drop policy if exists "Authenticated users can delete consultas_chatbot" on public.consultas_chatbot$q$;
  execute $q$create policy "Authenticated users can delete consultas_chatbot" on public.consultas_chatbot as permissive for delete to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can insert consultas_chatbot" on public.consultas_chatbot$q$;
  execute $q$create policy "Authenticated users can insert consultas_chatbot" on public.consultas_chatbot as permissive for insert to authenticated with check (true)$q$;
  execute $q$drop policy if exists "Authenticated users can read consultas_chatbot" on public.consultas_chatbot$q$;
  execute $q$create policy "Authenticated users can read consultas_chatbot" on public.consultas_chatbot as permissive for select to authenticated using (true)$q$;
  execute $q$drop policy if exists "Authenticated users can update consultas_chatbot" on public.consultas_chatbot$q$;
  execute $q$create policy "Authenticated users can update consultas_chatbot" on public.consultas_chatbot as permissive for update to authenticated using (true) with check (true)$q$;
  execute $q$grant select on public.consultas_chatbot to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.consultas_chatbot to authenticated$q$;
end $r$;
-- usage_events
do $r$ begin
  if to_regclass('public.usage_events') is null then raise notice 'rollback: usage_events no existe'; return; end if;
  execute $q$drop policy if exists usage_events_select_superadmin on public.usage_events$q$;
  execute $q$drop policy if exists "Authenticated users can read usage_events" on public.usage_events$q$;
  execute $q$create policy "Authenticated users can read usage_events" on public.usage_events as permissive for select to authenticated using (true)$q$;
  execute $q$grant select on public.usage_events to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.usage_events to authenticated$q$;
end $r$;
-- scope_prices
do $r$ begin
  if to_regclass('public.scope_prices') is null then raise notice 'rollback: scope_prices no existe'; return; end if;
  execute $q$drop policy if exists scope_prices_select_superadmin on public.scope_prices$q$;
  execute $q$drop policy if exists "Authenticated users can read scope_prices" on public.scope_prices$q$;
  execute $q$create policy "Authenticated users can read scope_prices" on public.scope_prices as permissive for select to authenticated using (true)$q$;
  execute $q$grant select on public.scope_prices to anon$q$;
  execute $q$grant insert, update, delete, truncate on public.scope_prices to authenticated$q$;
end $r$;
-- visitas_producto
do $r$ begin
  if to_regclass('public.visitas_producto') is null then raise notice 'rollback: visitas_producto no existe'; return; end if;
  execute $q$drop policy if exists "Autenticados pueden registrar visitas" on public.visitas_producto$q$;
  execute $q$create policy "Autenticados pueden registrar visitas" on public.visitas_producto as permissive for insert to authenticated with check (true)$q$;
  execute $q$grant insert, update, delete, truncate on public.visitas_producto to authenticated$q$;
end $r$;

commit;
