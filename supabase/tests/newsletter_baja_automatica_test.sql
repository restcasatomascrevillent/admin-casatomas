set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261003171500_newsletter_baja_automatica.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito.
--
-- CUÁNDO: DESPUÉS de aplicar 20261003143000 y 20261003171500 (A0 lo comprueba).
-- CÓMO (como postgres; vale contra producción porque todo se deshace):
--   npx supabase db query --linked -f supabase/tests/newsletter_baja_automatica_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/newsletter_baja_automatica_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL editor (si falla un
-- ASSERT la transacción puede quedarse abierta reteniendo candados).
--
-- QUÉ CUBRE
--   T1 dar de baja sin fecha ni origen -> se rellenan (now(), panel_manual)
--   T2 reactivar a mano (UPDATE directo) -> ERROR 23514
--   T3 mientras sigue de baja, fecha_baja y origen_baja no se pueden cambiar
--   T4 newsletter_registrar_baja: por email sin distinguir mayúsculas, solo
--      activos, devuelve filas cambiadas; idempotente
--   T5 newsletter_registrar_baja con un origen no válido -> ERROR
--   T6 una reserva con casilla marcada pero ANTERIOR a la baja no reactiva y
--      NO tumba la reserva (WARNING)
--   T7 una reserva nueva con casilla marcada SÍ reactiva (consentimiento nuevo)
--   Con 20261003184500 aplicada (doble opt-in) el alta ya no ocurre en el
--   INSERT sino al verificar el email: T6/T7 marcan email_verificado_at si la
--   columna existe, así que el fichero vale antes y después de esa migración.
--   T6/T7 usan un suscriptor creado ya de baja "ayer" (zz-nl-test-3): en una
--   transacción now() no avanza y el trigger no deja mover fecha_baja con un
--   UPDATE (la versión anterior de este test lo intentaba en T1 sin efecto, y
--   T7 fallaba porque la reserva y la baja tenían el mismo instante).
--   T8 newsletter_registrar_baja no es ejecutable por authenticated/anon
-- Reservas de prueba en 2099-07-20 (si ese día tuviera reservas reales no
-- pasa nada: se insertan dentro de la transacción y se deshacen).
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A0: migraciones aplicadas
do $$
begin
  assert to_regprocedure('public.newsletter_registrar_baja(text,text,uuid)') is not null,
    'A0: falta newsletter_registrar_baja (¿20261003171500 sin aplicar?)';
  assert exists (select 1 from pg_trigger where tgname = 'newsletter_suscriptores_proteger_baja'),
    'A0: falta el trigger newsletter_suscriptores_proteger_baja';
  assert exists (select 1 from pg_trigger
                  where tgname in ('agregar_suscriptor_al_reservar_consentida', 'newsletter_alta_reserva_verificada_upd')),
    'A0: falta el trigger de alta consentida de reservas (20260926062009 o 20261003184500)';
end
$$;

insert into public.newsletter_suscriptores (email, nombre, activo, origen_alta)
values ('zz-nl-test-1@example.invalid', 'zz test 1', true, 'reserva_web'),
       ('ZZ-NL-Test-2@example.invalid', 'zz test 2', true, 'reserva_web');
insert into public.newsletter_suscriptores (email, nombre, activo, origen_alta, fecha_baja, origen_baja)
values ('zz-nl-test-3@example.invalid', 'zz test 3', false, 'reserva_web', now() - interval '1 day', 'enlace_email');

-- Con el doble opt-in (20261003184500) el alta llega al verificar el email.
create function pg_temp.zz_nl_verificar(p_reserva uuid) returns void language plpgsql as $f$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'reservas' and column_name = 'email_verificado_at') then
    execute 'update public.reservas set email_verificado_at = now() where id = $1' using p_reserva;
  end if;
end
$f$;

-- T1
do $$
declare r record;
begin
  update public.newsletter_suscriptores set activo = false where email = 'zz-nl-test-1@example.invalid';
  select * into r from public.newsletter_suscriptores where email = 'zz-nl-test-1@example.invalid';
  assert not r.activo, 'T1: sigue activo';
  assert r.fecha_baja is not null, 'T1: fecha_baja no rellenada';
  assert r.origen_baja = 'panel_manual', 'T1: origen_baja no es panel_manual';
end
$$;

-- T2
do $$
declare v_estado text;
begin
  begin
    update public.newsletter_suscriptores set activo = true, fecha_baja = null, origen_baja = null
     where email = 'zz-nl-test-1@example.invalid';
    v_estado := 'sin error';
  exception when others then
    v_estado := sqlstate;
  end;
  assert v_estado = '23514', 'T2: reactivar a mano debería fallar con 23514, dio ' || v_estado;
