set client_encoding = 'UTF8';
-- Test de 20261105130000_proveedores_listado_sin_albaranes_facturados. BEGIN … ROLLBACK:
-- no deja nada escrito. Acaba en «proveedores_listado_sin_albaranes_facturados_test: OK».
--   npx supabase db query --linked -f supabase/tests/proveedores_listado_sin_albaranes_facturados_test.sql
--
--   T1 misma firma y permisos: anon no ejecuta, authenticated y service_role sí.
--   T2 un proveedor con una factura (600), un albarán ya facturado (100) y otro
--      sin factura (50): total_albaranes = 50 (no 150), albaranes = 2,
--      documentos = 3; total_facturas + total_albaranes = 650.
--   T3 la cifra de la lista coincide con el gasto de su ficha (ficha_proveedor_agente).
--   T4 en ningún proveedor de la base total_albaranes incluye albaranes facturados.
begin;

do $$
declare
  v_prov bigint;
  v_fac  bigint;
  v_alb1 bigint;
  v_alb2 bigint;
  r      record;
  v_n    int;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.proveedores_listado()', 'execute') then
    raise exception 'FALLO T1: anon puede ejecutar proveedores_listado';
  end if;
  if not has_function_privilege('authenticated', 'public.proveedores_listado()', 'execute')
     or not has_function_privilege('service_role', 'public.proveedores_listado()', 'execute') then
    raise exception 'FALLO T1: authenticated o service_role no pueden ejecutar proveedores_listado';
  end if;
  if position('20261105130000' in pg_get_functiondef('public.proveedores_listado()'::regprocedure)) = 0 then
    raise exception 'FALLO T1: proveedores_listado no es la de 20261105130000';
  end if;

  -- Datos ──────────────────────────────────────────────────────────────────
  insert into proveedores (nombre, cif) values ('PRUEBA LISTADO SIN FACTURADOS SL', 'B00000096') returning id into v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA LISTADO SIN FACTURADOS SL', 'B00000096', v_prov, 'FAC-96/26', '2026-10-31', 600)
  returning id into v_fac;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('albaran', 'PRUEBA LISTADO SIN FACTURADOS SL', 'B00000096', v_prov, 'ALB-96/1', '2026-10-10', 100)
  returning id into v_alb1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('albaran', 'PRUEBA LISTADO SIN FACTURADOS SL', 'B00000096', v_prov, 'ALB-96/2', '2026-10-20', 50)
  returning id into v_alb2;
  update facturas set facturado_en_id = v_fac, facturado_origen = 'manual' where id = v_alb1;
  if (select facturado_en_id from facturas where id = v_alb1) is distinct from v_fac
     or (select facturado_en_id from facturas where id = v_alb2) is not null then
    raise exception 'FALLO datos: el vínculo de los albaranes no es el esperado';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  select * into r from public.proveedores_listado() l where l.id = v_prov;
  if r.documentos <> 3 or r.facturas <> 1 or r.albaranes <> 2 then
    raise exception 'FALLO T2: recuentos % / % / %', r.documentos, r.facturas, r.albaranes;
  end if;
  if r.total_facturas <> 600 then
    raise exception 'FALLO T2: total_facturas % (esperaba 600)', r.total_facturas;
  end if;
  if r.total_albaranes <> 50 then
    raise exception 'FALLO T2: total_albaranes % (esperaba 50: el facturado no cuenta)', r.total_albaranes;
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  if (public.ficha_proveedor_agente('PRUEBA LISTADO SIN FACTURADOS SL')::jsonb ->> 'gasto')::numeric
     <> r.total_facturas + r.total_albaranes then
    raise exception 'FALLO T3: lista % frente a ficha %', r.total_facturas + r.total_albaranes,
      public.ficha_proveedor_agente('PRUEBA LISTADO SIN FACTURADOS SL')::jsonb ->> 'gasto';
  end if;

  -- Sin vínculo, el albarán vuelve a sumar.
  update facturas set facturado_en_id = null where id = v_alb1;
  if (select total_albaranes from public.proveedores_listado() l where l.id = v_prov) <> 150 then
    raise exception 'FALLO T2: sin vínculo, total_albaranes debería ser 150';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n
    from public.proveedores_listado() l
   where l.total_albaranes <> coalesce((select sum(f.total) from facturas f
                                        where f.proveedor_id = l.id and f.tipo = 'albaran'
                                          and f.facturado_en_id is null), 0);
  if v_n > 0 then
    raise exception 'FALLO T4: % proveedores con total_albaranes distinto de sus albaranes sin factura', v_n;
  end if;
end $$;

select 'proveedores_listado_sin_albaranes_facturados_test: OK' as resultado;
rollback;
