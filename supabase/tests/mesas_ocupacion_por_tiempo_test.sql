set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261005130000_mesas_ocupacion_por_tiempo.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>: ...".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito (ni reservas, ni
-- salas, ni mesas, ni asignaciones, ni el cambio del tiempo de ocupación).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (A0 lo comprueba y aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace y no toca ninguna fila
-- existente), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/mesas_ocupacion_por_tiempo_test.sql
-- Si termina sin ERROR, todo ha pasado (la última fila, de limpieza, da
-- 0 | 0 | 0 | 105 | 120 con el ajuste de producción). NO en el SQL editor (si
-- falla un ASSERT la transacción puede quedarse abierta con candados).
--
-- QUÉ MONTA (dentro de la transacción): días lejanos y vacíos (2099-08-01 a
-- 2099-08-06; si A0 dice que alguno tiene reservas, cambiar ocup_test.dia y
-- las fechas de la LIMPIEZA del final), una sala normal de Casa Tomás con las
-- mesas «3» y «4», una sala PRIVADA con su mesa única «R», y el tiempo de
-- ocupación a 120 / 120 min.
--
-- QUÉ CUBRE (petición del dueño, 05/10/2026)
--   A0  migración aplicada (sin índice por turno, con la franja) y días vacíos
--   T1  comida 14:00 y cena 20:30 en la misma mesa: se puede
--   T2  14:00 y 15:00 con 120 min → MESA_OCUPADA con el mensaje claro;
--       14:00 y 16:00 → se puede (la franja es [inicio, fin))
--   T3  cambiar el tiempo de ocupación a 90 min cambia el resultado
--   T4  cambiar la HORA de una reserva sentada: si pasa a solapar, la reserva
--       se guarda igual y la mesa se descarta (auditada, conflicto_franja);
--       si no solapa, conserva la mesa; escribir la asignación a mano → error
--   T5  mesas juntas de una misma reserva no chocan entre sí; otra sí
--   T6  cena que pasa de medianoche choca con la del día siguiente
--   T7  sala privada (Reservado): comida y cena en su mesa única, sí; dos
--       reservas en el mismo turno, no («Sala privada ocupada», su regla)
--   T8  cancelar libera la mesa para otra reserva a esa hora
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

set local ocup_test.dia = '2099-08-01';

-- Ayudas (viven en pg_temp: desaparecen con la transacción).

-- Inserta una reserva de prueba y devuelve 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.res(p_nombre text, p_fecha date, p_hora text, p_n int, p_espacio uuid)
returns text language plpgsql as $f$
begin
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente, espacio_id)
  values ('zz-test-ocup ' || p_nombre, p_fecha, p_hora::time, p_n, 'confirmada', 'casa_tomas', 'manual', 'zz-test-ocup', p_espacio);
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

create function pg_temp.rid(p_nombre text) returns uuid language sql as $f$
  select id from public.reservas where nombre = 'zz-test-ocup ' || p_nombre;
$f$;

create function pg_temp.mid(p_sala text, p_mesa text) returns uuid language sql as $f$
  select id from public.mesas
  where espacio_id = current_setting('ocup_test.' || p_sala)::uuid and nombre = p_mesa;
$f$;

-- Da mesas a una reserva por el MISMO camino que el panel (RPC). 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.sentar(p_nombre text, p_sala text, p_mesas text[]) returns text language plpgsql as $f$
declare v_ids uuid[];
begin
  select array_agg(pg_temp.mid(p_sala, m)) into v_ids from unnest(p_mesas) as m;
  perform public.asignar_mesas_reserva(pg_temp.rid(p_nombre), v_ids);
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

-- UPDATE de una reserva de prueba por su nombre: 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.upd(p_nombre text, p_set text) returns text language plpgsql as $f$
declare n int;
begin
  execute format('update public.reservas set %s where nombre = %L', p_set, 'zz-test-ocup ' || p_nombre);
  get diagnostics n = row_count;
  if n <> 1 then return 'FILAS|' || n; end if;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

