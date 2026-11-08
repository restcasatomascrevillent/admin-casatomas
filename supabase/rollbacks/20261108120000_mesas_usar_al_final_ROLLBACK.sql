-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261108120000_mesas_usar_al_final.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salio mal.
--
-- ANTES: revertir el frontend (useConfiguracionReservas,
-- ConfiguracionGeneralReservas). Con el panel vivo, guardar la configuracion
-- fallaria (PGRST204).
--
-- QUE SE PIERDE: la lista de mesas que se usan al final. Copia previa:
--   select asignacion_mesas_al_final from public.configuracion_reservas;
-- ===========================================================================

begin;

alter table public.configuracion_reservas
  drop column if exists asignacion_mesas_al_final;

commit;
