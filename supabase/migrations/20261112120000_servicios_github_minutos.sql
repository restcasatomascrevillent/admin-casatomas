set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261112120000_servicios_github_minutos — Minutos de GitHub Actions en Super Admin › Servicios
-- ===========================================================================
-- Dueño (06/11/2026): «añade esas métricas al apartado de servicios en GitHub
-- para controlarlo». Desde el 03/11/2026 por la noche GitHub no arranca
-- ninguna ejecución de Actions (CI, PR a producción y copia de seguridad): se
-- gastaron los 2.000 minutos del plan gratuito en menos de tres días.
--
-- QUÉ HACE: añade a los límites de GitHub en servicios_contratados la métrica
-- «Minutos de Actions» con su límite (2.000 minutos al mes en repositorios
-- privados del plan Free), para que la tarjeta pinte la barra y el aviso del
-- 80 %. Las demás métricas nuevas (ejecuciones del mes, ejecuciones que no
-- arrancaron, bloqueado desde…) no tienen límite y las da la función
-- servicios-uso. No pisa un límite ya editado en el panel. Idempotente.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño.
-- Deshacer: supabase/rollbacks/20261112120000_servicios_github_minutos_ROLLBACK.sql
-- ===========================================================================

begin;

update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('actions_minutos', jsonb_build_object(
         'orden', 2,
         'etiqueta', 'Minutos de Actions',
         'limite', 2000,
         'unidad', 'minutos',
         'periodo', 'mes en curso',
         'fuente', 'https://docs.github.com/en/billing/concepts/product-billing/github-actions',
         'nota', 'El plan gratuito incluye 2.000 minutos de Linux al mes en repositorios privados. Al gastarlos, GitHub deja de arrancar las pruebas y la copia de seguridad hasta el mes siguiente o hasta poner un presupuesto.'
       )),
       cuenta = 'Cuenta restcasatomascrevillent · repositorios web-casatomas, admin-casatomas y touza-casatomas'
 where proveedor = 'github'
   and not (coalesce(limites, '{}'::jsonb) ? 'actions_minutos');

commit;
