-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260925140000_cerrar_insert_anonimo_visitas_producto.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta a
-- mano (psql / SQL editor) y solo para deshacer un despliegue que salio
-- mal.
--
-- Reabre el INSERT anonimo sin validar contenido sobre `visitas_producto`,
-- y el privilegio de SELECT de tabla para anon (inerte bajo RLS, ver la
-- cabecera de la migracion que revierte). Deja la tabla exactamente como
-- estaba antes de 20260925140000: politica combinada "Cualquiera puede
-- registrar visitas" (anon+authenticated) y los dos GRANT de tabla.
--
-- ---------------------------------------------------------------------------

begin;

drop policy if exists "Autenticados pueden registrar visitas" on public."visitas_producto";

create policy "Cualquiera puede registrar visitas"
  on public."visitas_producto"
  for insert
  to anon, authenticated
  with check (true);

grant insert on public."visitas_producto" to anon;
grant select on public."visitas_producto" to anon;

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACION -- ejecutar despues de este rollback:
--
-- select policyname, roles, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'visitas_producto' and cmd = 'INSERT';
--
-- select
--   has_table_privilege('anon', 'public.visitas_producto', 'INSERT') as anon_puede_insertar,
--   has_table_privilege('anon', 'public.visitas_producto', 'SELECT') as anon_puede_leer;
--
-- Debe devolver: "Cualquiera puede registrar visitas" ({anon,authenticated},
-- true); y (true, true) -- el estado exacto de antes de 20260925140000.
-- ---------------------------------------------------------------------------
