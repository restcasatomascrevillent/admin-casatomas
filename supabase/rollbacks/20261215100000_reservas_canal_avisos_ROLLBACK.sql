set client_encoding = 'UTF8';
-- ===========================================================================
-- VUELTA ATRÁS de 20261215100000_reservas_canal_avisos.sql
-- ===========================================================================
-- Quita `reservas.canal_avisos`. Se pierde qué clientes eligieron WhatsApp:
-- desde ese momento todos sus avisos van por correo (emails-reserva no
-- encuentra la columna y manda el correo, ver avisarPorWhatsAppSiLoEligio).
-- Antes, apaga WHATSAPP_RESERVAS_ACTIVO en las funciones del entorno para que
-- la web deje de ofrecer WhatsApp. Idempotente.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

alter table public.reservas drop constraint if exists reservas_canal_avisos_check;
alter table public.reservas drop column if exists canal_avisos;

commit;