create function pg_temp.mesas_de(p_nombre text) returns text language sql as $f$
  select coalesce(string_agg(m.nombre::text, '+' order by m.nombre), '')
  from public.asignaciones_mesa a join public.mesas m on m.id = a.mesa_id
  where a.reserva_id = pg_temp.rid(p_nombre);
$f$;

create function pg_temp.ok(p_caso text, p_r text) returns void language plpgsql as $f$
begin
  assert p_r = 'OK', format('%s: debía PERMITIRSE; ha dado: %s', p_caso, p_r);
end
$f$;

create function pg_temp.rechazo(p_caso text, p_r text, p_prefijo text) returns void language plpgsql as $f$
begin
  assert p_r like '23514|' || p_prefijo || '%',
    format('%s: debía RECHAZARSE con 23514 «%s…»; ha dado: %s', p_caso, p_prefijo, p_r);
end
$f$;

-- ---------------------------------------------------------------------------
-- A0 migración aplicada y días de prueba vacíos
-- ---------------------------------------------------------------------------
do $$
declare
  d date := current_setting('ocup_test.dia')::date;
  n int;
begin
  assert to_regprocedure('public.fn_franja_ocupacion_mesa(date, time)') is not null,
    'A0a: la migración 20261005130000 NO está aplicada (falta fn_franja_ocupacion_mesa). Aplícala antes de ejecutar esto.';
  assert to_regclass('public.uq_asignaciones_mesa_mesa_fecha_turno') is null,
    'A0b: sigue existiendo el índice único por turno uq_asignaciones_mesa_mesa_fecha_turno';
  assert position('fn_franja_ocupacion_mesa' in (select prosrc from pg_proc where oid = 'public.asignaciones_mesa_denormalizar()'::regprocedure)) > 0,
    'A0c: asignaciones_mesa_denormalizar() no comprueba la franja';

  select count(*) into n from public.reservas where fecha between d - 1 and d + 6;
  assert n = 0,
    format('A0d: los días de prueba %s a %s ya tienen %s reservas: cambia ocup_test.dia (justo después del BEGIN) y las fechas de la LIMPIEZA', d - 1, d + 6, n);
end
$$;

-- ---------------------------------------------------------------------------
-- MONTAJE
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-ocup normal', 40, true, jsonb_build_object('marca', 'casa_tomas'))
  returning id into v_id;
  perform set_config('ocup_test.normal', v_id::text, true);
  insert into public.mesas (espacio_id, nombre, capacidad) values (v_id, '3', 4), (v_id, '4', 4);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-ocup privada', 20, true, jsonb_build_object('marca', 'casa_tomas', 'privada', true))
  returning id into v_id;
  perform set_config('ocup_test.privada', v_id::text, true);
  insert into public.mesas (espacio_id, nombre, capacidad) values (v_id, 'R', 20);

  update public.configuracion_reservas set estancia_comida_minutos = 120, estancia_cena_minutos = 120;
  assert public.fn_minutos_ocupacion_mesa(time '14:00') = 120 and public.fn_minutos_ocupacion_mesa(time '21:00') = 120,
    'Montaje: el tiempo de ocupación debía quedar en 120 / 120';
end
$$;

-- ---------------------------------------------------------------------------
-- T1 comida 14:00 y cena 20:30 en la misma mesa (el caso del dueño)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date;
  nor uuid := current_setting('ocup_test.normal')::uuid;
begin
  perform pg_temp.ok('T1a alta Oscar', pg_temp.res('Oscar', d, '14:00', 3, nor));
  perform pg_temp.ok('T1b alta Ezequiel', pg_temp.res('Ezequiel', d, '20:30', 2, nor));
  perform pg_temp.ok('T1c Oscar (comida 14:00) a la mesa 3', pg_temp.sentar('Oscar', 'normal', array['3']));
  perform pg_temp.ok('T1d Ezequiel (cena 20:30) a la MISMA mesa 3', pg_temp.sentar('Ezequiel', 'normal', array['3']));
  assert pg_temp.mesas_de('Oscar') = '3' and pg_temp.mesas_de('Ezequiel') = '3',
    format('T1e: las dos debían tener la mesa 3; Oscar=%s Ezequiel=%s', pg_temp.mesas_de('Oscar'), pg_temp.mesas_de('Ezequiel'));
