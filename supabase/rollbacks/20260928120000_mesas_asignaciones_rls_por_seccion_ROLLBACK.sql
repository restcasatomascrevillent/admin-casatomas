-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260928120000_mesas_asignaciones_rls_por_seccion.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md: dentro de
-- migrations/ la CLI lo indexaria como una migracion mas y `supabase db
-- push` lo ejecutaria en orden alfabetico justo despues de la migracion que
-- revierte -- `..._ROLLBACK.sql` ordena DESPUES de
-- `20260928120000_mesas_asignaciones_rls_por_seccion.sql`, asi que las
-- politicas se cerrarian y se reabririan en el mismo push). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- ---------------------------------------------------------------------------
-- AVISO 1 -- ESTO REABRE EL AGUJERO ENTERO
-- ---------------------------------------------------------------------------
--   Ejecutar esto devuelve a CUALQUIER usuario autenticado el poder de crear,
--   editar y borrar mesas y de asignar mesas a reservas sin pasar por
--   `can_write_section()`. Es exactamente el estado que el encargo del
--   2026-09-28 queria cerrar. No es un rollback inofensivo.
--
--   Devuelve ademas el privilegio TRUNCATE a `authenticated` sobre `mesas` y
--   `asignaciones_mesa` -- que NO pasa por la RLS -- y el SELECT de `anon`
--   sobre esas dos tablas.
--
-- ---------------------------------------------------------------------------
-- AVISO 2 -- EL ORDEN IMPORTA SI EL FRONTEND YA SE ADAPTO
-- ---------------------------------------------------------------------------
--   Si para cuando se ejecute esto el panel ya deshabilita botones segun
--   `useCanAccessSection("reservas", ...)` (ver el informe del encargo: hoy
--   `PlanoEspacio2D.tsx` NO comprueba permisos), este rollback no rompe nada
--   pero deja botones apagados sobre una base de datos abierta. Revertir el
--   frontend DESPUES, no antes: al reves no hay ventana de riesgo.
--
-- ---------------------------------------------------------------------------
-- QUE REVIERTE -- exactamente el estado leido de pg_policies el 2026-09-28
-- ---------------------------------------------------------------------------
--   1. Borra las 12 politicas `*_seccion` / `*_service_role` que crea la
--      migracion sobre `mesas`, `asignaciones_mesa` y
--      `asignaciones_mesa_descartadas`.
--   2. Recrea las 14 politicas originales, con su NOMBRE, su ROL (`public` o
--      `authenticated`) y su expresion EXACTOS, incluidas las duplicadas de
--      `mesas` (dos de SELECT, dos de INSERT, dos de UPDATE y dos de DELETE)
--      que venian de 20251207090324 y 20260208164215. Se recrean las dos
--      porque el estado al que se vuelve las tenia las dos: si solo se
--      recreara una, esto no seria un rollback sino otro cambio.
--   3. Devuelve los grants: TRUNCATE a `authenticated` en las tres tablas y
--      SELECT/REFERENCES/TRIGGER a `anon` en `mesas` y `asignaciones_mesa`.
--      `asignaciones_mesa_descartadas` NO recupera nada de `anon`: nunca lo
--      tuvo (20260926140000 ya se lo habia revocado) y la migracion que se
--      revierte tampoco se lo quito.
--
--   NO hay datos que perder ni que recuperar: la migracion no hace ningun
--   INSERT, UPDATE ni DELETE sobre filas. Solo politicas y privilegios.
--
--   NO toca ninguna funcion ni ningun trigger: la migracion tampoco lo hacia
--   (las 10 funciones implicadas ya tenian `search_path=public` y se dejaron
--   como estaban). `asignar_mesas_reserva` sigue SECURITY INVOKER antes y
--   despues, y los tres triggers SECURITY DEFINER no se tocan en ningun
--   momento.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Borrar las politicas nuevas
-- ---------------------------------------------------------------------------

drop policy if exists mesas_select_seccion  on public.mesas;
drop policy if exists mesas_insert_seccion  on public.mesas;
drop policy if exists mesas_update_seccion  on public.mesas;
drop policy if exists mesas_delete_seccion  on public.mesas;
drop policy if exists mesas_service_role    on public.mesas;

