-- ============================================================================
-- 20261107099000_categoria_conservas — Subcategoría «Conservas y salazones»
-- ----------------------------------------------------------------------------
-- En la demo se creó a mano el 05/11/2026 (id 49, dentro de «Pescado y
-- marisco»), y 20261107100000_chat_facturas_asociacion la usa en
-- terminos_agente (FK a categorias_producto.clave). En producción no existía y
-- esa migración fallaba con 23503. Misma fila que la demo (mismo id si está
-- libre). Idempotente: no hace nada si la clave ya existe.
-- Aplicar ANTES de 20261107100000. Rollback: no hace falta (borrarla dejaría
-- terminos_agente sin su categoría); si se quiere quitar, primero esos términos.
-- ============================================================================

do $$
declare v_padre bigint := (select id from public.categorias_producto where clave = 'pescado_marisco');
begin
  if exists (select 1 from public.categorias_producto where clave = 'pescado_marisco.conservas') then
    return;
  end if;
  if not exists (select 1 from public.categorias_producto where id = 49) then
    insert into public.categorias_producto (id, clave, nombre, descripcion, padre_id, orden, activa)
    overriding system value
    values (49, 'pescado_marisco.conservas', 'Conservas y salazones', null, v_padre, 30, true);
  else
    insert into public.categorias_producto (clave, nombre, descripcion, padre_id, orden, activa)
    values ('pescado_marisco.conservas', 'Conservas y salazones', null, v_padre, 30, true);
  end if;
end $$;

select setval(pg_get_serial_sequence('public.categorias_producto', 'id'),
              greatest((select max(id) from public.categorias_producto), 1));

select 'categoria_conservas: aplicada' as resultado;
