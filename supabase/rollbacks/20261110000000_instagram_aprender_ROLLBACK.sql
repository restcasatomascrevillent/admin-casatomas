set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261110000000_instagram_aprender.sql (se ejecuta A MANO).
-- ===========================================================================
-- PIERDE DATOS: los hashtags, la hora local y las métricas de reels de cada
-- publicación, y el texto pasa a los 300 primeros caracteres. Copia antes si
-- hace falta:
--   create table public.zz_backup_instagram_metricas_aprender as
--     select id, caption, hashtags, publicado_local, tiempo_medio_ms, tiempo_total_ms, tasa_salto
--       from public.instagram_metricas_publicacion;
--
-- AVISO: antes, volver a desplegar la versión ANTERIOR de las Edge Functions
-- instagram-metricas (la nueva escribe las columnas que esto quita; si no
-- las encuentra, guarda sin ellas y avisa) e instagram-ia (sin la RPC sigue
-- sin «Qué funciona»), y revertir el panel (el bloque «Qué funciona» dice
-- que falta la migración).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.instagram_que_funciona(text, text, integer, integer);

-- La vista depende de las columnas: se quita y se vuelve a crear como estaba.
drop view if exists public.instagram_metricas_publicacion_ultima;
drop index if exists public.instagram_metricas_publicacion_publicado_idx;

alter table public.instagram_metricas_publicacion drop constraint if exists instagram_metricas_publicacion_aprender_chk;
update public.instagram_metricas_publicacion set caption = left(caption, 300) where char_length(caption) > 300;
alter table public.instagram_metricas_publicacion drop constraint if exists instagram_metricas_publicacion_textos_chk;
alter table public.instagram_metricas_publicacion add constraint instagram_metricas_publicacion_textos_chk check (
  coalesce(char_length(permalink), 0) <= 500 and coalesce(char_length(miniatura_url), 0) <= 2000
  and coalesce(char_length(caption), 0) <= 300);
comment on column public.instagram_metricas_publicacion.caption is 'Primeros 300 caracteres del pie de foto.';

alter table public.instagram_metricas_publicacion
  drop column if exists hashtags,
  drop column if exists publicado_local,
  drop column if exists tiempo_medio_ms,
  drop column if exists tiempo_total_ms,
  drop column if exists tasa_salto;

create view public.instagram_metricas_publicacion_ultima
with (security_invoker = on) as
  select distinct on (media_id) *
    from public.instagram_metricas_publicacion
   order by media_id, fecha_captura desc;
comment on view public.instagram_metricas_publicacion_ultima is
  'Última captura de cada publicación de Instagram. security_invoker: aplica la RLS de instagram_metricas_publicacion.';
revoke all on public.instagram_metricas_publicacion_ultima from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_metricas_publicacion_ultima from anon, authenticated';
    execute 'grant select on public.instagram_metricas_publicacion_ultima to authenticated, service_role';
  end if;
end;
$$;

do $$ begin raise notice 'instagram_aprender: revertida'; end $$;

commit;
