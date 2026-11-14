-- Vuelta atrás de 20261201100000_informe_auditoria_mensual (solo lectura: no hay datos que deshacer).
set lock_timeout = '5s';
drop function if exists public.informe_auditoria_mensual(text);
