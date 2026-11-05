set client_encoding = 'UTF8';
-- Test de 20261105120000_vincular_albaranes_por_sentencia. BEGIN … ROLLBACK:
-- no deja nada escrito. Acaba en «vincular_albaranes_por_sentencia_test: OK».
--   npx supabase db query --linked -f supabase/tests/vincular_albaranes_por_sentencia_test.sql
--
--   T1 tres triggers FOR EACH STATEMENT y ninguno FOR EACH ROW; función
--      DEFINER sin EXECUTE para anon/authenticated.
--   T2 INSERT de una factura con 60 líneas (30 citan el albarán): vincula el
--      albarán y llama a vincular_albaranes_proveedor una sola vez.
--   T3 UPDATE de albaran_ref (a otro texto): desvincula; volver a ponerlo: vincula.
--   T4 DELETE de las líneas con albaran_ref: desvincula.
begin;

do $$
declare
  v_prov bigint;
  v_alb bigint;
  v_fac bigint;
  v_n int;
  v_t0 timestamptz;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.productos_factura'::regclass
     and tgname in ('trg_productos_factura_vincular_albaranes_ins',
                    'trg_productos_factura_vincular_albaranes_upd',
                    'trg_productos_factura_vincular_albaranes_del')
     and (tgtype & 1) = 0;            -- bit 0 = ROW; 0 → STATEMENT
  if v_n <> 3 then
    raise exception 'FALLO T1: esperaba 3 triggers por sentencia, hay %', v_n;
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.productos_factura'::regclass
                and tgfoid = 'public.trg_productos_factura_vincular_albaranes()'::regprocedure
                and (tgtype & 1) = 1) then
    raise exception 'FALLO T1: queda un trigger FOR EACH ROW de vínculo de albaranes';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.trg_productos_factura_vincular_albaranes()'::regprocedure) then
    raise exception 'FALLO T1: la función debería ser SECURITY DEFINER';
  end if;
  if has_function_privilege('authenticated', 'public.trg_productos_factura_vincular_albaranes()', 'execute')
     or has_function_privilege('anon', 'public.trg_productos_factura_vincular_albaranes()', 'execute') then
    raise exception 'FALLO T1: anon/authenticated pueden ejecutar la función del trigger';
  end if;

  -- Datos: proveedor propio, un albarán y una factura vacía.
  insert into proveedores (nombre, cif) values ('PRUEBA VINCULO SENTENCIA SL', 'B00000097') returning id into v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('albaran', 'PRUEBA VINCULO SENTENCIA SL', 'B00000097', v_prov, 'ALB-77/26', '2026-10-01', 10)
  returning id into v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA VINCULO SENTENCIA SL', 'B00000097', v_prov, 'FAC-77/26', '2026-10-31', 600)
  returning id into v_fac;
  if (select facturado_en_id from facturas where id = v_alb) is not null then
    raise exception 'FALLO datos: el albarán nace vinculado';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  v_t0 := clock_timestamp();
  insert into productos_factura (factura_id, nombre, cantidad, precio_unitario, total, albaran_ref)
  select v_fac, 'Producto ' || g, 1, 10, 10, case when g % 2 = 0 then 'ALB-77/26' end
    from generate_series(1, 60) g;
  if (select facturado_en_id from facturas where id = v_alb) is distinct from v_fac then
    raise exception 'FALLO T2: el albarán no se ha vinculado a la factura';
  end if;
  if (select facturado_origen from facturas where id = v_alb) is distinct from 'auto' then
    raise exception 'FALLO T2: facturado_origen debería ser auto';
  end if;
  raise notice 'T2: 60 líneas en % ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  -- T3 ─────────────────────────────────────────────────────────────────────
  update productos_factura set albaran_ref = 'OTRO-1' where factura_id = v_fac and albaran_ref = 'ALB-77/26';
  if (select facturado_en_id from facturas where id = v_alb) is not null then
    raise exception 'FALLO T3: al cambiar albaran_ref el albarán sigue vinculado';
  end if;
  update productos_factura set albaran_ref = 'ALB-77/26' where factura_id = v_fac and albaran_ref = 'OTRO-1';
  if (select facturado_en_id from facturas where id = v_alb) is distinct from v_fac then
    raise exception 'FALLO T3: al volver a poner albaran_ref no se vincula';
  end if;
  -- Un UPDATE que no toca albaran_ref ni factura_id no cambia nada.
  update productos_factura set nombre = nombre || ' (x)' where factura_id = v_fac;
  if (select facturado_en_id from facturas where id = v_alb) is distinct from v_fac then
    raise exception 'FALLO T3: un UPDATE de nombre ha desvinculado el albarán';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  delete from productos_factura where factura_id = v_fac and albaran_ref is not null;
  if (select facturado_en_id from facturas where id = v_alb) is not null then
    raise exception 'FALLO T4: al borrar las líneas el albarán sigue vinculado';
  end if;
end $$;

select 'vincular_albaranes_por_sentencia_test: OK' as resultado;
rollback;
