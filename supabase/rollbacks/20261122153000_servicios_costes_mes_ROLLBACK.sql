set client_encoding = 'UTF8';
-- ROLLBACK de 20261122153000_servicios_costes_mes.sql: borra los costes metidos
-- a mano por mes (¡se pierden!), el resumen mensual y la lectura de las cargas
-- del mapa de vinos, y devuelve a Drive y Mapbox la nota «Sin lectura
-- automática». No toca las lecturas guardadas ni los servicios.
begin;

drop function if exists public.servicios_cargas_mapa_vinos(timestamptz);
drop function if exists public.servicios_resumen_mes(date);
drop table if exists public.servicios_costes_mes;
drop function if exists public.servicios_costes_mes_al_editar();

update public.servicios_contratados
   set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', to_jsonb(
         'Después, 5 US$ cada 1.000 cargas. El mapa solo se carga cuando un visitante lo abre. Sin lectura automática: míralo en su panel (Statistics).'::text))
 where proveedor = 'mapbox'
   and limites -> 'cargas_mapa_web' ->> 'nota' like '%Lectura automática%';

update public.servicios_contratados
   set limites = jsonb_set(limites, '{almacenamiento,nota}', to_jsonb(
         'Compartido con Gmail y Google Fotos de esa cuenta. Sin lectura automática: míralo en Drive.'::text))
 where proveedor = 'google_drive'
   and limites -> 'almacenamiento' ->> 'nota' like '%Lectura automática%';

commit;
