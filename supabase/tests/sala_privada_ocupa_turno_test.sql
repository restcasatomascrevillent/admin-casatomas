set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261003130000_sala_privada_ocupa_turno.sql
-- ---------------------------------------------------------------------------
-- SUPERADA (2026-10-03, tarde): una vez aplicada 20261003150000_sala_privada_
-- fuera_de_aforo.sql (el Reservado queda FUERA DE AFORO y su reserva ya no pesa
-- la sala entera), varias pruebas de este fichero (T1, T5…) FALLAN A PROPÓSITO:
-- asumen el peso de 20 y el aforo con la sala privada dentro. Con esa migración
-- aplicada, la prueba vigente es supabase/tests/sala_privada_fuera_de_aforo_test.sql,
-- que cubre también la exclusividad. Este fichero solo vale entre 20261003130000
-- y 20261003150000.
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>: ...".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito (ni reservas, ni
-- salas, ni ocupacion_diaria).
--
-- CUÁNDO: DESPUÉS de aplicar la migración. La prueba A0 lo comprueba y aborta
-- si no está aplicada. (No necesita 20261003110000: monta su propia sala
-- privada de prueba, no usa el Reservado real.)
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace y no toca ninguna fila
-- existente), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/sala_privada_ocupa_turno_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sala_privada_ocupa_turno_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL editor (si falla un
-- ASSERT la transacción puede quedarse abierta reteniendo candados sobre
-- `reservas`; ver supabase/tests/aforo_ediciones.sql).
--
-- QUÉ MONTA (dentro de la transacción): días lejanos y vacíos (2099-07-10 a
-- 2099-07-14; si A0 dice que alguno tiene reservas, cambiar sala_test.dia y
-- las dos fechas de la LIMPIEZA del final) y tres salas de prueba de Casa
-- Tomás: una PRIVADA de 20 plazas, una normal de 10 y una privada
-- DESACTIVADA. Las capacidades se leen de la tabla en el momento.
--
-- QUÉ CUBRE
--   T1  una reserva de 5 en la sala privada descuenta 20 del aforo del negocio
--   T2  una segunda reserva en la misma sala y turno se rechaza (23514, mensaje
--       «Sala privada ocupada», DETAIL con la otra)
--   T3  la cena del mismo día sí se puede reservar
--   T4  editar la propia reserva (comensales, hora, estado, reenviar columnas)
--       no choca consigo misma
--   T5  salas NO privadas: comportamiento de siempre (varias reservas por
--       turno, cuentan por comensales)
--   T6  MOVER una reserva a la sala (UPDATE espacio_id) se comprueba; salir de
--       ella, no; mover a un turno libre, sí se puede
--   T7  cancelar / «No vino» libera la sala; deshacerlo choca si otra la tomó
--   T8  una reserva «completada» (Llegó) sigue ocupando la sala, pero marcar
--       la llegada de la que ya estaba allí no falla
--   T9  datos heredados: dos reservas vivas ya duplicadas siguen pudiendo
--       editarse (comensales) pero no cambiar de día
--   T10 una sala privada desactivada no cuenta
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
  values ('zz-test-sala ' || p_nombre, p_fecha, p_hora::time, p_n, p_estado, 'casa_tomas', 'manual', 'zz-test-sala', p_espacio);
  return 'OK';
exception when others then
  return sqlstate || '|' || sqlerrm;
end
$f$;

-- UPDATE de una reserva de prueba por su nombre: 'OK' o 'SQLSTATE|mensaje'.
create function pg_temp.upd(p_nombre text, p_set text) returns text language plpgsql as $f$
declare n int;
begin
  execute format('update public.reservas set %s where nombre = %L', p_set, 'zz-test-sala ' || p_nombre);
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
  execute format('select %I::text from public.reservas where nombre = %L', p_col, 'zz-test-sala ' || p_nombre) into v;
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
-- A0 la migración está aplicada y los días de prueba están vacíos
-- ---------------------------------------------------------------------------
do $$
declare
  d      date := current_setting('sala_test.dia')::date;
  v_src  text;
  v_trig text;
  n      int;
