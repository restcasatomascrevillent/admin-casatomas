-- =====================================================================
-- ROLLBACK de 20260922200000_endurecer_funciones.sql
-- Restaura el estado EXACTO anterior a la migracion.
--
-- ATENCION: ejecutar esto REABRE lo que la migracion cerro:
--   - Vuelve a conceder EXECUTE a `anon` y `authenticated` sobre 8
--     funciones de trigger (update_updated_at_column, handle_new_sell_user,
--     handle_new_user_inventory, handle_new_user_role, fn_notificar_solicitud,
--     actualizar_ocupacion_diaria_espacios, update_sell_users_updated_at,
--     calcular_horas_trabajadas) y sobre has_section_permission y
--     get_user_role -- cualquiera con la anon key o un JWT de authenticated
--     vuelve a poder invocarlas por /rest/v1/rpc/<nombre>, aunque el motor
--     de triggers no las necesitaba y ningun llamador vivo las usaba
--     directamente (ver cabecera de la migracion).
--   - Vuelve a dejar el search_path de 21 funciones SECURITY DEFINER /
--     trigger sin fijar (mutable): reabre el vector de escalada por
--     search_path que la migracion cerraba en esas 21.
--
-- NO toca is_admin ni validar_capacidad_reserva -- la migracion tampoco los
-- tocaba, asi que no hay nada que revertir en ellos.
--
-- Usar solo si algo se rompio en produccion tras aplicar la migracion y hay
-- que volver atras con prisa (ver "Smoke test minimo" en la cabecera de la
-- migracion antes de asumir que hace falta este rollback).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Inverso de BLOQUE 5 (search_path = 'public') -- vuelve a NULL/mutable.
-- ---------------------------------------------------------------------

alter function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric) reset search_path;
alter function public.update_conversacion_timestamp() reset search_path;
alter function public.touch_conversacion_updated_at() reset search_path;
alter function public.set_mensajes_chat_conversacion_id() reset search_path;
alter function public.normalizar_texto(p_texto text) reset search_path;
alter function public.normalizar_proveedor(p_proveedor text) reset search_path;
alter function public.normalizar_nombre_producto(p_nombre text) reset search_path;
alter function public.gastos_periodo(fecha_inicio date, fecha_fin date) reset search_path;
alter function public.ejecutar_consulta_chatbot(query_sql text) reset search_path;
alter function public.buscar_productos_similares(query_embedding vector, limite integer) reset search_path;
alter function public.buscar_producto(termino text) reset search_path;
alter function public.buscar_facturas_por_contexto(query_embedding vector, limite integer) reset search_path;
alter function public.buscar_contexto_chatbot(embedding_query vector) reset search_path;
alter function public.actualizar_historial_precios() reset search_path;

-- ---------------------------------------------------------------------
-- Inverso de BLOQUE 4 (search_path = '') -- vuelve a NULL/mutable.
-- ---------------------------------------------------------------------

alter function public.withdraw_stock_inventory(p_product_id uuid, p_quantity integer) reset search_path;
alter function public.vinos_actualizar_exclusion_sulfitos() reset search_path;
alter function public.validate_tipo_venta() reset search_path;
alter function public.set_user_role_presets_updated_at() reset search_path;
alter function public.handle_new_user_inventory() reset search_path;
alter function public.fn_snapshot_solicitud_original() reset search_path;
alter function public.fn_notificar_solicitud() reset search_path;

-- ---------------------------------------------------------------------
-- Inverso de BLOQUE 2 (has_section_permission / get_user_role).
-- ---------------------------------------------------------------------

grant execute on function public.get_user_role(_user_id uuid) to public, anon, authenticated;
grant execute on function public.has_section_permission(_user_id uuid, _section text, _permission text) to public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Inverso de BLOQUE 1 (funciones de trigger puras).
-- ---------------------------------------------------------------------

grant execute on function public.calcular_horas_trabajadas() to public, anon, authenticated;
grant execute on function public.update_sell_users_updated_at() to public, anon, authenticated;
grant execute on function public.actualizar_ocupacion_diaria_espacios() to public, anon, authenticated;
grant execute on function public.fn_notificar_solicitud() to public, anon, authenticated;
grant execute on function public.handle_new_user_role() to public, anon, authenticated;
grant execute on function public.handle_new_user_inventory() to public, anon, authenticated;
grant execute on function public.handle_new_sell_user() to public, anon, authenticated;
grant execute on function public.update_updated_at_column() to public, anon, authenticated;

commit;