end
$$;

-- T3
do $$
declare r record;
begin
  update public.newsletter_suscriptores set origen_baja = 'enlace_email', fecha_baja = null
   where email = 'zz-nl-test-1@example.invalid';
  select * into r from public.newsletter_suscriptores where email = 'zz-nl-test-1@example.invalid';
  assert r.origen_baja = 'panel_manual', 'T3: se pudo cambiar origen_baja de una baja';
  assert r.fecha_baja is not null, 'T3: se pudo borrar fecha_baja de una baja';
end
$$;

-- T4
do $$
declare n integer; r record;
begin
  n := public.newsletter_registrar_baja('zz-nl-test-2@EXAMPLE.invalid', 'queja_spam', null);
  assert n = 1, 'T4: debería dar de baja 1 fila, dio ' || n;
  select * into r from public.newsletter_suscriptores where lower(email) = 'zz-nl-test-2@example.invalid';
  assert not r.activo and r.origen_baja = 'queja_spam' and r.fecha_baja is not null, 'T4: baja mal registrada';
  n := public.newsletter_registrar_baja('zz-nl-test-2@example.invalid', 'rebote_permanente', null);
  assert n = 0, 'T4: segunda llamada no debería tocar nada';
  select * into r from public.newsletter_suscriptores where lower(email) = 'zz-nl-test-2@example.invalid';
  assert r.origen_baja = 'queja_spam', 'T4: el origen de la primera baja se sobrescribió';
end
$$;

-- T5
do $$
declare v_estado text;
begin
  begin
    perform public.newsletter_registrar_baja('zz-nl-test-2@example.invalid', 'enlace_email', null);
    v_estado := 'sin error';
  exception when others then
    v_estado := 'error';
  end;
  assert v_estado = 'error', 'T5: un origen no admitido debería fallar';
end
$$;

-- T6: casilla marcada en una reserva ANTERIOR a la baja -> no reactiva, la reserva entra
do $$
declare r record; v_reserva uuid;
begin
  insert into public.reservas (nombre, email, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente,
                               consentimiento_newsletter, created_at)
  values ('zz-nl-test T6', 'zz-nl-test-3@example.invalid', '2099-07-20', '13:30', 2, 'pendiente', 'casa_tomas', 'web',
          'zz-nl-test', true, now() - interval '2 days')
  returning id into v_reserva;
  assert v_reserva is not null, 'T6: la reserva no se insertó';
  perform pg_temp.zz_nl_verificar(v_reserva);
  select * into r from public.newsletter_suscriptores where email = 'zz-nl-test-3@example.invalid';
  assert not r.activo, 'T6: una reserva anterior a la baja reactivó al suscriptor';
  assert r.reserva_consentimiento_id is distinct from v_reserva, 'T6: se guardó el consentimiento viejo';
end
$$;

-- T7: casilla marcada en una reserva NUEVA -> reactiva
do $$
declare r record; v_reserva uuid;
begin
  insert into public.reservas (nombre, email, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente,
                               consentimiento_newsletter)
  values ('zz-nl-test T7', 'zz-nl-test-3@example.invalid', '2099-07-20', '14:00', 2, 'pendiente', 'casa_tomas', 'web',
          'zz-nl-test', true)
  returning id into v_reserva;
  perform pg_temp.zz_nl_verificar(v_reserva);
  select * into r from public.newsletter_suscriptores where email = 'zz-nl-test-3@example.invalid';
  assert r.activo, 'T7: el consentimiento nuevo no reactivó';
  assert r.fecha_baja is null and r.origen_baja is null, 'T7: quedaron restos de la baja';
  assert r.reserva_consentimiento_id = v_reserva, 'T7: no se guardó la reserva del consentimiento';
end
$$;

-- T8
do $$
begin
  assert not has_function_privilege('authenticated', 'public.newsletter_registrar_baja(text,text,uuid)', 'execute'),
    'T8: authenticated puede ejecutar newsletter_registrar_baja';
  assert not has_function_privilege('anon', 'public.newsletter_registrar_baja(text,text,uuid)', 'execute'),
    'T8: anon puede ejecutar newsletter_registrar_baja';
  assert has_function_privilege('service_role', 'public.newsletter_registrar_baja(text,text,uuid)', 'execute'),
    'T8: service_role no puede ejecutar newsletter_registrar_baja';
end
$$;

rollback;
