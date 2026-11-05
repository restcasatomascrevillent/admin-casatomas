set client_encoding = 'UTF8';
-- Rollback de 20261106130000_facturas_clasificacion_no_producto.sql: vuelve la lista de
-- es_linea_no_producto_tablero con «líneas» a secas (2026-11-05), recalcula la caché
-- y deja el trigger con UPDATE OF nombre, unidad. El COMMENT de
-- explorar_compras_clave se queda (es solo documentación). Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_linea_no_producto_tablero(p_nombre text, p_unidad text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select public.es_linea_servicio_agente(p_nombre)
      or coalesce(lower(p_nombre), '') ~
         '\m(envases?|jaulas?|cascos?|descuentos?|dtos?|promoci[oó]n(es)?|bonificaci[oó]n(es)?|rappels?|abonos?|alquiler(es)?|cuotas?|impuestos?|tasas?|peajes?|energ[ií]a|potencia|t[eé]rminos?|kwh|electricidad|el[eé]ctric[oa]s?|residuos?|rga|alarmas?|fibra|llamadas|l[ií]neas?|tv|bono social|almacenamiento|contador(es)?|equipo de medida|dispositivos?|cargos?|excesos?|seguros?|licencias?|suscripci[oó]n(es)?)\M'
      or lower(btrim(coalesce(p_unidad, ''))) in ('servicio', 'servicios', 'kwh', 'kw', 'kw·día', 'kw·dia', 'día', 'dia', 'días', 'dias', 'mes', 'meses')
$function$;
revoke all on function public.es_linea_no_producto_tablero(text, text) from public, anon;
grant execute on function public.es_linea_no_producto_tablero(text, text) to authenticated, service_role;

-- La lista ha cambiado: la caché se recalcula (solo cambian las entradas que
-- dicen otra cosa; ~4.100 entradas, < 1 s).
update public.nombres_linea_no_producto c
   set no_producto = public.es_linea_no_producto_tablero(c.nombre_n, c.unidad_k)
 where c.no_producto is distinct from public.es_linea_no_producto_tablero(c.nombre_n, c.unidad_k);

drop trigger if exists trg_productos_factura_no_producto on public.productos_factura;
create trigger trg_productos_factura_no_producto
  after insert or update of nombre, unidad on public.productos_factura
  for each row execute function public.productos_factura_no_producto_cache();

commit;

select 'facturas_clasificacion_no_producto: revertida' as resultado;
