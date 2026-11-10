set client_encoding = 'UTF8';
-- Deshace 20261122121500_reservas_origen.sql. BORRA lo guardado sobre cómo se
-- hizo cada reserva web (tiempos del formulario, dispositivo, procedencia).
-- La Edge Function reservas-web sigue funcionando sin la columna (reintenta el
-- INSERT sin `origen`), así que no hace falta redesplegarla antes.
begin;

alter table public.reservas drop constraint if exists reservas_origen_objeto_acotado;
alter table public.reservas drop column if exists origen;

commit;
