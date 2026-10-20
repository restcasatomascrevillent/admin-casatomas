set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20260930212000_aforo_permite_ediciones_sin_subir_ocupacion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni reservas, ni salas, ni ocupacion_diaria).
--
-- CUÁNDO: DESPUÉS de aplicar la migración. La prueba A0 lo comprueba y aborta
-- si no está aplicada.
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace y no toca ninguna
-- fila existente), como `postgres`, con:
--   npx supabase db query --linked -f supabase/tests/aforo_ediciones.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/aforo_ediciones.sql
-- Si termina sin ERROR, todo ha pasado: lo último que devuelve es la
-- comprobación de LIMPIEZA, que corre ya después del ROLLBACK y exige que no
-- quede ninguna reserva ni sala «zz-test-aforo…» (el nombre que llevan
-- todas las filas de prueba) ni ninguna reserva el 2099-06-10/11. No lee
-- ningún SET: con `db query`, el SQL editor o `psql -1` todo el fichero va
-- en una transacción y el ROLLBACK también deshace los SET.
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) en la sesión del editor y retener los candados de
-- escritura que tomó sobre `reservas` y `espacios_reserva`, que bloquean,
-- por ejemplo, la propia migración o su rollback. Si pasara, cerrar esa
-- sesión: buscarla en pg_stat_activity (state = 'idle in transaction
-- (aborted)') y pg_terminate_backend(pid).
-- Si se corta a medias con psql o db query, la conexión se cierra y se
-- deshace todo, pero la LIMPIEZA del final no llega a correr; comprobarla a
-- mano:
--   select count(*) from public.reservas where nombre like 'zz-test-aforo%';           -- -> 0
--   select count(*) from public.reservas where fecha in ('2099-06-10', '2099-06-11');  -- -> 0
--   select count(*) from public.espacios_reserva where nombre like 'zz-test-aforo%';     -- -> 0
--
-- QUÉ MONTA (dentro de la transacción): un día de pruebas lejano y vacío
-- (aforo_test.dia, 2099-06-10; si A0 dice que tiene reservas, cambia la
-- fecha en el SET LOCAL de justo después del BEGIN y también las dos fechas
-- escritas en la LIMPIEZA del final) y dos salas de prueba de 10 plazas,
-- una por negocio.
-- La comida de Casa Tomás se llena hasta el aforo con la sala de prueba
-- activa y después se desactiva la sala: el turno queda 10 plazas POR
-- ENCIMA del aforo, que es justo el caso del defecto («desactivar una sala
-- baja el aforo»). La cena de ese día y la comida del día siguiente se
-- llenan justo hasta el aforo. Las capacidades se leen de la tabla en el
-- momento: no dependen de cuántas salas haya hoy.
--
-- Candados: filas nuevas, el advisory lock de ese día lejano y el candado
-- de escritura normal (ROW EXCLUSIVE) sobre `reservas` y `espacios_reserva`.
-- No frena las altas ni las ediciones de nadie, pero sí el DDL sobre esas
-- tablas mientras la transacción siga abierta (de ahí lo del SQL editor).
-- lock_timeout/statement_timeout por si acaso.
--
-- ESTADO: escrito el 2026-09-30 y SIN EJECUTAR (la migración tampoco está
-- aplicada, y no hay Postgres local en la máquina donde se escribió). Lo que
-- sí está comprobado contra producción, solo con SELECT: las columnas NOT
-- NULL y los defaults de `reservas` y `espacios_reserva`, los demás
-- triggers de las dos tablas (ninguno sale de la transacción) y la regla
-- del paso 0b evaluada caso a caso sobre una tabla VALUES.
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Día de pruebas (y el siguiente). Si se cambia aquí, cambiar también las
-- dos fechas escritas en la LIMPIEZA del final (que no puede leer esto: el
-- ROLLBACK se lo lleva).
set local aforo_test.dia = '2099-06-10';

-- ---------------------------------------------------------------------------
-- A0 la migración está aplicada, la función sigue como debe y el día está vacío
-- ---------------------------------------------------------------------------
do $$
declare
  d        date := current_setting('aforo_test.dia')::date;
  v_src    text;
  v_secdef boolean;
  v_conf   text[];
  v_owner  text;
  v_trig   text;
  n        int;
begin
  select p.prosrc, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)
    into v_src, v_secdef, v_conf, v_owner
  from pg_proc p
  where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;

  assert position('NEW.numero_comensales <= OLD.numero_comensales' in v_src) > 0,
    'A0a: la migración 20260930212000 NO está aplicada (falta el paso 0b en validar_capacidad_reserva). Aplícala antes de ejecutar esto.';
  assert v_secdef = false, 'A0b: validar_capacidad_reserva debía seguir SECURITY INVOKER';
  assert v_conf = array['search_path=public'], format('A0c: search_path inesperado: %s', v_conf);
  assert v_owner = 'postgres', format('A0d: propietario inesperado: %s', v_owner);

  select pg_get_triggerdef(t.oid) into v_trig
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';
  assert v_trig like 'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()',
    format('A0e: el trigger no es el esperado (debe saltar también con marca): %s', v_trig);

  select count(*) into n from public.reservas where fecha in (d, d + 1);
  assert n = 0,
    format('A0f: el día de pruebas %s (o el siguiente) ya tiene %s reservas: cambia aforo_test.dia (justo después del BEGIN) y las dos fechas de la LIMPIEZA del final', d, n);

  select coalesce(sum(capacidad_maxima), 0) into n
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  assert n > 0, 'A0g: Casa Tomás no tiene ninguna sala activa; sin aforo no se puede montar la prueba';
end
$$;