end
$$;

-- ---------------------------------------------------------------------------
-- T2 mismo turno: 14:00 y 15:00 con 120 min chocan; 14:00 y 16:00 no
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 1;
  nor uuid := current_setting('ocup_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T2a alta A', pg_temp.res('A', d, '14:00', 2, nor));
  perform pg_temp.ok('T2b alta B', pg_temp.res('B', d, '15:00', 2, nor));
  perform pg_temp.ok('T2c alta C', pg_temp.res('C', d, '16:00', 2, nor));
  perform pg_temp.ok('T2d A 14:00 a la mesa 3', pg_temp.sentar('A', 'normal', array['3']));

  r := pg_temp.sentar('B', 'normal', array['3']);
  perform pg_temp.rechazo('T2e B 15:00 en la mesa 3 (A hasta las 16:00)', r,
    'MESA_OCUPADA: La mesa 3 está ocupada de 14:00 a 16:00 por zz-test-ocup A');
  assert pg_temp.mesas_de('B') = '', 'T2f: B no debía quedarse con ninguna mesa';

  perform pg_temp.ok('T2g C 16:00 en la mesa 3 (justo cuando A la deja)', pg_temp.sentar('C', 'normal', array['3']));
  -- Y al revés: B (15:00-17:00) tampoco cabe ahora que C empieza a las 16:00.
  r := pg_temp.sentar('B', 'normal', array['3']);
  perform pg_temp.rechazo('T2h B sigue chocando (con A, la primera)', r, 'MESA_OCUPADA: La mesa 3 está ocupada de 14:00');
  perform pg_temp.ok('T2i B a la mesa 4, libre', pg_temp.sentar('B', 'normal', array['4']));
end
$$;

-- ---------------------------------------------------------------------------
-- T3 el tiempo de ocupación manda: con 90 min, 14:00 y 15:30 ya caben
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 2;
  nor uuid := current_setting('ocup_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T3a alta D', pg_temp.res('D', d, '14:00', 2, nor));
  perform pg_temp.ok('T3b alta E', pg_temp.res('E', d, '15:30', 2, nor));
  perform pg_temp.ok('T3c D a la mesa 3', pg_temp.sentar('D', 'normal', array['3']));

  r := pg_temp.sentar('E', 'normal', array['3']);
  perform pg_temp.rechazo('T3d con 120 min, E 15:30 choca', r, 'MESA_OCUPADA: La mesa 3 está ocupada de 14:00 a 16:00');

  update public.configuracion_reservas set estancia_comida_minutos = 90;
  assert public.fn_franja_ocupacion_mesa(d, time '14:00') = tsrange(d + time '14:00', d + time '15:30', '[)'),
    'T3e: con 90 min la franja de las 14:00 debía ser [14:00, 15:30)';
  perform pg_temp.ok('T3f con 90 min, E 15:30 cabe', pg_temp.sentar('E', 'normal', array['3']));

  update public.configuracion_reservas set estancia_comida_minutos = 120;
end
$$;

-- ---------------------------------------------------------------------------
-- T4 cambiar la hora de una reserva YA SENTADA
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 3;
  nor uuid := current_setting('ocup_test.normal')::uuid;
  r   text;
  v_motivo text;
