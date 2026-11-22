set client_encoding = 'UTF8';
-- Test de 20261209400000_telegram_avisos_utiles. BEGIN … ROLLBACK: no deja nada escrito (los avisos a
-- Telegram son pg_net y no salen si se deshace la transacción).
-- Acaba en «avisos_telegram_utiles_test: OK».
--   npx supabase db query --linked -f supabase/tests/avisos_telegram_utiles_test.sql
--
--   T1 columnas nuevas con sus valores por defecto; las funciones nuevas solo para service_role.
--   T2 hay_pendientes con reservas: hoy/mañana sí; pendiente de verificar, canceladas por el restaurante y de otro día, no.
--   T3 disparar('semanal'): solo el día/hora configurados y una vez.
--   T4 avisos_telegram_datos_semanal devuelve vinos, tienda, facturas y albaranes.
--   T5 throttle de chat_pulgar_abajo y albaran_aviso (15 min) sin tocar otros tipos.
--   T6 vigilante: inactivo no hace nada; activo registra OpenAI sin créditos y lecturas fallidas, agrupado y con tope.
begin;

do $$
declare
  c record; v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_n int; v_id bigint; v_id2 bigint; s text; j jsonb;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  select * into c from avisos_telegram_config where id;
  if not c.reservas_al_momento or c.tope_hora <> 10 or c.tope_dia <> 30 or not c.semanal_activo or c.semanal_dia <> 1 or c.semanal_hora <> 9
     or c.semanal_ultimo_dia is not null or c.resumen_revision <> '{}'::jsonb then
    raise exception 'FALLO T1: valores por defecto %', row_to_json(c);
  end if;
  if has_function_privilege('authenticated', 'public.avisos_telegram_datos_semanal(date)', 'execute')
     or has_function_privilege('authenticated', 'public.vigilante_fallos_telegram()', 'execute')
     or has_function_privilege('anon', 'public.avisos_telegram_datos_semanal(date)', 'execute')
     or not has_function_privilege('service_role', 'public.avisos_telegram_datos_semanal(date)', 'execute')
     or not has_function_privilege('service_role', 'public.vigilante_fallos_telegram()', 'execute') then
    raise exception 'FALLO T1: permisos de las funciones nuevas';
  end if;
  if (select count(*) from cron.job where jobname in ('avisos-telegram-semanal', 'avisos-telegram-vigilante')) <> 2 then
    raise exception 'FALLO T1: faltan los crons';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  insert into reservas (nombre, telefono, fecha, hora, numero_comensales, estado, canal)
  values ('Test TG hoy', '600000001', v_hoy, '21:00', 4, 'confirmada', 'web') returning id into v_r1;
  insert into reservas (nombre, telefono, fecha, hora, numero_comensales, estado, canal)
  values ('Test TG pendiente', '600000002', v_hoy, '21:00', 2, 'pendiente', 'web') returning id into v_r2;
  insert into reservas (nombre, telefono, fecha, hora, numero_comensales, estado, canal)
  values ('Test TG lejos', '600000003', v_hoy + 10, '21:00', 2, 'confirmada', 'web') returning id into v_r3;
  insert into reservas (nombre, telefono, fecha, hora, numero_comensales, estado, canal)
  values ('Test TG manana', '600000004', v_hoy + 1, '14:00', 6, 'confirmada', 'web') returning id into v_r4;
  -- Lo ya existente (últimas 25 h) se da por enviado, y se activa Telegram.
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n where n.created_at > now() - interval '25 hours' on conflict do nothing;
  update avisos_telegram_config set activo = true, chat_id = '-1001234567890', silencio_activo = false where id;
  -- 20261216100000: los fallos técnicos solo van a su chat (chat_fallos); con esa migración, se pone el mismo.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'avisos_telegram_config' and column_name = 'chat_fallos') then
    execute 'update avisos_telegram_config set chat_fallos = chat_id where id';
  end if;
  -- (los triggers de reservas ya han creado avisos «reserva_nueva»; se marcan como enviados salvo los de prueba)
  delete from avisos_telegram_envios where aviso_id in (select id from notificaciones_dashboard where referencia_id in (v_r1, v_r2, v_r3, v_r4));
  update notificaciones_dashboard set created_at = now() + interval '1 second' where referencia_id in (v_r1, v_r2, v_r3, v_r4);
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n where n.referencia_id in (v_r2, v_r3);
  if not public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T2: la reserva de hoy confirmada no cuenta como pendiente';
  end if;
  -- Solo la de hoy (confirmada) y la de mañana valen; se envían ambas y no queda nada.
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n where n.referencia_id in (v_r1, v_r4) on conflict do nothing;
  if public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: quedan pendientes tras enviarlas'; end if;
  -- Pendiente de verificar: espera; cuando se confirma, sale.
  delete from avisos_telegram_envios where aviso_id in (select id from notificaciones_dashboard where referencia_id = v_r2);
  if public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: una reserva pendiente de verificar cuenta'; end if;
  update reservas set estado = 'verificada' where id = v_r2;
  if not public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: la reserva verificada no cuenta'; end if;
  delete from avisos_telegram_envios where aviso_id in (select id from notificaciones_dashboard where referencia_id = v_r3);
  update reservas set estado = 'cancelada' where id = v_r2;
  -- v_r2 cancelada por el panel/SQL a mano: cancelada_por NULL (no consta) → su aviso «cancelada» cuenta; se marca enviado.
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n where n.referencia_id = v_r2 on conflict do nothing;
  if public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: la reserva de otro día (10 días) cuenta'; end if;
  -- Cancelada por el restaurante: no cuenta.
  update reservas set estado = 'confirmada', cancelada_por = null where id = v_r4;
  delete from avisos_telegram_envios where aviso_id in (select id from notificaciones_dashboard where referencia_id = v_r4);
  update reservas set cancelada_por = 'restaurante', estado = 'cancelada' where id = v_r4;
  update notificaciones_dashboard set created_at = now() + interval '1 second' where referencia_id = v_r4;
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n where n.referencia_id = v_r4 and n.tipo = 'reserva_nueva' on conflict do nothing;
  if public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: cancelada por el restaurante cuenta como pendiente'; end if;
  -- Con reservas_al_momento = false ninguna cuenta.
  update avisos_telegram_config set reservas_al_momento = false where id;
  if public.avisos_telegram_hay_pendientes() then raise exception 'FALLO T2: con reservas_al_momento=false cuenta'; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  update avisos_telegram_config set semanal_activo = false where id;
  if public.avisos_telegram_disparar('semanal') <> 'no_toca' then raise exception 'FALLO T3: semanal apagada'; end if;
  update avisos_telegram_config set semanal_activo = true,
         semanal_dia = (extract(isodow from (now() at time zone 'Europe/Madrid'))::int % 7) + 1 where id;
  if public.avisos_telegram_disparar('semanal') <> 'no_toca' then raise exception 'FALLO T3: otro día'; end if;
  update avisos_telegram_config set semanal_dia = extract(isodow from (now() at time zone 'Europe/Madrid'))::int,
         semanal_hora = 0, semanal_ultimo_dia = v_hoy where id;
  if public.avisos_telegram_disparar('semanal') <> 'no_toca' then raise exception 'FALLO T3: ya enviada hoy'; end if;
  begin
    update avisos_telegram_config set semanal_dia = 8 where id;
    raise exception 'FALLO T3: día 8 aceptado';
  exception when check_violation then null;
  end;

  -- T4 ─────────────────────────────────────────────────────────────────────
  j := public.avisos_telegram_datos_semanal();
  if not (j ? 'vinos' and j ? 'tienda' and j ? 'facturas' and j ? 'albaranes')
     or jsonb_typeof(j -> 'vinos' -> 'peor') <> 'array' or (j -> 'albaranes' ->> 'n') is null or (j -> 'facturas' ->> 'documentos') is null then
    raise exception 'FALLO T4: datos semanales %', left(j::text, 300);
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  v_id := public.fallo_interno_registrar('albaran_aviso', '{"factura_id":1,"avisos":[]}', null, 'k-alb-1');
  v_id2 := public.fallo_interno_registrar('albaran_aviso', '{"factura_id":2,"avisos":[]}', null, 'k-alb-2');
  if v_id is null or v_id2 is not null then raise exception 'FALLO T5: el segundo albarán en 15 min no se agrupa'; end if;
  if (select (datos ->> 'repetidos')::int from fallos_internos where id = v_id) <> 1 then raise exception 'FALLO T5: no cuenta el repetido'; end if;
  update fallos_internos set created_at = now() - interval '20 minutes' where id = v_id;
  v_id2 := public.fallo_interno_registrar('albaran_aviso', '{"factura_id":3,"avisos":[]}', null, 'k-alb-3');
  if v_id2 is null or (select (datos ->> 'acumulados_antes')::int from fallos_internos where id = v_id2) <> 1 then
    raise exception 'FALLO T5: el siguiente aviso no trae los acumulados';
  end if;
  -- otros tipos no se agrupan
  v_id := public.fallo_interno_registrar('prueba_a', '{}', null, null);
  v_id2 := public.fallo_interno_registrar('prueba_a', '{}', null, null);
  if v_id is null or v_id2 is null then raise exception 'FALLO T5: agrupa un tipo que no toca'; end if;

  -- T6 ─────────────────────────────────────────────────────────────────────
  update avisos_telegram_config set activo = false where id;
  if public.vigilante_fallos_telegram() <> 'inactivo' then raise exception 'FALLO T6: con Telegram inactivo trabaja'; end if;
  update avisos_telegram_config set activo = true where id; -- activo_desde = now() (trigger): los fallos van 1 s después
  insert into ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado, error, terminado_at, updated_at)
  values (gen_random_uuid(), (select id from auth.users limit 1), 1, 'imagen', 'prueba.jpg', 'fallido', 'OpenAI embeddings 429: You have no credits', now() + interval '1 second', now() + interval '1 second'),
         (gen_random_uuid(), (select id from auth.users limit 1), 1, 'imagen', 'prueba.jpg', 'fallido', 'OpenAI embeddings 429: You have no credits', now() + interval '1 second', now() + interval '1 second'),
         (gen_random_uuid(), (select id from auth.users limit 1), 1, 'imagen', 'prueba.jpg', 'fallido', 'La extracción no cumple el contrato', now() + interval '1 second', now() + interval '1 second');
  s := public.vigilante_fallos_telegram();
  if s not like '%openai%' or s not like '%ocr%' then raise exception 'FALLO T6: vigilante devolvió %', s; end if;
  select count(*) into v_n from fallos_internos where tipo = 'openai_sin_creditos' and (datos ->> 'trabajos')::int = 2;
  if v_n <> 1 then raise exception 'FALLO T6: OpenAI sin créditos agrupado mal'; end if;
  select count(*) into v_n from fallos_internos where tipo = 'ocr_fallido' and (datos ->> 'trabajos')::int = 1;
  if v_n <> 1 then raise exception 'FALLO T6: ocr_fallido agrupado mal'; end if;
  -- Segunda pasada: nada nuevo, nada que repetir (tope).
  insert into ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado, error, terminado_at, updated_at) values (gen_random_uuid(), (select id from auth.users limit 1), 1, 'imagen', 'prueba.jpg', 'fallido', 'You have no credits', now() + interval '1 second', now() + interval '1 second');
  s := public.vigilante_fallos_telegram();
  if s like '%openai%' or s like '%ocr%' then raise exception 'FALLO T6: repite antes de 6 h / 1 h (%)', s; end if;
  if (select count(*) from fallos_internos where tipo in ('openai_sin_creditos', 'ocr_fallido')) <> 2 then
    raise exception 'FALLO T6: más de un fallo por clase';
  end if;
end $$;

select 'avisos_telegram_utiles_test: OK' as resultado;
rollback;
