set client_encoding = 'UTF8';
-- Vuelta atrás de 20261207110000_informe_subidas_proveedor: quita el informe fijo
-- «Subidas y proveedor» (el panel enseña entonces «necesita la migración»). No toca datos.
begin;
set local lock_timeout = '5s';

drop function if exists public.informe_subidas_precio(integer, bigint, bigint, text, date, integer, integer, boolean);
drop function if exists public.informe_proveedor_mas_barato(bigint, bigint, text, date, integer, integer, boolean);
drop function if exists public.informe_precios_compacto(jsonb, text);
drop function if exists public.informe_precios_doc(bigint);
drop function if exists public.informe_precios_compras(date, text);

commit;
