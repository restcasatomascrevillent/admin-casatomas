set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-DB-02 (extensión T7-ESPACIOS) · espacios_reserva por sección
-- (remediación 2026-10-30, perfil rem-05; decisión D-005)
-- ===========================================================================
--
-- PROBLEMA (ensayo con ROLLBACK de las 10 migraciones de RC2 sobre la demo,
-- evidencias/demo-s0/politicas-demo.json): tras RC2 solo quedaban abiertas a
-- cualquier cuenta con sesión las 6 de escritura de public.espacios_reserva:
--   "Authenticated users can delete/insert/update espacios_reserva"
--       TO authenticated, USING/CHECK true                 (20260208164215)
--   "Solo usuarios autenticados pueden actualizar/crear/eliminar espacios"
--       TO public, auth.uid() IS NOT NULL                  (20251114070455)
-- más 3 de lectura sin sección ("Authenticated users can read espacios_reserva",
-- "Only authenticated can read espacios", "Público puede ver espacios activos").
-- El DELETE es el grave: arrastra por ON DELETE CASCADE mesas,
-- asignaciones_mesa, planos_espacio y configuracion_turnos (las acciones
-- referenciales no pasan por RLS) y deja reservas sin sala (SET NULL).
--
-- La demo NO tiene aplicada 20260928140000 (que en Git ya cerraba esto con
-- otros nombres): el estado real y el de Git difieren. Esta migración acepta
-- los dos y deja ambos en el mismo estado final.
--
-- ESTADO FINAL (D-005):
--   espacios_reserva_select_anon_activos  SELECT anon           activa = true
--   espacios_reserva_select_seccion       SELECT authenticated  can_read_section('reservas')
--   espacios_reserva_insert_seccion       INSERT authenticated  can_write_section('reservas')
--   espacios_reserva_update_seccion       UPDATE authenticated  can_write_section('reservas')
--   espacios_reserva_delete_seccion       DELETE authenticated  can_write_section('reservas')
--   espacios_reserva_service_role         ALL    service_role   true
--   acceso_panel_no_bloqueado             RESTRICTIVE (20261013082609; se crea si falta)
--   GRANT: anon solo SELECT; authenticated sin TRUNCATE (TRUNCATE no pasa por RLS
--   y TRUNCATE ... CASCADE ignora el ON DELETE de las FK).
--
-- LECTURA ANÓNIMA QUE SE CONSERVA: espacios ACTIVOS (mismo alcance que
-- "Público puede ver espacios activos"), pero TO anon y no TO public, para que
-- un autenticado sin sección no lea por OR. Consumidores revisados (grep
-- 30/10): web-casatomas/src y touza-restaurant-website/src solo la nombran en
-- types.ts; ni el SSG ni sus Edge Functions la consultan; restaurante-phone
-- (api/*) y las Edge Functions del panel (reservas-web, emails-reserva,
-- _shared/disponibilidad, auditoria-revertir) usan service role; el panel
-- viejo de restaurante-phone/src (anon key) la incrusta en un select de
-- reservas: se conserva el SELECT de anon para que ese join no pase a 403.
--
-- AVISO DELETE (para revisión): D-005 pone el DELETE en la sección, igual
-- que mesas. Git (20260928140000, opción A) lo tenía en is_super_admin(). Con
-- can_write_section = 'view' hoy, un usuario con reservas/view puede borrar
-- una sala y su cascada. Sigue siendo un cierre respecto a la demo (cualquier
-- cuenta), pero es más laxo que Git. Para la opción A basta cambiar la
-- expresión de espacios_reserva_delete_seccion por
-- (select public.is_super_admin((select auth.uid()))).
--
-- HUELLA (criterio de «esperadas opcionales»):
--   * Las 9 de la demo, la variante sin tilde y espacios_reserva_delete_super_admin
--     (Git) son ESPERADAS OPCIONALES: se borran con DROP POLICY IF EXISTS y,
--     si falta alguna, solo se avisa con NOTICE. Motivo: el estado de partida
--     no es uno solo (demo = las 9; Git = las de 20260928140000; producción
--     puede tener cualquier subconjunto si alguien tocó a mano).
--   * ABORTA ANTES de tocar nada si (a) hay alguna política que no está ni
--     entre las esperadas ni entre las finales (estado desconocido), o (b) no
--     hay ninguna esperada y tampoco está completo el estado final (no se
--     reconoce el punto de partida: revisar a mano).
--   * ABORTA AL FINAL si queda alguna política no prevista, una permisiva de
--     escritura con true / auth.uid() IS NOT NULL, RLS apagada, anon con
--     escritura o authenticated con TRUNCATE.
--   * Idempotente: con el estado final ya presente, vuelve a crear las
--     mismas políticas y GRANT; la huella no cambia.
--
-- ROLLBACK EXACTO: antes de cambiar nada se guarda una foto del estado previo
-- (políticas, RLS y GRANT de anon/authenticated) en
-- private.rem_t7_espacios_reserva_previo, solo la primera vez. El rollback
-- (supabase/rollbacks/20261030210000_..._ROLLBACK.sql) la restaura tal cual y
-- borra la tabla de la foto. Si la migración se aplica sobre un estado que ya
-- era el final y sin foto, la foto será ese estado final.
--
-- Bloqueos: ACCESS EXCLUSIVE breve sobre espacios_reserva (DROP/CREATE POLICY,
-- REVOKE) en UNA transacción; no reescribe datos. lock_timeout 5 s: si una
-- lectura larga bloquea, falla sin aplicar nada y se reintenta.
-- Orden: después de 20261030130000/140000; no depende de ellas.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create schema if not exists private;

do $t7$
declare
  v_rel regclass := to_regclass('public.espacios_reserva');
  v_esperadas text[] := array[
    'Público puede ver espacios activos',
    'Publico puede ver espacios activos',
    'Solo usuarios autenticados pueden crear espacios',
    'Solo usuarios autenticados pueden actualizar espacios',
    'Solo usuarios autenticados pueden eliminar espacios',
    'Authenticated users can read espacios_reserva',
    'Authenticated users can insert espacios_reserva',
    'Authenticated users can update espacios_reserva',
    'Authenticated users can delete espacios_reserva',
    'Only authenticated can read espacios',
    'espacios_reserva_delete_super_admin'];
  v_finales text[] := array[
    'espacios_reserva_select_anon_activos',
    'espacios_reserva_select_seccion',
    'espacios_reserva_insert_seccion',
    'espacios_reserva_update_seccion',
    'espacios_reserva_delete_seccion',
    'espacios_reserva_service_role'];
  v_restrictiva constant text := 'acceso_panel_no_bloqueado';
  v_desconocidas text[];
  v_presentes text[];
  v_faltan text[];
  v_final_completo boolean;
  v_n text;
  v_malos text[] := '{}';
begin
  if v_rel is null then
    raise exception 'MIGRACIÓN ABORTADA (T7-ESPACIOS): no existe public.espacios_reserva. No se ha tocado nada.';
  end if;

  -- 1) huella previa ---------------------------------------------------------
  select array_agg(polname order by polname) into v_desconocidas
    from pg_policy where polrelid = v_rel
     and polname <> all (v_esperadas || v_finales || v_restrictiva);
  if v_desconocidas is not null then
    raise exception 'MIGRACIÓN ABORTADA (T7-ESPACIOS): espacios_reserva tiene políticas que esta migración no conoce (una permisiva desconocida reabre por OR). No se ha tocado nada. Desconocidas: %',
      array_to_string(v_desconocidas, ', ');
  end if;

  select coalesce(array_agg(n order by n), '{}') into v_presentes
    from unnest(v_esperadas) n
   where exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n);
  v_final_completo := not exists (select 1 from unnest(v_finales) n
                                   where not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n));

  if cardinality(v_presentes) = 0 and not v_final_completo then
    raise exception 'MIGRACIÓN ABORTADA (T7-ESPACIOS): faltan políticas que se esperaba encontrar: no está ninguna de las esperadas (demo/Git) ni el estado final completo. Estado de partida no reconocido; revisar a mano. No se ha tocado nada.';
  end if;

  if not v_final_completo then
    select coalesce(array_agg(n), '{}') into v_faltan from unnest(v_esperadas) n where n <> all (v_presentes);
    if cardinality(v_faltan) > 0 then
      raise notice 'T7-ESPACIOS · esperadas opcionales ausentes (no aborta): %', array_to_string(v_faltan, '; ');
    end if;
  else
    raise notice 'T7-ESPACIOS · el estado final ya estaba presente: se reaplica (idempotente)';
  end if;

  -- 2) foto del estado previo (solo la primera vez) ---------------------------
  create table if not exists private.rem_t7_espacios_reserva_previo (
    id int primary key check (id = 1),
    politicas jsonb not null,
    rls boolean not null,
    grants jsonb not null,
    guardado_at timestamptz not null default now());
  revoke all on private.rem_t7_espacios_reserva_previo from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on private.rem_t7_espacios_reserva_previo from anon, authenticated, service_role;
  end if;

  insert into private.rem_t7_espacios_reserva_previo (id, politicas, rls, grants)
  select 1,
    coalesce((select jsonb_agg(jsonb_build_object(
                'n', p.policyname, 'permissive', p.permissive, 'roles', to_jsonb(p.roles),
                'cmd', p.cmd, 'qual', p.qual, 'check', p.with_check) order by p.policyname)
              from pg_policies p where p.schemaname = 'public' and p.tablename = 'espacios_reserva'), '[]'::jsonb),
    (select relrowsecurity from pg_class where oid = v_rel),
    jsonb_build_object(
      'anon', coalesce((select jsonb_agg(distinct a.privilege_type) from pg_class c, aclexplode(c.relacl) a
                         where c.oid = v_rel and a.grantee = 'anon'::regrole), '[]'::jsonb),
      'authenticated', coalesce((select jsonb_agg(distinct a.privilege_type) from pg_class c, aclexplode(c.relacl) a
                         where c.oid = v_rel and a.grantee = 'authenticated'::regrole), '[]'::jsonb))
  on conflict (id) do nothing;

  -- 3) aplicar ---------------------------------------------------------------
  alter table public.espacios_reserva enable row level security;

  foreach v_n in array v_esperadas loop
    execute format('drop policy if exists %I on public.espacios_reserva', v_n);
  end loop;
  foreach v_n in array v_finales loop
    execute format('drop policy if exists %I on public.espacios_reserva', v_n);
  end loop;

  create policy espacios_reserva_select_anon_activos on public.espacios_reserva
    as permissive for select to anon using (activa = true);
  create policy espacios_reserva_select_seccion on public.espacios_reserva
    as permissive for select to authenticated using ((select public.can_read_section('reservas')));
  create policy espacios_reserva_insert_seccion on public.espacios_reserva
    as permissive for insert to authenticated with check ((select public.can_write_section('reservas')));
  create policy espacios_reserva_update_seccion on public.espacios_reserva
    as permissive for update to authenticated
    using ((select public.can_write_section('reservas'))) with check ((select public.can_write_section('reservas')));
  create policy espacios_reserva_delete_seccion on public.espacios_reserva
    as permissive for delete to authenticated using ((select public.can_write_section('reservas')));
  create policy espacios_reserva_service_role on public.espacios_reserva
    as permissive for all to service_role using (true) with check (true);

  if to_regprocedure('private.sesion_panel_permitida()') is not null
     and not exists (select 1 from pg_policy where polrelid = v_rel and polname = v_restrictiva) then
    create policy acceso_panel_no_bloqueado on public.espacios_reserva as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  end if;

  revoke insert, update, delete, truncate, references, trigger on public.espacios_reserva from anon;
  grant select on public.espacios_reserva to anon;
  revoke truncate on public.espacios_reserva from authenticated;

  -- 4) huella final ----------------------------------------------------------
  select array_agg(polname order by polname) into v_desconocidas
    from pg_policy where polrelid = v_rel and polname <> all (v_finales || v_restrictiva);
  if v_desconocidas is not null then
    v_malos := v_malos || format('políticas no previstas: %s', array_to_string(v_desconocidas, ', '));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'espacios_reserva'
              and permissive = 'PERMISSIVE' and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and roles && array['public','authenticated','anon']::name[]
              and coalesce(qual, with_check) in ('true', '(auth.uid() IS NOT NULL)')) then
    v_malos := v_malos || 'queda una permisiva de escritura abierta';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_rel) then
    v_malos := v_malos || 'RLS apagada';
  end if;
  if has_table_privilege('anon', v_rel, 'INSERT') or has_table_privilege('anon', v_rel, 'UPDATE')
     or has_table_privilege('anon', v_rel, 'DELETE') or has_table_privilege('anon', v_rel, 'TRUNCATE') then
    v_malos := v_malos || 'anon conserva escritura';
  end if;
  if has_table_privilege('authenticated', v_rel, 'TRUNCATE') then
    v_malos := v_malos || 'authenticated conserva TRUNCATE';
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'MIGRACIÓN ABORTADA al final (T7-ESPACIOS): %. No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end
$t7$;

commit;
