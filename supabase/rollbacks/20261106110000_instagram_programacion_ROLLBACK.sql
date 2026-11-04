set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261106110000_instagram_programacion.sql (A MANO).
-- ===========================================================================
-- BORRA DATOS: la tabla public.instagram_programaciones (todas las
-- programaciones, pendientes incluidas: dejarán de publicarse) y la columna
-- instagram_piezas.publicada_at. Copia antes si hace falta:
--   create table public.zz_backup_instagram_programaciones as table public.instagram_programaciones;
--
-- Quita PRIMERO el cron (si no, seguiría llamando a una función sin tabla).
-- No toca instagram_piezas (salvo publicada_at), ni el bucket, ni los
-- secretos de Vault ('project_url' lo usan otras tareas; el de
-- 'instagram_programador_secret' se puede borrar a mano:
--   delete from vault.secrets where name = 'instagram_programador_secret';).
--
-- AVISO: revertir el frontend (src/components/instagram/programar) y
-- desplegar sin la Edge Function instagram-programador ANTES: el calendario
-- lee instagram_programaciones y llama a las RPC (PGRST205 / PGRST202).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

select cron.unschedule('instagram-programador')
 where exists (select 1 from cron.job where jobname = 'instagram-programador');

drop function if exists public.instagram_programador_cerrar(uuid, uuid, text, text, text, text, text, integer);
drop function if exists public.instagram_programador_reclamar(integer);
drop function if exists public.instagram_cancelar_programacion(uuid);
drop function if exists public.instagram_programar(uuid, timestamptz, boolean);
drop function if exists public.instagram_reprogramar(uuid, timestamptz, boolean);
drop function if exists public.instagram_programacion_pieza(uuid);
drop function if exists public.instagram_programacion_conflictos(text, timestamptz, uuid);
drop function if exists public.instagram_programacion_validar_fecha(timestamptz);
drop function if exists public.instagram_programacion_permiso();

drop table if exists public.instagram_programaciones;
drop function if exists public.instagram_programaciones_al_editar();

drop trigger if exists instagram_piezas_marcar_publicada on public.instagram_piezas;
drop function if exists public.instagram_piezas_marcar_publicada();
drop index if exists public.instagram_piezas_publicada_at_idx;
alter table public.instagram_piezas drop column if exists publicada_at;

commit;
