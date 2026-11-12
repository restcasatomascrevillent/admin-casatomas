set client_encoding = 'UTF8';
-- Test de 20261127100000_fallos_internos_telegram. BEGIN … ROLLBACK: no deja nada escrito
-- (el aviso a Telegram es pg_net y no sale si se deshace la transacción).
-- Acaba en «fallos_internos_telegram_test: OK».
--   npx supabase db query --linked -f supabase/tests/fallos_internos_telegram_test.sql
begin;

do $$
declare
  v_id bigint; v_id2 bigint; v_uid uuid; v_n int; v_fb bigint;
begin
  -- T1 permisos
  if has_table_privilege('anon', 'public.fallos_internos', 'select')
     or has_table_privilege('authenticated', 'public.fallos_internos', 'insert')
     or has_function_privilege('authenticated', 'public.fallo_interno_registrar(text,jsonb,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.fallos_internos_reclamar(integer)', 'execute')
     or has_function_privilege('anon', 'public.registrar_fallo_interno(text,jsonb,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.registrar_fallo_interno(text,jsonb,text)', 'execute') then
    raise exception 'FALLO T1: permisos';
  end if;
  if (select count(*) from cron.job where jobname = 'avisos-telegram-fallos') <> 1 then
    raise exception 'FALLO T1: falta el cron';
  end if;

  -- T2 alta, clave única y reclamo sin duplicados
  v_id := public.fallo_interno_registrar('prueba_tipo', '{"a":1}', null, 'k1');
  v_id2 := public.fallo_interno_registrar('prueba_tipo', '{"a":2}', null, 'k1');
  if v_id is null or v_id2 is not null then raise exception 'FALLO T2: la clave no evita el duplicado'; end if;
  select count(*) into v_n from public.fallos_internos_reclamar(50) where id = v_id;
  if v_n <> 1 then raise exception 'FALLO T2: no reclama'; end if;
  select count(*) into v_n from public.fallos_internos_reclamar(50) where id = v_id;
  if v_n <> 0 then raise exception 'FALLO T2: reclama dos veces'; end if;

  -- T3 pulgar abajo genera fallo; pulgar arriba no
  select id into v_uid from auth.users limit 1;
  if v_uid is not null then
    insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_uid, 'p', 'r', -1) returning id into v_fb;
    if not exists (select 1 from public.fallos_internos where tipo = 'chat_pulgar_abajo' and clave = 'feedback:' || v_fb) then
      raise exception 'FALLO T3: el pulgar abajo no genera fallo';
    end if;
    insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_uid, 'p2', 'r2', 1) returning id into v_fb;
    if exists (select 1 from public.fallos_internos where clave = 'feedback:' || v_fb) then
      raise exception 'FALLO T3: el pulgar arriba genera fallo';
    end if;
  end if;

  -- T4 acción 'fallos' aceptada; tipo desconocido rechazado en el RPC (sin sesión → error de sesión)
  perform public.avisos_telegram_disparar('fallos');
  raise notice 'fallos_internos_telegram_test: OK';
end;
$$;

rollback;
