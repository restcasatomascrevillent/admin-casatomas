set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261003193000_newsletter_resend_broadcasts.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito.
--
-- CUÁNDO: DESPUÉS de aplicar 20261003143000, 20261003171500 y 20261003193000.
-- CÓMO (como postgres; vale contra producción porque todo se deshace):
--   npx supabase db query --linked -f supabase/tests/newsletter_resend_broadcasts_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/newsletter_resend_broadcasts_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL editor (si falla un
-- ASSERT la transacción puede quedarse abierta reteniendo candados).
--
-- QUÉ CUBRE
--   A0 columnas, tabla, funciones e índices creados
--   T1 newsletter_envios: canal por defecto 'transaccional'; CHECK rechaza otro valor
--   T2 resend_broadcast_id único (dos envíos no comparten Broadcast)
--   T3 newsletter_marcar_sincronizados: guarda contact_id, '' o null -> NULL,
--      fija resend_sincronizado_at y NO toca activo/fecha_baja/origen_baja
--   T4 marcar a un dado de baja no lo reactiva (el trigger de 20261003171500 sigue mandando)
--   T5 cerrojo: solo una pasada 'en_curso' a la vez (23505 en la segunda)
--   T6 newsletter_estadisticas_broadcasts cuenta eventos y destinatarios distintos por broadcast
--   T7 permisos: marcar solo service_role; estadísticas para authenticated;
--      la tabla de pasadas no admite INSERT de authenticated y anon no la lee
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A0
do $$
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'newsletter_suscriptores' and column_name = 'resend_contact_id'),
    'A0: falta newsletter_suscriptores.resend_contact_id';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'newsletter_suscriptores' and column_name = 'resend_sincronizado_at'),
    'A0: falta newsletter_suscriptores.resend_sincronizado_at';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'newsletter_envios' and column_name = 'canal'),
    'A0: falta newsletter_envios.canal';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'newsletter_envios' and column_name = 'resend_broadcast_id'),
    'A0: falta newsletter_envios.resend_broadcast_id';
  assert to_regclass('public.newsletter_sincronizaciones_resend') is not null,
    'A0: falta la tabla newsletter_sincronizaciones_resend';
  assert to_regprocedure('public.newsletter_marcar_sincronizados(jsonb)') is not null,
    'A0: falta newsletter_marcar_sincronizados(jsonb)';
  assert to_regprocedure('public.newsletter_estadisticas_broadcasts(text[])') is not null,
    'A0: falta newsletter_estadisticas_broadcasts(text[])';
  assert to_regclass('public.newsletter_sincronizaciones_resend_una_en_curso') is not null,
    'A0: falta el índice-cerrojo newsletter_sincronizaciones_resend_una_en_curso';
  assert (select relrowsecurity from pg_class where oid = 'public.newsletter_sincronizaciones_resend'::regclass),
    'A0: newsletter_sincronizaciones_resend sin RLS';
end
$$;

-- T1
do $$
declare v_canal text;
begin
  insert into public.newsletter_envios (asunto, mensaje, total_destinatarios)
  values ('zz test t1', 'zz', 0)
  returning canal into v_canal;
  assert v_canal = 'transaccional', 'T1: el canal por defecto debería ser transaccional';

  begin
    insert into public.newsletter_envios (asunto, mensaje, canal) values ('zz test t1b', 'zz', 'sms');
    assert false, 'T1: el CHECK de canal debería rechazar ''sms''';
  exception when check_violation then
    null;
  end;
end
$$;

-- T2
do $$
begin
  insert into public.newsletter_envios (asunto, mensaje, canal, resend_broadcast_id)
  values ('zz test t2', 'zz', 'broadcast', 'zz-broadcast-test-1');
  begin
    insert into public.newsletter_envios (asunto, mensaje, canal, resend_broadcast_id)
    values ('zz test t2b', 'zz', 'broadcast', 'zz-broadcast-test-1');
    assert false, 'T2: resend_broadcast_id debería ser único';
  exception when unique_violation then
    null;
  end;
end
$$;

insert into public.newsletter_suscriptores (email, nombre, activo, origen_alta)
values ('zz-rs-test-1@example.invalid', 'zz uno', true, 'reserva_web'),
       ('zz-rs-test-2@example.invalid', 'zz dos', true, 'reserva_web');

-- T3
do $$
declare
  v1 uuid; v2 uuid; n integer; r record;
begin
  select id into v1 from public.newsletter_suscriptores where email = 'zz-rs-test-1@example.invalid';
  select id into v2 from public.newsletter_suscriptores where email = 'zz-rs-test-2@example.invalid';

  n := public.newsletter_marcar_sincronizados(jsonb_build_array(
    jsonb_build_object('id', v1, 'contact_id', 'c-zz-1'),
    jsonb_build_object('id', v2, 'contact_id', '')
  ));
  assert n = 2, format('T3: deberían marcarse 2 filas, se marcaron %s', n);

  select * into r from public.newsletter_suscriptores where id = v1;
  assert r.resend_contact_id = 'c-zz-1', 'T3: no se guardó el contact_id';
  assert r.resend_sincronizado_at is not null, 'T3: no se fijó resend_sincronizado_at';
  assert r.activo and r.fecha_baja is null and r.origen_baja is null, 'T3: marcar no debe tocar el estado de suscripción';

  select * into r from public.newsletter_suscriptores where id = v2;
  assert r.resend_contact_id is null, 'T3: contact_id vacío debería quedar NULL';

  n := public.newsletter_marcar_sincronizados(jsonb_build_array(jsonb_build_object('id', v1, 'contact_id', null)));
  select * into r from public.newsletter_suscriptores where id = v1;
  assert r.resend_contact_id is null, 'T3: contact_id null debería desvincular';

  begin
    perform public.newsletter_marcar_sincronizados('{"no": "array"}'::jsonb);
    assert false, 'T3: un objeto que no es array debería dar error';
  exception when raise_exception then
    null;
  end;
