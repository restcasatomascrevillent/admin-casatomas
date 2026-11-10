-- ROLLBACK de 20261118100100_logs_web_operaciones_bd.sql: quita los triggers
-- de reservas y cheques_regalo que apuntan las operaciones web en web_eventos.
-- Los eventos ya registrados se quedan (se borran con el rollback de 20261118100000).
begin;
drop trigger if exists web_logs_operacion_bd on public.reservas;
drop trigger if exists web_logs_operacion_bd on public.cheques_regalo;
drop function if exists public.web_logs_operacion_bd();
commit;
