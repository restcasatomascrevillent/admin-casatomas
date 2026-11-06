set client_encoding = 'UTF8';
-- ===========================================================================
-- facturas_clasificacion_no_producto · 20261106130000 · 2026-11-06
-- ===========================================================================
--
-- Fallos de QA de Facturas › Análisis («¿es producto?»):
--
--   6. es_linea_no_producto_tablero marcaba como NO producto cualquier nombre con
--      «línea»: «FEFIÑANES 2025 …, segunda línea», «CALABACÍN … (línea con marca
--      M …)». Ahora «línea» solo cuenta con contexto de telefonía (línea móvil,
--      fija, telefónica, de datos/voz, ADSL, smartphone) o «línea anterior»
--      (descuentos que se refieren a la línea de arriba). Impacto en la demo:
--      7 nombres / 8 líneas / 102,69 € pasan a producto (3 de Makro «línea con
--      marca», 4 vinos «segunda línea»); la línea de Orange sigue fuera (unidad
--      «servicio» y «línea smartph…»). Se recalcula la caché nombres_linea_no_producto.
--   7. La caché solo se actualizaba con UPDATE OF nombre, unidad: se añade
--      nombre_normalizado (columna generada del nombre).
--   8. explorar_compras_clave no lleva search_path a propósito: queda escrito en
--      su COMMENT por qué.
--
-- Idempotente. Test: supabase/tests/facturas_clasificacion_no_producto_test.sql
-- Rollback: supabase/rollbacks/20261106130000_facturas_clasificacion_no_producto_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_linea_no_producto_tablero(p_nombre text, p_unidad text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 20261106130000: «líneas» solo con contexto de telefonía (línea móvil/fija/…) o «línea anterior»
  -- (descuento de la línea de arriba); «segunda línea», «línea con marca» son producto.
  select public.es_linea_servicio_agente(p_nombre)
      or coalesce(lower(p_nombre), '') ~
         '\m(envases?|jaulas?|cascos?|descuentos?|dtos?|promoci[oó]n(es)?|bonificaci[oó]n(es)?|rappels?|abonos?|alquiler(es)?|cuotas?|impuestos?|tasas?|peajes?|energ[ií]a|potencia|t[eé]rminos?|kwh|electricidad|el[eé]ctric[oa]s?|residuos?|rga|alarmas?|fibra|llamadas|l[ií]neas? (m[oó]vil(es)?|fijas?|telef[oó]nicas?|de datos|de voz|adsl|smartph\w*)|l[ií]nea anterior|tv|bono social|almacenamiento|contador(es)?|equipo de medida|dispositivos?|cargos?|excesos?|seguros?|licencias?|suscripci[oó]n(es)?)\M'
      or lower(btrim(coalesce(p_unidad, ''))) in ('servicio', 'servicios', 'kwh', 'kw', 'kw·día', 'kw·dia', 'día', 'dia', 'días', 'dias', 'mes', 'meses')
$function$;
revoke all on function public.es_linea_no_producto_tablero(text, text) from public, anon;
grant execute on function public.es_linea_no_producto_tablero(text, text) to authenticated, service_role;

-- La lista ha cambiado: la caché se recalcula (solo cambian las entradas que
-- dicen otra cosa; ~4.100 entradas, < 1 s).
update public.nombres_linea_no_producto c
   set no_producto = public.es_linea_no_producto_tablero(c.nombre_n, c.unidad_k)
 where c.no_producto is distinct from public.es_linea_no_producto_tablero(c.nombre_n, c.unidad_k);

-- La caché se mantiene al insertar y al cambiar nombre, nombre_normalizado
-- (columna generada a partir del nombre) o unidad.
drop trigger if exists trg_productos_factura_no_producto on public.productos_factura;
create trigger trg_productos_factura_no_producto
  after insert or update of nombre, nombre_normalizado, unidad on public.productos_factura
  for each row execute function public.productos_factura_no_producto_cache();

comment on function public.explorar_compras_clave(text, date, text, text, text, bigint, text) is
  'Facturas › Análisis: clave de un hecho para un eje (día, semana, mes, trimestre, proveedor, familia, producto, local, tipo). '
  'SIN «SET search_path» A PROPÓSITO: una función SQL con SET no se puede expandir en línea (inlining) y explorar_compras / '
  'documentos_de_cifra la llaman dos veces por línea (12.500 líneas → de ~0,1 s a > 1 s). Es segura sin search_path: no lee '
  'tablas ni llama a funciones de usuario, solo a pg_catalog.to_char / date_trunc escritos con su esquema, y es SECURITY INVOKER. '
  'Si se le añade cualquier otra llamada, que vaya con su esquema (pg_catalog. / public.). 20261105170000; nota: 20261106130000.';

commit;
