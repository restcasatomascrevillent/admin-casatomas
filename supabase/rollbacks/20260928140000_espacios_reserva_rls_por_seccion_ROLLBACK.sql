-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260928140000_espacios_reserva_rls_por_seccion.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md: dentro de
-- migrations/ la CLI lo indexaria como una migracion mas y `supabase db
-- push` lo ejecutaria en orden alfabetico justo despues de la migracion que
-- revierte -- `..._ROLLBACK.sql` ordena DESPUES de
-- `20260928140000_espacios_reserva_rls_por_seccion.sql`, asi que las
-- politicas se cerrarian y se reabririan en el mismo push). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- OJO: a fecha de hoy (2026-09-28) la migracion que revierte **NO ESTA
-- APLICADA EN NINGUN SITIO**. Este fichero existe para el dia en que lo este.
-- Ejecutarlo ahora no haria nada util: los `drop policy if exists` no
-- encontrarian nada y recrearia unas politicas que ya existen (fallaria en el
-- primer `create policy` por nombre duplicado, dentro de la transaccion, sin
-- dejar rastro).
--
-- ---------------------------------------------------------------------------
-- AVISO 1 -- ESTO REABRE EL AGUJERO, Y ESTE ES DE LOS CAROS
-- ---------------------------------------------------------------------------
--   Ejecutar esto devuelve a CUALQUIER usuario autenticado el poder de
--   crear, editar y **BORRAR** espacios. Y borrar un espacio no borra solo un
--   espacio: `espacios_reserva` esta referenciada con ON DELETE CASCADE desde
--   `mesas`, `asignaciones_mesa`, `planos_espacio` y `configuracion_turnos`, y
--   con ON DELETE SET NULL desde `reservas` (dos columnas) y
--   `solicitudes_pendientes`. Las acciones referenciales corren con los
--   derechos del propietario y NO aplican RLS, asi que este rollback reabre
--   de rebote la escritura sobre `mesas` y `asignaciones_mesa` que cerro
--   20260928120000, sin tocar ni una de sus politicas.
--
--   Devuelve ademas el privilegio TRUNCATE a `authenticated` -- que NO pasa
--   por la RLS -- y `REFERENCES`/`TRIGGER` a `anon`. El SELECT de `anon` no
--   cambia: lo tiene antes y despues (la migracion lo conserva a proposito).
--
-- ---------------------------------------------------------------------------
-- AVISO 2 -- EL ORDEN IMPORTA SI EL FRONTEND YA SE ADAPTO
-- ---------------------------------------------------------------------------
--   Hoy `src/pages/Espacios.tsx` no comprueba ningun permiso por su cuenta:
--   le basta con estar bajo `SuperAdminRoute`. Si para cuando se ejecute esto
--   el panel ya deshabilita botones segun permisos, revertir el frontend
--   DESPUES, no antes: al reves deja botones apagados sobre una base de datos
--   abierta, que es el fallo barato. Al reves es el caro.
--
-- ---------------------------------------------------------------------------
-- QUE REVIERTE -- exactamente el estado leido de produccion el 2026-09-28
-- ---------------------------------------------------------------------------
--   1. Borra las 6 politicas que crea la migracion.
--   2. Recrea las 9 originales, con su NOMBRE (tilde incluida), su ROL
--      (`public` o `authenticated`) y su expresion EXACTOS, incluidas las
--      duplicadas de `20260208164215` y la suelta de `20260228173300`. Se
--      recrean TODAS porque el estado al que se vuelve las tenia todas: si se
--      recrearan solo algunas, esto no seria un rollback sino otro cambio.
--   3. Devuelve los grants: TRUNCATE a `authenticated` y
--      REFERENCES + TRIGGER a `anon` (el SELECT de `anon` ya lo tiene; se
--      incluye en el mismo grant para que el estado final sea explicito).
--
--   NO hay datos que perder ni que recuperar: la migracion no hace ningun
--   INSERT, UPDATE ni DELETE sobre filas. Solo politicas y privilegios.
--
--   NO toca ninguna funcion, ninguna vista ni ningun trigger: la migracion
--   tampoco lo hacia. `validar_capacidad_reserva` y
--   `fn_aceptar_propuesta_solicitud` siguen SECURITY INVOKER,
--   `fn_capacidad_efectiva_marca` sigue SECURITY DEFINER,
--   `vista_asignacion_dia` y `vista_capacidad_espacios` siguen
--   security_invoker = on, y ninguna de las siete funciones implicadas
--   necesitaba `search_path` (ya lo tenian todas).
--
--   NO toca las FK ni el CASCADE: no se cambia ninguna, ni antes ni despues.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Borrar las politicas nuevas
--    La de DELETE puede llamarse de dos maneras segun la opcion que se
--    aplicara (ver la cabecera de la migracion): se contemplan las dos.
-- ---------------------------------------------------------------------------