begin
  select p.prosrc into v_src
  from pg_proc p where p.oid = 'public.validar_capacidad_reserva()'::regprocedure;
  assert position('Sala privada ocupada' in v_src) > 0,
    'A0a: la migración 20261003130000 NO está aplicada (falta la exclusividad de la sala privada en validar_capacidad_reserva). Aplícala antes de ejecutar esto.';

  select pg_get_triggerdef(t.oid) into v_trig
  from pg_trigger t
  where t.tgrelid = 'public.reservas'::regclass and t.tgname = 'trg_validar_capacidad';
  assert v_trig like 'CREATE TRIGGER trg_validar_capacidad BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado, marca, espacio_id ON public.reservas FOR EACH ROW EXECUTE FUNCTION %validar_capacidad_reserva()',
    format('A0b: el trigger no es el esperado (debe saltar también con espacio_id): %s', v_trig);

  select count(*) into n from public.reservas where fecha between d and d + 4;
  assert n = 0,
    format('A0c: los días de prueba %s a %s ya tienen %s reservas: cambia sala_test.dia (justo después del BEGIN) y las fechas de la LIMPIEZA del final', d, d + 4, n);
end
$$;

-- ---------------------------------------------------------------------------
-- MONTAJE
-- ---------------------------------------------------------------------------
do $$
declare
  d      date := current_setting('sala_test.dia')::date;
  cap_ct int;
  v_id   uuid;
begin
  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-sala privada', 20, true, jsonb_build_object('marca', 'casa_tomas', 'privada', true))
  returning id into v_id;
  perform set_config('sala_test.privada', v_id::text, true);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-sala normal', 10, true, jsonb_build_object('marca', 'casa_tomas'))
  returning id into v_id;
  perform set_config('sala_test.normal', v_id::text, true);

  insert into public.espacios_reserva (nombre, capacidad_maxima, activa, caracteristicas)
  values ('zz-test-sala privada apagada', 20, false, jsonb_build_object('marca', 'casa_tomas', 'privada', true))
  returning id into v_id;
  perform set_config('sala_test.apagada', v_id::text, true);

  -- Aforo de Casa Tomás con las salas de prueba activas (la misma cuenta que el trigger).
  select coalesce(sum(capacidad_maxima), 0) into cap_ct
  from public.espacios_reserva
  where activa = true and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  assert cap_ct > 30, format('Montaje: el aforo de Casa Tomás (%s) debería incluir las salas de prueba', cap_ct);
  perform set_config('sala_test.cap', cap_ct::text, true);
end
$$;

-- ---------------------------------------------------------------------------
-- T1 una reserva de 5 en la sala privada descuenta 20 del aforo
--    Comida de d: relleno hasta (aforo - 20) + la reserva de 5 en la privada.
--    Con la regla vieja la ocupación sería aforo - 15 y cabrían 15 más; con la
--    nueva es justo el aforo y no cabe ni uno.
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T1a relleno de la comida', pg_temp.res('relleno comida d', d, '13:00', cap - 20, 'confirmada', null));
  perform pg_temp.ok('T1b reserva de 5 en la privada (cap-20 + 20 = cap)', pg_temp.res('P1', d, '13:00', 5, 'confirmada', pri));

  r := pg_temp.res('uno mas sin sala', d, '13:30', 1, 'pendiente', null);
  perform pg_temp.rechazo('T1c un comensal más sin sala: la privada pesa 20, no 5', r, 'Aforo superado para el turno.');
  assert r like format('%%Ocupación actual: %s, Pedidos: 1', cap),
    format('T1d: la ocupación del turno debía ser %s (cap-20 + 20); mensaje: %s', cap, r);

  r := pg_temp.res('uno mas en normal', d, '13:30', 1, 'pendiente', nor);
  perform pg_temp.rechazo('T1e un comensal más en una sala normal', r, 'Aforo superado para el turno.');

  -- Ni siquiera la cena de otro día se ve afectada (turno distinto).
  perform pg_temp.ok('T1f cena del mismo día: otro turno', pg_temp.res('cena normal d', d, '21:00', 3, 'pendiente', nor));
end
$$;

-- ---------------------------------------------------------------------------
-- T2 segunda reserva en la privada, mismo día y turno: rechazada
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
  perform pg_temp.rechazo('T2a segunda reserva en la privada (misma comida)', r, 'Sala privada ocupada: «zz-test-sala privada» ya tiene una reserva el 10/07/2099 en el turno de comida.');

  -- Una hora distinta del mismo turno (16:30) tampoco.
  r := pg_temp.res('P2', d, '16:30', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T2b 16:30 sigue siendo comida', r, 'Sala privada ocupada');

  -- El DETALLE apunta a la reserva que ya la tiene.
  begin
    insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente, espacio_id)
    values ('zz-test-sala P2', d, '14:00', 2, 'pendiente', 'casa_tomas', 'manual', 'zz-test-sala', pri);
  exception when others then
    get stacked diagnostics v_detalle = pg_exception_detail;
  end;
  assert v_detalle = 'Reserva en conflicto: ' || v_p1, format('T2c: el DETAIL debía citar a P1 (%s); es: %s', v_p1, v_detalle);

  -- No se ha colado nada.
  assert (select count(*) from public.reservas where nombre = 'zz-test-sala P2') = 0, 'T2d: P2 no debía haberse guardado';
