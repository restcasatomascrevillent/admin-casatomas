set client_encoding = 'UTF8';
-- ROLLBACK de 20261104141000_encuesta_vino_favorito.sql («Vota tu vino
-- favorito»). Aplicar a mano SOLO si hay que deshacerlo.
--
-- BORRA DATOS: se pierden las participaciones guardadas (nombre y contacto de
-- quien votó). Si hay un sorteo en marcha, sacar antes la lista desde el Gestor
-- Web › Carta › Vinos.
begin;
set local lock_timeout = '5s';

drop function if exists public.votar_vino_favorito(text, text, text, boolean, text);
drop table if exists public.votos_vino_favorito;
alter table public.configuracion_web drop column if exists encuesta_vinos_activa;

notify pgrst, 'reload schema';
commit;
