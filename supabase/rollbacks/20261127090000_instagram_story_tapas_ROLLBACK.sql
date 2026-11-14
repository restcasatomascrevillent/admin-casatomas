-- Vuelta atrás de 20261127090000_instagram_story_tapas.sql
-- Quita la story automática del jueves de tapas: RPC, tablas y avisos de la
-- campana de ese tipo. NO toca las piezas ni las programaciones ya creadas
-- (siguen en el calendario y se pueden cancelar desde allí), ni las columnas
-- clave/datos de notificaciones_dashboard (son de 20261107300000).
drop function if exists public.instagram_story_tapas_ver(date);
drop function if exists public.instagram_story_tapas_cancelar(date);
drop function if exists public.instagram_story_tapas_fallo(date, text);
drop function if exists public.instagram_story_tapas_registrar(date, uuid, uuid, text, jsonb, text);
drop function if exists public.instagram_story_tapas_reclamar(date, text, boolean);
drop function if exists public.instagram_story_tapas_sincronizar(date);
drop function if exists public.instagram_story_tapas_permiso(boolean);
drop table if exists public.instagram_story_tapas;
drop trigger if exists instagram_story_tapas_ajustes_tocar on public.instagram_story_tapas_ajustes;
drop table if exists public.instagram_story_tapas_ajustes;
drop function if exists public.instagram_story_tapas_ajustes_tocar();
delete from public.notificaciones_dashboard where tipo = 'instagram_story_tapas';
select 'instagram_story_tapas: retirada' as resultado;
