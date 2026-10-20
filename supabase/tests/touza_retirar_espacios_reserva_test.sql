set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas SQL de supabase/migrations/20261003120000_touza_retirar_espacios_reserva.sql
-- ---------------------------------------------------------------------------
-- SQL plano: cada comprobación es un ASSERT dentro de un DO. Todo va dentro de
-- BEGIN … ROLLBACK y la transacción es de SOLO LECTURA (no escribe nada).
-- DESPUÉS de aplicar la migración (desde adminpanelct/):
--   npx supabase db query --linked -f supabase/tests/touza_retirar_espacios_reserva_test.sql
-- Si termina sin ERROR, todo ha pasado. Si falla, el mensaje dice cuál (A0…A7).
-- ANTES de aplicarla, A0 falla a propósito («la migración no parece aplicada»).
-- ===========================================================================

begin;
set transaction read only;

do $$
declare
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',  -- Terraza (Touza)
    '1c976f78-0bd7-4d10-b7bf-5208c910d16d',  -- El Reservado
    '1d268991-ab58-49c6-b70e-10d9533595a7'   -- Interior
  ]::uuid[];
  n   integer;
  m   integer;
  txt text;
begin
  -- A0. La migración está aplicada: ninguna sala con marca touza ni con esos ids.
  select count(*) into n from public.espacios_reserva
   where caracteristicas->>'marca' = 'touza' or id = any (c_salas);
  assert n = 0, format('A0: la migración no parece aplicada (quedan %s salas de Touza)', n);

  -- A1. Casa Tomás intacta: 4 salas activas, 170 plazas, todas con su marca (o sin ella).
  select count(*), coalesce(sum(capacidad_maxima), 0) into n, m from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas';
  assert n = 4 and m = 170, format('A1: Casa Tomás tiene %s salas activas / %s plazas (esperado 4 / 170)', n, m);
  select count(*) into n from public.espacios_reserva;
  assert n = 4, format('A1: la tabla tiene %s salas (esperado 4: solo Casa Tomás)', n);

  -- A2. Los nombres de Casa Tomás siguen siendo únicos y ya no hay dos «Terraza».
  select count(*) into n from public.espacios_reserva where nombre = 'Terraza';
  assert n = 1, format('A2: hay %s salas llamadas Terraza (esperado 1, la de Casa Tomás)', n);

  -- A3. Ningún dato colgando de un espacio que ya no existe (las FK lo garantizan; los dos
  --     sitios SIN FK se miran aparte).
  select count(*) into n from public.asignaciones_mesa_descartadas d
   where d.espacio_id is not null and not exists (select 1 from public.espacios_reserva e where e.id = d.espacio_id);
  assert n = 0, format('A3: %s asignaciones descartadas apuntan a una sala inexistente', n);
  select count(*) into n from public.configuracion_reservas c
   where exists (select 1 from unnest(c.asignacion_espacios_excluidos) x
                  where not exists (select 1 from public.espacios_reserva e where e.id = x));
  assert n = 0, format('A3: %s filas de configuracion_reservas excluyen una sala inexistente', n);

  -- A4. Ninguna reserva ni solicitud se quedó con una sala inventada, y ninguna reserva viva es de Touza.
  select count(*) into n from public.reservas r
   where (r.espacio_id is not null and not exists (select 1 from public.espacios_reserva e where e.id = r.espacio_id))
      or (r.espacio_solicitado_id is not null and not exists (select 1 from public.espacios_reserva e where e.id = r.espacio_solicitado_id));
  assert n = 0, format('A4: %s reservas apuntan a una sala inexistente', n);
  select count(*) into n from public.reservas
   where marca = 'touza' and estado in ('pendiente', 'verificada', 'confirmada');
  assert n = 0, format('A4: quedan %s reservas VIVAS de Touza', n);

  -- A5. El aforo de Touza es 0 por las dos vías: la tabla y la función que usa el bot nuevo.
  select coalesce(sum(capacidad_maxima), 0) into n from public.espacios_reserva
   where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'touza';
  assert n = 0, format('A5: aforo de Touza en la tabla = %s (esperado 0)', n);
  select public.fn_capacidad_efectiva_marca('touza') into n;
  assert n = 0, format('A5: fn_capacidad_efectiva_marca(''touza'') = %s (esperado 0)', n);

  -- A6. Las vistas que leen espacios_reserva no enseñan nada de Touza y siguen funcionando.
  select count(*) into n from public.vista_capacidad_espacios where marca = 'touza';
  assert n = 0, format('A6: vista_capacidad_espacios tiene %s filas de Touza', n);
  select count(*) into n from public.vista_capacidad_espacios;
  assert n = 4, format('A6: vista_capacidad_espacios tiene %s filas (esperado 4)', n);
  perform 1 from public.vista_asignacion_dia limit 1;

  -- A7. El trigger de aforo sigue en pie y sigue siendo por marca (rechaza Touza con aforo 0).
  select pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure) into txt;
  assert txt like '%activa = true%' and txt like '%caracteristicas->>''marca''%',
    'A7: validar_capacidad_reserva ya no suma las salas activas por marca';
  select count(*) into n from pg_trigger
   where tgrelid = 'public.reservas'::regclass and not tgisinternal and tgname = 'trg_validar_capacidad';
  assert n = 1, 'A7: falta el trigger trg_validar_capacidad en reservas';
end
$$;

rollback;