begin
  perform pg_temp.ok('T4a alta H', pg_temp.res('H', d, '14:00', 2, nor));
  perform pg_temp.ok('T4b alta I', pg_temp.res('I', d, '17:00', 2, nor));
  perform pg_temp.ok('T4c H 14:00 a la mesa 3', pg_temp.sentar('H', 'normal', array['3']));
  perform pg_temp.ok('T4d I 17:00 a la mesa 3 (cena, 17:00-19:00)', pg_temp.sentar('I', 'normal', array['3']));

  -- Sin choque: 14:00 -> 14:30 (14:30-16:30) conserva la mesa.
  perform pg_temp.ok('T4e H pasa a las 14:30', pg_temp.upd('H', 'hora = ''14:30'''));
  assert pg_temp.mesas_de('H') = '3', format('T4f: H debía conservar la mesa 3; tiene «%s»', pg_temp.mesas_de('H'));

  -- Escribir a mano una asignación que solapa: error (lo valida el trigger,
  -- no solo el RPC).
  perform pg_temp.ok('T4g alta J', pg_temp.res('J', d, '18:00', 2, nor));
  begin
    insert into public.asignaciones_mesa (reserva_id, mesa_id) values (pg_temp.rid('J'), pg_temp.mid('normal', '3'));
    r := 'OK';
  exception when others then
    r := sqlstate || '|' || sqlerrm;
  end;
  perform pg_temp.rechazo('T4h INSERT directo de J 18:00 en la mesa 3', r, 'MESA_OCUPADA: La mesa 3 está ocupada de 17:00 a 19:00 por zz-test-ocup I');

  -- Con choque: H pasa a las 16:00 (16:00-18:00, pisa a I 17:00). La reserva
  -- SE GUARDA (el bot y la web también cambian horas) y la mesa se descarta.
  r := pg_temp.upd('H', 'hora = ''16:00''');
  perform pg_temp.ok('T4i el cambio de hora de H se guarda igual', r);
  assert (select hora from public.reservas where id = pg_temp.rid('H')) = time '16:00', 'T4j: H debía quedar a las 16:00';
  assert pg_temp.mesas_de('H') = '', format('T4k: H debía quedarse SIN mesa; tiene «%s»', pg_temp.mesas_de('H'));
  assert pg_temp.mesas_de('I') = '3', 'T4l: I conserva su mesa';

  select motivo into v_motivo
  from public.asignaciones_mesa_descartadas
  where reserva_id = pg_temp.rid('H')
  order by descartada_at desc limit 1;
  assert v_motivo like 'conflicto_franja: MESA_OCUPADA: La mesa 3 está ocupada de 17:00 a 19:00 por zz-test-ocup I%',
    format('T4m: el descarte debía quedar auditado como conflicto_franja; motivo: %s', v_motivo);

  -- Y tras el descarte, pedir de nuevo la mesa 3 da el error claro.
  r := pg_temp.sentar('H', 'normal', array['3']);
  perform pg_temp.rechazo('T4n H 16:00 vuelve a pedir la mesa 3', r, 'MESA_OCUPADA: La mesa 3 está ocupada de 17:00 a 19:00');
end
$$;

-- ---------------------------------------------------------------------------
-- T5 mesas juntas: no chocan consigo mismas; con otra reserva sí
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 4;
  nor uuid := current_setting('ocup_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T5a alta K', pg_temp.res('K', d, '13:00', 7, nor));
  perform pg_temp.ok('T5b alta L', pg_temp.res('L', d, '13:30', 2, nor));
  perform pg_temp.ok('T5c K en la 3 + la 4', pg_temp.sentar('K', 'normal', array['3', '4']));
  assert pg_temp.mesas_de('K') = '3+4', format('T5d: K debía tener 3+4; tiene «%s»', pg_temp.mesas_de('K'));
  -- Reasignar las mismas mesas a K (p. ej. «Cambiar» sin cambiar nada) no choca.
  perform pg_temp.ok('T5e K otra vez en 3 + 4', pg_temp.sentar('K', 'normal', array['4', '3']));
  r := pg_temp.sentar('L', 'normal', array['4']);
  perform pg_temp.rechazo('T5f L 13:30 en la 4', r, 'MESA_OCUPADA: La mesa 4 está ocupada de 13:00 a 15:00 por zz-test-ocup K');
  -- Atomicidad: si una de las mesas choca, no se queda con ninguna.
  perform pg_temp.ok('T5g alta M', pg_temp.res('M', d, '20:00', 2, nor));
  perform pg_temp.ok('T5h M 20:00 en la 3', pg_temp.sentar('M', 'normal', array['3']));
  r := pg_temp.sentar('L', 'normal', array['3']);
  perform pg_temp.rechazo('T5i L 13:30 en la 3 (de K)', r, 'MESA_OCUPADA: La mesa 3');
