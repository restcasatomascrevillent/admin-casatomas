set client_encoding = 'UTF8';
-- Test de 20261123200000_chat_feedback. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_feedback_test: OK».
--   supabase db query --linked -f supabase/tests/chat_feedback_test.sql
--
--   1. Tabla, RLS activa, sus 4 políticas (con la restrictiva de sesión si existe).
--   2. Permisos: anon nada; authenticated lee e inserta, y solo actualiza `revisado`.
--   3. Restricciones: valoración ±1, historial/herramientas jsonb array, un voto por mensaje.
--   4. Trigger: marcar revisado pone revisado_at; desmarcar lo quita.
--   5. RLS: un autenticado no puede insertar a nombre de otro usuario.
begin;

do $$
declare
  v_u1 uuid;
  v_u2 uuid;
  v_msg uuid := gen_random_uuid();
  v_id bigint;
  v_r record;
  v_fallo boolean;
begin
  -- 1
  if to_regclass('public.chat_feedback') is null then raise exception 'FALLO 1: falta la tabla'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.chat_feedback'::regclass) then
    raise exception 'FALLO 1: RLS sin activar';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.chat_feedback'::regclass
       and polname in ('chat_feedback_insert_propio', 'chat_feedback_select_seccion', 'chat_feedback_update_seccion')) <> 3 then
    raise exception 'FALLO 1: faltan políticas';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null
     and not exists (select 1 from pg_policy where polrelid = 'public.chat_feedback'::regclass
                      and polname = 'acceso_panel_no_bloqueado' and not polpermissive) then
    raise exception 'FALLO 1: falta la restrictiva acceso_panel_no_bloqueado';
  end if;

  -- 2
  if has_table_privilege('anon', 'public.chat_feedback', 'select')
     or has_table_privilege('anon', 'public.chat_feedback', 'insert') then
    raise exception 'FALLO 2: anon tiene permisos';
  end if;
  if not has_table_privilege('authenticated', 'public.chat_feedback', 'select')
     or not has_table_privilege('authenticated', 'public.chat_feedback', 'insert')
     or has_table_privilege('authenticated', 'public.chat_feedback', 'delete')
     or not has_column_privilege('authenticated', 'public.chat_feedback', 'revisado', 'update')
     or has_column_privilege('authenticated', 'public.chat_feedback', 'respuesta', 'update')
     or has_column_privilege('authenticated', 'public.chat_feedback', 'valoracion', 'update') then
    raise exception 'FALLO 2: permisos de authenticated';
  end if;

  -- 3
  select id into v_u1 from auth.users order by created_at limit 1;
  select id into v_u2 from auth.users where id <> v_u1 order by created_at limit 1;
  if v_u1 is null then raise exception 'FALLO 3: no hay usuarios en auth.users para probar'; end if;

  insert into public.chat_feedback (usuario_id, mensaje_id, pregunta, respuesta, historial, herramientas, modelo, valoracion, comentario)
  values (v_u1, v_msg, 'Y de vaca', 'No hay compras de vaca.',
          '[{"rol":"user","contenido":"Dime precio de toda la ternera de embajadores"}]',
          '[{"nombre":"compras_producto","argumentos":{"producto":"vaca"},"resultado":"completada"}]',
          'gpt-6.1-terra', -1, 'No ha mirado Embajadores')
  returning id into v_id;

  v_fallo := false;
  begin
    insert into public.chat_feedback (usuario_id, mensaje_id, pregunta, respuesta, valoracion)
    values (v_u1, v_msg, 'otra', 'otra', 1);
  exception when unique_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: dos votos al mismo mensaje'; end if;

  v_fallo := false;
  begin
    insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_u1, 'p', 'r', 2);
  exception when check_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: valoración 2 admitida'; end if;

  v_fallo := false;
  begin
    insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion, historial) values (v_u1, 'p', 'r', 1, '{}');
  exception when check_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: historial que no es array admitido'; end if;

  -- Sin mensaje_id (mensaje no guardado) no choca con el índice único.
  insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_u1, 'p', 'r', 1);
  insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_u1, 'p', 'r', 1);

  -- 4
  update public.chat_feedback set revisado = true where id = v_id;
  select revisado, revisado_at into v_r from public.chat_feedback where id = v_id;
  if not v_r.revisado or v_r.revisado_at is null then raise exception 'FALLO 4: revisado_at sin poner'; end if;
  update public.chat_feedback set revisado = false where id = v_id;
  select revisado_at into v_r from public.chat_feedback where id = v_id;
  if v_r.revisado_at is not null then raise exception 'FALLO 4: revisado_at sin quitar'; end if;

  -- 5
  if v_u2 is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_u2::text, true);
    execute 'set local role authenticated';
    v_fallo := false;
    begin
      insert into public.chat_feedback (usuario_id, pregunta, respuesta, valoracion) values (v_u1, 'p', 'r', 1);
    exception when insufficient_privilege then v_fallo := true;
    end;
    execute 'reset role';
    if not v_fallo then raise exception 'FALLO 5: insertado a nombre de otro usuario'; end if;
  end if;

  raise notice 'chat_feedback_test: OK';
end;
$$;

select 'chat_feedback_test: OK' as resultado;

rollback;
