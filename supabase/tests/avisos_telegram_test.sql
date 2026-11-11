set client_encoding = 'UTF8';
-- Test de 20261126001000_avisos_telegram. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «avisos_telegram_test: OK».
--   npx supabase db query --linked -f supabase/tests/avisos_telegram_test.sql
--
--   T1 permisos: sin acceso para anon; funciones de cron sin EXECUTE para authenticated;
--      config con valores por defecto (inactivo, 9 h, margen bajo y subida al momento, 23–8).
--   T2 crons instalados y, con activo = false, disparar no llama a nada («inactivo»).
--   T3 silencio: 23–8 cubre 23, 0 y 7, no 8 ni 22; desde = hasta → sin silencio.
--   T4 pendientes: activo + chat_id → un aviso de margen bajo nuevo está pendiente;
--      uno anterior a la activación, otro de tipo no marcado o con campana=false, no.
--      Con un envío correcto deja de estar pendiente; con 3 fallos también.
--   T5 chat_id inválido rechazado; resumen ya enviado hoy → «no_toca».
-- Nunca llega a llamar a la función (no hay ningún caso que devuelva «llamada»).
begin;

do $$
declare
  c record; v_id uuid; v_viejo uuid; r text;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_table_privilege('anon', 'public.avisos_telegram_config', 'select')
     or has_table_privilege('anon', 'public.avisos_telegram_envios', 'select')
     or has_table_privilege('authenticated', 'public.avisos_telegram_envios', 'insert')
     or has_function_privilege('authenticated', 'public.avisos_telegram_disparar(text)', 'execute')
     or has_function_privilege('authenticated', 'public.avisos_telegram_hay_pendientes()', 'execute') then
    raise exception 'FALLO T1: permisos de más';
  end if;
  select * into c from avisos_telegram_config where id;
  if c.activo or c.hora_resumen <> 9 or c.silencio_desde <> 23 or c.silencio_hasta <> 8 or not c.silencio_activo
     or c.tipos_al_momento <> array['facturas_margen_bajo', 'facturas_precio_sube'] then
    raise exception 'FALLO T1: valores por defecto %', row_to_json(c);
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  if (select count(*) from cron.job where jobname in ('avisos-telegram-pendientes', 'avisos-telegram-resumen')) <> 2 then
    raise exception 'FALLO T2: faltan los crons';
  end if;
  update avisos_telegram_config set activo = false, chat_id = '-1001234567890' where id;
  r := public.avisos_telegram_disparar('pendientes');
  if r <> 'inactivo' then raise exception 'FALLO T2: con activo=false pendientes da %', r; end if;
  r := public.avisos_telegram_disparar('resumen');
  if r <> 'inactivo' then raise exception 'FALLO T2: con activo=false resumen da %', r; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  if not public.avisos_telegram_en_silencio(23, 23, 8) or not public.avisos_telegram_en_silencio(0, 23, 8)
     or not public.avisos_telegram_en_silencio(7, 23, 8) or public.avisos_telegram_en_silencio(8, 23, 8)
     or public.avisos_telegram_en_silencio(22, 23, 8) or public.avisos_telegram_en_silencio(3, 5, 5)
     or not public.avisos_telegram_en_silencio(14, 14, 16) then
    raise exception 'FALLO T3: silencio mal calculado';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  insert into notificaciones_dashboard (tipo, titulo, mensaje, datos, created_at)
  values ('facturas_margen_bajo', 'Prueba TG viejo', 'x', '{"texto_telegram":"viejo"}', now() - interval '1 hour')
  returning id into v_viejo;
  -- Que ningún aviso real de la demo confunda el test: lo de las últimas 25 h se da por enviado.
  insert into avisos_telegram_envios (tipo, aviso_id, ok)
  select 'aviso', n.id, true from notificaciones_dashboard n
   where n.created_at > now() - interval '25 hours' and n.id <> v_viejo
  on conflict do nothing;
  update avisos_telegram_config set activo = true, silencio_activo = false where id;
  if public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: un aviso anterior a la activación cuenta como pendiente';
  end if;
  -- now() es el inicio de la transacción (= activo_desde): los nuevos van 1 s después.
  insert into notificaciones_dashboard (tipo, titulo, datos, created_at)
  values ('reserva_nueva', 'Prueba TG reserva', '{}', now() + interval '1 second'),
         ('facturas_precio_sube', 'Prueba TG pequeña', '{"campana":false}', now() + interval '1 second');
  if public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: un tipo no marcado o con campana=false cuenta como pendiente';
  end if;
  insert into notificaciones_dashboard (tipo, titulo, datos, created_at)
  values ('facturas_margen_bajo', 'Prueba TG nuevo', '{"texto_telegram":"nuevo"}', now() + interval '1 second')
  returning id into v_id;
  if not public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: el aviso nuevo de margen bajo no está pendiente';
  end if;
  insert into avisos_telegram_envios (tipo, aviso_id, ok, error) values ('aviso', v_id, false, 'x'), ('aviso', v_id, false, 'x');
  if not public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: con 2 fallos debe seguir pendiente';
  end if;
  insert into avisos_telegram_envios (tipo, aviso_id, ok, error) values ('aviso', v_id, false, 'x');
  if public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: con 3 fallos no se reintenta';
  end if;
  delete from avisos_telegram_envios where aviso_id = v_id;
  insert into avisos_telegram_envios (tipo, aviso_id, ok) values ('aviso', v_id, true);
  if public.avisos_telegram_hay_pendientes() then
    raise exception 'FALLO T4: un aviso ya enviado sigue pendiente';
  end if;
  begin
    insert into avisos_telegram_envios (tipo, aviso_id, ok) values ('aviso', v_id, true);
    raise exception 'FALLO T4: dos envíos correctos del mismo aviso';
  exception when unique_violation then null;
  end;
  r := public.avisos_telegram_disparar('pendientes');
  if r <> 'nada' then raise exception 'FALLO T4: sin pendientes disparar da %', r; end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  begin
    update avisos_telegram_config set chat_id = 'hola; drop' where id;
    raise exception 'FALLO T5: chat_id inválido aceptado';
  exception when check_violation then null;
  end;
  update avisos_telegram_config set chat_id = '  @grupo_casatomas  ' where id;
  if (select chat_id from avisos_telegram_config) <> '@grupo_casatomas' then
    raise exception 'FALLO T5: chat_id sin recortar';
  end if;
  update avisos_telegram_config set resumen_ultimo_dia = (now() at time zone 'Europe/Madrid')::date, hora_resumen = 0 where id;
  r := public.avisos_telegram_disparar('resumen');
  if r <> 'no_toca' then raise exception 'FALLO T5: resumen ya enviado hoy da %', r; end if;
end $$;

select 'avisos_telegram_test: OK' as resultado;
rollback;