-- ---------------------------------------------------------------------------
-- MONTAJE (todo se deshace con el ROLLBACK final)
-- ---------------------------------------------------------------------------
do $$
declare
  d      date := current_setting('aforo_test.dia')::date;
  cap_ct int;
  cap_tz int;
  v_id   uuid;
begin
  -- Aforo de hoy de cada negocio: la misma cuenta que el paso 1 del trigger.
  select coalesce(sum(capacidad_maxima), 0) into cap_ct
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  select coalesce(sum(capacidad_maxima), 0) into cap_tz
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'touza';
  perform set_config('aforo_test.cap_ct', cap_ct::text, true);
  perform set_config('aforo_test.cap_tz', (cap_tz + 10)::text, true);

  -- Salas de prueba de 10 plazas. La de Casa Tomás se desactiva más abajo;
  -- la de Touza garantiza hueco en Touza aunque hoy no tuviera salas.
  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-aforo sala casa_tomas', 10, true, jsonb_build_object('marca', 'casa_tomas'))
  returning id into v_id;
  perform set_config('aforo_test.sala_ct', v_id::text, true);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-aforo sala touza', 10, true, jsonb_build_object('marca', 'touza'));

  -- Casa Tomás, COMIDA del día d, justo hasta cap_ct + 10 con la sala de prueba activa.
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo ct_a', d, '13:00', 4, 'pendiente', 'casa_tomas', 'manual', 'zz-test-aforo')
  returning id into v_id;
  perform set_config('aforo_test.ct_a', v_id::text, true);

  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo ct_c', d, '16:30', 2, 'confirmada', 'casa_tomas', 'manual', 'zz-test-aforo')
  returning id into v_id;
  perform set_config('aforo_test.ct_c', v_id::text, true);

  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo relleno comida', d, '14:00', cap_ct + 10 - 6, 'confirmada', 'casa_tomas', 'manual', 'zz-test-aforo');

  -- Cancelada: no ocupa plaza, se inserta sin comprobar el aforo.
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo ct_b', d, '13:15', 2, 'cancelada', 'casa_tomas', 'manual', 'zz-test-aforo')
  returning id into v_id;
  perform set_config('aforo_test.ct_b', v_id::text, true);

  -- Se desactiva la sala de prueba: el aforo de Casa Tomás baja a cap_ct y
  -- la comida del día d queda 10 plazas POR ENCIMA.
  update public.espacios_reserva set activa = false
  where id = current_setting('aforo_test.sala_ct')::uuid;

  -- Casa Tomás, CENA del día d y COMIDA del día d + 1: justo en el aforo.
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo relleno cena', d, '21:00', cap_ct, 'confirmada', 'casa_tomas', 'manual', 'zz-test-aforo');
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo relleno comida d+1', d + 1, '13:00', cap_ct, 'confirmada', 'casa_tomas', 'manual', 'zz-test-aforo');

  -- Touza, día d: comida con 2 y una cancelada en la cena.
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo tz_a', d, '13:00', 2, 'pendiente', 'touza', 'manual', 'zz-test-aforo')
  returning id into v_id;
  perform set_config('aforo_test.tz_a', v_id::text, true);

  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo tz_b', d, '21:00', 2, 'cancelada', 'touza', 'manual', 'zz-test-aforo')
  returning id into v_id;
  perform set_config('aforo_test.tz_b', v_id::text, true);
