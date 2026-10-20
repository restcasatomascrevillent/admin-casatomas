-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260930150000_solicitudes_marca_desde_sala.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor).
--
-- Cuando: el trigger es TEMPORAL. Se quita cuando los bots de
-- restaurante-phone (PR #2) ya manden `marca` en produccion, o si diera
-- problemas.
--
-- Que revierte: borra el trigger trg_solicitudes_marca_desde_sala (primero)
-- y la funcion fn_solicitudes_marca_desde_sala().
--
-- Que se pierde: nada guardado. Las filas ya insertadas conservan la marca
-- que les puso el trigger. OJO si los bots VIEJOS siguen en produccion: sus
-- solicitudes de El Reservado vuelven a guardarse como 'casa_tomas' y, al
-- aceptarlas, crean una reserva de Casa Tomas. Consulta para localizarlas
-- despues:
--
--   select id, nombre, fecha_solicitada, hora_solicitada, created_at
--   from public.solicitudes_pendientes s
--   where s.marca = 'casa_tomas'
--     and s.estado not in ('resuelta', 'descartada')
--     and (exists (select 1 from public.espacios_reserva e
--                  where e.id = s.espacio_propuesto_id
--                    and btrim(e.caracteristicas->>'marca') = 'touza')
--          or ltrim(coalesce(s.notas_cliente, '')) like 'Solicitud de El Reservado%');
--
-- No toca la columna marca, ni su CHECK, ni fn_aceptar_propuesta_solicitud,
-- ni trg_notificar_solicitud.
-- ===========================================================================

begin;

drop trigger if exists trg_solicitudes_marca_desde_sala on public.solicitudes_pendientes;
drop function if exists public.fn_solicitudes_marca_desde_sala();

commit;

-- VERIFICACION:
--   select count(*) from pg_trigger
--   where tgrelid = 'public.solicitudes_pendientes'::regclass
--     and tgname = 'trg_solicitudes_marca_desde_sala';
--   -- -> 0
--   select to_regprocedure('public.fn_solicitudes_marca_desde_sala()');
--   -- -> null
