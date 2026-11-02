set client_encoding = 'UTF8';
-- Rollback de 20261101180000_restricciones_novedades_espacios.sql: quita las
-- restricciones. No toca datos.
begin;
alter table public.novedades drop constraint if exists novedades_titulo_valido;
alter table public.novedades drop constraint if exists novedades_titulos_traducidos_longitud;
alter table public.novedades drop constraint if exists novedades_descripciones_longitud;
alter table public.novedades drop constraint if exists novedades_etiquetas_longitud;
alter table public.novedades drop constraint if exists novedades_fechas_en_orden;
alter table public.espacios_reserva drop constraint if exists espacios_reserva_nombre_valido;
alter table public.espacios_reserva drop constraint if exists espacios_reserva_descripcion_longitud;
alter table public.espacios_reserva drop constraint if exists espacios_reserva_capacidad_no_negativa;
commit;