end
$$;

-- ---------------------------------------------------------------------------
-- T3 la cena del mismo día en la privada, sí
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  r   text;
begin
  perform pg_temp.ok('T3a cena en la privada (la comida está ocupada, la cena no)', pg_temp.res('P-cena', d, '21:00', 4, 'confirmada', pri));
  r := pg_temp.res('P-cena 2', d, '22:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T3b segunda en la misma cena', r, 'Sala privada ocupada');
  r := pg_temp.res('P-cena 3 justo 17:00', d, '17:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T3c las 17:00 ya son cena', r, 'Sala privada ocupada');
  perform pg_temp.ok('T3d el día siguiente, libre', pg_temp.res('P-d1', d + 1, '21:00', 2, 'pendiente', pri));
end
$$;

-- ---------------------------------------------------------------------------
-- T4 editar la propia reserva no choca consigo misma
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok('T4a subir comensales 5 → 8 (la sala sigue pesando 20)', pg_temp.upd('P1', 'numero_comensales = 8'));
  perform pg_temp.ok('T4b cambiar la hora dentro del turno', pg_temp.upd('P1', 'hora = ''15:30'''));
  perform pg_temp.ok('T4c confirmada → verificada', pg_temp.upd('P1', 'estado = ''verificada'''));
  perform pg_temp.ok('T4d reenviar todas las columnas del trigger sin cambiarlas',
    pg_temp.upd('P1', 'fecha = fecha, hora = hora, numero_comensales = numero_comensales, estado = estado, marca = marca, espacio_id = espacio_id'));
  perform pg_temp.ok('T4e bajar comensales', pg_temp.upd('P1', 'numero_comensales = 3'));
  assert pg_temp.dato('P1', 'numero_comensales') = '3', 'T4f: P1 debía quedar con 3 comensales';
  perform pg_temp.ok('T4g volver a confirmada', pg_temp.upd('P1', 'estado = ''confirmada'''));
end
$$;

