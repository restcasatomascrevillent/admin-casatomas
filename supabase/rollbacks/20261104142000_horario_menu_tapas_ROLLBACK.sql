set client_encoding = 'UTF8';
-- ROLLBACK de 20261104142000_horario_menu_tapas.sql (días y horas de «Menú del
-- día» y «Tapas»). Aplicar a mano SOLO si hay que deshacerlo.
--
-- Se pierden los horarios guardados: la web vuelve a lo de siempre (menú de
-- martes a jueves y tapas los jueves, todo el día). El interruptor de
-- encender/apagar no se toca.
begin;
set local lock_timeout = '5s';

drop function if exists public.configuracion_web_horario_menu_tapas(text, jsonb);
alter table public.configuracion_web drop constraint if exists configuracion_web_horarios_validos;
alter table public.configuracion_web
  drop column if exists horario_menu_dia_casa_tomas,
  drop column if exists horario_tapas_casa_tomas;
drop function if exists public.horario_web_valido(jsonb);

notify pgrst, 'reload schema';
commit;
