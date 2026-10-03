set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas SQL de 20261003110000_reservado_mesa_unica.sql
-- ---------------------------------------------------------------------------
-- SQL plano: cada comprobación es un ASSERT dentro de un DO. Todo va dentro
-- de BEGIN … ROLLBACK (las reservas de prueba se deshacen). DESPUÉS de aplicar
-- la migración:
--   npx supabase db query --linked -f supabase/tests/reservado_mesa_unica_test.sql
-- Si termina sin ERROR, todo ha pasado.
-- ===========================================================================

begin;

do $$
declare
  c_espacio constant uuid := '78448cb5-29d2-43a2-9c39-d499d4cb2ef3';
  r record;
  n integer;
  v_mesa uuid;
  v_dia date := current_date + 400;   -- lejos de cualquier reserva real
  v_r1 uuid;
  v_r2 uuid;
  v_r3 uuid;
  v_msg text;
  v_estado text;
begin
  -- A0. La migración está aplicada: una mesa «Reservado» en la sala.
  select count(*) into n from public.mesas where espacio_id = c_espacio and nombre = 'Reservado';
  assert n = 1, 'A0: la migración no parece aplicada (no hay mesa «Reservado»)';

  -- A1. Es la ÚNICA mesa de la sala (ni inactivas ni fusiones) y tiene todas las plazas.
  select count(*) into n from public.mesas where espacio_id = c_espacio;
  assert n = 1, format('A1: el Reservado tiene %s mesas en total (esperaba 1)', n);
  select * into r from public.mesas where espacio_id = c_espacio;
  v_mesa := r.id;
  assert coalesce(r.activa, true) and not coalesce(r.is_merged, false), 'A1: la mesa no es real y activa';
  assert r.capacidad = (select capacidad_maxima from public.espacios_reserva where id = c_espacio),
    'A1: la mesa no tiene las plazas de la sala';
  assert r.capacidad = 20, format('A1: capacidad %s (esperaba 20)', r.capacidad);

  -- A2. Plano mínimo coherente (50 px/m) y la mesa cabe dentro (pos en m, tamaño en cm).
  select * into r from public.planos_espacio where espacio_id = c_espacio;
  assert found, 'A2: el Reservado no tiene plano';
  assert r.pixels_per_meter = 50 and r.ancho = r.ancho_metros * 50 and r.alto = r.alto_metros * 50,
    'A2: dimensiones del plano incoherentes';
  assert jsonb_typeof(r.configuracion->'elementos') = 'array'
     and (r.configuracion->'realDimensions'->>'width')::numeric = r.ancho_metros
     and (r.configuracion->'realDimensions'->>'height')::numeric = r.alto_metros,
    'A2: configuracion.realDimensions no coincide con el plano';
  select count(*) into n from public.mesas m
   where m.id = v_mesa
     and m.pos_x >= 0 and m.pos_y >= 0
     and m.pos_x + m.ancho / 100 <= r.ancho_metros
     and m.pos_y + m.alto / 100 <= r.alto_metros;
  assert n = 1, 'A2: la mesa queda fuera del plano';

  -- A3. El espacio ya cuadra en la vista de capacidad; el aforo (capacidad_maxima) no se ha movido.
  select * into r from public.vista_capacidad_espacios where espacio_id = c_espacio;
  assert r.cuadra and r.plazas_mesas = 20 and r.mesas_reales = 1 and r.diferencia = 0,
    format('A3: vista_capacidad_espacios: cuadra=%s plazas=%s mesas=%s', r.cuadra, r.plazas_mesas, r.mesas_reales);
  assert (select capacidad_maxima from public.espacios_reserva where id = c_espacio) = 20, 'A3: cambió la capacidad_maxima';

  -- A4. No se ha tocado ningún otro espacio (Touza sigue sin mesas; las demás salas conservan las suyas).
  select count(*) into n from public.mesas where espacio_id <> c_espacio
   and espacio_id in ('1c976f78-0bd7-4d10-b7bf-5208c910d16d', '1d268991-ab58-49c6-b70e-10d9533595a7', '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12');
  assert n = 0, 'A4: aparecieron mesas en espacios de Touza';

  -- A5. EXCLUSIVIDAD POR TURNO. Tres reservas del Reservado el mismo día:
  --     dos de comida (13:00 y 14:30) y una de cena.
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, espacio_id, notas_cliente)
  values ('zz-test-reservado r1', v_dia, '13:00', 3, 'confirmada', 'casa_tomas', 'manual', c_espacio, 'zz-test-reservado')
  returning id into v_r1;
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, espacio_id, notas_cliente)
  values ('zz-test-reservado r2', v_dia, '14:30', 12, 'confirmada', 'casa_tomas', 'manual', c_espacio, 'zz-test-reservado')
  returning id into v_r2;
  insert into public.reservas (nombre, fecha, hora, numero_comensales, estado, marca, canal, espacio_id, notas_cliente)
  values ('zz-test-reservado r3', v_dia, '21:00', 8, 'confirmada', 'casa_tomas', 'manual', c_espacio, 'zz-test-reservado')
  returning id into v_r3;

  -- La primera se queda la sala entera.
  select count(*) into n from public.asignar_mesas_reserva(v_r1, array[v_mesa]);
  assert n = 1, 'A5a: la primera reserva no pudo quedarse la mesa del Reservado';

  -- La segunda, mismo turno (comida): MESA_OCUPADA con el nombre de la mesa y check_violation.
  v_msg := null; v_estado := null;
  begin
    perform public.asignar_mesas_reserva(v_r2, array[v_mesa]);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_estado := sqlstate;
  end;
  assert v_msg like 'MESA_OCUPADA:%Reservado%', format('A5b: la segunda reserva del turno NO fue rechazada con MESA_OCUPADA (%s)', coalesce(v_msg, 'sin error'));
  assert v_estado = '23514', format('A5b: SQLSTATE %s (esperaba 23514)', v_estado);
  assert (select count(*) from public.asignaciones_mesa where reserva_id = v_r2) = 0,
    'A5b: el intento rechazado dejó una asignación';

  -- La tercera es de CENA el mismo día: otro turno, la mesa vuelve a estar libre.
  select count(*) into n from public.asignar_mesas_reserva(v_r3, array[v_mesa]);
  assert n = 1, 'A5c: la cena del mismo día no pudo quedarse el Reservado';
  assert (select turno from public.asignaciones_mesa where reserva_id = v_r3) = 'cena', 'A5c: turno distinto de cena';

  -- Un INSERT directo en la tabla (saltándose la RPC) tampoco puede duplicar el turno: lo para el índice único.
  v_msg := null;
  begin
    insert into public.asignaciones_mesa (reserva_id, mesa_id) values (v_r2, v_mesa);
  exception when unique_violation then
    v_msg := 'unique_violation';
  end;
  assert v_msg = 'unique_violation', 'A5d: un INSERT directo duplicó la mesa del Reservado en el mismo turno';

  -- A6. Cancelar la primera libera la sala para la segunda del mismo turno.
  update public.reservas set estado = 'cancelada' where id = v_r1;
  select count(*) into n from public.asignaciones_mesa where reserva_id = v_r1;
  assert n = 0, 'A6: cancelar la reserva no liberó el Reservado';
  select count(*) into n from public.asignar_mesas_reserva(v_r2, array[v_mesa]);
  assert n = 1, 'A6: tras cancelar, la otra reserva del turno no pudo quedarse el Reservado';
end;
$$;

select 'reservado_mesa_unica: todas las comprobaciones han pasado' as resultado;

rollback;
