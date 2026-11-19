set client_encoding = 'UTF8';
-- Vuelta atrás de 20261212810000_presupuestos_comparacion_guardada: quita la tabla de comparaciones
-- guardadas. chat-facturas sigue funcionando sin ella (vuelve a calcular la comparación cada vez).
begin;
set local lock_timeout = '5s';
drop table if exists public.chat_presupuestos_comparaciones;
commit;
