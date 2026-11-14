set client_encoding = 'UTF8';
-- ROLLBACK de 20261130140000_facturas_avisos_al_verificar: quita el trigger y la función.
-- Los avisos ya archivados y los silencios «importe_inusual:<id>» se quedan (son como un
-- «Visto»); el resumen de revisión lo vuelve a poner al día el cron de las 06:15.
set lock_timeout = '5s';

drop trigger if exists facturas_avisos_al_verificar on public.facturas;
drop function if exists public.facturas_avisos_al_verificar_trg();
drop function if exists public.facturas_alertas_tras_verificar(bigint[]);

select 'facturas_avisos_al_verificar: deshecha' as resultado;
