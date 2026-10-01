set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261001113700_configuracion_web_fotos_platos.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni la fila de configuración cambiada, ni usuarios de prueba).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (C0 lo comprueba y aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/configuracion_web_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/configuracion_web_test.sql
-- Si termina sin ERROR, todo ha pasado (lo último que devuelve es una fila
-- «configuracion_web: todas las comprobaciones han pasado»).
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) reteniendo el candado de la fila de configuración.
--
-- NOTA sobre auth.users: el fixture inserta dos usuarios de prueba con solo
-- (id, email). Si GoTrue exigiera más columnas NOT NULL, el fallo saldrá en
-- ese INSERT y no en un ASSERT: es un problema del fixture, no de la RLS.
--
-- ESTADO: escrito el 2026-10-01 y SIN EJECUTAR (la migración tampoco está
-- aplicada).
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- C0 la migración está aplicada y la fila única existe con los defaults
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  assert to_regclass('public.configuracion_web') is not null,
    'C0a: no existe public.configuracion_web: aplicar antes la migración';
  assert (select count(*) from public.configuracion_web) = 1,
    'C0b: configuracion_web debe tener exactamente UNA fila';
  select * into r from public.configuracion_web;
  assert r.id = true, 'C0c: la fila única no tiene id = true';
end;
$$;

-- ---------------------------------------------------------------------------
-- C1 singleton: no se puede meter una segunda fila (ni con id=false)
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.configuracion_web (id) values (false);
    raise exception 'C1a: se pudo insertar una fila con id = false';
  exception when check_violation then null;
  end;
  begin
    insert into public.configuracion_web (id) values (true);
    raise exception 'C1b: se pudo insertar una segunda fila con id = true';
  exception when unique_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- C2 catálogo: 3 políticas, RLS encendida, grants mínimos
-- ---------------------------------------------------------------------------
do $$
declare privs text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.configuracion_web'::regclass),
    'C2a: RLS apagada en configuracion_web';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'configuracion_web') = 3,
    'C2b: se esperaban 3 políticas en configuracion_web';

  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(ninguno)') into privs
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'configuracion_web' and grantee = 'anon';
  assert privs = 'SELECT', format('C2c: anon debería tener SOLO SELECT, tiene: %s', privs);

  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(ninguno)') into privs
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'configuracion_web' and grantee = 'authenticated';
  assert privs = 'SELECT,UPDATE', format('C2d: authenticated debería tener SELECT,UPDATE, tiene: %s', privs);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture (como postgres): un usuario CON gestor_carta y uno con otra sección
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000cf01', 'test-cfgweb-con-carta@rls.local'),
  ('00000000-0000-0000-0000-00000000cf02', 'test-cfgweb-sin-carta@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-00000000cf01', 'gestor_carta', true, false),
  ('00000000-0000-0000-0000-00000000cf02', 'reservas', true, false);
-- can_edit = false a propósito: can_write_section mira 'view' (ver
-- 20260918120000). Si alguien la cambia a 'edit', C5 se pone roja.

-- ---------------------------------------------------------------------------
-- C3 anon: lee, no escribe
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  assert (select count(*) from public.configuracion_web) = 1, 'C3a: anon no ve la fila (las webs no podrían leerla)';
  begin
    update public.configuracion_web set mostrar_fotos_platos_touza = false where id;
    raise exception 'C3b: anon pudo ejecutar UPDATE';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- C4 authenticated SIN gestor_carta: lee, el UPDATE no alcanza la fila
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cf02","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.configuracion_web) = 1, 'C4a: authenticated no ve la fila';
  update public.configuracion_web set mostrar_fotos_platos_touza = false where id;
  assert not found, 'C4b: un usuario SIN gestor_carta pudo cambiar el interruptor';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- C5 authenticated CON gestor_carta: cambia el interruptor y el trigger
--    deja updated_by = su uid
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cf01","role":"authenticated"}';

do $$
declare r record;
begin
  update public.configuracion_web
     set mostrar_fotos_platos_casa_tomas = false
   where id
  returning * into r;
  assert found, 'C5a: un usuario CON gestor_carta no pudo cambiar el interruptor';
  assert r.mostrar_fotos_platos_casa_tomas = false, 'C5b: el cambio no se guardó';
  assert r.updated_by = '00000000-0000-0000-0000-00000000cf01'::uuid,
    format('C5c: updated_by no es el usuario que cambió (%s)', r.updated_by);

  begin
    delete from public.configuracion_web where id;
    raise exception 'C5d: authenticated pudo ejecutar DELETE';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (después del ROLLBACK)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from auth.users where email like 'test-cfgweb-%@rls.local') then
    raise exception 'LIMPIEZA: quedan usuarios test-cfgweb-* tras el ROLLBACK: revisarlo a mano';
  end if;
end
$$;

select 'configuracion_web: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
