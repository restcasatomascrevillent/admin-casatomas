set client_encoding = 'UTF8';
-- Test de 20261107300000_facturas_alertas. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_alertas_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_alertas_test.sql
--
--   T1 permisos: anon y authenticated no ejecutan facturas_generar_alertas ni
--      facturas_alertas_candidatas (solo service_role); facturas_alertas_activas sí
--      (authenticated, INVOKER); generar es SECURITY DEFINER; cron instalado una vez.
--   T2 datos de prueba en 2030-2031 (hoy simulado = 25/03/2031):
--      · subida: 4 compras a 10 €/kg y una a 50 €/kg (atípica) → la de 13 €/kg avisa
--        (+30 %, alta); otro producto a +5 % no avisa.
--      · un portes a +100 % no avisa (no es producto).
--      · albarán sin factura de oct-2030 → aviso; el ya facturado no.
--      · proveedor nuevo (primer documento el 10/03/2031) → aviso.
--      · importe inusual (500 € frente a 100 € de media) → aviso; la factura que
--        agrupa albaranes no.
--   T3 generar: inserta sin duplicar (segunda pasada: 0 nuevas), conserva «leída»,
--      caduca lo que deja de cumplirse (precio corregido) y no toca otros avisos.
--   T4 activas: sin permiso de Facturas, nada; con un usuario del panel con
--      permiso, las vigentes con su enlace; filtro de periodo y de local.
--   T5 rendimiento: candidatas sobre los datos reales en < 3 s (en la demo ~0,5 s).
begin;

