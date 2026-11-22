set client_encoding = 'UTF8';
-- Test de 20261209600000_telegram_avisos_revision. BEGIN … ROLLBACK: no deja nada escrito (los avisos a
-- Telegram son pg_net y no salen si se deshace la transacción). Acaba en «avisos_telegram_revision_test: OK».
--   npx supabase db query --linked -f supabase/tests/avisos_telegram_revision_test.sql
--
--   T1 con activo_desde = ahora, el reclamo y el disparador de 'fallos' no ven lo antiguo; sí lo nuevo.
--   T2 nunca más de 3 días atrás, aunque activo_desde sea anterior.
--   T3 el throttle guarda los ids de los descartados (sin repetir) y el siguiente aviso los trae.
--   T4 avisos_telegram_albaranes_total coincide con el recuento directo; solo service_role.
begin;

do $$
declare
  v_n int; v_id bigint; v_id2 bigint; s text; j jsonb; v_tot jsonb; v_cnt int; v_imp numeric;
begin
  delete from fallos_internos;   -- (se deshace con el rollback) para partir de cero
  update avisos_telegram_config set activo = false where id;
  update avisos_telegram_config set activo = true, chat_id = '-100123456' where id;   -- activo_desde := now()
  -- 20261216100000: los fallos técnicos solo van a su chat (chat_fallos); con esa migración, se pone el mismo.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'avisos_telegram_config' and column_name = 'chat_fallos') then
    execute 'update avisos_telegram_config set chat_fallos = chat_id where id';
  end if;
  -- Atraso anterior a la activación (hace 1 h, 1 día y 5 días).
  insert into fallos_internos (tipo, datos, created_at) values ('prueba_revision', '{"k":"viejo1h"}', now() - interval '1 hour'),
    ('prueba_revision', '{"k":"viejo1d"}', now() - interval '1 day'), ('prueba_revision', '{"k":"viejo5d"}', now() - interval '5 days');

  -- T1 ─────────────────────────────────────────────────────────────────────
  s := avisos_telegram_disparar('fallos');
  if s <> 'nada' then raise exception 'FALLO T1: con solo atraso anterior a la activación el disparador devolvió %', s; end if;
  select count(*) into v_n from fallos_internos_reclamar(50);
  if v_n <> 0 then raise exception 'FALLO T1: el reclamo mandaría % filas antiguas', v_n; end if;
  insert into fallos_internos (tipo, datos) values ('prueba_revision', '{"k":"nuevo"}');
  s := avisos_telegram_disparar('fallos');
  if s = 'nada' then raise exception 'FALLO T1: lo creado tras activar debe contar'; end if;
  select count(*), min(datos ->> 'k') into v_n, s from fallos_internos_reclamar(50);
  if v_n <> 1 or s <> 'nuevo' then raise exception 'FALLO T1: el reclamo devolvió % filas (%)', v_n, s; end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  update avisos_telegram_config set activo_desde = now() - interval '30 days' where id;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'avisos_telegram_config' and column_name = 'fallos_desde') then
    execute 'update avisos_telegram_config set fallos_desde = now() - interval ''30 days'' where id';
  end if;
  update fallos_internos set reclamado_en = null, intentos = 0 where tipo = 'prueba_revision';
  perform 1 from fallos_internos_reclamar(50);
  select count(*) into v_n from fallos_internos where tipo = 'prueba_revision' and reclamado_en is not null and datos ->> 'k' = 'viejo5d';
  if v_n <> 0 then raise exception 'FALLO T2: se reclamó un fallo de hace 5 días (tope 3)'; end if;
  select count(*) into v_n from fallos_internos where tipo = 'prueba_revision' and reclamado_en is not null;
  if v_n <> 3 then raise exception 'FALLO T2: debían reclamarse 3 (nuevo, 1 h y 1 d) y fueron %', v_n; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  insert into fallos_internos (tipo, datos) values ('albaran_aviso', '{"factura_id": 1, "avisos": []}');
  insert into fallos_internos (tipo, datos) values ('albaran_aviso', '{"factura_id": 2, "avisos": []}');
  insert into fallos_internos (tipo, datos) values ('albaran_aviso', '{"factura_id": 3, "avisos": []}');
  insert into fallos_internos (tipo, datos) values ('albaran_aviso', '{"factura_id": 2, "avisos": []}');
  select id, datos into v_id, j from fallos_internos where tipo = 'albaran_aviso';
  if (select count(*) from fallos_internos where tipo = 'albaran_aviso') <> 1 then raise exception 'FALLO T3: debía quedar 1 fila'; end if;
  if (j ->> 'repetidos')::int <> 3 or j -> 'repetidos_ids' <> '[2, 3]'::jsonb then
    raise exception 'FALLO T3: repetidos / repetidos_ids = % / %', j ->> 'repetidos', j -> 'repetidos_ids';
  end if;
  update fallos_internos set created_at = now() - interval '20 minutes' where id = v_id;
  insert into fallos_internos (tipo, datos) values ('albaran_aviso', '{"factura_id": 9, "avisos": []}') returning id into v_id2;
  select datos into j from fallos_internos where id = v_id2;
  if (j ->> 'acumulados_antes')::int <> 3 or j -> 'acumulados_ids' <> '[2, 3]'::jsonb then
    raise exception 'FALLO T3: la fila nueva trae % / %', j ->> 'acumulados_antes', j -> 'acumulados_ids';
  end if;
  -- Pulgar abajo: guarda feedback_id; otros tipos no se tocan.
  insert into fallos_internos (tipo, datos) values ('chat_pulgar_abajo', '{"feedback_id": 7}');
  insert into fallos_internos (tipo, datos) values ('chat_pulgar_abajo', '{"feedback_id": 8}');
  select datos into j from fallos_internos where tipo = 'chat_pulgar_abajo';
  if j -> 'repetidos_ids' <> '[8]'::jsonb then raise exception 'FALLO T3: pulgar repetidos_ids = %', j -> 'repetidos_ids'; end if;
  insert into fallos_internos (tipo, datos) values ('otro_tipo_x', '{}');
  insert into fallos_internos (tipo, datos) values ('otro_tipo_x', '{}');
  if (select count(*) from fallos_internos where tipo = 'otro_tipo_x') <> 2 then raise exception 'FALLO T3: otros tipos no se agrupan'; end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  v_tot := avisos_telegram_albaranes_total();
  select count(*), coalesce(round(sum(total), 2), 0) into v_cnt, v_imp from facturas where tipo = 'albaran' and facturado_en_id is null;
  if (v_tot ->> 'total_n')::int <> v_cnt or (v_tot ->> 'total_importe')::numeric <> v_imp then
    raise exception 'FALLO T4: total % frente a % / %', v_tot, v_cnt, v_imp;
  end if;
  if has_function_privilege('authenticated', 'public.avisos_telegram_albaranes_total()', 'execute')
     or has_function_privilege('anon', 'public.fallos_internos_desde()', 'execute')
     or not has_function_privilege('service_role', 'public.avisos_telegram_albaranes_total()', 'execute')
     or not has_function_privilege('service_role', 'public.fallos_internos_reclamar(integer)', 'execute') then
    raise exception 'FALLO T4: permisos de las funciones';
  end if;
  raise notice 'avisos_telegram_revision_test: OK';
end;
$$;

rollback;
