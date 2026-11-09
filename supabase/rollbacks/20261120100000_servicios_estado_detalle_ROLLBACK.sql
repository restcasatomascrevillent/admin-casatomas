set client_encoding = 'UTF8';
-- ROLLBACK de 20261120100000_servicios_estado_detalle.sql: quita la RPC de
-- conexiones y tablas mayores, devuelve a GitHub el límite de 12 US$ de
-- «Pruebas automáticas» y el nombre «Minutos de Actions», y quita el límite de
-- memoria de las funciones de Vercel. No toca las lecturas guardadas.
begin;

drop function if exists public.servicios_metricas_bd_extra();

update public.servicios_contratados
   set limites = jsonb_set(
         limites,
         '{actions_computo}',
         (limites -> 'actions_computo') || jsonb_build_object(
           'limite', 12,
           'nota', 'El plan gratuito incluye 12 USD de cómputo al mes en repositorios privados (unos 2.000 minutos de Linux).'
         ))
 where proveedor = 'github'
   and limites ? 'actions_computo'
   and not (limites -> 'actions_computo' ? 'limite');

update public.servicios_contratados
   set limites = jsonb_set(limites, '{actions_minutos,etiqueta}', to_jsonb('Minutos de Actions'::text))
 where proveedor = 'github'
   and limites -> 'actions_minutos' ->> 'etiqueta' = 'Minutos de Actions en repositorios privados';

update public.servicios_contratados
   set limites = limites - 'memoria_funciones'
 where proveedor = 'vercel';

commit;