end
$$;

-- ---------------------------------------------------------------------------
-- T6 una cena de las 23:30 ocupa la mesa pasada la medianoche
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 4;
  nor uuid := current_setting('ocup_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T6a alta N 23:30', pg_temp.res('N', d, '23:30', 2, nor));
  perform pg_temp.ok('T6b alta O 00:30 del día siguiente', pg_temp.res('O', d + 1, '00:30', 2, nor));
  perform pg_temp.ok('T6c N en la 4 (K la deja a las 15:00)', pg_temp.sentar('N', 'normal', array['4']));
  r := pg_temp.sentar('O', 'normal', array['4']);
  perform pg_temp.rechazo('T6d O 00:30 choca con N (23:30-01:30)', r,
    'MESA_OCUPADA: La mesa 4 está ocupada de 23:30 a 01:30 por zz-test-ocup N (el ');
end
$$;

-- ---------------------------------------------------------------------------
-- T7 sala privada (Reservado): su regla de una reserva por turno sigue
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date;
  pri uuid := current_setting('ocup_test.privada')::uuid;
  r   text;
begin
  perform pg_temp.ok('T7a comida en la privada', pg_temp.res('P1', d, '14:00', 10, pri));
  perform pg_temp.ok('T7b cena en la privada', pg_temp.res('P2', d, '21:00', 12, pri));
  perform pg_temp.ok('T7c comida a su mesa única', pg_temp.sentar('P1', 'privada', array['R']));
  perform pg_temp.ok('T7d cena a la MISMA mesa única', pg_temp.sentar('P2', 'privada', array['R']));

  r := pg_temp.res('P3', d, '16:30', 4, pri);
  perform pg_temp.rechazo('T7e otra comida en la privada (aunque a las 16:30 la mesa ya estaría libre)', r, 'Sala privada ocupada');
  r := pg_temp.res('P4', d, '17:00', 4, pri);
  perform pg_temp.rechazo('T7f otra cena en la privada', r, 'Sala privada ocupada');
end
$$;

-- ---------------------------------------------------------------------------
-- T8 cancelar libera la mesa para otra reserva a esa hora
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('ocup_test.dia')::date + 1;
begin
  -- B (15:00) no cabía en la 3 por A (14:00). Se cancela A y se reintenta:
  -- sigue chocando con C (16:00-18:00)… así que B pasa a las 13:30 con A
  -- cancelada: [13:30, 15:30) no pisa a C.
  perform pg_temp.ok('T8a cancelar A', pg_temp.upd('A', 'estado = ''cancelada'''));
  assert pg_temp.mesas_de('A') = '', 'T8b: la cancelada no conserva mesa';
  perform pg_temp.ok('T8c B pasa a las 13:30', pg_temp.upd('B', 'hora = ''13:30'''));
  perform pg_temp.ok('T8d B 13:30 en la mesa 3 (A cancelada, C a las 16:00)', pg_temp.sentar('B', 'normal', array['3']));
end
$$;

-- ---------------------------------------------------------------------------
-- A9 cierre: nada de lo anterior ha tocado filas que no sean de prueba
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.reservas where notas_cliente = 'zz-test-ocup' and nombre not like 'zz-test-ocup %';
  assert n = 0, 'A9: hay reservas de prueba con un nombre inesperado';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (ya fuera de la transacción): no debe quedar nada de la prueba.
-- Si cambiaste ocup_test.dia, cambia aquí también las fechas.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.reservas where nombre like 'zz-test-ocup%')                     as reservas_de_prueba,
  (select count(*) from public.reservas where fecha between '2099-07-31' and '2099-08-07')     as reservas_en_los_dias_de_prueba,
  (select count(*) from public.espacios_reserva where nombre like 'zz-test-ocup%')             as salas_de_prueba,
  (select estancia_comida_minutos from public.configuracion_reservas limit 1)                  as minutos_comida,
  (select estancia_cena_minutos from public.configuracion_reservas limit 1)                    as minutos_cena;
-- -> 0 | 0 | 0 | 105 | 120 (o el ajuste que tenga producción)
