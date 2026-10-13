set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##   El Reservado de Casa Tomás pasa de 20 a 14 plazas                   ##
-- ##   (decisión del dueño, 13/10/2026: «El Reservado entran 14»)          ##
-- ===========================================================================
--
-- QUÉ CAMBIA (solo dos UPDATE, nada se borra ni se mueve)
--   · espacios_reserva 78448cb5-29d2-43a2-9c39-d499d4cb2ef3 («Reservado»):
--     capacidad_maxima 20 → 14.
--   · Su mesa única «Reservado» (20261003110000_reservado_mesa_unica.sql):
--     capacidad 20 → 14, para que `vista_capacidad_espacios` siga cuadrando.
--     Medidas y posición en el plano: sin tocar.
--
-- EFECTOS
--   · AFORO: ninguno. El Reservado es sala privada FUERA DE AFORO
--     (20261003150000): ni suma capacidad ni sus reservas consumen aforo.
--   · El trigger de la BD NO limita comensales por sala: un grupo de más de
--     14 se puede seguir guardando en el Reservado. El panel avisa y propone
--     la mesa larga del Salón (src/lib/reservas/grupoGrande.ts).
--   · Web y bot: no ofrecen el Reservado (nunca asignan sala privada).
--   · supabase/tests/reservado_mesa_unica_test.sql comprobaba 20 plazas: tras
--     esto, esperar 14.
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261013130000_reservado_14_plazas.sql
-- Deshacer: los mismos UPDATE con 14 → 20.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  c_espacio constant uuid := '78448cb5-29d2-43a2-9c39-d499d4cb2ef3';
  e record;
  n integer;
begin
  select id, nombre, activa, capacidad_maxima, caracteristicas into e
    from public.espacios_reserva where id = c_espacio;
  if not found then
    raise exception 'No existe el espacio Reservado de Casa Tomás (%).', c_espacio;
  end if;
  if e.capacidad_maxima = 14 then
    raise notice 'El Reservado ya tiene 14 plazas: nada que hacer.';
    return;
  end if;
  if e.nombre <> 'Reservado'
     or e.capacidad_maxima is distinct from 20
     or e.caracteristicas->'privada' is distinct from 'true'::jsonb then
    raise exception 'El Reservado no es el esperado (nombre %, capacidad %, caracteristicas %). Revisar antes de aplicar.',
      e.nombre, e.capacidad_maxima, e.caracteristicas;
  end if;

  update public.espacios_reserva set capacidad_maxima = 14 where id = c_espacio;

  -- La mesa única (la sala entera): mismas plazas que la sala.
  update public.mesas set capacidad = 14
   where espacio_id = c_espacio and capacidad = 20 and coalesce(activa, true) and not coalesce(is_merged, false);
  get diagnostics n = row_count;
  if n > 1 then
    raise exception 'El Reservado tiene % mesas activas de 20 (se esperaba 1). Revisar a mano.', n;
  end if;
  if n = 0 then
    raise notice 'El Reservado no tenía su mesa única de 20 plazas: solo se cambia la sala.';
  end if;
end;
$$;

commit;

-- Comprobación:
-- select e.nombre, e.capacidad_maxima, m.nombre as mesa, m.capacidad
--   from public.espacios_reserva e left join public.mesas m on m.espacio_id = e.id and m.activa
--  where e.id = '78448cb5-29d2-43a2-9c39-d499d4cb2ef3';
