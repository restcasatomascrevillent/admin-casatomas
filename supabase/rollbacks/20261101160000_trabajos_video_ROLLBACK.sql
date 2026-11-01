-- ROLLBACK de 20261101160000_trabajos_video.sql («Mandar a un dispositivo potente»).
-- Aplicar a mano (db query --linked -f) SOLO si hay que deshacer la función.
-- Borra los trabajos pendientes y las suscripciones push (no recuperables).
-- Después, borrar del bucket `platos` lo que quede en pendientes/ y quitar la
-- Edge Function notificar-video (`npx supabase functions delete notificar-video`).
begin;
drop function if exists public.guardar_suscripcion_push(text, text, text, text);
drop function if exists public.soltar_trabajo_video(uuid);
drop function if exists public.terminar_trabajo_video(uuid, boolean, text);
drop function if exists public.reclamar_trabajo_video(uuid, text);
drop function if exists public.trabajos_video_permiso();
drop table if exists public.suscripciones_push;
drop table if exists public.trabajos_video;
commit;
