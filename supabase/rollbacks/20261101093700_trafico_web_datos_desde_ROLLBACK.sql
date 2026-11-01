-- ROLLBACK de migrations/20261101093700_trafico_web_datos_desde.sql. A mano.
-- ANTES, volver a desplegar la versión anterior de sync-trafico-web: la nueva
-- lee `datos_desde` y sin la columna falla al leer el estado.
-- Sin la columna, si Web Analytics ya está activado, el siguiente run pedirá
-- desde el 27-10-2026 y guardará como 0 los días en que estuvo apagado.
begin;
alter table public.trafico_web_sync_estado drop column if exists datos_desde;
commit;