end
$$;

-- ---------------------------------------------------------------------------
-- A1 el montaje ha quedado como se espera (misma cuenta que el trigger)
-- ---------------------------------------------------------------------------
do $$
declare
  d      date := current_setting('aforo_test.dia')::date;
  cap_ct int  := current_setting('aforo_test.cap_ct')::int;
  cap_tz int  := current_setting('aforo_test.cap_tz')::int;
  n      int;
begin
  select coalesce(sum(capacidad_maxima), 0) into n
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  assert n = cap_ct, format('A1a: aforo de Casa Tomás %s, se esperaba %s', n, cap_ct);

  select coalesce(sum(capacidad_maxima), 0) into n
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'touza';
  assert n = cap_tz, format('A1b: aforo de Touza %s, se esperaba %s', n, cap_tz);

  select coalesce(sum(numero_comensales), 0) into n from public.reservas
  where fecha = d and marca = 'casa_tomas' and hora < '17:00'
    and estado in ('pendiente', 'verificada', 'confirmada');
  assert n = cap_ct + 10, format('A1c: comida de Casa Tomás con %s, se esperaba %s (10 por encima del aforo)', n, cap_ct + 10);

  select coalesce(sum(numero_comensales), 0) into n from public.reservas
  where fecha = d and marca = 'casa_tomas' and hora >= '17:00'
    and estado in ('pendiente', 'verificada', 'confirmada');
  assert n = cap_ct, format('A1d: cena de Casa Tomás con %s, se esperaba %s (justo en el aforo)', n, cap_ct);

  select coalesce(sum(numero_comensales), 0) into n from public.reservas
  where fecha = d + 1 and marca = 'casa_tomas' and hora < '17:00'
    and estado in ('pendiente', 'verificada', 'confirmada');
  assert n = cap_ct, format('A1e: comida de Casa Tomás del día siguiente con %s, se esperaba %s', n, cap_ct);
end
$$;

