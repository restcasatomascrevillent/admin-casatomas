set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261003184500_newsletter_doble_optin_y_email_normalizado.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT; el primer fallo aborta con "ASSERT FAILED: <caso>".
-- TODO va dentro de BEGIN … ROLLBACK: no deja nada escrito.
--
-- CUÁNDO: DESPUÉS de aplicar 20261003143000, 20261003171500 y 20261003184500.
-- CÓMO (como postgres; vale contra producción porque todo se deshace):
--   npx supabase db query --linked -f supabase/tests/newsletter_doble_optin_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/newsletter_doble_optin_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL editor (si falla un
-- ASSERT la transacción puede quedarse abierta reteniendo candados).
--
-- CÓMO SE SIMULA QUIÉN ESCRIBE
--   · Sin JWT (este script, como postgres) = privilegiado, igual que las Edge
--     Functions con la service role: es lo que hacen reservas-web al crear y
--     emails-reserva / reservas-web al marcar email_verificado_at.
--   · El panel = request.jwt.claims con role 'authenticated' (helper
--     zz_optin_como_panel). Seguimos siendo postgres, así que la RLS no
--     estorba: lo que se prueba son los triggers.
--
-- QUÉ CUBRE
--   T0  migración aplicada: triggers nuevos, el de alta en el INSERT ya no está
--   T1  casilla + INSERT (web) -> NO hay alta; fecha de la casilla guardada
--   T2  el personal confirma a mano (y hasta intenta marcar la verificación o
--       la casilla) -> NO hay alta
--   T3  el cliente pulsa «Confirmo» (email_verificado_at) -> alta, con
--       fecha_consentimiento = casilla y fecha_verificacion_email
--   T4  cancelada antes de verificar -> NO hay alta (ni aunque luego se marque)
--   T5  mayúsculas/espacios -> mismo suscriptor; el índice único lo impone
--   T6  dado de baja + reserva nueva con casilla verificada -> reactiva;
--       casilla anterior a la baja -> no reactiva (y no tumba nada)
--   T7  sin casilla, aunque se verifique -> nada
--   T8  solicitud con casilla -> la reserva convertida (panel o
--       fn_aceptar_propuesta_solicitud) la hereda; alta solo al verificar;
--       origen_alta = solicitud_web
--   T9  el panel no puede poner la casilla ni en reservas ni en solicitudes;
--       cambiar el email anula casilla y verificación
--   T10 origen_alta por canal: manual -> reserva_manual
-- Reservas de prueba en 2099-07-21 (si ese día tuviera reservas reales no
-- pasa nada: se insertan dentro de la transacción y se deshacen).
-- ===========================================================================

begin;

set local plpgsql.check_asserts = on;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Helpers de la transacción (se deshacen con el ROLLBACK).
create function pg_temp.zz_optin_como_panel() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"authenticated"}', true); $$;
create function pg_temp.zz_optin_sin_jwt() returns void language sql as
$$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.zz_optin_reserva(p_email text, p_casilla boolean, p_hora text,
                                         p_canal text default 'web') returns uuid language sql as
$$
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               notas_cliente, consentimiento_newsletter, condiciones_aceptadas_at)
  values ('zz-optin', p_email, '+34600000999', '2099-07-21', p_hora::time, 2, 'pendiente', 'casa_tomas', p_canal,
          'zz-optin-test', p_casilla, now())
  returning id;
$$;

-- T0
do $$
begin
  assert exists (select 1 from pg_trigger where tgname = 'newsletter_alta_reserva_verificada_upd'
                   and tgrelid = 'public.reservas'::regclass), 'T0: falta newsletter_alta_reserva_verificada_upd';
  assert exists (select 1 from pg_trigger where tgname = 'newsletter_alta_reserva_verificada_ins'
                   and tgrelid = 'public.reservas'::regclass), 'T0: falta newsletter_alta_reserva_verificada_ins';
  assert exists (select 1 from pg_trigger where tgname = 'reservas_proteger_consentimiento_newsletter'),
    'T0: falta reservas_proteger_consentimiento_newsletter';
  assert exists (select 1 from pg_trigger where tgname = 'solicitudes_proteger_consentimiento_newsletter'),
    'T0: falta solicitudes_proteger_consentimiento_newsletter';
  assert exists (select 1 from pg_trigger where tgname = 'newsletter_suscriptores_normalizar_email'),
    'T0: falta newsletter_suscriptores_normalizar_email';
  assert not exists (select 1 from pg_trigger where tgname = 'agregar_suscriptor_al_reservar_consentida'),
    'T0: sigue el trigger que daba de alta en el INSERT';
  assert exists (select 1 from pg_indexes where indexname = 'newsletter_suscriptores_email_lower_key'
                   and indexdef ilike 'create unique index%'), 'T0: falta el índice único sobre lower(email)';
  assert not exists (select 1 from public.newsletter_suscriptores where email like '%@optin.invalid'),
    'T0: ya hay suscriptores @optin.invalid (datos de prueba de otra ejecución)';
