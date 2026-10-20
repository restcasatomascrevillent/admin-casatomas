set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20260930211000_email_reserva_modificada.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni la reserva de prueba, ni sus envíos).
--
-- QUÉ COMPRUEBA (lo que depende de la BD y no pueden ver las pruebas de
-- vitest, que usan un doble en memoria):
--   A0 la migración está aplicada (CHECK, índice, columnas y plantilla v1);
--   B  los otros correos siguen siendo UNO por (reserva, tipo): una segunda
--      'confirmada' activa salta con 23505, y una 'fallido' no ocupa el hueco;
--   C  los avisos de cambio: dos con claves distintas conviven, la misma clave
--      activa dos veces salta con 23505, una 'fallido' libera su clave, y un
--      aviso no choca con la 'confirmada' de la misma reserva;
--   D  los CHECK: 'reserva_modificada' sin clave_aviso, otro tipo con
--      clave_aviso o un tipo inventado (en envíos y en plantillas) se rechazan.
--
-- CUÁNDO: DESPUÉS de aplicar la migración (A0 aborta si no lo está).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace y no toca ninguna
-- fila existente), como `postgres`, con:
--   npx supabase db query --linked -f supabase/tests/email_reserva_modificada.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/email_reserva_modificada.sql
-- Si termina sin ERROR, todo ha pasado: lo último que devuelve es la
-- comprobación de LIMPIEZA, que corre ya fuera de la transacción.
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) y retener sus candados sobre `reservas` y
-- `envios_email_reserva`. Si pasara: buscar la sesión en pg_stat_activity
-- (state = 'idle in transaction (aborted)') y pg_terminate_backend(pid).
-- Si se corta a medias con psql o db query, la conexión se cierra y se
-- deshace todo, pero la LIMPIEZA no llega a correr; comprobarla a mano:
--   select count(*) from public.reservas where nombre = 'zz-test-email-modificada';          -- -> 0
--   select count(*) from public.envios_email_reserva where destinatario = 'zz-test@correo.invalid'; -- -> 0
--
-- QUÉ MONTA (dentro de la transacción): UNA reserva CANCELADA en un día
-- lejano, 2099-07-15. Esa fecha está en DOS sitios: el `set local` de justo
-- después del BEGIN y, escrita tal cual, la LIMPIEZA del final (que corre tras
-- el ROLLBACK y no puede leer ningún parámetro de sesión: con `db query -f`
-- todo el fichero va en un solo mensaje y el ROLLBACK deshace también los
-- SET). Si A0 dice que ese día tiene reservas, cambiarla en los dos sitios.
-- Cancelada a propósito: no
-- ocupa plaza, así que el trigger de aforo no la comprueba (con o sin la
-- migración de aforo 20260930212000). Sin consentimiento de newsletter: el
-- trigger de suscripción no salta. Los envíos van a una dirección .invalid,
-- y no se llama a Resend ni a ninguna Edge Function: esto solo escribe filas.
--
-- Candados: filas nuevas y el candado de escritura normal (ROW EXCLUSIVE)
-- sobre `reservas`, `envios_email_reserva` y `plantillas_email_reserva`; no
-- frena a nadie salvo al DDL sobre esas tablas mientras dure.
-- lock_timeout/statement_timeout por si acaso.
--
-- ESTADO: escrito el 2026-09-30 y SIN EJECUTAR (la migración tampoco está
-- aplicada, y no hay Postgres local en la máquina donde se escribió). Los
-- nombres de los CHECK y del índice están comprobados contra producción, solo
-- con SELECT.
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Día de pruebas (si se cambia, cambiar también la fecha literal de la LIMPIEZA).
set local email_mod_test.dia = '2099-07-15';

-- ---------------------------------------------------------------------------
-- A0 la migración está aplicada y el día de pruebas está vacío
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
  n int;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint
  where conrelid = 'public.envios_email_reserva'::regclass and conname = 'envios_email_reserva_tipo_email_check';
  assert coalesce(v, '') like '%reserva_modificada%',
    'A0a: la migración 20260930211000 NO está aplicada (el CHECK de envios_email_reserva.tipo_email no admite reserva_modificada). Aplícala antes de ejecutar esto.';

  select pg_get_constraintdef(oid) into v from pg_constraint
  where conrelid = 'public.plantillas_email_reserva'::regclass and conname = 'plantillas_email_reserva_tipo_check';
  assert coalesce(v, '') like '%reserva_modificada%', format('A0b: CHECK de plantillas_email_reserva.tipo inesperado: %s', v);

  select pg_get_constraintdef(oid) into v from pg_constraint
  where conrelid = 'public.envios_email_reserva'::regclass and conname = 'envios_email_reserva_clave_aviso_solo_modificada';
  assert v is not null, 'A0c: falta el CHECK envios_email_reserva_clave_aviso_solo_modificada';

  select indexdef into v from pg_indexes where schemaname = 'public' and indexname = 'uq_envio_email_reserva_activo';
  assert coalesce(v, '') like 'CREATE UNIQUE INDEX uq_envio_email_reserva_activo ON public.envios_email_reserva USING btree (reserva_id, tipo_email, COALESCE(clave_aviso, %',
    format('A0d: el índice único no es el esperado: %s', v);

  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'envios_email_reserva' and column_name in ('clave_aviso', 'detalle');
  assert n = 2, format('A0e: faltan columnas nuevas en envios_email_reserva (hay %s de 2)', n);

  select count(*) into n from public.plantillas_email_reserva where tipo = 'reserva_modificada' and es_actual;
  assert n = 1, format('A0f: debe haber UNA plantilla reserva_modificada vigente y hay %s', n);

  select count(*) into n from public.reservas where fecha = current_setting('email_mod_test.dia')::date;
  assert n = 0,
    format('A0g: el día de pruebas %s ya tiene %s reservas: cambia la fecha del set local de después del BEGIN y la de la LIMPIEZA',
           current_setting('email_mod_test.dia'), n);
