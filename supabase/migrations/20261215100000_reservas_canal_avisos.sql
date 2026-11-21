set client_encoding = 'UTF8';
-- ===========================================================================
-- CANAL DE LOS AVISOS DE RESERVA: EMAIL O WHATSAPP (dueño, 21/11/2026)
-- ===========================================================================
-- Petición: «que cuando se haga la reserva se pueda elegir el método de
-- recepción de mensajes» (prueba de concepto de avisos por WhatsApp, ver
-- docs/funcionalidades/whatsapp-reservas.md).
--
-- QUÉ HACE
--   · `reservas.canal_avisos`: 'email' (por defecto, lo de siempre) o
--     'whatsapp'. Lo rellena reservas-web cuando el cliente elige WhatsApp en
--     el formulario de la web (solo se le ofrece si WhatsApp está activo en
--     ese entorno: hoy, solo la demo).
--   · emails-reserva lo lee al mandar cada aviso: con 'whatsapp' se lo pide a
--     whatsapp-reservas y, si no sale, manda el correo de siempre.
--   · Las reservas que ya existen quedan en 'email': nada cambia para ellas.
--   · Ni RLS ni permisos nuevos: la columna sigue las políticas de `reservas`.
--
-- Idempotente. Vuelta atrás:
--   supabase/rollbacks/20261215100000_reservas_canal_avisos_ROLLBACK.sql
-- Prueba (PGlite): npm run test:canal-avisos:db
-- ===========================================================================
begin;
set local lock_timeout = '5s';

-- Con DEFAULT constante no reescribe la tabla (Postgres 11+): es inmediato.
alter table public.reservas
  add column if not exists canal_avisos text not null default 'email';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_canal_avisos_check' and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas
      add constraint reservas_canal_avisos_check check (canal_avisos in ('email', 'whatsapp'));
  end if;
end $$;

comment on column public.reservas.canal_avisos is
  'Por dónde quiere el cliente los avisos de su reserva: email (por defecto) o whatsapp. Lo elige en el formulario de la web; emails-reserva lo lee al avisar y, si el WhatsApp no sale, manda el correo (migración 20261215100000).';

commit;