end
$$;

-- T1: casilla + INSERT -> no hay alta
do $$
declare v_id uuid; r record;
begin
  v_id := pg_temp.zz_optin_reserva('t1@optin.invalid', true, '13:00');
  select * into r from public.reservas where id = v_id;
  assert r.consentimiento_newsletter, 'T1: la reserva no guardó la casilla';
  assert r.consentimiento_newsletter_at = r.created_at, 'T1: la fecha de la casilla no es created_at';
  assert r.email_verificado_at is null, 'T1: la reserva nace verificada';
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't1@optin.invalid'),
    'T1: casilla + INSERT ha dado de alta sin verificar el email';
end
$$;

-- T2: el personal pasa a verificada y confirma a mano -> no hay alta
do $$
declare v_id uuid; r record;
begin
  select id into v_id from public.reservas where email = 't1@optin.invalid';
  perform pg_temp.zz_optin_como_panel();
  update public.reservas set estado = 'verificada' where id = v_id;
  update public.reservas set estado = 'confirmada', email_verificado_at = now() where id = v_id;
  perform pg_temp.zz_optin_sin_jwt();
  select * into r from public.reservas where id = v_id;
  assert r.estado = 'confirmada', 'T2: no se confirmó';
  assert r.email_verificado_at is null, 'T2: el panel pudo marcar email_verificado_at';
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't1@optin.invalid'),
    'T2: confirmar a mano ha dado de alta';
end
$$;

-- T3: el cliente pulsa «Confirmo» -> alta
do $$
declare v_id uuid; r record; s record;
begin
  v_id := pg_temp.zz_optin_reserva('t3@optin.invalid', true, '13:15');
  update public.reservas set estado = 'verificada' where id = v_id;                  -- el personal
  update public.reservas set estado = 'confirmada' where id = v_id;                  -- emails-reserva (enlace)
  update public.reservas set email_verificado_at = now() where id = v_id;            -- _shared/verificacion-email.ts
  select * into r from public.reservas where id = v_id;
  select * into s from public.newsletter_suscriptores where email = 't3@optin.invalid';
  assert found, 'T3: verificar el email no dio de alta';
  assert s.activo, 'T3: el alta no está activa';
  assert s.origen_alta = 'reserva_web', 'T3: origen_alta = ' || coalesce(s.origen_alta, 'NULL');
  assert s.reserva_consentimiento_id = v_id, 'T3: reserva_consentimiento_id no es la reserva';
  assert s.fecha_consentimiento = r.consentimiento_newsletter_at, 'T3: fecha_consentimiento no es la de la casilla';
  assert s.fecha_verificacion_email = r.email_verificado_at, 'T3: falta fecha_verificacion_email';
end
$$;

-- T4: cancelada antes de verificar -> no hay alta
do $$
declare v_id uuid;
begin
  v_id := pg_temp.zz_optin_reserva('t4@optin.invalid', true, '13:30');
  update public.reservas set estado = 'cancelada' where id = v_id;
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't4@optin.invalid'),
    'T4: cancelar dio de alta';
  update public.reservas set email_verificado_at = now() where id = v_id;
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't4@optin.invalid'),
    'T4: una reserva cancelada dio de alta al marcar la verificación';
end
$$;

