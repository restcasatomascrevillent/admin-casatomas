-- Vuelta atrás de 20261209310000_abreviaturas_avisos.
-- Se pierden los avisos de abreviaturas (las confirmadas siguen en abreviaturas_proveedor). Los avisos ya creados
-- en la campana (tipo facturas_abreviatura) se archivan como leídos y caducados.
set lock_timeout = '5s';
update public.notificaciones_dashboard set leida = true, caduca_en = least(coalesce(caduca_en, now()), now())
 where tipo = 'facturas_abreviatura';
drop function if exists public.abreviaturas_resolver(uuid, text, text);
drop function if exists public.abreviaturas_avisos_pendientes();
drop function if exists public.abreviaturas_proponer(jsonb);
drop function if exists public.abreviaturas_es_plausible(text, text);
drop table if exists public.abreviaturas_avisos;
