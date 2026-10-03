set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261003150000_sala_privada_fuera_de_aforo.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>: ...".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito (ni reservas, ni
-- salas, ni mesas, ni ocupacion_diaria).
--
-- CUÁNDO: DESPUÉS de aplicar la migración. La prueba A0 lo comprueba y aborta
-- si no está aplicada.
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace y no toca ninguna fila
-- existente), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/sala_privada_fuera_de_aforo_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sala_privada_fuera_de_aforo_test.sql
-- Si termina sin ERROR, todo ha pasado (y la última fila, de limpieza, da
-- 0 | 0 | 0 | <md5> | 1). NO en el SQL editor (si falla un ASSERT la
-- transacción puede quedarse abierta reteniendo candados sobre `reservas`;
-- ver supabase/tests/aforo_ediciones.sql).
--
-- QUÉ MONTA (dentro de la transacción): días lejanos y vacíos (2099-07-10 a
-- 2099-07-14; si A0 dice que alguno tiene reservas, cambiar sala_test.dia y
-- las dos fechas de la LIMPIEZA del final) y tres salas de prueba de Casa
-- Tomás: una PRIVADA de 20 plazas, una normal de 10 y una privada
-- DESACTIVADA. El Reservado REAL (T10) se usa solo en días vacíos.
--
-- QUÉ CUBRE (decisión del dueño, 2026-10-03: el Reservado está FUERA DE AFORO)
--   A0  el aforo real de Casa Tomás sin salas privadas es 150
--   T1  con el turno al 100 %, una reserva en la sala privada se admite y no
--       cambia la ocupación ni la capacidad que se muestran en el error
--   T2  la exclusividad se mantiene (segunda reserva → 23514 «Sala privada
--       ocupada»), también con el turno al 100 %; otro turno u otro día, sí
--   T3  cancelar / «No vino» libera la sala; deshacerlo choca si otra la tomó
--   T4  mover una reserva a la sala privada libera aforo; sacarla de ella
--       vuelve a consumirlo (rechazo si el turno está lleno)
--   T5  salas normales: sin cambios (cuentan por comensales)
--   T6  una sala privada desactivada no cuenta (ni fuera de aforo ni exclusiva)
--   T7  «completada» (Llegó): no cuenta aforo, sigue ocupando la sala
--   T8  vista_ocupacion_hoy no cuenta las reservas de salas privadas
--   T9  fn_capacidad_efectiva_marca no suma las mesas de salas privadas
--   T10 el Reservado REAL: se puede reservar con el restaurante lleno
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

set local sala_test.dia = '2099-07-10';

-- Ayudas (viven en pg_temp: desaparecen con la transacción).
create function pg_temp.probar(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

-- Inserta una reserva de prueba y devuelve 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.res(p_nombre text, p_fecha date, p_hora text, p_n int, p_estado text, p_espacio uuid)
returns text language plpgsql as $f$
begin
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente, espacio_id)
  values ('zz-test-fuera ' || p_nombre, p_fecha, p_hora::time, p_n, p_estado, 'casa_tomas', 'manual', 'zz-test-fuera', p_espacio);
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

-- UPDATE de una reserva de prueba por su nombre: 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.upd(p_nombre text, p_set text) returns text language plpgsql as $f$
declare n int;
begin
  execute format('update public.reservas set %s where nombre = %L', p_set, 'zz-test-fuera ' || p_nombre);
  get diagnostics n = row_count;
  if n <> 1 then return 'FILAS|' || n; end if;
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