end
$$;

-- ---------------------------------------------------------------------------
-- MONTAJE (todo se deshace con el ROLLBACK final)
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-email-modificada', current_setting('email_mod_test.dia')::date, '21:00', 2, 'cancelada',
          'casa_tomas', 'manual', 'zz-test-email-modificada')
  returning id into v_id;
  perform set_config('email_mod_test.reserva', v_id::text, true);
end
$$;

-- ---------------------------------------------------------------------------
-- B los demás correos siguen siendo UNO por (reserva, tipo)
-- ---------------------------------------------------------------------------
do $$
declare v uuid := current_setting('email_mod_test.reserva')::uuid;
begin
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado)
  values (v, 'confirmada', 'zz-test@correo.invalid', 'enviado');

  begin
    insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado)
    values (v, 'confirmada', 'zz-test@correo.invalid', 'pendiente');
    assert false, 'B1: una segunda confirmada activa (pendiente|enviado) de la misma reserva debía saltar con 23505 (uq_envio_email_reserva_activo)';
  exception when unique_violation then
    null; -- esperado
  end;

  -- B2: una 'fallido' no ocupa el hueco (como antes de la migración).
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado)
  values (v, 'confirmada', 'zz-test@correo.invalid', 'fallido');
end
$$;

-- ---------------------------------------------------------------------------
-- C los avisos de «reserva modificada»
-- ---------------------------------------------------------------------------
do $$
declare
  v uuid := current_setting('email_mod_test.reserva')::uuid;
  n int;
begin
  -- C1: dos avisos con claves distintas (dos cambios sucesivos) conviven.
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso, detalle)
  values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'enviado', '2099-07-15|21:30|2|tras:ninguno', '{}'::jsonb);
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso, detalle)
  values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'pendiente', '2099-07-15|22:00|2|tras:aviso-1', '{}'::jsonb);

  -- C2: el MISMO aviso dos veces (doble clic, dos peticiones a la vez) salta con 23505.
  begin
    insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso, detalle)
    values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'pendiente', '2099-07-15|21:30|2|tras:ninguno', '{}'::jsonb);
    assert false, 'C2: el mismo aviso (misma clave_aviso) activo dos veces debía saltar con 23505';
  exception when unique_violation then
    null; -- esperado
  end;

  -- C3: un aviso 'fallido' libera su clave (el reintento del cron es un UPDATE de esa misma fila).
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso, detalle)
  values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'fallido', '2099-07-15|23:00|2|tras:aviso-2', '{}'::jsonb);
  insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso, detalle)
  values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'pendiente', '2099-07-15|23:00|2|tras:aviso-2', '{}'::jsonb);

  -- C4: nada de esto chocó con la 'confirmada' de la misma reserva (B).
  select count(*) into n from public.envios_email_reserva
  where reserva_id = v and resultado in ('pendiente', 'enviado');
  assert n = 4, format('C4: debía haber 4 envíos activos de la reserva de prueba (1 confirmada + 3 avisos) y hay %s', n);
end
$$;

-- ---------------------------------------------------------------------------
-- D los CHECK
-- ---------------------------------------------------------------------------
do $$
declare v uuid := current_setting('email_mod_test.reserva')::uuid;
begin
  begin
    insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado)
    values (v, 'reserva_modificada', 'zz-test@correo.invalid', 'fallido');
    assert false, 'D1: un reserva_modificada SIN clave_aviso debía saltar con 23514';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado, clave_aviso)
    values (v, 'recordatorio', 'zz-test@correo.invalid', 'fallido', 'x');
    assert false, 'D2: otro tipo CON clave_aviso debía saltar con 23514 (le cambiaría su idempotencia)';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.envios_email_reserva (reserva_id, tipo_email, destinatario, resultado)
    values (v, 'inventado', 'zz-test@correo.invalid', 'fallido');
    assert false, 'D3: un tipo_email inventado debía saltar con 23514';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.plantillas_email_reserva (tipo, version, es_actual, asunto, saludo, cuerpo)
    values ('inventado', 1, false, 'x', 'x', 'x');
    assert false, 'D4: una plantilla de tipo inventado debía saltar con 23514';
  exception when check_violation then
    null;
  end;
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (ya fuera de la transacción): no queda nada de la prueba.
-- Con IF/RAISE y no con ASSERT: el check_asserts de arriba era SET LOCAL y se
-- ha ido con el ROLLBACK. Por la misma razón NO lee ningún parámetro de
-- sesión: la fecha va escrita tal cual (la del `set local` de arriba) y las
-- filas de prueba se cuentan también por su nombre, sus notas y su dirección.
-- ---------------------------------------------------------------------------
do $$
declare
  n_reservas int;
  n_envios   int;
begin
  select count(*) into n_reservas from public.reservas
  where nombre like 'zz-test-email-modificada%'
     or notas_cliente like 'zz-test-email-modificada%'
     or fecha = date '2099-07-15';
  select count(*) into n_envios from public.envios_email_reserva where destinatario = 'zz-test@correo.invalid';
  if n_reservas <> 0 or n_envios <> 0 then
    raise exception 'LIMPIEZA: tras el ROLLBACK quedan % reservas y % envíos de la prueba: revisarlo a mano', n_reservas, n_envios;
  end if;
end
$$;

select 'email_reserva_modificada: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
