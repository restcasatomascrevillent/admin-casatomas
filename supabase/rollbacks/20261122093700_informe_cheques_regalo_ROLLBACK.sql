set client_encoding = 'UTF8';
-- ROLLBACK de 20261122093700_informe_cheques_regalo.sql: quita la RPC del
-- informe de cheques regalo. No toca datos: la RPC solo lee.
begin;

drop function if exists public.informe_cheques_regalo(date, date);
notify pgrst, 'reload schema';

commit;