do $$
declare
  v_p1   bigint;  -- mayorista (subidas)
  v_p2   bigint;  -- proveedor nuevo
  v_p3   bigint;  -- importe inusual
  v_f    bigint;
  v_fsub bigint;
  v_alb  bigint;
  v_n    int;
  v_r    jsonb;
  v_t    timestamptz;
  v_uid  uuid;
  v_sid  uuid;
  v_ok   boolean := false;
  v_otro uuid;
  rec    record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_candidatas(date)', 'execute')
     or has_function_privilege('anon', 'public.facturas_alertas_activas(date,date,text)', 'execute') then
    raise exception 'FALLO T1: permisos de ejecución de más';
  end if;
  if not has_function_privilege('service_role', 'public.facturas_generar_alertas(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.facturas_alertas_activas(date,date,text)', 'execute') then
    raise exception 'FALLO T1: faltan permisos de ejecución';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.facturas_generar_alertas(date)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.facturas_alertas_activas(date,date,text)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.facturas_alertas_candidatas(date)'::regprocedure) then
    raise exception 'FALLO T1: SECURITY DEFINER/INVOKER al revés';
  end if;
  if (select count(*) from cron.job where jobname = 'facturas-alertas') <> 1 then
    raise exception 'FALLO T1: el cron facturas-alertas no está instalado una vez';
  end if;

  -- T2 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2030-06-01' and '2031-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2030-06 … 2031; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA ALERTAS MAYORISTA', 'B00000731') returning id into v_p1;
  insert into proveedores (nombre, cif) values ('PRUEBA ALERTAS NUEVO', 'B00000732') returning id into v_p2;
  insert into proveedores (nombre, cif) values ('PRUEBA ALERTAS BODEGA', 'B00000733') returning id into v_p3;

  -- Mayorista: compras de merluza (kg), aceite (l) y portes. Referencia: ene-mar 2031.
  for rec in select * from (values
      ('2031-01-05'::date, 10.0, 20.0, 5.0), ('2031-01-20', 10.0, 20.0, 5.0),
      ('2031-02-05', 50.0, 20.0, 5.0),      -- merluza atípica (> 3× la mediana): no cuenta
      ('2031-02-20', 10.0, 20.0, 5.0), ('2031-03-01', 10.0, 20.0, 5.0),
      ('2031-03-20', 13.0, 21.0, 10.0)) as t(fecha, merluza, aceite, portes) loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total, local)
    values ('factura', 'PRUEBA ALERTAS MAYORISTA', 'B00000731', v_p1, 'ALR-' || to_char(rec.fecha, 'YYYYMMDD'), rec.fecha,
            rec.merluza * 2 + rec.aceite + rec.portes, 0, rec.merluza * 2 + rec.aceite + rec.portes, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
      (v_f, 'PRUEBA MERLUZA ALERTAS', 2, 'kg', rec.merluza, rec.merluza * 2),
      (v_f, 'PRUEBA ACEITE ALERTAS', 1, 'l', rec.aceite, rec.aceite),
      (v_f, 'PORTES', 1, 'ud', rec.portes, rec.portes);
    if rec.fecha = '2031-03-20' then v_fsub := v_f; end if;
  end loop;

  -- Albarán sin factura de octubre (no hay documentos en noviembre: mes no incompleto) y uno ya facturado.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA ALERTAS MAYORISTA', 'B00000731', v_p1, 'ALR-ALB-1', '2030-10-10', 80, 'casa_tomas') returning id into v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local, facturado_en_id, facturado_origen)
  values ('albaran', 'PRUEBA ALERTAS MAYORISTA', 'B00000731', v_p1, 'ALR-ALB-2', '2030-10-12', 90, 'casa_tomas', v_fsub, 'manual');

  -- Proveedor nuevo.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ALERTAS NUEVO', 'B00000732', v_p2, 'NUEVO-1', '2031-03-10', 60, 'casa_tomas');

  -- Bodega: 4 facturas de 100 € y una de 500 € (inusual).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  select 'factura', 'PRUEBA ALERTAS BODEGA', 'B00000733', v_p3, 'BOD-' || g, ('2030-12-01'::date + g * 20), 100, 'touza'
    from generate_series(1, 4) g;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ALERTAS BODEGA', 'B00000733', v_p3, 'BOD-GRANDE', '2031-03-15', 500, 'touza');

  create temp table _c on commit drop as select * from public.facturas_alertas_candidatas('2031-03-25');

  if not exists (select 1 from _c where tipo = 'facturas_precio_sube' and datos ->> 'producto' = 'PRUEBA MERLUZA ALERTAS'
                  and (datos ->> 'precio_ref')::numeric = 10 and (datos ->> 'variacion_pct')::numeric = 30 and prioridad = 'alta'
                  and (datos ->> 'factura_id')::bigint = v_fsub and datos ->> 'medida' = 'kg' and datos ->> 'mes' = '2031-03') then
    raise exception 'FALLO T2: no sale la subida de la merluza (+30 %% sobre 10 €/kg): %',
      (select jsonb_agg(to_jsonb(c)) from _c c where c.tipo = 'facturas_precio_sube' and c.datos ->> 'proveedor_id' = v_p1::text);
  end if;
  if exists (select 1 from _c where tipo = 'facturas_precio_sube' and datos ->> 'producto' in ('PRUEBA ACEITE ALERTAS', 'PORTES')) then
    raise exception 'FALLO T2: avisa del aceite (+5 %%) o de los portes';
  end if;
  if not exists (select 1 from _c where tipo = 'facturas_albaran_sin_factura' and (datos ->> 'proveedor_id')::bigint = v_p1
                  and (datos ->> 'albaranes')::int = 1 and (datos ->> 'factura_id')::bigint = v_alb) then
    raise exception 'FALLO T2: no sale el albarán sin factura (o cuenta el facturado)';
  end if;
  if not exists (select 1 from _c where tipo = 'facturas_proveedor_nuevo' and (datos ->> 'proveedor_id')::bigint = v_p2) then
    raise exception 'FALLO T2: no sale el proveedor nuevo';
  end if;
  if exists (select 1 from _c where tipo = 'facturas_proveedor_nuevo' and (datos ->> 'proveedor_id')::bigint in (v_p1, v_p3)) then
    raise exception 'FALLO T2: un proveedor con compras de hace más de 45 días sale como nuevo';
  end if;
  if not exists (select 1 from _c where tipo = 'facturas_importe_inusual' and (datos ->> 'proveedor_id')::bigint = v_p3
                  and (datos ->> 'importe')::numeric = 500 and datos ->> 'local' = 'touza') then
    raise exception 'FALLO T2: no sale el importe inusual de la bodega';
  end if;
  if exists (select 1 from _c where clave is null or titulo is null or datos ->> 'enlace' is null or caduca_en is null) then
    raise exception 'FALLO T2: alguna alerta sin clave, título, enlace o caducidad';
  end if;
  if exists (select clave from _c group by clave having count(*) > 1) then
    raise exception 'FALLO T2: claves repetidas';
  end if;

  -- T3 generar ─────────────────────────────────────────────────────────────
  insert into notificaciones_dashboard (tipo, titulo, mensaje) values ('sistema', 'PRUEBA OTRO AVISO', 'no se toca') returning id into v_otro;
  v_r := public.facturas_generar_alertas('2031-03-25');
  if (v_r ->> 'nuevas')::int < 4 then
    raise exception 'FALLO T3: la primera pasada no inserta las alertas: %', v_r;
  end if;
  update notificaciones_dashboard set leida = true where clave like 'proveedor_nuevo:' || v_p2;
  v_r := public.facturas_generar_alertas('2031-03-25');
  if (v_r ->> 'nuevas')::int <> 0 then
    raise exception 'FALLO T3: la segunda pasada duplica: %', v_r;
  end if;
  if not (select leida from notificaciones_dashboard where clave = 'proveedor_nuevo:' || v_p2) then
    raise exception 'FALLO T3: se pierde «leída» al regenerar';
  end if;
  -- El precio se corrige: la subida deja de cumplirse y caduca.
  update productos_factura set precio_unitario = 10, total = 20 where factura_id = v_fsub and nombre = 'PRUEBA MERLUZA ALERTAS';
  v_r := public.facturas_generar_alertas('2031-03-25');
  if exists (select 1 from notificaciones_dashboard
              where tipo = 'facturas_precio_sube' and datos ->> 'producto' = 'PRUEBA MERLUZA ALERTAS'
                and (caduca_en is null or caduca_en > now() or not leida)) then
    raise exception 'FALLO T3: la subida corregida sigue vigente (o sin leer, y contaría en «Avisos»): %', v_r;
  end if;
  if not exists (select 1 from notificaciones_dashboard where id = v_otro and caduca_en is null) then
    raise exception 'FALLO T3: se ha tocado un aviso que no es de alertas de Facturas';
  end if;

  -- T4 activas ─────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  v_r := public.facturas_alertas_activas(null, null, null);
  reset role;
  if jsonb_array_length(v_r) <> 0 then
    raise exception 'FALLO T4: sin permiso de Facturas se ven % alertas', jsonb_array_length(v_r);
  end if;
  -- Un usuario real del panel con permiso de Facturas (si no hay sesiones, se salta).
  for rec in select s.user_id, s.id from auth.sessions s order by s.updated_at desc nulls last limit 30 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', rec.user_id, 'session_id', rec.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := public.can_read_section('facturas');
    reset role;
    if v_ok then v_uid := rec.user_id; v_sid := rec.id; exit; end if;
  end loop;
  if v_ok then
    set local role authenticated;
    v_r := public.facturas_alertas_activas(null, null, null);
    reset role;
    if not exists (select 1 from jsonb_array_elements(v_r) a
                    where a ->> 'tipo' = 'facturas_importe_inusual' and a -> 'datos' ->> 'enlace' like '?tab=compras%') then
      raise exception 'FALLO T4: el usuario del panel no ve el importe inusual con su enlace';
    end if;
    if exists (select 1 from jsonb_array_elements(v_r) a where a ->> 'tipo' = 'facturas_precio_sube'
                and a -> 'datos' ->> 'producto' = 'PRUEBA MERLUZA ALERTAS') then
      raise exception 'FALLO T4: se ve una alerta caducada';
    end if;
    set local role authenticated;
    v_n := jsonb_array_length(public.facturas_alertas_activas('2031-03-01', '2031-03-31', 'casa_tomas'));
    v_r := public.facturas_alertas_activas('2031-03-01', '2031-03-31', 'casa_tomas');
    reset role;
    if exists (select 1 from jsonb_array_elements(v_r) a where a -> 'datos' ->> 'local' = 'touza') then
      raise exception 'FALLO T4: el filtro de local deja pasar Touza';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_r) a where a ->> 'tipo' = 'facturas_proveedor_nuevo') then
      raise exception 'FALLO T4: el filtro de periodo quita el proveedor nuevo de marzo';
    end if;
    set local role authenticated;
    v_r := public.facturas_alertas_activas('2031-04-01', '2031-04-30', null);
    reset role;
    if exists (select 1 from jsonb_array_elements(v_r) a where a ->> 'tipo' = 'facturas_proveedor_nuevo'
                and (a -> 'datos' ->> 'proveedor_id')::bigint = v_p2) then
      raise exception 'FALLO T4: el filtro de periodo deja pasar una alerta de marzo en abril';
    end if;
  else
    raise notice 'T4: no hay ninguna sesión de un usuario con permiso de Facturas; parte de usuario saltada';
  end if;
  perform set_config('request.jwt.claims', null, true);

  -- T5 rendimiento ─────────────────────────────────────────────────────────
  v_t := clock_timestamp();
  perform count(*) from public.facturas_alertas_candidatas(current_date);
  if clock_timestamp() - v_t > interval '3 seconds' then
    raise exception 'FALLO T5: facturas_alertas_candidatas tarda %', clock_timestamp() - v_t;
  end if;
end;
$$;

rollback;

select 'facturas_alertas_test: OK' as resultado;