-- T5: mayúsculas y espacios -> un único suscriptor
do $$
declare v_a uuid; v_b uuid; n integer; s record; v_estado text;
begin
  v_a := pg_temp.zz_optin_reserva('T5.Mayus@OPTIN.invalid', true, '14:00');
  update public.reservas set email_verificado_at = now() where id = v_a;
  v_b := pg_temp.zz_optin_reserva('t5.mayus@optin.invalid', true, '14:15');
  update public.reservas set email_verificado_at = now() where id = v_b;
  select count(*) into n from public.newsletter_suscriptores where lower(email) = 't5.mayus@optin.invalid';
  assert n = 1, 'T5: hay ' || n || ' suscriptores para el mismo email';
  select * into s from public.newsletter_suscriptores where lower(email) = 't5.mayus@optin.invalid';
  assert s.email = 't5.mayus@optin.invalid', 'T5: el email no se guardó normalizado: ' || s.email;
  -- Escritura directa con otras mayúsculas: el trigger normaliza y choca con el UNIQUE.
  begin
    insert into public.newsletter_suscriptores (email, nombre, activo) values ('T5.MAYUS@optin.INVALID', 'x', true);
    v_estado := 'sin error';
  exception when unique_violation then
    v_estado := '23505';
  end;
  assert v_estado = '23505', 'T5: se pudo insertar el mismo email con otras mayúsculas (' || v_estado || ')';
  -- Y un UPDATE de email también se normaliza.
  update public.newsletter_suscriptores set email = ' T5.Mayus@Optin.Invalid ' where id = s.id;
  assert (select email from public.newsletter_suscriptores where id = s.id) = 't5.mayus@optin.invalid',
    'T5: el UPDATE de email no se normalizó';
end
$$;

-- T6: dado de baja + reserva nueva con casilla verificada -> reactiva
do $$
declare v_vieja uuid; v_nueva uuid; s record;
begin
  -- Se inserta ya de baja "ayer": en una transacción now() no avanza, y con un
  -- UPDATE posterior el trigger de 20261003171500 no deja mover fecha_baja.
  insert into public.newsletter_suscriptores (email, nombre, activo, origen_alta, fecha_baja, origen_baja)
  values ('t6@optin.invalid', 'zz-optin t6', false, 'reserva_web', now() - interval '1 day', 'enlace_email');

  -- Casilla marcada ANTES de la baja y verificada después: no reactiva, no falla.
  insert into public.reservas (nombre, email, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente,
                               consentimiento_newsletter, created_at)
  values ('zz-optin', 't6@optin.invalid', '2099-07-21', '14:30', 2, 'pendiente', 'casa_tomas', 'web', 'zz-optin-test',
          true, now() - interval '2 days')
  returning id into v_vieja;
  update public.reservas set email_verificado_at = now() where id = v_vieja;
  select * into s from public.newsletter_suscriptores where email = 't6@optin.invalid';
  assert not s.activo, 'T6: una casilla anterior a la baja reactivó';
  assert s.origen_baja = 'enlace_email', 'T6: se tocó la constancia de la baja';

  -- Casilla nueva, aún sin verificar: sigue de baja.
  v_nueva := pg_temp.zz_optin_reserva('t6@optin.invalid', true, '14:45');
  select * into s from public.newsletter_suscriptores where email = 't6@optin.invalid';
  assert not s.activo, 'T6: una casilla sin verificar reactivó';

  -- El cliente verifica: reactiva.
  update public.reservas set email_verificado_at = now() where id = v_nueva;
  select * into s from public.newsletter_suscriptores where email = 't6@optin.invalid';
  assert s.activo, 'T6: el consentimiento nuevo y verificado no reactivó';
  assert s.fecha_baja is null and s.origen_baja is null, 'T6: quedaron restos de la baja';
  assert s.reserva_consentimiento_id = v_nueva, 'T6: no se guardó la reserva del consentimiento nuevo';
end
$$;

-- T7: sin casilla, aunque se verifique -> nada
do $$
declare v_id uuid;
begin
  v_id := pg_temp.zz_optin_reserva('t7@optin.invalid', false, '15:00');
  update public.reservas set estado = 'confirmada', email_verificado_at = now() where id = v_id;
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't7@optin.invalid'),
    'T7: una reserva sin casilla dio de alta';
end
$$;

