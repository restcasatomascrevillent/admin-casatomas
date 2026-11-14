-- Vuelta atrás de 20261201110000_informe_acciones_web_mensual (solo lectura: no hay datos que deshacer).
set lock_timeout = '5s';
drop function if exists public.informe_acciones_web_mensual(text);