create function pg_temp.dato(p_nombre text, p_col text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('select %I::text from public.reservas where nombre = %L', p_col, 'zz-test-fuera ' || p_nombre) into v;
  return v;
end
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
-- A0 la migración está aplicada, los días de prueba están vacíos y el aforo
--    real de Casa Tomás sin salas privadas es 150
-- ---------------------------------------------------------------------------
do $$
declare
  d      date := current_setting('sala_test.dia')::date;
  v_src  text;
  v_trig text;
  n      int;
  v_aforo int;
begin
  select p.prosrc into v_src
  from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
  assert position('v_vieja_privada' in v_src) > 0,
    'A0a: la migración 20261003150000 NO está aplicada (falta v_vieja_privada en validar_capacidad_reserva). Aplícala antes de ejecutar esto.';

  select pg_get_triggerdef(t.oid) into v_trig
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';
  assert v_trig like 'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca, espacio_id ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()',
    format('A0b: el trigger no es el esperado (debe saltar también con espacio_id): %s', v_trig);

  select count(*) into n from public.reservas where fecha between d and d + 4;
  assert n = 0,
    format('A0c: los días de prueba %s a %s ya tienen %s reservas: cambia sala_test.dia (justo después del BEGIN) y las fechas de la LIMPIEZA del final', d, d + 4, n);

  select coalesce(sum(capacidad_maxima), 0) into v_aforo
  from public.espacios_reserva
  where activa = true
    and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
    and (caracteristicas->>'privada') is distinct from 'true';
  assert v_aforo = 150,
    format('A0d: el aforo de Casa Tomás SIN salas privadas debía ser 150 (Comedor + Salón + Terraza) y es %s', v_aforo);

  assert (select count(*) from public.espacios_reserva
          where activa = true and caracteristicas->>'privada' = 'true'
            and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas') >= 1,
    'A0e: debía existir al menos una sala privada activa de Casa Tomás (el Reservado)';
end
$$;

-- ---------------------------------------------------------------------------
-- MONTAJE
-- ---------------------------------------------------------------------------
do $$
declare
  cap_ct int;
  v_id   uuid;
begin
  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-fuera privada', 20, true, jsonb_build_object('marca', 'casa_tomas', 'privada', true))
  returning id into v_id;
  perform set_config('sala_test.privada', v_id::text, true);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-fuera normal', 10, true, jsonb_build_object('marca', 'casa_tomas'))
  returning id into v_id;
  perform set_config('sala_test.normal', v_id::text, true);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-fuera privada apagada', 20, false, jsonb_build_object('marca', 'casa_tomas', 'privada', true))
  returning id into v_id;
  perform set_config('sala_test.apagada', v_id::text, true);

  -- Aforo de Casa Tomás con las salas de prueba: 150 + 10 de la normal (las
  -- privadas, la de prueba y el Reservado, NO suman).
  select coalesce(sum(capacidad_maxima), 0) into cap_ct
  from public.espacios_reserva
  where activa = true
    and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas'
    and (caracteristicas->>'privada') is distinct from 'true';
  assert cap_ct = 160, format('Montaje: el aforo con la sala normal de prueba debía ser 160 y es %s', cap_ct);
  perform set_config('sala_test.cap', cap_ct::text, true);
end
$$;

-- ---------------------------------------------------------------------------
-- T1 con el turno al 100 %, la sala privada admite una reserva y no cambia nada
--    Comida de d: relleno hasta el aforo EXACTO. Con la regla de antes
--    (170 + peso 20) la de 8 no cabría; con la nueva no consume nada.
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T1a relleno de la comida hasta el aforo exacto', pg_temp.res('relleno comida d', d, '13:00', cap, 'confirmada', null));

  r := pg_temp.res('uno mas sin sala', d, '13:30', 1, 'pendiente', null);
  perform pg_temp.rechazo('T1b con el turno al 100 % un comensal más se rechaza', r, 'Aforo superado para el turno.');
  assert r like format('%%Capacidad total: %s, Ocupación actual: %s, Pedidos: 1', cap, cap),
    format('T1c: capacidad y ocupación debían ser %s y %s (sin salas privadas); mensaje: %s', cap, cap, r);
  assert r not like '%sala privada%', 'T1d: el mensaje de aforo ya no habla de salas privadas: ' || r;

  perform pg_temp.ok('T1e reserva de 8 en la sala privada con el turno al 100 %', pg_temp.res('P1', d, '13:00', 8, 'confirmada', pri));

  r := pg_temp.res('uno mas sin sala', d, '13:30', 1, 'pendiente', null);
  assert r like format('%%Capacidad total: %s, Ocupación actual: %s, Pedidos: 1', cap, cap),
    format('T1f: la reserva de 8 en la privada NO debía cambiar la ocupación (%s); mensaje: %s', cap, r);

  r := pg_temp.res('uno mas en normal', d, '13:30', 1, 'pendiente', nor);
  perform pg_temp.rechazo('T1g un comensal más en una sala normal: sigue lleno', r, 'Aforo superado para el turno.');

  -- Subir los comensales de la reserva de la sala privada tampoco consume aforo.
  perform pg_temp.ok('T1h subir P1 de 8 a 20 (más que nada)', pg_temp.upd('P1', 'numero_comensales = 20'));
  perform pg_temp.ok('T1i subir P1 a 40 (más que la propia sala): fuera de aforo', pg_temp.upd('P1', 'numero_comensales = 40'));
  perform pg_temp.ok('T1j bajarla otra vez', pg_temp.upd('P1', 'numero_comensales = 8'));

  -- Turno a medias (comida de d+1): la privada no ocupa hueco a nadie.
  perform pg_temp.ok('T1k relleno hasta cap-5 (d+1)', pg_temp.res('relleno comida d1', d + 1, '13:00', cap - 5, 'confirmada', null));
  perform pg_temp.ok('T1l 8 en la privada', pg_temp.res('P-d1', d + 1, '13:30', 8, 'confirmada', pri));
  perform pg_temp.ok('T1m caben justo los 5 que quedan', pg_temp.res('resto d1', d + 1, '14:00', 5, 'confirmada', null));
  r := pg_temp.res('uno mas d1', d + 1, '14:30', 1, 'confirmada', null);
  perform pg_temp.rechazo('T1n y ni uno más', r, 'Aforo superado para el turno.');
end
$$;

-- ---------------------------------------------------------------------------
-- T2 la exclusividad se mantiene
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  r   text;
  v_detalle text;
  v_p1 text := pg_temp.dato('P1', 'id');
begin
  r := pg_temp.res('P2', d, '14:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T2a segunda reserva en la privada (misma comida, turno al 100 %)', r, 'Sala privada ocupada: «zz-test-fuera privada» ya tiene una reserva el 10/07/2099 en el turno de comida.');
  r := pg_temp.res('P2', d, '16:30', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T2b 16:30 sigue siendo comida', r, 'Sala privada ocupada');

  begin
    insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente, espacio_id)
    values ('zz-test-fuera P2', d, '14:00', 2, 'pendiente', 'casa_tomas', 'manual', 'zz-test-fuera', pri);
  exception when others then
    get stacked diagnostics v_detalle = pg_exception_detail;
  end;
  assert v_detalle = 'Reserva en conflicto: ' || v_p1, format('T2c: el DETAIL debía citar a P1 (%s); es: %s', v_p1, v_detalle);
  assert (select count(*) from public.reservas where nombre = 'zz-test-fuera P2') = 0, 'T2d: P2 no debía haberse guardado';

  perform pg_temp.ok('T2e la cena del mismo día en la privada, sí', pg_temp.res('P-cena', d, '21:00', 4, 'confirmada', pri));
  r := pg_temp.res('P-cena 2', d, '17:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T2f las 17:00 ya son cena', r, 'Sala privada ocupada');
  perform pg_temp.ok('T2g el día siguiente a la hora de la comida de d+1 está ocupado, la cena no', pg_temp.res('P-d1 cena', d + 1, '21:00', 2, 'pendiente', pri));

  -- Editar la propia reserva no choca consigo misma.
  perform pg_temp.ok('T2h confirmada → verificada', pg_temp.upd('P1', 'estado = ''verificada'''));
  perform pg_temp.ok('T2i cambiar la hora dentro del turno', pg_temp.upd('P1', 'hora = ''15:30'''));
  perform pg_temp.ok('T2j reenviar todas las columnas del trigger sin cambiarlas',
    pg_temp.upd('P1', 'fecha = fecha, hora = hora, numero_comensales = numero_comensales, estado = estado, marca = marca, espacio_id = espacio_id'));
  perform pg_temp.ok('T2k volver a confirmada', pg_temp.upd('P1', 'estado = ''confirmada'''));
end
$$;

-- ---------------------------------------------------------------------------
-- T3 cancelar / «No vino» libera la sala (comida de d: P1 la tiene)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  r   text;
begin
  perform pg_temp.ok('T3a cancelar P1', pg_temp.upd('P1', 'estado = ''cancelada'''));
  perform pg_temp.ok('T3b ahora P2 puede reservar la privada (comida de d)', pg_temp.res('P2', d, '14:00', 2, 'pendiente', pri));
  r := pg_temp.upd('P1', 'estado = ''confirmada''');
  perform pg_temp.rechazo('T3c reactivar P1 con P2 dentro', r, 'Sala privada ocupada');
  assert pg_temp.dato('P1', 'estado') = 'cancelada', 'T3d: P1 debía seguir cancelada';

  perform pg_temp.ok('T3e P2 «No vino»', pg_temp.upd('P2', 'estado = ''no_show'''));
  perform pg_temp.ok('T3f P1 vuelve (la sala está libre otra vez)', pg_temp.upd('P1', 'estado = ''confirmada'''));
  r := pg_temp.upd('P2', 'estado = ''confirmada''');
  perform pg_temp.rechazo('T3g deshacer el «No vino» de P2 con P1 dentro', r, 'Sala privada ocupada');
end
$$;

-- ---------------------------------------------------------------------------
-- T4 mover reservas entre salas normales y la privada
--    Comida de d+1 (llena con 'relleno comida d1' + 'resto d1' = cap; la
--    privada tiene P-d1).
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  -- 'resto d1' (5, sin sala) intenta ir a la privada de d+1, que ya tiene P-d1.
  r := pg_temp.upd('resto d1', 'espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T4a mover a la privada ya ocupada', r, 'Sala privada ocupada');

  -- Cena de d+1: P-d1 cena tiene la privada. Una reserva de 3 en la cena de d+1,
  -- sin sala, tampoco puede entrar; pero una en la cena de d+2 (libre) sí, y libera aforo.
  perform pg_temp.ok('T4b relleno de la cena de d+2 hasta el aforo exacto', pg_temp.res('relleno cena d2', d + 2, '21:00', cap, 'confirmada', null));
  perform pg_temp.ok('T4c Z (2) en la cena de d+2 en la privada: fuera de aforo, cabe', pg_temp.res('Z', d + 2, '21:30', 2, 'confirmada', pri));
  r := pg_temp.res('Y sin sala', d + 2, '22:00', 2, 'confirmada', null);
  perform pg_temp.rechazo('T4d la cena de d+2 está llena', r, 'Aforo superado para el turno.');

  -- Sacar Z de la privada a una sala normal CONSUME aforo: con el turno lleno se rechaza.
  r := pg_temp.upd('Z', 'espacio_id = ''' || nor || '''::uuid');
  perform pg_temp.rechazo('T4e sacar Z de la privada a una normal con el turno lleno', r, 'Aforo superado para el turno.');
  assert pg_temp.dato('Z', 'espacio_id') = pri::text, 'T4f: Z debía seguir en la privada';
  r := pg_temp.upd('Z', 'espacio_id = null');
  perform pg_temp.rechazo('T4g y quitarle la sala también consume aforo', r, 'Aforo superado para el turno.');

  -- Meter una reserva normal en la privada LIBERA aforo.
  perform pg_temp.ok('T4h otra reserva W (3) en una cena de d+3 con hueco', pg_temp.res('W', d + 3, '21:00', 3, 'confirmada', null));
  perform pg_temp.ok('T4i relleno de la cena de d+3 hasta el aforo', pg_temp.res('relleno cena d3', d + 3, '21:30', cap - 3, 'confirmada', null));
  r := pg_temp.res('V sin sala', d + 3, '22:00', 1, 'confirmada', null);
  perform pg_temp.rechazo('T4j cena de d+3 llena', r, 'Aforo superado para el turno.');
  perform pg_temp.ok('T4k mover W a la privada libre (sale del aforo)', pg_temp.upd('W', 'espacio_id = ''' || pri || '''::uuid'));
  perform pg_temp.ok('T4l ahora V cabe', pg_temp.res('V sin sala', d + 3, '22:00', 3, 'confirmada', null));
  r := pg_temp.upd('W', 'espacio_id = ''' || nor || '''::uuid');
  perform pg_temp.rechazo('T4m W no puede volver al aforo: está lleno otra vez', r, 'Aforo superado para el turno.');

  -- Verificar con sala (pendiente → verificada escribiendo espacio_id, el modal «Verificar»).
  perform pg_temp.ok('T4n U pendiente en la cena de d+4', pg_temp.res('U', d + 4, '21:00', 2, 'pendiente', null));
  perform pg_temp.ok('T4o U → verificada con la privada libre', pg_temp.upd('U', 'estado = ''verificada'', espacio_id = ''' || pri || '''::uuid'));
  perform pg_temp.ok('T4p U2 pendiente en la cena de d+4', pg_temp.res('U2', d + 4, '22:00', 2, 'pendiente', null));
  r := pg_temp.upd('U2', 'estado = ''verificada'', espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T4q U2 → verificada con la privada ocupada', r, 'Sala privada ocupada');
end
$$;

-- ---------------------------------------------------------------------------
-- T5 salas NO privadas: sin cambios (cuentan por comensales)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  -- Comida de d+2 (vacía): relleno hasta cap-5, luego 2 + 3 en la sala normal y ni uno más.
  perform pg_temp.ok('T5a relleno', pg_temp.res('relleno comida d2', d + 2, '13:00', cap - 5, 'confirmada', null));
  perform pg_temp.ok('T5b 2 en la sala normal', pg_temp.res('N1', d + 2, '13:15', 2, 'confirmada', nor));
  perform pg_temp.ok('T5c 3 más en la MISMA sala normal y turno', pg_temp.res('N2', d + 2, '13:45', 3, 'confirmada', nor));
  r := pg_temp.res('N3', d + 2, '14:00', 1, 'confirmada', nor);
  perform pg_temp.rechazo('T5d uno más: aforo lleno (se cuenta por comensales)', r, 'Aforo superado para el turno.');
  assert r like format('%%Capacidad total: %s, Ocupación actual: %s, Pedidos: 1', cap, cap), 'T5e: ' || r;
  perform pg_temp.ok('T5f mover una reserva entre la normal y sin sala', pg_temp.upd('N2', 'espacio_id = null'));
  perform pg_temp.ok('T5g y volver', pg_temp.upd('N2', 'espacio_id = ''' || current_setting('sala_test.normal') || '''::uuid'));
  -- Reducir comensales con el turno lleno, siempre pasa (paso 0b).
  perform pg_temp.ok('T5h bajar comensales con el turno lleno', pg_temp.upd('N2', 'numero_comensales = 2'));
  r := pg_temp.upd('N2', 'numero_comensales = 4');
  perform pg_temp.rechazo('T5i subir comensales con el turno al máximo', r, 'Aforo superado para el turno.');
end
$$;

-- ---------------------------------------------------------------------------
-- T6 una sala privada DESACTIVADA no cuenta: ni fuera de aforo ni exclusiva
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  off uuid := current_setting('sala_test.apagada')::uuid;
  r   text;
begin
  -- Cena de d+1 (la privada de prueba tiene P-d1 cena, no esta): dos en la apagada, mismo turno.
  perform pg_temp.ok('T6a primera en la privada apagada (cena d+1)', pg_temp.res('O1', d + 1, '21:30', 5, 'confirmada', off));
  perform pg_temp.ok('T6b segunda en la privada apagada, mismo turno (sin exclusividad)', pg_temp.res('O2', d + 1, '22:00', 5, 'confirmada', off));
  -- Cuentan por comensales como en cualquier sala: cena de d+1 con 10 + relleno cap-10 = cap, y uno más no cabe.
  perform pg_temp.ok('T6c relleno hasta el aforo', pg_temp.res('relleno cena d1', d + 1, '21:00', cap - 10 - 2, 'confirmada', null));
  -- (la cena de d+1 ya tenía 'P-d1 cena' de 2 en la privada ACTIVA, que no cuenta)
  perform pg_temp.ok('T6d aún caben 0 más? justo cap: 10 + (cap-12) = cap-2, caben 2', pg_temp.res('dos mas d1', d + 1, '20:30', 2, 'confirmada', null));
  r := pg_temp.res('uno mas cena d1', d + 1, '20:45', 1, 'confirmada', null);
  perform pg_temp.rechazo('T6e y uno más no: las reservas de la sala apagada SÍ cuentan en el aforo', r, 'Aforo superado para el turno.');
end
$$;

-- ---------------------------------------------------------------------------
-- T7 «completada» (Llegó): no cuenta aforo, sigue ocupando la sala
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T7a «Ha llegado» sobre la que ya está en la privada (P1, comida de d)', pg_temp.upd('P1', 'estado = ''completada'''));
  r := pg_temp.res('P3', d, '14:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T7b nueva reserva con P1 ya sentada', r, 'Sala privada ocupada');
  r := pg_temp.res('P3 llegada directa', d, '14:00', 2, 'completada', pri);
  perform pg_temp.rechazo('T7c alta directa como completada en la sala ocupada', r, 'Sala privada ocupada');
  perform pg_temp.ok('T7d una completada en una sala normal con el turno lleno no se comprueba (no cuenta aforo)',
    pg_temp.res('C', d, '14:00', 3, 'completada', nor));
  r := pg_temp.upd('C', 'espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T7e mover una completada a la privada ocupada', r, 'Sala privada ocupada');
  perform pg_temp.ok('T7f cancelar P1 libera la privada', pg_temp.upd('P1', 'estado = ''cancelada'''));
  perform pg_temp.ok('T7g P3 entra', pg_temp.res('P3', d, '14:00', 2, 'confirmada', pri));
end
$$;

-- ---------------------------------------------------------------------------
-- T8 vista_ocupacion_hoy no cuenta las reservas de salas privadas
-- ---------------------------------------------------------------------------
do $$
declare
  pri uuid := current_setting('sala_test.privada')::uuid;
  v0 record;
  v1 record;
begin
  select total_reservas, total_comensales, comensales_activos, reservas_activas into v0 from public.vista_ocupacion_hoy;
  perform pg_temp.ok('T8a reserva de hoy en la privada de prueba (1 comensal, pendiente)', pg_temp.res('hoy privada', current_date, '13:00', 1, 'pendiente', pri));
  select total_reservas, total_comensales, comensales_activos, reservas_activas into v1 from public.vista_ocupacion_hoy;
  assert v1 = v0, format('T8b: la vista no debía contar la reserva de la sala privada: antes %s, después %s', v0, v1);
  assert (select count(*) from public.reservas where nombre = 'zz-test-fuera hoy privada') = 1, 'T8c: la reserva de hoy debía existir';
end
$$;

-- ---------------------------------------------------------------------------
-- T9 fn_capacidad_efectiva_marca no suma las mesas de salas privadas
-- ---------------------------------------------------------------------------
do $$
declare
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  c0 int;
  c1 int;
  c2 int;
begin
  c0 := public.fn_capacidad_efectiva_marca('casa_tomas');
  insert into public.mesas (espacio_id, nombre, capacidad) values (pri, 'zz-test-fuera mesa privada', 6);
  c1 := public.fn_capacidad_efectiva_marca('casa_tomas');
  assert c1 = c0, format('T9a: una mesa de 6 plazas en la sala privada no debía sumar: antes %s, después %s', c0, c1);
  insert into public.mesas (espacio_id, nombre, capacidad) values (nor, 'zz-test-fuera mesa normal', 4);
  c2 := public.fn_capacidad_efectiva_marca('casa_tomas');
  assert c2 = c1 + 4, format('T9b: una mesa de 4 plazas en una sala normal debía sumar 4: antes %s, después %s', c1, c2);
end
$$;

-- ---------------------------------------------------------------------------
-- T10 el Reservado REAL, con el restaurante lleno (cena de d+4 llena)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  res uuid;
  r   text;
begin
  select id into res from public.espacios_reserva
  where nombre = 'Reservado' and activa = true and caracteristicas->>'privada' = 'true'
    and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  assert res is not null, 'T10a: no existe el Reservado de Casa Tomás (activo y privado)';

  -- Comida de d+4 (vacía): al 100 %.
  perform pg_temp.ok('T10b comida de d+4 al 100 %', pg_temp.res('relleno comida d4', d + 4, '13:00', cap, 'confirmada', null));
  r := pg_temp.res('uno mas d4', d + 4, '13:30', 1, 'pendiente', null);
  perform pg_temp.rechazo('T10c el restaurante está lleno', r, 'Aforo superado para el turno.');
  perform pg_temp.ok('T10d aun así se puede reservar el Reservado (8 pax)', pg_temp.res('R1', d + 4, '14:00', 8, 'confirmada', res));
  r := pg_temp.res('R2', d + 4, '14:30', 2, 'pendiente', res);
  perform pg_temp.rechazo('T10e pero solo una por turno', r, 'Sala privada ocupada: «Reservado»');
  perform pg_temp.ok('T10f la cena sí', pg_temp.res('R3', d + 4, '21:00', 20, 'confirmada', res));
end
$$;

-- ---------------------------------------------------------------------------
-- A9 cierre: nada de lo anterior ha tocado filas que no sean de prueba
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.reservas where notas_cliente = 'zz-test-fuera' and nombre not like 'zz-test-fuera %';
  assert n = 0, 'A9: hay reservas de prueba con un nombre inesperado';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (ya fuera de la transacción): no debe quedar nada de la prueba.
-- Si cambiaste sala_test.dia, cambia aquí también las dos fechas.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.reservas where nombre like 'zz-test-fuera%')                         as reservas_de_prueba,
  (select count(*) from public.reservas where fecha between '2099-07-10' and '2099-07-14')          as reservas_en_los_dias_de_prueba,
  (select count(*) from public.espacios_reserva where nombre like 'zz-test-fuera%')                 as salas_de_prueba,
  (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure) as md5_funcion,
  (select count(*) from pg_trigger where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad' and tgenabled = 'O') as trigger_activo;
-- -> 0 | 0 | 0 | <md5 de la función> | 1