-- T8: solicitud con casilla -> la reserva convertida la hereda; alta solo al verificar
do $$
declare v_sol uuid; v_sol2 uuid; v_res uuid; r record; s record; v_rpc jsonb;
begin
  -- Como reservas-web (service role): solicitud con la casilla, creada "hace una hora".
  insert into public.solicitudes_pendientes (nombre, email, telefono, fecha_solicitada, hora_solicitada,
                                             numero_comensales, motivo_rechazo, estado, marca,
                                             consentimiento_newsletter, condiciones_aceptadas_at, created_at)
  values ('zz-optin t8', 'T8@optin.invalid', '+34600000818', '2099-07-21', '15:15', 14, 'grupo_grande', 'pendiente',
          'casa_tomas', true, now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_sol;
  assert (select consentimiento_newsletter from public.solicitudes_pendientes where id = v_sol),
    'T8: la solicitud no guardó la casilla';

  -- «Convertir en reserva» desde el panel: manda solicitud_id y NO la casilla.
  perform pg_temp.zz_optin_como_panel();
  insert into public.reservas (nombre, email, telefono, fecha, hora, numero_comensales, estado, marca, canal,
                               notas_cliente, solicitud_id, consentimiento_newsletter)
  values ('zz-optin t8', 't8@optin.invalid', '+34600000818', '2099-07-21', '15:15', 2, 'verificada', 'casa_tomas',
          'manual', 'zz-optin-test', v_sol, false)
  returning id into v_res;
  perform pg_temp.zz_optin_sin_jwt();
  select * into r from public.reservas where id = v_res;
  assert r.consentimiento_newsletter, 'T8: la reserva convertida no heredó la casilla de la solicitud';
  assert r.consentimiento_newsletter_at = now() - interval '1 hour', 'T8: la fecha de la casilla no es la de la solicitud';
  assert r.condiciones_aceptadas_at = now() - interval '1 hour', 'T8: no heredó condiciones_aceptadas_at';
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't8@optin.invalid'),
    'T8: convertir la solicitud dio de alta sin verificar';

  -- El cliente pulsa «Confirmo» en la propuesta de la reserva convertida.
  update public.reservas set estado = 'confirmada' where id = v_res;
  update public.reservas set email_verificado_at = now() where id = v_res;
  select * into s from public.newsletter_suscriptores where email = 't8@optin.invalid';
  assert found and s.activo, 'T8: verificar la reserva convertida no dio de alta';
  assert s.origen_alta = 'solicitud_web', 'T8: origen_alta = ' || coalesce(s.origen_alta, 'NULL');
  assert s.fecha_consentimiento = now() - interval '1 hour', 'T8: fecha_consentimiento no es la de la casilla';

  -- Vía fn_aceptar_propuesta_solicitud por correo (lo que hace emails-reserva).
  insert into public.solicitudes_pendientes (nombre, email, telefono, fecha_solicitada, hora_solicitada,
                                             numero_comensales, motivo_rechazo, estado, marca, propuesta_estado,
                                             consentimiento_newsletter)
  values ('zz-optin t8b', 't8b@optin.invalid', '+34600000819', '2099-07-21', '15:30', 2, 'sin_disponibilidad',
          'pendiente', 'casa_tomas', 'enviada', true)
  returning id into v_sol2;
  v_rpc := public.fn_aceptar_propuesta_solicitud(v_sol2, 'email');
  assert (v_rpc ->> 'ok')::boolean, 'T8: fn_aceptar_propuesta_solicitud falló: ' || v_rpc::text;
  select * into r from public.reservas where id = (v_rpc ->> 'reserva_id')::uuid;
  assert r.consentimiento_newsletter, 'T8: la reserva de fn_aceptar_propuesta_solicitud no heredó la casilla';
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't8b@optin.invalid'),
    'T8: aceptar la propuesta dio de alta antes de marcar la verificación';
  update public.reservas set email_verificado_at = now() where id = r.id;
  assert exists (select 1 from public.newsletter_suscriptores where email = 't8b@optin.invalid' and activo
                   and origen_alta = 'solicitud_web'), 'T8: verificar tras aceptar la propuesta no dio de alta';

end
$$;