-- ---------------------------------------------------------------------------
-- A2 el INSERT no cambia: una reserva NUEVA en el turno pasado de aforo se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
    values ('zz-test-aforo nueva', current_setting('aforo_test.dia')::date, '13:45', 1, 'pendiente', 'casa_tomas', 'manual', 'zz-test-aforo');
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('A2: un alta en el turno pasado de aforo debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E1 turno pasado de aforo + REDUCIR comensales (4 → 3): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int; v_n int;
begin
  begin
    update public.reservas set numero_comensales = 3
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E1: reducir comensales en un turno pasado de aforo debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E1: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
  select numero_comensales into v_n from public.reservas where id = current_setting('aforo_test.ct_a')::uuid;
  assert v_n = 3, format('E1: se esperaban 3 comensales, hay %s', v_n);
end
$$;

-- ---------------------------------------------------------------------------
-- E2 mover la hora DENTRO del mismo turno (13:00 → 15:30, mismos comensales): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas set hora = '15:30'
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E2: mover la hora dentro del turno debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E2: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;

-- ---------------------------------------------------------------------------
-- E3 mover la hora y reducir a la vez (15:30 → 13:30, 3 → 2): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas set hora = '13:30', numero_comensales = 2
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E3: mover dentro del turno y reducir debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E3: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;

-- ---------------------------------------------------------------------------
-- E4 reenviar las columnas del trigger SIN cambiarlas (un UPDATE de fila
--    entera, con marca incluida): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas
       set fecha = fecha, hora = hora, numero_comensales = numero_comensales,
           estado = estado, marca = marca
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E4: reenviar las columnas sin cambiarlas debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E4: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;

-- ---------------------------------------------------------------------------
-- E5 pasar entre estados vivos (pendiente → verificada → confirmada): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text;
begin
  begin
    update public.reservas set estado = 'verificada' where id = current_setting('aforo_test.ct_a')::uuid;
    update public.reservas set estado = 'confirmada' where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E5: verificar/confirmar una reserva viva en un turno pasado de aforo debía PERMITIRSE; ha dado: %s', v_err);
  assert (select estado from public.reservas where id = current_setting('aforo_test.ct_a')::uuid) = 'confirmada',
    'E5: la reserva debía quedar confirmada';
end
$$;

-- ---------------------------------------------------------------------------
-- E6 cambiar SOLO el nombre (y las notas): se permite (el trigger ni salta)
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas
       set nombre = 'zz-test-aforo ct_a (renombrada)', notas_cliente = 'zz-test-aforo, otra nota'
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E6: cambiar solo el nombre debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E6: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;

-- ---------------------------------------------------------------------------
-- E7 SUBIR comensales (2 → 3) en el turno pasado de aforo: se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    update public.reservas set numero_comensales = 3
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E7: subir comensales en un turno pasado de aforo debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E8 subir comensales Y mover dentro del turno (13:30 → 14:30, 2 → 5): se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    update public.reservas set hora = '14:30', numero_comensales = 5
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E8: subir comensales moviendo la hora dentro del turno debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E9 mover a OTRO TURNO lleno (la cena del día d, 21:30): se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    update public.reservas set hora = '21:30'
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E9: mover a otro turno lleno debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E10 mover a OTRO DÍA lleno (la comida del día d + 1): se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    update public.reservas set fecha = current_setting('aforo_test.dia')::date + 1
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E10: mover a otro día lleno debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E11 mover a otro turno CON hueco (la cena del día d + 1): se permite
--     (se deshace después para seguir con la reserva en su sitio)
-- ---------------------------------------------------------------------------
savepoint e11;
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas set fecha = current_setting('aforo_test.dia')::date + 1, hora = '21:00'
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E11: mover a un turno con hueco debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E11: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;
rollback to savepoint e11;

-- ---------------------------------------------------------------------------
-- E12 el corte de las 17:00 (ct_c, 16:30, comida): 16:30 → 16:59 es el
--     mismo turno y se permite; 16:59 → 17:00 ya es la cena (llena) y se rechaza
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_estado text; v_msg text;
begin
  begin
    update public.reservas set hora = '16:59'
    where id = current_setting('aforo_test.ct_c')::uuid;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E12a: 16:30 → 16:59 (mismo turno) debía PERMITIRSE; ha dado: %s', v_err);

  begin
    update public.reservas set hora = '17:00'
    where id = current_setting('aforo_test.ct_c')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E12b: 16:59 → 17:00 es cambiar a la cena (llena) y debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E13 pasar de CANCELADA a viva en el turno pasado de aforo: se rechaza
--     (es añadir ocupación)
-- ---------------------------------------------------------------------------
do $$
declare v_estado text; v_msg text;
begin
  begin
    update public.reservas set estado = 'pendiente'
    where id = current_setting('aforo_test.ct_b')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E13: pasar de cancelada a viva en un turno pasado de aforo debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- E14 editar una reserva que NO ocupa plaza (sigue cancelada) aunque vaya a
--     un turno lleno y con más comensales: se permite, como siempre
-- ---------------------------------------------------------------------------
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas set hora = '21:15', numero_comensales = 6
    where id = current_setting('aforo_test.ct_b')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E14: editar una cancelada debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E14: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;

-- ---------------------------------------------------------------------------
-- E15 cancelar una reserva viva del turno pasado de aforo: se permite
--     (se deshace después)
-- ---------------------------------------------------------------------------
savepoint e15;
do $$
declare v_err text;
begin
  begin
    update public.reservas set estado = 'cancelada'
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E15: cancelar debía PERMITIRSE; ha dado: %s', v_err);
end
$$;
rollback to savepoint e15;

-- ---------------------------------------------------------------------------
-- E16 OTRO NEGOCIO no se afecta: con la comida de Casa Tomás pasada de
--     aforo, una reserva de Touza del mismo día y turno puede SUBIR de
--     comensales (2 → 4, Touza tiene hueco) y moverse de hora
-- ---------------------------------------------------------------------------
do $$
declare v_err text;
begin
  begin
    update public.reservas set numero_comensales = 4
    where id = current_setting('aforo_test.tz_a')::uuid;
    update public.reservas set hora = '14:00'
    where id = current_setting('aforo_test.tz_a')::uuid;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E16: Touza no debía verse afectada por la comida llena de Casa Tomás; ha dado: %s', v_err);
end
$$;

-- ---------------------------------------------------------------------------
-- E17 pasar de cancelada a viva CON hueco (Touza, cena): se permite
-- ---------------------------------------------------------------------------
do $$
declare v_err text;
begin
  begin
    update public.reservas set estado = 'pendiente'
    where id = current_setting('aforo_test.tz_b')::uuid;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E17: pasar de cancelada a viva en un turno con hueco debía PERMITIRSE; ha dado: %s', v_err);
end
$$;

-- ---------------------------------------------------------------------------
-- E18 cambiar de negocio a un turno CON hueco (ct_a → Touza, comida): se
--     permite; se comprueba el turno de destino, no el de origen (se deshace)
-- ---------------------------------------------------------------------------
savepoint e18;
do $$
declare v_err text; v_filas int;
begin
  begin
    update public.reservas set marca = 'touza'
    where id = current_setting('aforo_test.ct_a')::uuid;
    get diagnostics v_filas = row_count;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  assert v_err is null, format('E18: cambiar de negocio a un turno con hueco debía PERMITIRSE; ha dado: %s', v_err);
  assert v_filas = 1, format('E18: el UPDATE ha tocado %s filas, se esperaba 1', v_filas);
end
$$;
rollback to savepoint e18;

-- ---------------------------------------------------------------------------
-- E19 cambiar de negocio a un turno LLENO: se rechaza. Solo se toca `marca`:
--     comprueba que el trigger salta también con esa columna.
--     a) Casa Tomás → Touza con la comida de Touza llena
--     b) Touza → Casa Tomás, cuya comida está pasada de aforo
-- ---------------------------------------------------------------------------
do $$
declare
  d       date := current_setting('aforo_test.dia')::date;
  cap_tz  int  := current_setting('aforo_test.cap_tz')::int;
  v_ocup  int;
  v_estado text;
  v_msg    text;
