set client_encoding = 'UTF8';
-- Test de 20261106130000_facturas_clasificacion_no_producto. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_clasificacion_no_producto_test: OK». Pasar también
-- analisis_rapido_test y tablero_compras_test (su T2 sigue valiendo).
--   supabase db query --linked -f supabase/tests/facturas_clasificacion_no_producto_test.sql
--
--   K1 «línea» ya no basta para «no es producto»: sí con telefonía o «línea anterior».
--   K2 la caché nombres_linea_no_producto dice lo mismo que la función (recalculada).
--   K3 el trigger de la caché salta también con nombre_normalizado.
--   K4 explorar_compras_clave: sin search_path a propósito y explicado en su COMMENT.
--   K5 permisos de es_linea_no_producto_tablero (anon no; authenticated y service_role sí).
begin;

do $$
declare
  v_n bigint;
  v_doc bigint;
begin
  -- K1 ─────────────────────────────────────────────────────────────────────
  if es_linea_no_producto_tablero('fefinanes 2025 (cod. 198068), segunda linea', 'botella')
     or es_linea_no_producto_tablero('calabacin mc c-g 5kg (linea con marca m 026067)', 'caja')
     or es_linea_no_producto_tablero('Fenomenal Verdejo Ecológico 2024 (ref. 145557), segunda línea', 'botella') then
    raise exception 'FALLO K1: un producto con «línea» en el nombre sale como no producto';
  end if;
  if not es_linea_no_producto_tablero('linea smartph neg sin lim', 'ud')
     or not es_linea_no_producto_tablero('Línea móvil empresa', 'ud')
     or not es_linea_no_producto_tablero('LINEA FIJA', 'ud')
     or not es_linea_no_producto_tablero('Líneas de datos', 'ud')
     or not es_linea_no_producto_tablero('100 % de desc. (linea anterior, fenomenal 145557)', 'ud') then
    raise exception 'FALLO K1: telefonía o «línea anterior» no salen como no producto';
  end if;
  -- Lo de siempre sigue igual.
  if not es_linea_no_producto_tablero('PORTES', 'ud') or not es_linea_no_producto_tablero('termino potencia', 'kw')
     or not es_linea_no_producto_tablero('Alquiler local', 'ud') or not es_linea_no_producto_tablero('Fibra 600MB', 'ud')
     or es_linea_no_producto_tablero('PAN DE CRISTAL', 'ud') or es_linea_no_producto_tablero('TOMATE RAF', 'kg') then
    raise exception 'FALLO K1: la lista de siempre ha cambiado';
  end if;

  -- K2 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n from nombres_linea_no_producto c
   where c.no_producto is distinct from es_linea_no_producto_tablero(c.nombre_n, c.unidad_k);
  if v_n > 0 then
    raise exception 'FALLO K2: % entradas de la caché no coinciden con la función (¿falta recalcularla?)', v_n;
  end if;
  if exists (select 1 from nombres_linea_no_producto where nombre_n like '%segunda linea%' and no_producto) then
    raise exception 'FALLO K2: la caché sigue diciendo que «segunda línea» no es producto';
  end if;

  -- K3 ─────────────────────────────────────────────────────────────────────
  if position('nombre_normalizado' in (select pg_get_triggerdef(t.oid) from pg_trigger t
                                        where t.tgrelid = 'public.productos_factura'::regclass
                                          and t.tgname = 'trg_productos_factura_no_producto')) = 0 then
    raise exception 'FALLO K3: el trigger de la caché no salta con nombre_normalizado';
  end if;
  -- Un nombre nuevo sigue entrando en la caché (al insertar y al renombrar).
  select id into v_doc from facturas order by id limit 1;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_doc, 'LINEA MOVIL PRUEBA CLASIFICACION', 1, 'ud', 5, 5);
  if not exists (select 1 from nombres_linea_no_producto where nombre_n like 'linea movil prueba clasificacion%' and no_producto) then
    raise exception 'FALLO K3: el trigger no apunta los nombres nuevos';
  end if;
  update productos_factura set nombre = 'VINO PRUEBA CLASIFICACION, SEGUNDA LINEA' where nombre = 'LINEA MOVIL PRUEBA CLASIFICACION';
  if not exists (select 1 from nombres_linea_no_producto where nombre_n like 'vino prueba clasificacion%' and not no_producto) then
    raise exception 'FALLO K3: el trigger no apunta los nombres renombrados';
  end if;

  -- K4 ─────────────────────────────────────────────────────────────────────
  if (select proconfig from pg_proc where oid = 'public.explorar_compras_clave(text,date,text,text,text,bigint,text)'::regprocedure) is not null then
    raise exception 'FALLO K4: explorar_compras_clave ya tiene SET (no se podría expandir en línea)';
  end if;
  if coalesce(obj_description('public.explorar_compras_clave(text,date,text,text,text,bigint,text)'::regprocedure, 'pg_proc'), '')
     not ilike '%search_path%inlining%' then
    raise exception 'FALLO K4: falta el COMMENT que explica por qué explorar_compras_clave no lleva search_path';
  end if;

  -- K5 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.es_linea_no_producto_tablero(text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.es_linea_no_producto_tablero(text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.es_linea_no_producto_tablero(text,text)', 'execute') then
    raise exception 'FALLO K5: permisos de es_linea_no_producto_tablero';
  end if;
  if position('20261106130000' in pg_get_functiondef('public.es_linea_no_producto_tablero(text,text)'::regprocedure)) = 0 then
    raise exception 'FALLO K5: es_linea_no_producto_tablero no es la de 20261106130000';
  end if;
end;
$$;

rollback;

select 'facturas_clasificacion_no_producto_test: OK' as resultado;