-- ---------------------------------------------------------------------------
-- T5 salas NO privadas: sin cambios (varias reservas en el mismo turno, cuentan por comensales)
--    Comida de d+1: relleno hasta (aforo - 5), luego 2 + 3 en la sala normal
--    (justo el aforo) y ni uno más.
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  cap int  := current_setting('sala_test.cap')::int;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  perform pg_temp.ok('T5a relleno', pg_temp.res('relleno comida d1', d + 1, '13:00', cap - 5, 'confirmada', null));
  perform pg_temp.ok('T5b 2 en la sala normal', pg_temp.res('N1', d + 1, '13:15', 2, 'confirmada', nor));
  perform pg_temp.ok('T5c 3 más en la MISMA sala normal y turno', pg_temp.res('N2', d + 1, '13:45', 3, 'confirmada', nor));
  r := pg_temp.res('N3', d + 1, '14:00', 1, 'confirmada', nor);
  perform pg_temp.rechazo('T5d uno más: aforo lleno (se cuenta por comensales)', r, 'Aforo superado para el turno.');
  assert r not like '%sala privada%', 'T5e: el mensaje de aforo de una sala normal no debía hablar de salas privadas: ' || r;
  perform pg_temp.ok('T5f mover una reserva entre la normal y sin sala', pg_temp.upd('N2', 'espacio_id = null'));
  perform pg_temp.ok('T5g y volver', pg_temp.upd('N2', 'espacio_id = ''' || current_setting('sala_test.normal') || '''::uuid'));
end
$$;

-- ---------------------------------------------------------------------------
-- T6 MOVER a la sala privada (UPDATE espacio_id) se comprueba
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  nor uuid := current_setting('sala_test.normal')::uuid;
  r   text;
begin
  -- Cena de d: P-cena (4) tiene la privada. X (2, sin sala) intenta entrar.
  perform pg_temp.ok('T6a X en la cena de d, sin sala', pg_temp.res('X', d, '21:30', 2, 'confirmada', null));
  r := pg_temp.upd('X', 'espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T6b mover X a la privada ocupada', r, 'Sala privada ocupada');
  assert pg_temp.dato('X', 'espacio_id') is null, 'T6c: X debía seguir sin sala';
  perform pg_temp.ok('T6d mover X a una sala normal', pg_temp.upd('X', 'espacio_id = ''' || nor || '''::uuid'));

  -- Comida de d+2, libre: Y entra; Z no puede entrar mientras Y esté.
  perform pg_temp.ok('T6e Y, comida de d+2, sin sala', pg_temp.res('Y', d + 2, '13:00', 3, 'confirmada', null));
  perform pg_temp.ok('T6f Z, comida de d+2, sin sala', pg_temp.res('Z', d + 2, '14:00', 2, 'confirmada', null));
  perform pg_temp.ok('T6g mover Y a la privada libre', pg_temp.upd('Y', 'espacio_id = ''' || pri || '''::uuid'));
  r := pg_temp.upd('Z', 'espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T6h mover Z a la privada ya tomada por Y', r, 'Sala privada ocupada');
  perform pg_temp.ok('T6i Y sale de la privada (bajar el peso nunca se rechaza)', pg_temp.upd('Y', 'espacio_id = ''' || nor || '''::uuid'));
  perform pg_temp.ok('T6j ahora Z sí puede entrar', pg_temp.upd('Z', 'espacio_id = ''' || pri || '''::uuid'));

  -- Mover de día/turno dentro de la privada.
  r := pg_temp.upd('Z', 'fecha = fecha - 2');   -- a la comida de d, ocupada por P1
  perform pg_temp.rechazo('T6k llevar Z a un día/turno ocupado', r, 'Sala privada ocupada');
  perform pg_temp.ok('T6l llevar Z a la cena de d+2 (libre)', pg_temp.upd('Z', 'hora = ''21:00'''));

  -- Verificar con sala: pendiente → verificada escribiendo espacio_id (el camino del modal «Verificar»).
  perform pg_temp.ok('T6m W pendiente en la cena de d+3', pg_temp.res('W', d + 3, '21:00', 2, 'pendiente', null));
  perform pg_temp.ok('T6n W → verificada con la privada libre', pg_temp.upd('W', 'estado = ''verificada'', espacio_id = ''' || pri || '''::uuid'));
  perform pg_temp.ok('T6o W2 pendiente en la cena de d+3', pg_temp.res('W2', d + 3, '22:00', 2, 'pendiente', null));
  r := pg_temp.upd('W2', 'estado = ''verificada'', espacio_id = ''' || pri || '''::uuid');
  perform pg_temp.rechazo('T6p W2 → verificada con la privada ocupada', r, 'Sala privada ocupada');
  assert pg_temp.dato('W2', 'estado') = 'pendiente', 'T6q: W2 debía seguir pendiente';
end
$$;

-- ---------------------------------------------------------------------------
-- T7 cancelar / «No vino» libera la sala; deshacerlo choca si otra la tomó
--    (comida de d: P1 la tiene)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  r   text;
begin
  perform pg_temp.ok('T7a cancelar P1', pg_temp.upd('P1', 'estado = ''cancelada'''));
  perform pg_temp.ok('T7b ahora P2 puede reservar la privada (comida de d)', pg_temp.res('P2', d, '14:00', 2, 'pendiente', pri));
  r := pg_temp.upd('P1', 'estado = ''confirmada''');
  perform pg_temp.rechazo('T7c reactivar P1 con P2 dentro', r, 'Sala privada ocupada');
  assert pg_temp.dato('P1', 'estado') = 'cancelada', 'T7d: P1 debía seguir cancelada';

  perform pg_temp.ok('T7e P2 «No vino»', pg_temp.upd('P2', 'estado = ''no_show'''));
  perform pg_temp.ok('T7f P1 vuelve (la sala está libre otra vez)', pg_temp.upd('P1', 'estado = ''confirmada'''));
  r := pg_temp.upd('P2', 'estado = ''confirmada''');
  perform pg_temp.rechazo('T7g deshacer el «No vino» de P2 con P1 dentro', r, 'Sala privada ocupada');
end
$$;

-- ---------------------------------------------------------------------------
-- T8 «completada» (Llegó): sigue ocupando la sala
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
  r   text;