end
$$;

-- T4
do $$
declare v1 uuid; r record;
begin
  select id into v1 from public.newsletter_suscriptores where email = 'zz-rs-test-1@example.invalid';
  perform public.newsletter_registrar_baja('zz-rs-test-1@example.invalid', 'resend_baja_nativa', null);
  perform public.newsletter_marcar_sincronizados(jsonb_build_array(jsonb_build_object('id', v1, 'contact_id', 'c-zz-1')));
  select * into r from public.newsletter_suscriptores where id = v1;
  assert not r.activo, 'T4: marcar no puede reactivar a un dado de baja';
  assert r.origen_baja = 'resend_baja_nativa' and r.fecha_baja is not null, 'T4: la constancia de la baja debe seguir intacta';
end
$$;

-- T5
do $$
begin
  -- Si hay una pasada real en curso en este momento, este caso no es concluyente: se omite.
  if exists (select 1 from public.newsletter_sincronizaciones_resend where estado = 'en_curso') then
    raise notice 'T5 omitido: hay una sincronización real en curso';
    return;
  end if;
  insert into public.newsletter_sincronizaciones_resend (origen) values ('panel');
  begin
    insert into public.newsletter_sincronizaciones_resend (origen) values ('cron');
    assert false, 'T5: no debería admitirse una segunda pasada en_curso';
  exception when unique_violation then
    null;
  end;
  -- Terminada la primera, ya se puede empezar otra.
  update public.newsletter_sincronizaciones_resend set estado = 'ok', terminada_at = now() where estado = 'en_curso';
  insert into public.newsletter_sincronizaciones_resend (origen) values ('envio');
end
$$;

-- T6
do $$
declare
  v_entregados bigint; v_dest bigint; v_abiertos bigint;
begin
  insert into public.email_eventos (email_id, tipo_evento, email_destinatario, metadata) values
    ('zz-e1', 'delivered', 'a@example.invalid', '{"broadcast_id": "zz-b-1"}'),
    ('zz-e2', 'delivered', 'b@example.invalid', '{"broadcast_id": "zz-b-1"}'),
    ('zz-e3', 'opened',    'a@example.invalid', '{"broadcast_id": "zz-b-1"}'),
    ('zz-e3', 'opened',    'A@example.invalid', '{"broadcast_id": "zz-b-1"}'),
    ('zz-e4', 'delivered', 'c@example.invalid', '{"broadcast_id": "zz-b-2"}'),
    ('zz-e5', 'delivered', 'd@example.invalid', '{}');

  select eventos, destinatarios into v_entregados, v_dest
    from public.newsletter_estadisticas_broadcasts(array['zz-b-1'])
   where broadcast_id = 'zz-b-1' and tipo_evento = 'delivered';
  assert v_entregados = 2 and v_dest = 2, format('T6: delivered de zz-b-1 = %s/%s, esperado 2/2', v_entregados, v_dest);

  select destinatarios into v_abiertos
    from public.newsletter_estadisticas_broadcasts(array['zz-b-1'])
   where broadcast_id = 'zz-b-1' and tipo_evento = 'opened';
  assert v_abiertos = 1, format('T6: opened distintos de zz-b-1 = %s, esperado 1 (sin distinguir mayúsculas)', v_abiertos);

  assert not exists (select 1 from public.newsletter_estadisticas_broadcasts(array['zz-b-1']) where broadcast_id = 'zz-b-2'),
    'T6: no debería devolver broadcasts no pedidos';
end
$$;

-- T7
do $$
begin
  assert not has_function_privilege('authenticated', 'public.newsletter_marcar_sincronizados(jsonb)', 'EXECUTE'),
    'T7: authenticated no debe poder ejecutar newsletter_marcar_sincronizados';
  assert not has_function_privilege('anon', 'public.newsletter_marcar_sincronizados(jsonb)', 'EXECUTE'),
    'T7: anon no debe poder ejecutar newsletter_marcar_sincronizados';
  assert has_function_privilege('service_role', 'public.newsletter_marcar_sincronizados(jsonb)', 'EXECUTE'),
    'T7: service_role debe poder ejecutar newsletter_marcar_sincronizados';
  assert has_function_privilege('authenticated', 'public.newsletter_estadisticas_broadcasts(text[])', 'EXECUTE'),
    'T7: authenticated debe poder leer las estadísticas (la RLS de email_eventos filtra)';
  assert not has_function_privilege('anon', 'public.newsletter_estadisticas_broadcasts(text[])', 'EXECUTE'),
    'T7: anon no debe poder leer las estadísticas';
  assert not has_table_privilege('authenticated', 'public.newsletter_sincronizaciones_resend', 'INSERT'),
    'T7: authenticated no debe poder insertar pasadas';
  assert not has_table_privilege('anon', 'public.newsletter_sincronizaciones_resend', 'SELECT'),
    'T7: anon no debe poder leer las pasadas';
end
$$;

rollback;