begin
  -- Se llena la comida de Touza justo hasta su aforo.
  select coalesce(sum(numero_comensales), 0) into v_ocup from public.reservas
  where fecha = d and marca = 'touza' and hora < '17:00'
    and estado in ('pendiente', 'verificada', 'confirmada');
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-aforo relleno touza', d, '14:30', cap_tz - v_ocup, 'confirmada', 'touza', 'manual', 'zz-test-aforo');

  begin
    update public.reservas set marca = 'touza'
    where id = current_setting('aforo_test.ct_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E19a: cambiar de negocio a un turno lleno debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));

  v_estado := null; v_msg := null;
  begin
    update public.reservas set marca = 'casa_tomas'
    where id = current_setting('aforo_test.tz_a')::uuid;
  exception when others then
    v_estado := sqlstate; v_msg := sqlerrm;
  end;
  assert v_estado = '23514' and v_msg like 'Aforo superado para el turno.%',
    format('E19b: pasar de Touza a la comida pasada de aforo de Casa Tomás debía RECHAZARSE con 23514; ha dado: %s %s', coalesce(v_estado, 'OK (sin error)'), coalesce(v_msg, ''));
end
$$;

-- ---------------------------------------------------------------------------
-- F los rechazos no han dejado nada a medias: ct_a sigue como la dejó E6
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select fecha, hora, numero_comensales, estado, marca into r
  from public.reservas where id = current_setting('aforo_test.ct_a')::uuid;
  assert r.fecha = current_setting('aforo_test.dia')::date and r.hora = '13:30'::time
     and r.numero_comensales = 2 and r.estado = 'confirmada' and r.marca = 'casa_tomas',
    format('F: ct_a debía seguir en %s 13:30, 2 comensales, confirmada, casa_tomas; está en %s %s, %s, %s, %s',
           current_setting('aforo_test.dia'), r.fecha, r.hora, r.numero_comensales, r.estado, r.marca);
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (después del ROLLBACK): no queda nada de la prueba.
-- No lee aforo_test.dia ni ningún otro SET: con `db query`, el SQL editor o
-- `psql -1` todo el fichero va en una transacción y el ROLLBACK de arriba
-- también los deshace. Cuenta por el nombre que llevan todas las filas de
-- prueba y por las dos fechas escritas aquí (si se cambió el día de
-- pruebas, cambiarlas también).
-- Con IF/RAISE y no con ASSERT: el check_asserts de arriba era SET LOCAL.
-- ---------------------------------------------------------------------------
do $$
declare
  n_por_nombre int;
  n_por_fecha  int;
  n_salas      int;
begin
  select count(*) into n_por_nombre from public.reservas where nombre like 'zz-test-aforo%';
  select count(*) into n_por_fecha from public.reservas where fecha in (date '2099-06-10', date '2099-06-11');
  select count(*) into n_salas from public.espacios_reserva where nombre like 'zz-test-aforo%';
  if n_por_nombre <> 0 or n_por_fecha <> 0 or n_salas <> 0 then
    raise exception 'LIMPIEZA: tras el ROLLBACK quedan % reservas «zz-test-aforo…», % reservas el 2099-06-10/11 y % salas «zz-test-aforo…»: revisarlo a mano',
      n_por_nombre, n_por_fecha, n_salas;
  end if;
end
$$;

select 'aforo_ediciones: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
