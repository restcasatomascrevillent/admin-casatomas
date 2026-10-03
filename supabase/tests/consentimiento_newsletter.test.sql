-- ===========================================================================
-- Pruebas SQL del alta en la newsletter desde la reserva (RGPD)
--   * trigger  agregar_suscriptor_al_reservar_consentida  (AFTER INSERT ON reservas)
--   * funcion  agregar_suscriptor_desde_reserva_consentida()
--   * migracion 20261003143000_reserva_web_prueba_consentimiento.sql
--     (reservas.condiciones_aceptadas_at, newsletter_suscriptores.fecha_consentimiento
--      y .reserva_consentimiento_id)
-- ---------------------------------------------------------------------------
-- AUTOCONTENIDO: todo va dentro de BEGIN ... ROLLBACK, no depende de ningun
-- SET previo y no deja NADA en la base de datos (las reservas y suscriptores
-- de prueba se deshacen al final). Fichero en ASCII puro a proposito: asi da
-- igual la codificacion del cliente que lo envie.
--
-- CUANDO: DESPUES de aplicar la migracion 20261003143000 (si no, A0 falla con
-- un mensaje claro y no se ejecuta nada mas).
--
-- COMO (desde la raiz de adminpanelct):
--   npx supabase db query --linked -f supabase/tests/consentimiento_newsletter.test.sql
--
-- RESULTADO: si termina SIN "ERROR", han pasado todas las comprobaciones.
-- Si alguna falla, el mensaje empieza por su codigo (A1, A2...) y explica que
-- se esperaba. Al fallar, Postgres aborta la transaccion: tampoco queda nada.
--
-- Datos de prueba: emails *@consentimiento.invalid (dominio reservado, nunca
-- existe), nombres "zz-test-consentimiento ..." y fecha de reserva a 400 dias
-- vista (lejos de cualquier servicio real y de su aforo).
-- ===========================================================================

begin;

set local client_encoding to 'UTF8';
set local search_path to public;

do $$
declare
  v_dia      date := current_date + 400;
  n          integer;
  s          record;
  v_r        record;
  v_reserva  uuid;
  v_reserva2 uuid;
  v_antes    record;