drop policy if exists asignaciones_mesa_select_seccion on public.asignaciones_mesa;
drop policy if exists asignaciones_mesa_insert_seccion on public.asignaciones_mesa;
drop policy if exists asignaciones_mesa_update_seccion on public.asignaciones_mesa;
drop policy if exists asignaciones_mesa_delete_seccion on public.asignaciones_mesa;
drop policy if exists asignaciones_mesa_service_role   on public.asignaciones_mesa;

drop policy if exists asignaciones_mesa_descartadas_select_seccion on public.asignaciones_mesa_descartadas;
drop policy if exists asignaciones_mesa_descartadas_service_role   on public.asignaciones_mesa_descartadas;

-- ---------------------------------------------------------------------------
-- 2) Recrear las 14 originales
--    Sin `TO ...` explicito PostgreSQL asigna el rol `public`: asi es como
--    estaban las de 20251207090324 (el fichero original no llevaba clausula
--    de rol), y por eso salen con roles = {public} en pg_policies.
-- ---------------------------------------------------------------------------

-- mesas -- juego de 20251207090324 (rol public)
create policy "Usuarios autenticados pueden ver mesas"
  on public.mesas for select using (auth.uid() is not null);
create policy "Usuarios autenticados pueden crear mesas"
  on public.mesas for insert with check (auth.uid() is not null);
create policy "Usuarios autenticados pueden actualizar mesas"
  on public.mesas for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "Usuarios autenticados pueden eliminar mesas"
  on public.mesas for delete using (auth.uid() is not null);

-- mesas -- juego duplicado de 20260208164215 (TO authenticated, true)
create policy "Authenticated users can read mesas"
  on public.mesas for select to authenticated using (true);
create policy "Authenticated users can insert mesas"
  on public.mesas for insert to authenticated with check (true);
create policy "Authenticated users can update mesas"
  on public.mesas for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete mesas"
  on public.mesas for delete to authenticated using (true);

-- asignaciones_mesa -- la abierta del todo (20260208164243)
create policy "Auth can manage asignaciones_mesa"
  on public.asignaciones_mesa for all to authenticated using (true) with check (true);

-- asignaciones_mesa -- juego de 20251207090324 (rol public)
create policy "Usuarios autenticados pueden ver asignaciones"
  on public.asignaciones_mesa for select using (auth.uid() is not null);
create policy "Usuarios autenticados pueden crear asignaciones"
  on public.asignaciones_mesa for insert with check (auth.uid() is not null);
create policy "Usuarios autenticados pueden actualizar asignaciones"
  on public.asignaciones_mesa for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "Usuarios autenticados pueden eliminar asignaciones"
  on public.asignaciones_mesa for delete using (auth.uid() is not null);

-- asignaciones_mesa_descartadas -- la lectura abierta de 20260926140000
create policy "Autenticados leen asignaciones descartadas"
  on public.asignaciones_mesa_descartadas for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3) Devolver los grants
-- ---------------------------------------------------------------------------

grant truncate on public.mesas                         to authenticated;
grant truncate on public.asignaciones_mesa             to authenticated;
grant truncate on public.asignaciones_mesa_descartadas to authenticated;

grant select, references, trigger on public.mesas             to anon;
grant select, references, trigger on public.asignaciones_mesa to anon;

commit;

-- ===========================================================================
-- VERIFICACION DEL ROLLBACK (a mano, despues)
-- ===========================================================================
--
-- select tablename, policyname, cmd, roles::text,
--        coalesce(qual,'-'), coalesce(with_check,'-')
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
-- order by tablename, cmd, policyname;
--   -- esperado: 14 filas -- 8 en mesas, 5 en asignaciones_mesa, 1 en
--   -- asignaciones_mesa_descartadas -- y ninguna con nombre `*_seccion`.
--
-- select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
--   and grantee in ('anon','authenticated','service_role')
-- group by 1,2 order by 1,2;
--   -- esperado: anon con SELECT,REFERENCES,TRIGGER en mesas y
--   -- asignaciones_mesa (y ausente en descartadas); authenticated con
--   -- TRUNCATE en las tres.
-- ---------------------------------------------------------------------------
