set client_encoding = 'UTF8';
-- Test de 20261106150000_facturas_sin_anon. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_sin_anon_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_sin_anon_test.sql
--
--   A1 anon no tiene ningún privilegio en las tablas y vistas de Facturas.
--   A2 authenticated y service_role conservan lo suyo (select en todas).
--   A3 con el rol anon, leer facturas o productos_factura da «permission denied»
--      (antes devolvía 0 filas por la RLS).
--   A4 lo de cheques regalo no se ha tocado (sigue igual que estaba).
begin;

do $$
declare
  t     text;
  v_ok  boolean;
  tablas text[] := array[
    'facturas', 'productos_factura', 'proveedores', 'proveedores_alias',
    'productos_catalogo', 'productos_catalogo_antigua', 'productos_alias', 'categorias_producto',
    'facturas_sustituciones', 'ocr_trabajos', 'ocr_trabajo_paginas', 'productos_factura_unidades_respaldo',
    'configuracion_facturas', 'nombres_linea_no_producto',
    'chat_facturas_conversaciones', 'chat_facturas_mensajes',
    'vista_gastos_mensuales', 'vista_gastos_proveedor_mes', 'vista_productos_top', 'vista_proveedores_resumen'];
begin
  -- A1 / A2 ─────────────────────────────────────────────────────────────────
  foreach t in array tablas loop
    continue when to_regclass('public.' || t) is null;
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'FALLO A1: anon conserva algún privilegio en %', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'select')
       or not has_table_privilege('service_role', 'public.' || t, 'select') then
      raise exception 'FALLO A2: authenticated o service_role han perdido select en %', t;
    end if;
  end loop;

  -- A3 ─────────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  set local role anon;
  v_ok := false;
  begin
    perform 1 from public.facturas limit 1;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLO A3: anon puede consultar facturas';
  end if;
  v_ok := false;
  begin
    perform 1 from public.productos_factura limit 1;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'FALLO A3: anon puede consultar productos_factura';
  end if;

  -- A4 ─────────────────────────────────────────────────────────────────────
  if to_regclass('public.facturas_cheques') is not null
     and not has_table_privilege('anon', 'public.facturas_cheques', 'select') then
    raise exception 'FALLO A4: se ha tocado facturas_cheques (fuera de esta migración)';
  end if;
end;
$$;

rollback;

select 'facturas_sin_anon_test: OK' as resultado;