begin
  -- -------------------------------------------------------------------------
  -- A0. La migracion esta aplicada y el trigger es el esperado.
  -- -------------------------------------------------------------------------
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'reservas' and column_name = 'condiciones_aceptadas_at';
  assert n = 1, 'A0: falta reservas.condiciones_aceptadas_at (aplica antes la migracion 20261003143000)';

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'newsletter_suscriptores'
     and column_name in ('fecha_consentimiento', 'reserva_consentimiento_id', 'origen_alta', 'fecha_baja', 'origen_baja');
  assert n = 5, format('A0: newsletter_suscriptores tiene %s de las 5 columnas esperadas (migraciones 20260919120000, 20260926062009 y 20261003143000)', n);

  select count(*) into n from pg_constraint
   where conname = 'newsletter_suscriptores_reserva_consentimiento_id_fkey'
     and conrelid = 'public.newsletter_suscriptores'::regclass
     and confrelid = 'public.reservas'::regclass
     and confdeltype = 'n';  -- ON DELETE SET NULL
  assert n = 1, 'A0: falta la FK reserva_consentimiento_id -> reservas(id) ON DELETE SET NULL';

  select t.tgenabled, t.tgtype, p.proname, pg_get_triggerdef(t.oid) as def
    into v_r
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.reservas'::regclass
     and t.tgname = 'agregar_suscriptor_al_reservar_consentida'
     and not t.tgisinternal;
  assert found, 'A0: no existe el trigger agregar_suscriptor_al_reservar_consentida en reservas';
  assert v_r.tgenabled <> 'D', 'A0: el trigger esta DESACTIVADO';
  assert v_r.proname = 'agregar_suscriptor_desde_reserva_consentida',
    format('A0: el trigger apunta a %s()', v_r.proname);
  -- tgtype: bit 0 = FOR EACH ROW, bit 1 = BEFORE (0 => AFTER), bit 2 = INSERT, bit 4 = UPDATE.
  assert (v_r.tgtype & 1) = 1 and (v_r.tgtype & 2) = 0 and (v_r.tgtype & 4) = 4 and (v_r.tgtype & 16) = 0,
    format('A0: el trigger no es AFTER INSERT FOR EACH ROW (sin UPDATE): %s', v_r.def);
  assert v_r.def ilike '%consentimiento_newsletter = true%',
    format('A0: el WHEN del trigger no exige consentimiento_newsletter = true: %s', v_r.def);

  -- La funcion rellena la prueba de consentimiento (version de 20261003143000).
  assert (select prosrc from pg_proc
           where proname = 'agregar_suscriptor_desde_reserva_consentida'
             and pronamespace = 'public'::regnamespace) ilike '%reserva_consentimiento_id%',
    'A0: la funcion del trigger es la version ANTIGUA (no rellena reserva_consentimiento_id): falta aplicar 20261003143000';

  -- Ningun dato de prueba previo (el script no pisa nada real).
  select count(*) into n from public.newsletter_suscriptores where email like '%@consentimiento.invalid';
  assert n = 0, 'A0: ya hay suscriptores @consentimiento.invalid: alguien dejo datos de prueba';

  -- -------------------------------------------------------------------------
  -- A1. Reserva WEB con la casilla marcada -> suscriptor ACTIVO con la prueba.
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, condiciones_aceptadas_at, notas_cliente)
  values ('zz-test-consentimiento A1', 'a1@consentimiento.invalid', '+34600000001', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', true, now(), 'zz-test-consentimiento')
  returning id, created_at into v_r;

  select * into s from public.newsletter_suscriptores where email = 'a1@consentimiento.invalid';
  assert found, 'A1: la reserva con consentimiento NO creo el suscriptor';
  assert s.activo, 'A1: el suscriptor no esta activo';
  assert s.origen_alta = 'reserva_web', format('A1: origen_alta = %L (esperaba reserva_web)', s.origen_alta);
  assert s.nombre = 'zz-test-consentimiento A1', format('A1: nombre = %L', s.nombre);
  assert s.reserva_consentimiento_id = v_r.id, 'A1: reserva_consentimiento_id no apunta a la reserva';
  assert s.fecha_consentimiento is not null, 'A1: fecha_consentimiento es NULL';
  assert s.fecha_consentimiento = v_r.created_at,
    format('A1: fecha_consentimiento %s <> created_at de la reserva %s', s.fecha_consentimiento, v_r.created_at);
  assert s.fecha_baja is null and s.origen_baja is null, 'A1: el alta nueva trae datos de baja';

  -- La reserva conserva su propia prueba (inmutable).
  select consentimiento_newsletter, condiciones_aceptadas_at into v_antes from public.reservas where id = v_r.id;
  assert v_antes.consentimiento_newsletter and v_antes.condiciones_aceptadas_at is not null,
    'A1: la reserva no guardo consentimiento_newsletter / condiciones_aceptadas_at';

  -- -------------------------------------------------------------------------
  -- A2. Reserva SIN la casilla (y la de por defecto) -> no crea suscriptor.
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A2', 'a2@consentimiento.invalid', '+34600000002', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', false, 'zz-test-consentimiento');
  select count(*) into n from public.newsletter_suscriptores where email = 'a2@consentimiento.invalid';
  assert n = 0, 'A2: una reserva con consentimiento_newsletter = false creo un suscriptor';

  -- Sin indicar la columna: el DEFAULT debe ser false y tampoco suscribir.
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente)
  values ('zz-test-consentimiento A2b', 'a2b@consentimiento.invalid', '+34600000022', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', 'zz-test-consentimiento')
  returning consentimiento_newsletter into v_antes;
  assert v_antes.consentimiento_newsletter = false, 'A2: el DEFAULT de reservas.consentimiento_newsletter no es false';
  select count(*) into n from public.newsletter_suscriptores where email = 'a2b@consentimiento.invalid';
  assert n = 0, 'A2: una reserva sin la columna (DEFAULT) creo un suscriptor';

  -- -------------------------------------------------------------------------
  -- A3. Suscriptor DADO DE BAJA + reserva SIN casilla -> sigue de baja, intacto.
  -- -------------------------------------------------------------------------
  insert into public.newsletter_suscriptores (email, nombre, activo, origen_alta, fecha_baja, origen_baja)
  values ('baja@consentimiento.invalid', 'zz-test-consentimiento baja', false, 'panel_manual',
          now() - interval '30 days', 'enlace_email');
  select * into v_antes from public.newsletter_suscriptores where email = 'baja@consentimiento.invalid';

  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A3', 'baja@consentimiento.invalid', '+34600000003', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', false, 'zz-test-consentimiento');

  select * into s from public.newsletter_suscriptores where email = 'baja@consentimiento.invalid';
  assert not s.activo, 'A3: una reserva SIN casilla reactivo a quien se habia dado de baja';
  assert s.fecha_baja = v_antes.fecha_baja and s.origen_baja = v_antes.origen_baja,
    'A3: una reserva SIN casilla toco la constancia de la baja';
  assert s.origen_alta is not distinct from v_antes.origen_alta and s.reserva_consentimiento_id is null
     and s.fecha_consentimiento is null and s.updated_at = v_antes.updated_at,
    'A3: una reserva SIN casilla modifico el suscriptor dado de baja';

  -- -------------------------------------------------------------------------
  -- A4. Dado de baja + reserva CON casilla -> se reactiva (consentimiento nuevo).
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, condiciones_aceptadas_at, notas_cliente)
  values ('zz-test-consentimiento A4', 'baja@consentimiento.invalid', '+34600000004', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', true, now(), 'zz-test-consentimiento')
  returning id, created_at into v_r;

  select count(*) into n from public.newsletter_suscriptores where email = 'baja@consentimiento.invalid';
  assert n = 1, format('A4: hay %s filas para el mismo email (esperaba 1: upsert, no duplicado)', n);
  select * into s from public.newsletter_suscriptores where email = 'baja@consentimiento.invalid';
  assert s.activo, 'A4: la reserva CON casilla no reactivo al suscriptor dado de baja';
  assert s.fecha_baja is null and s.origen_baja is null, 'A4: la reactivacion no limpio fecha_baja/origen_baja';
  assert s.origen_alta = 'reserva_web', format('A4: origen_alta = %L (esperaba reserva_web)', s.origen_alta);
  assert s.reserva_consentimiento_id = v_r.id, 'A4: reserva_consentimiento_id no apunta a la reserva que reactivo';
  assert s.fecha_consentimiento = v_r.created_at, 'A4: fecha_consentimiento no es la de la reserva que reactivo';
  assert s.nombre = 'zz-test-consentimiento A4', format('A4: nombre = %L (esperaba el de la reserva nueva)', s.nombre);

  -- -------------------------------------------------------------------------
  -- A5. Email vacio o NULL con la casilla -> no crea nada.
  -- -------------------------------------------------------------------------
  select count(*) into n from public.newsletter_suscriptores;
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A5 vacio', '', '+34600000005', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', true, 'zz-test-consentimiento');
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A5 null', null, '+34600000055', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', true, 'zz-test-consentimiento');
  assert (select count(*) from public.newsletter_suscriptores) = n,
    'A5: una reserva con email vacio o NULL creo un suscriptor';
  assert not exists (select 1 from public.newsletter_suscriptores where email = ''),
    'A5: existe un suscriptor con email vacio';

  -- -------------------------------------------------------------------------
  -- A6. UPDATE de una reserva NO dispara el alta (solo cuenta la casilla al reservar).
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A6', 'a6@consentimiento.invalid', '+34600000006', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', false, 'zz-test-consentimiento')
  returning id into v_reserva;
  update public.reservas set consentimiento_newsletter = true where id = v_reserva;
  update public.reservas set estado = 'confirmada' where id = v_reserva;
  select count(*) into n from public.newsletter_suscriptores where email = 'a6@consentimiento.invalid';
  assert n = 0, 'A6: un UPDATE (consentimiento_newsletter -> true / cambio de estado) creo un suscriptor';

  -- Cambiar el email de una reserva YA consentida tampoco da de alta el email nuevo.
  update public.reservas set email = 'a6-nuevo@consentimiento.invalid'
   where email = 'a1@consentimiento.invalid' and notas_cliente = 'zz-test-consentimiento';
  select count(*) into n from public.newsletter_suscriptores where email = 'a6-nuevo@consentimiento.invalid';
  assert n = 0, 'A6: cambiar el email de una reserva consentida dio de alta el email nuevo';

  -- -------------------------------------------------------------------------
  -- A7. Canal telefono con consentimiento -> origen_alta 'reserva_telefono'.
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A7', 'a7@consentimiento.invalid', '+34600000007', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'telefono', true, 'zz-test-consentimiento')
  returning id into v_reserva;
  select * into s from public.newsletter_suscriptores where email = 'a7@consentimiento.invalid';
  assert found and s.activo, 'A7: la reserva telefonica con consentimiento no creo el suscriptor';
  assert s.origen_alta = 'reserva_telefono', format('A7: origen_alta = %L (esperaba reserva_telefono)', s.origen_alta);
  assert s.reserva_consentimiento_id = v_reserva, 'A7: reserva_consentimiento_id no apunta a la reserva telefonica';

  -- Canal manual (panel) cae en 'reserva_web' segun la funcion actual: se fija para
  -- que cambiarlo sea una decision consciente.
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A7m', 'a7m@consentimiento.invalid', '+34600000077', v_dia, '14:00', 2, 'pendiente',
          'casa_tomas', 'manual', true, 'zz-test-consentimiento');
  select origen_alta into s from public.newsletter_suscriptores where email = 'a7m@consentimiento.invalid';
  assert s.origen_alta = 'reserva_web', format('A7: canal manual -> origen_alta = %L', s.origen_alta);

  -- -------------------------------------------------------------------------
  -- A8. Suscriptor ACTIVO que vuelve a reservar con la casilla -> la prueba se
  --     actualiza a la reserva mas reciente (consentimiento renovado), sin duplicar.
  -- -------------------------------------------------------------------------
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A8', 'a7@consentimiento.invalid', '+34600000008', v_dia + 1, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', true, 'zz-test-consentimiento')
  returning id into v_reserva2;
  select count(*) into n from public.newsletter_suscriptores where email = 'a7@consentimiento.invalid';
  assert n = 1, format('A8: %s filas para el mismo email tras reconsentir', n);
  select * into s from public.newsletter_suscriptores where email = 'a7@consentimiento.invalid';
  assert s.activo and s.reserva_consentimiento_id = v_reserva2 and s.origen_alta = 'reserva_web',
    'A8: el reconsentimiento no actualizo reserva_consentimiento_id/origen_alta a la reserva nueva';

  -- Y una reserva posterior SIN casilla no borra la prueba del consentimiento anterior.
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               consentimiento_newsletter, notas_cliente)
  values ('zz-test-consentimiento A8b', 'a7@consentimiento.invalid', '+34600000088', v_dia + 2, '14:00', 2, 'pendiente',
          'casa_tomas', 'web', false, 'zz-test-consentimiento');
  select * into s from public.newsletter_suscriptores where email = 'a7@consentimiento.invalid';
  assert s.activo and s.reserva_consentimiento_id = v_reserva2,
    'A8: una reserva posterior SIN casilla toco al suscriptor activo';

  -- -------------------------------------------------------------------------
  -- A9. Borrar la reserva del consentimiento NO borra al suscriptor: la FK pone NULL.
  -- -------------------------------------------------------------------------
  delete from public.reservas where id = v_reserva2;
  select * into s from public.newsletter_suscriptores where email = 'a7@consentimiento.invalid';
  assert found and s.activo, 'A9: borrar la reserva borro o desactivo al suscriptor';
  assert s.reserva_consentimiento_id is null, 'A9: la FK no puso reserva_consentimiento_id a NULL';
  assert s.fecha_consentimiento is not null, 'A9: se perdio fecha_consentimiento al borrar la reserva';

  raise notice 'consentimiento_newsletter.test.sql: A0-A9 OK (todo se deshace con ROLLBACK)';
end
$$;

rollback;