drop policy if exists espacios_reserva_select_anon_activos on public.espacios_reserva;
drop policy if exists espacios_reserva_select_seccion      on public.espacios_reserva;
drop policy if exists espacios_reserva_insert_seccion      on public.espacios_reserva;
drop policy if exists espacios_reserva_update_seccion      on public.espacios_reserva;
drop policy if exists espacios_reserva_delete_super_admin  on public.espacios_reserva;
drop policy if exists espacios_reserva_delete_seccion      on public.espacios_reserva;  -- OPCION C
drop policy if exists espacios_reserva_service_role        on public.espacios_reserva;

-- ---------------------------------------------------------------------------
-- 2) Recrear las 9 originales
--    Sin `TO ...` explicito PostgreSQL asigna el rol `public`: asi es como
--    estaban las cuatro de 20251114070455 (el fichero original no llevaba
--    clausula de rol), y por eso salen con roles = {public} en pg_policies.
-- ---------------------------------------------------------------------------

-- juego de 20251114070455 (rol public). El nombre lleva tilde: es el que hay
-- en produccion, y sin ella esto no seria el mismo estado.
create policy "Público puede ver espacios activos"
  on public.espacios_reserva for select using (activa = true);
create policy "Solo usuarios autenticados pueden crear espacios"
  on public.espacios_reserva for insert with check (auth.uid() is not null);
create policy "Solo usuarios autenticados pueden actualizar espacios"
  on public.espacios_reserva for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "Solo usuarios autenticados pueden eliminar espacios"
  on public.espacios_reserva for delete using (auth.uid() is not null);

-- juego duplicado de 20260208164215 (TO authenticated, true)
create policy "Authenticated users can read espacios_reserva"
  on public.espacios_reserva for select to authenticated using (true);
create policy "Authenticated users can insert espacios_reserva"
  on public.espacios_reserva for insert to authenticated with check (true);
create policy "Authenticated users can update espacios_reserva"
  on public.espacios_reserva for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete espacios_reserva"
  on public.espacios_reserva for delete to authenticated using (true);

-- suelta, de 20260228173300
create policy "Only authenticated can read espacios"
  on public.espacios_reserva for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3) Devolver los grants
-- ---------------------------------------------------------------------------

grant truncate on public.espacios_reserva to authenticated;
grant select, references, trigger on public.espacios_reserva to anon;

commit;

-- ===========================================================================
-- VERIFICACION DEL ROLLBACK (a mano, despues)
-- ===========================================================================
--
-- select policyname, cmd, roles::text,
--        coalesce(qual,'-'), coalesce(with_check,'-')
-- from pg_policies
-- where schemaname='public' and tablename='espacios_reserva'
-- order by cmd, policyname;
--   -- esperado: 9 filas -- 3 de SELECT, 2 de INSERT, 2 de UPDATE, 2 de
--   -- DELETE -- y ninguna con nombre `espacios_reserva_*`.
--
-- select grantee, string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name='espacios_reserva'
--   and grantee in ('anon','authenticated','service_role')
-- group by 1 order by 1;
--   -- esperado: anon = REFERENCES,SELECT,TRIGGER;
--   --           authenticated = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,
--   --                           TRUNCATE,UPDATE.
-- ---------------------------------------------------------------------------