begin
  perform pg_temp.ok('T8a «Ha llegado» sobre la que ya está en la privada (P1)', pg_temp.upd('P1', 'estado = ''completada'''));
  r := pg_temp.res('P3', d, '14:00', 2, 'pendiente', pri);
  perform pg_temp.rechazo('T8b nueva reserva con P1 ya sentada', r, 'Sala privada ocupada');
  r := pg_temp.res('P3 llegada directa', d, '14:00', 2, 'completada', pri);
  perform pg_temp.rechazo('T8c alta directa como completada en la sala ocupada', r, 'Sala privada ocupada');

  -- Una completada que se mueve a la privada ocupada también choca; a la libre, no.
  perform pg_temp.ok('T8d C, cena de d+1 en una sala normal, completada', pg_temp.res('C', d + 1, '21:30', 2, 'completada', current_setting('sala_test.normal')::uuid));
  r := pg_temp.upd('C', 'espacio_id = ''' || pri || '''::uuid');   -- P-d1 tiene la cena de d+1
  perform pg_temp.rechazo('T8e mover una completada a la privada ocupada', r, 'Sala privada ocupada');

  -- Marcar la llegada de una reserva viva que ya está en la sala nunca falla.
  perform pg_temp.ok('T8f P-d1 «Ha llegado»', pg_temp.upd('P-d1', 'estado = ''completada'''));
  perform pg_temp.ok('T8g y deshacerlo', pg_temp.upd('P-d1', 'estado = ''confirmada'''));

  -- Cancelando P1 se libera y entra otra.
  perform pg_temp.ok('T8h cancelar P1', pg_temp.upd('P1', 'estado = ''cancelada'''));
  perform pg_temp.ok('T8i P3 entra', pg_temp.res('P3', d, '14:00', 2, 'confirmada', pri));
end
$$;

-- ---------------------------------------------------------------------------
-- T9 datos heredados: dos reservas vivas ya duplicadas (no puede crearlas el
--    trigger; se fuerzan apagándolo, dentro de la transacción)
-- ---------------------------------------------------------------------------
alter table public.reservas disable trigger trg_validar_capacidad;
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  pri uuid := current_setting('sala_test.privada')::uuid;
begin
  perform pg_temp.ok('T9a duplicado heredado 1 (cena de d+4)', pg_temp.res('H1', d + 4, '21:00', 3, 'confirmada', pri));
  perform pg_temp.ok('T9b duplicado heredado 2 (cena de d+4)', pg_temp.res('H2', d + 4, '21:30', 2, 'confirmada', pri));
end
$$;
alter table public.reservas enable trigger trg_validar_capacidad;

do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  r   text;
begin
  perform pg_temp.ok('T9c bajar comensales de una duplicada (no añade ocupación)', pg_temp.upd('H1', 'numero_comensales = 2'));
  perform pg_temp.ok('T9d mover la hora dentro del turno', pg_temp.upd('H1', 'hora = ''22:00'''));
  perform pg_temp.ok('T9e cambiar el nombre (no dispara el trigger)', pg_temp.upd('H1', 'telefono = ''600000000'''));
  r := pg_temp.upd('H1', 'fecha = fecha + 0, numero_comensales = 4');
  perform pg_temp.rechazo('T9f subir comensales SÍ vuelve a comprobar', r, 'Sala privada ocupada');
  assert (select count(*) from public.reservas
          where nombre in ('zz-test-sala H1', 'zz-test-sala H2') and estado = 'confirmada') = 2,
    'T9g: las dos heredadas debían seguir vivas (la migración no toca filas)';
end
$$;

-- ---------------------------------------------------------------------------
-- T10 una sala privada DESACTIVADA no cuenta (ni exclusividad ni peso)
-- ---------------------------------------------------------------------------
do $$
declare
  d   date := current_setting('sala_test.dia')::date;
  off uuid := current_setting('sala_test.apagada')::uuid;
begin
  perform pg_temp.ok('T10a primera en la privada apagada', pg_temp.res('O1', d + 4, '13:00', 5, 'confirmada', off));
  perform pg_temp.ok('T10b segunda en la privada apagada, mismo turno', pg_temp.res('O2', d + 4, '13:30', 5, 'confirmada', off));
end
$$;

-- ---------------------------------------------------------------------------
-- A9 cierre: nada de lo anterior ha tocado filas que no sean de prueba
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.reservas where notas_cliente = 'zz-test-sala' and nombre not like 'zz-test-sala %';
  assert n = 0, 'A9: hay reservas de prueba con un nombre inesperado';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (ya fuera de la transacción): no debe quedar nada de la prueba.
-- Si cambiaste sala_test.dia, cambia aquí también las dos fechas.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.reservas where nombre like 'zz-test-sala%')                          as reservas_de_prueba,
  (select count(*) from public.reservas where fecha between '2099-07-10' and '2099-07-14')          as reservas_en_los_dias_de_prueba,
  (select count(*) from public.espacios_reserva where nombre like 'zz-test-sala%')                  as salas_de_prueba,
  (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = 'public.validar_capacidad_reserva()'::regprocedure) as md5_funcion,
  (select count(*) from pg_trigger where tgrelid = 'public.reservas'::regclass and tgname = 'trg_validar_capacidad' and tgenabled = 'O') as trigger_activo;
-- -> 0 | 0 | 0 | <md5 de la función> | 1
