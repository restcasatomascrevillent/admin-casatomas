set client_encoding = 'UTF8';
-- Test de 20261124130000_usuarios_pestana_inicial. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «usuarios_pestana_inicial_test: OK».
--   supabase db query --linked -f supabase/tests/usuarios_pestana_inicial_test.sql
--
--   1. Tabla, RLS activa, sus políticas (con la restrictiva de sesión si existe) y auditoría.
--   2. Privilegios: anon nada; authenticated select/insert/update/delete (lo demás lo decide la RLS).
--   3. Restricciones: la ruta tiene forma de ruta del panel (/xxx); un usuario, una fila.
--   4. RLS, con un usuario que NO es super admin (y con sesión, si hay alguna): no puede escribir
--      (ni la suya), lee la suya y no ve la de otro si no puede ver «usuarios».
--   5. RLS, con un super admin con sesión: crea, cambia y borra; updated_by = él.
begin;

do $$
declare
  v_super uuid;
  v_super_sesion text;
  v_otro uuid;
  v_otro_sesion text;
  v_tercero uuid;
  v_fallo boolean;
  v_n integer;
  v_r record;
begin
  -- 1
  if to_regclass('public.user_pestana_inicial') is null then raise exception 'FALLO 1: falta la tabla'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.user_pestana_inicial'::regclass) then
    raise exception 'FALLO 1: RLS sin activar';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.user_pestana_inicial'::regclass
       and polname in ('user_pestana_inicial_select_propia', 'user_pestana_inicial_select_super_admin',
                       'user_pestana_inicial_select_seccion_usuarios', 'user_pestana_inicial_insert',
                       'user_pestana_inicial_update', 'user_pestana_inicial_delete')) <> 6 then
    raise exception 'FALLO 1: faltan políticas';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null
     and not exists (select 1 from pg_policy where polrelid = 'public.user_pestana_inicial'::regclass
                      and polname = 'acceso_panel_no_bloqueado' and not polpermissive) then
    raise exception 'FALLO 1: falta la restrictiva acceso_panel_no_bloqueado';
  end if;
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.user_pestana_inicial'::regclass and tgname = 'trg_auditoria') then
    raise exception 'FALLO 1: falta la auditoría';
  end if;

  -- 2
  if has_table_privilege('anon', 'public.user_pestana_inicial', 'select')
     or has_table_privilege('anon', 'public.user_pestana_inicial', 'insert') then
    raise exception 'FALLO 2: anon tiene permisos';
  end if;
  if not has_table_privilege('authenticated', 'public.user_pestana_inicial', 'select')
     or not has_table_privilege('authenticated', 'public.user_pestana_inicial', 'insert')
     or not has_table_privilege('authenticated', 'public.user_pestana_inicial', 'update')
     or not has_table_privilege('authenticated', 'public.user_pestana_inicial', 'delete') then
    raise exception 'FALLO 2: permisos de authenticated';
  end if;

  -- Usuarios para probar: un super admin (con sesión si la hay), otro que no lo es y no ve «usuarios».
  select s.user_id, (select se.id::text from auth.sessions se where se.user_id = s.user_id order by se.created_at desc limit 1)
    into v_super, v_super_sesion
    from public.super_admins s join auth.users u on u.id = s.user_id
    order by (exists (select 1 from auth.sessions se where se.user_id = s.user_id)) desc
    limit 1;
  select u.id, (select se.id::text from auth.sessions se where se.user_id = u.id order by se.created_at desc limit 1)
    into v_otro, v_otro_sesion
    from auth.users u
    where not public.is_super_admin(u.id)
      and not exists (select 1 from public.user_permissions p where p.user_id = u.id and p.section_key = 'usuarios' and (p.can_view or p.can_edit))
      and (u.banned_until is null or u.banned_until <= now())
    order by (exists (select 1 from auth.sessions se where se.user_id = u.id)) desc, u.created_at
    limit 1;
  select u.id into v_tercero from auth.users u where u.id <> coalesce(v_otro, gen_random_uuid())
    order by u.created_at limit 1;
  if v_otro is null or v_tercero is null then raise exception 'FALLO 3: no hay usuarios en auth.users para probar'; end if;

  -- 3
  v_fallo := false;
  begin
    insert into public.user_pestana_inicial (user_id, ruta) values (v_otro, 'reservas');
  exception when check_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: ruta sin barra admitida'; end if;
  v_fallo := false;
  begin
    insert into public.user_pestana_inicial (user_id, ruta) values (v_otro, '/Reservas?x=1');
  exception when check_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: ruta con mayúsculas o parámetros admitida'; end if;

  insert into public.user_pestana_inicial (user_id, ruta) values (v_otro, '/reservas');
  insert into public.user_pestana_inicial (user_id, ruta) values (v_tercero, '/facturas')
    on conflict (user_id) do update set ruta = excluded.ruta;
  v_fallo := false;
  begin
    insert into public.user_pestana_inicial (user_id, ruta) values (v_otro, '/facturas');
  exception when unique_violation then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO 3: dos filas para el mismo usuario'; end if;
  select updated_at into v_r from public.user_pestana_inicial where user_id = v_otro;
  if v_r.updated_at is null then raise exception 'FALLO 3: updated_at sin poner'; end if;

  -- 4 (el que no es super admin)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_otro, 'role', 'authenticated', 'session_id', v_otro_sesion)::text, true);
  perform set_config('request.jwt.claim.sub', v_otro::text, true);
  execute 'set local role authenticated';

  v_fallo := false;
  begin
    update public.user_pestana_inicial set ruta = '/ayuda' where user_id = v_otro;
    get diagnostics v_n = row_count;
    if v_n = 0 then v_fallo := true; end if;
  exception when insufficient_privilege then v_fallo := true;
  end;
  if not v_fallo then execute 'reset role'; raise exception 'FALLO 4: un usuario cambia su propia pestaña'; end if;

  v_fallo := false;
  begin
    delete from public.user_pestana_inicial where user_id = v_otro;
    get diagnostics v_n = row_count;
    if v_n = 0 then v_fallo := true; end if;
  exception when insufficient_privilege then v_fallo := true;
  end;
  if not v_fallo then execute 'reset role'; raise exception 'FALLO 4: un usuario borra su pestaña'; end if;

  if v_otro_sesion is not null then
    v_fallo := false;
    begin
      insert into public.user_pestana_inicial (user_id, ruta) values (gen_random_uuid(), '/ayuda');
    exception when insufficient_privilege then v_fallo := true;
    end;
    if not v_fallo then execute 'reset role'; raise exception 'FALLO 4: un usuario crea pestañas'; end if;

    select count(*) into v_n from public.user_pestana_inicial where user_id = v_otro and ruta = '/reservas';
    if v_n <> 1 then execute 'reset role'; raise exception 'FALLO 4: el usuario no lee su propia pestaña'; end if;
    select count(*) into v_n from public.user_pestana_inicial where user_id = v_tercero;
    if v_n <> 0 then execute 'reset role'; raise exception 'FALLO 4: el usuario ve la pestaña de otro'; end if;
  else
    raise notice 'usuarios_pestana_inicial_test: sin sesión para el usuario de prueba, lectura propia sin comprobar';
  end if;
  execute 'reset role';

  -- 5 (super admin con sesión)
  if v_super is not null and v_super_sesion is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_super, 'role', 'authenticated', 'session_id', v_super_sesion)::text, true);
    perform set_config('request.jwt.claim.sub', v_super::text, true);
    execute 'set local role authenticated';

    update public.user_pestana_inicial set ruta = '/facturas' where user_id = v_otro;
    get diagnostics v_n = row_count;
    if v_n <> 1 then execute 'reset role'; raise exception 'FALLO 5: el super admin no cambia la pestaña'; end if;
    select ruta, updated_by into v_r from public.user_pestana_inicial where user_id = v_otro;
    if v_r.ruta <> '/facturas' or v_r.updated_by is distinct from v_super then
      execute 'reset role'; raise exception 'FALLO 5: ruta o updated_by mal (%, %)', v_r.ruta, v_r.updated_by;
    end if;
    delete from public.user_pestana_inicial where user_id = v_otro;
    get diagnostics v_n = row_count;
    if v_n <> 1 then execute 'reset role'; raise exception 'FALLO 5: el super admin no borra la pestaña'; end if;
    insert into public.user_pestana_inicial (user_id, ruta) values (v_otro, '/ayuda');
    execute 'reset role';
  else
    raise notice 'usuarios_pestana_inicial_test: sin super admin con sesión, escritura del super admin sin comprobar';
  end if;

  raise notice 'usuarios_pestana_inicial_test: OK';
end;
$$;

select 'usuarios_pestana_inicial_test: OK' as resultado;

rollback;
