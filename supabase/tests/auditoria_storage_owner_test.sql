set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261010140000_auditoria_storage_owner.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP): cada comprobación es un ASSERT dentro de un DO; el
-- primer fallo aborta con "ASSERT FAILED: <caso>: ...". TODO va dentro de
-- BEGIN … ROLLBACK: no deja nada escrito (ni objetos de Storage ni auditoría).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (S0 lo comprueba y aborta si no).
-- CÓMO (contra producción, todo se deshace; NO en el SQL Editor):
--   npx supabase db query --linked -f supabase/tests/auditoria_storage_owner_test.sql
-- Si termina sin ERROR, todo ha pasado (última fila: «auditoria_storage_owner_test: OK»).
--
-- QUÉ SE PRUEBA. Se simula el INSERT de Storage en storage.objects SIN usuario
-- identificado (auth.uid() NULL), que era lo que lanzaba el 28000 «no se ha
-- identificado al responsable». NOTA: `db query` no deja hacer SET SESSION
-- AUTHORIZATION, así que session_user no se puede fijar a authenticator; la
-- ruta que falla con claims {"role":"authenticated"} sin sub es la misma
-- rama final de fn_identificar_actor_auditoria.
--   A. sin claims y con owner_id de un usuario real, INSERT/UPDATE/DELETE
--      pasan y audit_log guarda actor_user_id = owner, tabla storage.objects,
--      origen usuario;
--   B. sin claims y sin owner (subida anónima en bucket público): no lanza
--      28000 y no deja fila de auditoría;
--   C. claims {"role":"authenticated"} sin sub, con owner: pasa y atribuye
--      (ANTES DEL ARREGLO ESTE CASO LANZABA 28000);
--   D. owner inexistente o no-UUID: no lanza 28000 y sin fila de auditoría;
--   G. NO se relaja nada más: como service_role, sin origen y sin owner,
--      sigue lanzando 28000.
-- ===========================================================================

begin;

do $$
begin
  if position('auditoria_storage_owner' in (select prosrc from pg_proc
       where oid = to_regprocedure('public.fn_registrar_auditoria()'))) = 0 then
    raise exception 'S0: falta aplicar 20261010140000_auditoria_storage_owner.sql';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'storage.objects'::regclass
       and tgname = 'trg_auditoria' and not tgisinternal) then
    raise exception 'S0: storage.objects no tiene trg_auditoria';
  end if;
end;
$$;

-- storage.protect_delete bloquea los DELETE directos salvo con este ajuste (solo en esta transacción).
select set_config('storage.allow_delete_query', 'true', true);
create temp table t_aud(k text primary key, v text);
grant all on t_aud to public;
insert into t_aud select 'uid', id::text from auth.users order by created_at limit 1;
insert into t_aud select 'bucket', id from storage.buckets order by created_at limit 1;
insert into t_aud select 'n0', count(*)::text from public.audit_log;
select set_config('request.jwt.claims', '', true), set_config('request.headers', '', true),
       set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true);

-- ------------------------------ A / B / D ------------------------------------
set local role postgres;

do $$
declare v_uid text := (select v from t_aud where k = 'uid');
        v_b text := (select v from t_aud where k = 'bucket');
begin
  assert auth.uid() is null, 'precondición: auth.uid() debe ser NULL';
  -- A: insert + update + delete con owner (3 filas de auditoría)
  insert into storage.objects(bucket_id, name, owner_id, owner, metadata)
    values (v_b, 'zz_test_aud/A.jpg', v_uid, v_uid::uuid, '{}'::jsonb);
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = v_b and name = 'zz_test_aud/A.jpg';
  delete from storage.objects where bucket_id = v_b and name = 'zz_test_aud/A.jpg';
  -- B: sin owner
  insert into storage.objects(bucket_id, name, metadata) values (v_b, 'zz_test_aud/B.jpg', '{}'::jsonb);
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = v_b and name = 'zz_test_aud/B.jpg';
  delete from storage.objects where bucket_id = v_b and name = 'zz_test_aud/B.jpg';
  -- D: owner inexistente y owner que no es UUID
  insert into storage.objects(bucket_id, name, owner_id, metadata)
    values (v_b, 'zz_test_aud/D1.jpg', '00000000-0000-4000-8000-00000000dead', '{}'::jsonb);
  insert into storage.objects(bucket_id, name, owner_id, metadata)
    values (v_b, 'zz_test_aud/D2.jpg', 'no-es-un-uuid', '{}'::jsonb);
  delete from storage.objects where bucket_id = v_b and name in ('zz_test_aud/D1.jpg', 'zz_test_aud/D2.jpg');
end;
$$;

-- ------------------------------ C --------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
declare v_uid text := (select v from t_aud where k = 'uid');
        v_b text := (select v from t_aud where k = 'bucket');
begin
  insert into storage.objects(bucket_id, name, owner_id, metadata)
    values (v_b, 'zz_test_aud/C.jpg', v_uid, '{}'::jsonb);  -- 1 fila de auditoría
  delete from storage.objects where bucket_id = v_b and name = 'zz_test_aud/C.jpg';  -- 1 fila
end;
$$;

-- ------------------------------ G (no se relaja nada) ------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_b text := (select v from t_aud where k = 'bucket'); v_ok boolean := false;
begin
  begin
    insert into storage.objects(bucket_id, name, metadata) values (v_b, 'zz_test_aud/G1.jpg', '{}'::jsonb);
  exception when sqlstate '28000' then v_ok := true;
  end;
  assert v_ok, 'G1: service_role sin origen ni owner debía seguir lanzando 28000';
end;
$$;

reset role;

-- ------------------------------ Resultado ------------------------------------
do $$
declare v_uid uuid := (select v from t_aud where k = 'uid')::uuid;
        v_n0 bigint := (select v from t_aud where k = 'n0')::bigint;
        v_n1 bigint; v_a bigint; v_otras bigint; v_malas bigint;
begin
  select count(*) into v_n1 from public.audit_log;
  select count(*) filter (where actor_user_id = v_uid),
         count(*) filter (where actor_user_id is distinct from v_uid),
         count(*) filter (where actor_user_id = v_uid and (actor_origin <> 'usuario' or tabla <> 'storage.objects'))
    into v_a, v_otras, v_malas
    from public.audit_log where tabla = 'storage.objects' and detalles::text like '%zz_test_aud/%';
  -- A: 3 (insert, update, delete) + C: 2 (insert, delete) = 5
  assert v_a = 5, format('A/C: se esperaban 5 filas de auditoría atribuidas al owner y hay %s', v_a);
  assert v_otras = 0, format('B/D: no debía haber filas de auditoría sin owner válido y hay %s', v_otras);
  assert v_malas = 0, 'A: las filas deben ser de origen usuario en storage.objects';
  assert v_n1 - v_n0 = 5, format('audit_log creció en %s filas (esperado 5)', v_n1 - v_n0);
end;
$$;

select 'auditoria_storage_owner_test: OK' as resultado;

rollback;
