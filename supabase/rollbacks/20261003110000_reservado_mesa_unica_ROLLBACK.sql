set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003110000_reservado_mesa_unica.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261003110000_reservado_mesa_unica_ROLLBACK.sql
--
-- Borra la mesa «Reservado» y el plano del espacio Reservado de Casa Tomás
-- (78448cb5-…), que antes de la migración NO existían (0 mesas, 0 planos).
--
-- SEGURIDAD: si la mesa tiene asignaciones de reservas (pasadas, presentes o
-- futuras) ABORTA sin tocar nada. `asignaciones_mesa.mesa_id` es ON DELETE
-- CASCADE y borrar la mesa se llevaría esas asignaciones; hay que liberarlas a
-- mano antes (Reservas → plano del Reservado → «Quitar mesas») o decidir
-- conscientemente perderlas.
-- OJO: cualquier retoque hecho después en el editor (medidas, paredes) se pierde.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  c_espacio constant uuid := '78448cb5-29d2-43a2-9c39-d499d4cb2ef3';
  n integer;
begin
  select count(*) into n
    from public.asignaciones_mesa a
    join public.mesas m on m.id = a.mesa_id
   where m.espacio_id = c_espacio;
  if n > 0 then
    raise exception 'El Reservado tiene % asignacion(es) de mesa. Libéralas antes de deshacer (borrar la mesa las eliminaría en cascada).', n;
  end if;

  delete from public.mesas where espacio_id = c_espacio;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Se esperaba borrar 1 mesa del Reservado y salen % (¿se editó el plano?). Revisar a mano.', n;
  end if;

  delete from public.planos_espacio where espacio_id = c_espacio;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Se esperaba borrar 1 plano del Reservado y salen %. Revisar a mano.', n;
  end if;
end;
$$;

commit;
