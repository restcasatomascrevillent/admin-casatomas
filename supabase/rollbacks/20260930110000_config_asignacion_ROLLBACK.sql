-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260930110000_config_asignacion.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- ANTES: revertir el frontend (useConfiguracionReservas,
-- ConfiguracionGeneralReservas, PanelAsignacion) Y ejecutar el rollback de
-- 20260930120000_aviso_reservas_sin_asignar, cuya funcion lee
-- asignacion_ventana_horas y asignacion_aviso_activo. Con el panel vivo, la
-- pantalla de configuracion falla al guardar (PGRST204) y el cron empezaria
-- a fallar cada 15 minutos (42703).
--
-- QUE SE PIERDE: el ajuste de horas de ventana, el interruptor del aviso y
-- las listas de salas/mesas excluidas. Copia previa si hace falta:
--   select asignacion_ventana_horas, asignacion_aviso_activo,
--          asignacion_espacios_excluidos, asignacion_mesas_excluidas
--   from public.configuracion_reservas;
--
-- No toca el aforo, ni reservas, ni espacio_id, ni asignaciones_mesa.
-- ===========================================================================

begin;

alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_asignacion_ventana_rango;

alter table public.configuracion_reservas
  drop column if exists asignacion_ventana_horas,
  drop column if exists asignacion_aviso_activo,
  drop column if exists asignacion_espacios_excluidos,
  drop column if exists asignacion_mesas_excluidas;

commit;

-- VERIFICACION:
--   select count(*) from information_schema.columns
--   where table_name = 'configuracion_reservas' and column_name like 'asignacion_%';
--   -- -> 0