-- T9: el panel no puede poner la casilla; cambiar el email la anula
do $$
declare v_id uuid; v_sol uuid; r record; v_casilla boolean;
begin
  -- Reserva del panel con la casilla marcada a mano -> false.
  perform pg_temp.zz_optin_como_panel();
  insert into public.reservas (nombre, email, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente,
                               consentimiento_newsletter, email_verificado_at)
  values ('zz-optin t9', 't9@optin.invalid', '2099-07-21', '16:00', 2, 'verificada', 'casa_tomas', 'manual',
          'zz-optin-test', true, now())
  returning id, consentimiento_newsletter, email_verificado_at into r;
  assert not r.consentimiento_newsletter, 'T9: el panel pudo crear una reserva con la casilla marcada';
  assert r.email_verificado_at is null, 'T9: el panel pudo crear una reserva ya verificada';
  v_id := r.id;

  -- Ni marcarla después.
  update public.reservas set consentimiento_newsletter = true where id = v_id;
  assert not (select consentimiento_newsletter from public.reservas where id = v_id),
    'T9: el panel pudo marcar la casilla en un UPDATE';

  -- Solicitud del panel con la casilla -> false; y no puede marcarla después.
  insert into public.solicitudes_pendientes (nombre, email, motivo_rechazo, estado, marca, consentimiento_newsletter)
  values ('zz-optin t9', 't9s@optin.invalid', 'grupo_grande', 'pendiente', 'casa_tomas', true)
  returning id, consentimiento_newsletter into v_sol, v_casilla;
  assert not v_casilla, 'T9: el panel pudo crear una solicitud con la casilla marcada';
  update public.solicitudes_pendientes set consentimiento_newsletter = true where id = v_sol;
  assert not (select consentimiento_newsletter from public.solicitudes_pendientes where id = v_sol),
    'T9: el panel pudo marcar la casilla de una solicitud';
  perform pg_temp.zz_optin_sin_jwt();

  -- Reserva web con casilla; el personal corrige el email -> casilla anulada.
  v_id := pg_temp.zz_optin_reserva('t9b@optin.invalid', true, '16:15');
  perform pg_temp.zz_optin_como_panel();
  update public.reservas set email = 't9b-otro@optin.invalid' where id = v_id;
  perform pg_temp.zz_optin_sin_jwt();
  select * into r from public.reservas where id = v_id;
  assert not r.consentimiento_newsletter and r.consentimiento_newsletter_at is null,
    'T9: cambiar el email no anuló la casilla';
  update public.reservas set email_verificado_at = now() where id = v_id;
  assert not exists (select 1 from public.newsletter_suscriptores where email in ('t9b@optin.invalid', 't9b-otro@optin.invalid')),
    'T9: tras cambiar el email, verificar dio de alta';

  -- Solicitud con casilla y reserva convertida con OTRO email: no hereda.
  insert into public.solicitudes_pendientes (nombre, email, motivo_rechazo, estado, marca, consentimiento_newsletter)
  values ('zz-optin t9c', 't9c@optin.invalid', 'grupo_grande', 'pendiente', 'casa_tomas', true)
  returning id into v_sol;
  insert into public.reservas (nombre, email, fecha, hora, numero_comensales, estado, marca, canal, notas_cliente,
                               solicitud_id)
  values ('zz-optin t9c', 't9c-otro@optin.invalid', '2099-07-21', '16:30', 2, 'verificada', 'casa_tomas', 'manual',
          'zz-optin-test', v_sol)
  returning id into v_id;
  assert not (select consentimiento_newsletter from public.reservas where id = v_id),
    'T9: una reserva con otro email heredó la casilla de la solicitud';

  -- La anonimización (email -> NULL) NO borra la prueba de la casilla.
  v_id := pg_temp.zz_optin_reserva('t9d@optin.invalid', true, '16:45');
  update public.reservas set email = null where id = v_id;
  assert (select consentimiento_newsletter from public.reservas where id = v_id),
    'T9: anonimizar el email borró la constancia de la casilla';
end
$$;

-- T10: origen_alta por canal
do $$
declare v_id uuid;
begin
  -- Canal manual con casilla (solo posible con service role / SQL: el panel no
  -- puede marcarla) -> reserva_manual, y solo tras verificar.
  v_id := pg_temp.zz_optin_reserva('t10m@optin.invalid', true, '17:00', 'manual');
  assert not exists (select 1 from public.newsletter_suscriptores where email = 't10m@optin.invalid'),
    'T10: canal manual dio de alta sin verificar';
  update public.reservas set email_verificado_at = now() where id = v_id;
  assert (select origen_alta from public.newsletter_suscriptores where email = 't10m@optin.invalid') = 'reserva_manual',
    'T10: canal manual no quedó como reserva_manual';

  v_id := pg_temp.zz_optin_reserva('t10t@optin.invalid', true, '17:15', 'telefono');
  update public.reservas set email_verificado_at = now() where id = v_id;
  assert (select origen_alta from public.newsletter_suscriptores where email = 't10t@optin.invalid') = 'reserva_telefono',
    'T10: canal telefono no quedó como reserva_telefono';
end
$$;

rollback;
