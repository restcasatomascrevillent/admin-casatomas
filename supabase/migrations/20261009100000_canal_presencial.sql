set client_encoding = 'UTF8';
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano                              ##
-- ##   Canal 'presencial' para quien entra SIN RESERVA (walk-in).          ##
-- ===========================================================================
-- El botón «Sin reserva» del panel crea la reserva con canal 'presencial'.
-- Mientras esta migración no esté aplicada, el CHECK la rechaza y el panel
-- reintenta solo con 'manual' (ver `src/hooks/useSentarSinReserva.ts`), así
-- que funciona igual antes y después; con ella, las estadísticas por canal
-- distinguen a quien entra de la calle.
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261009100000_canal_presencial.sql
-- ===========================================================================
begin;
set local lock_timeout = '5s';
alter table public.reservas drop constraint if exists reservas_canal_check;
alter table public.reservas add constraint reservas_canal_check
  check (canal = any (array['web'::text, 'telefono'::text, 'manual'::text, 'presencial'::text]));
commit;
