set client_encoding = 'UTF8';
-- ROLLBACK de 20261112120000_servicios_github_minutos.sql: quita el límite de
-- «Minutos de Actions» de GitHub (la métrica se sigue leyendo, sin barra).
begin;
update public.servicios_contratados
   set limites = limites - 'actions_minutos'
 where proveedor = 'github';
commit;
