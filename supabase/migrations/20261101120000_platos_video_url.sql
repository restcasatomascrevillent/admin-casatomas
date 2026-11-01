-- Vídeo del plato (3–4 s, fondo quitado y fondo de carta elegido) para
-- algunos platos estrella. Lo genera el panel en el navegador y lo sube al
-- bucket `platos` como `<id>-video.<mp4|webm>`; aquí se guarda su URL pública
-- (con `?t=` para saltar la caché). null = sin vídeo.
--
-- El panel funciona aunque esta migración no esté aplicada: si la columna no
-- viene en select('*') oculta la sección de vídeo, y si al guardar PostgREST
-- responde PGRST204/42703 avisa «Falta aplicar la migración de vídeo» sin
-- romper el guardado del plato.
--
-- No toca RLS ni GRANTs: la columna hereda los permisos de la tabla.

alter table public."Platos" add column if not exists video_url text;

comment on column public."Platos".video_url is
  'URL pública del vídeo del plato (bucket platos, <id>-video.mp4|webm). null = sin vídeo.';

-- ROLLBACK (manual):
--   alter table public."Platos" drop column if exists video_url;
--   -- y borrar del bucket `platos` los ficheros *-video.mp4 / *-video.webm
