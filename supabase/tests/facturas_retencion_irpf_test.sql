set client_encoding = 'UTF8';
-- Test de 20261106300000_facturas_retencion_irpf. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_retencion_irpf_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_retencion_irpf_test.sql
--
--   T1 columnas y CHECK (0 no vale; % entre 0 y 50).
--   T2 validar_cordura_factura: con la retención el cuadre base + IVA − IRPF = total no avisa;
--      sin ella (o con una que no cuadra) sí avisa, y el mensaje nombra la retención.
--   T3 documento_compras devuelve retencion_irpf y retencion_irpf_pct.
--   T4 chatbot: documento_compacto_agente y la nota de detalle_documento_agente.
--   T5 las funciones del OCR son las de esta migración.
--   T6 datos reales: toda factura con retención cuadra (±0,05 €) y ninguna avisa de IVA.
begin;

do $$
declare
  v_p   bigint;
  v_f   bigint;
  v_g   bigint;
  v_a   jsonb;
  v_j   jsonb;
  v_n   int;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'facturas'
         and column_name in ('retencion_irpf', 'retencion_irpf_pct') and data_type = 'numeric') <> 2 then
    raise exception 'FALLO T1: faltan las columnas retencion_irpf / retencion_irpf_pct';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA RETENCION ALQUILER', 'B00000301') returning id into v_p;
  begin
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total, retencion_irpf)
    values ('factura', 'PRUEBA RETENCION ALQUILER', 'B00000301', v_p, 'RET-0', '2031-05-01', 100, 21, 121, 0);
    raise exception 'FALLO T1: se admite una retención de 0 (debe ser NULL)';
  exception when check_violation then null;
  end;
  begin
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total, retencion_irpf, retencion_irpf_pct)
    values ('factura', 'PRUEBA RETENCION ALQUILER', 'B00000301', v_p, 'RET-00', '2031-05-01', 100, 21, 61, 60, 60);
    raise exception 'FALLO T1: se admite un 60 %% de retención';
  exception when check_violation then null;
  end;

  -- T2 ─────────────────────────────────────────────────────────────────────
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total,
                        retencion_irpf, retencion_irpf_pct, local)
  values ('factura', 'PRUEBA RETENCION ALQUILER', 'B00000301', v_p, 'RET-1', '2031-05-01', 750, 157.5, 765, 142.5, 19, 'casa_tomas')
  returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, 'Alquiler local', 1, 'ud', 750, 750);
  v_a := validar_cordura_factura(v_f);
  if exists (select 1 from jsonb_array_elements(v_a) a where a ->> 'codigo' = 'iva_incoherente') then
    raise exception 'FALLO T2: con retención 750 + 157,50 − 142,50 = 765 da iva_incoherente: %', v_a;
  end if;
  update facturas set retencion_irpf = null, retencion_irpf_pct = null where id = v_f;
  v_a := validar_cordura_factura(v_f);
  if not exists (select 1 from jsonb_array_elements(v_a) a where a ->> 'codigo' = 'iva_incoherente') then
    raise exception 'FALLO T2: sin retención no avisa de 750 + 157,50 ≠ 765';
  end if;
  update facturas set retencion_irpf = 100 where id = v_f;
  select a into v_j from jsonb_array_elements(validar_cordura_factura(v_f)) a where a ->> 'codigo' = 'iva_incoherente';
  if v_j is null or position('retencion IRPF' in v_j ->> 'mensaje') = 0
     or (v_j -> 'detalle' ->> 'esperado')::numeric <> 807.5 or (v_j -> 'detalle' ->> 'retencion_irpf')::numeric <> 100 then
    raise exception 'FALLO T2: una retención que no cuadra no se explica: %', v_j;
  end if;
  update facturas set retencion_irpf = 142.5, retencion_irpf_pct = 19 where id = v_f;

  -- T3 ─────────────────────────────────────────────────────────────────────
  v_j := documento_compras(v_f)::jsonb;
  if (v_j ->> 'retencion_irpf')::numeric <> 142.5 or (v_j ->> 'retencion_irpf_pct')::numeric <> 19 then
    raise exception 'FALLO T3: documento_compras sin retención: %', v_j;
  end if;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total, local)
  values ('factura', 'PRUEBA RETENCION ALQUILER', 'B00000301', v_p, 'RET-2', '2031-05-02', 10, 2.1, 12.1, 'casa_tomas')
  returning id into v_g;
  v_j := documento_compras(v_g)::jsonb;
  if not (v_j ? 'retencion_irpf') or (v_j -> 'retencion_irpf') <> 'null'::jsonb then
    raise exception 'FALLO T3: sin retención documento_compras debe traer retencion_irpf null: %', v_j;
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  select documento_compacto_agente(f) into v_j from facturas f where f.id = v_f;
  if (v_j ->> 'retencion_irpf')::numeric <> 142.5 or v_j ? 'retencion_irpf_pct' then
    raise exception 'FALLO T4: documento_compacto_agente (lista): %', v_j;
  end if;
  select documento_compacto_agente(f, true) into v_j from facturas f where f.id = v_f;
  if (v_j ->> 'retencion_irpf_pct')::numeric <> 19 then
    raise exception 'FALLO T4: documento_compacto_agente (detalle) sin %%: %', v_j;
  end if;
  select documento_compacto_agente(f) into v_j from facturas f where f.id = v_g;
  if v_j ? 'retencion_irpf' then
    raise exception 'FALLO T4: sin retención no debe salir la clave: %', v_j;
  end if;
  v_j := detalle_documento_agente(v_f)::jsonb;
  if position('retencion IRPF de 142.50' in v_j ->> 'nota') = 0 or position('19.00 %' in v_j ->> 'nota') = 0 then
    raise exception 'FALLO T4: la nota del detalle no explica la retención: %', v_j ->> 'nota';
  end if;
  if position('retencion' in detalle_documento_agente(v_g)::jsonb ->> 'nota') > 0 then
    raise exception 'FALLO T4: la nota habla de retención en un documento sin ella';
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  if position('20261106300000' in pg_get_functiondef('public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0
     or position('20261106300000' in pg_get_functiondef('public.ocr_anadir_pagina(bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0
     or position('20261106300000' in pg_get_functiondef('public.validar_cordura_factura(bigint)'::regprocedure)) = 0 then
    raise exception 'FALLO T5: alguna función no es la de 20261106300000';
  end if;
  if has_function_privilege('anon', 'public.documento_compras(bigint)', 'execute') then
    raise exception 'FALLO T5: anon puede ejecutar documento_compras';
  end if;

  -- T6 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n
    from facturas f
   where f.retencion_irpf is not null and f.id not in (v_f, v_g)
     and f.subtotal is not null and f.iva is not null and f.total is not null
     and abs(f.subtotal + f.iva - f.retencion_irpf - f.total) > 0.05;
  if v_n > 0 then
    raise exception 'FALLO T6: % factura(s) con retención que no cuadran', v_n;
  end if;
  select count(*) into v_n
    from facturas f
   where f.retencion_irpf is not null and f.alertas_validacion::text like '%iva_incoherente%';
  if v_n > 0 then
    raise exception 'FALLO T6: % factura(s) con retención siguen con iva_incoherente (¿falta recalcular_alertas_factura?)', v_n;
  end if;
end;
$$;

rollback;

select 'facturas_retencion_irpf_test: OK' as resultado;
