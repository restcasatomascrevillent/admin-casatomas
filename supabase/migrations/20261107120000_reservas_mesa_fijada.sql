set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261107120000_reservas_mesa_fijada — «Fijar mesa» de una reserva (07/11/2026)
-- ===========================================================================
-- Dueño (07/11/2026): «gente que quiere esa mesa y el restaurante lo sabe».
-- Una reserva con la mesa FIJADA no se mueve en los recálculos («Organizar»,
-- «Recalcular mesas») ni se le quita la mesa al sentar a otra persona.
--
-- QUÉ HACE
--   reservas.mesa_fijada boolean NOT NULL DEFAULT false.
--   Va en `reservas` y no en `asignaciones_mesa` porque el RPC
--   `asignar_mesas_reserva` REEMPLAZA las filas de asignación (se perdería).
--   La regla la aplica el panel (lógica pura en src/lib/reservas/
--   recalcularMesas.ts y organizarServicio.ts); la base de datos no añade
--   lógica: el trigger `reservas_sincronizar_asignaciones` sigue igual (si se
--   cambia la sala o el día de una reserva fijada, sus mesas se borran como
--   siempre y la fijación queda sin mesa, que el panel ignora).
--
-- PERMISOS: no cambian. El UPDATE de `reservas` ya lo tiene `authenticated`
-- (GRANT de tabla de Supabase) y la RLS `reservas_update_seccion` exige
-- can_edit_section('reservas'): solo quien edita reservas puede fijar.
--
-- ORDEN DE DESPLIEGUE: el panel pide la columna por nombre en «Hoy»
-- (COLUMNAS_RESERVAS_HOY y el select de asignaciones). Aplicarla en cada
-- proyecto ANTES (o a la vez) de publicar el panel que la usa.
--
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo con el «sí» del dueño. Idempotente.
-- Deshacer: supabase/rollbacks/20261107120000_reservas_mesa_fijada_ROLLBACK.sql
-- Pruebas: npm run test:mesa-fijada:db (PGlite).
-- ===========================================================================
begin;
set local lock_timeout = '5s';

alter table public.reservas
  add column if not exists mesa_fijada boolean not null default false;

comment on column public.reservas.mesa_fijada is
  'Mesa fijada (07/11/2026): el cliente quiere ESA mesa. Los recálculos del panel (Organizar, Recalcular mesas) no la mueven y al sentar a otro no se le quita. Solo tiene efecto si la reserva tiene mesa asignada.';

notify pgrst, 'reload schema';
commit;
