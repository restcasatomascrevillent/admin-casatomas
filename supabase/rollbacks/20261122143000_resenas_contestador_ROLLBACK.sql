set client_encoding = 'UTF8';
-- Deshace 20261122143000_resenas_contestador.sql. BORRA los borradores de
-- respuesta, los ajustes del contestador y el token de Google Business Profile
-- (habría que volver a conectar la cuenta). Conserva `respuesta` y
-- `fecha_respuesta` (existían antes) y las reseñas.
-- Antes: desprogramar el ciclo (20261122143100_resenas_cron_ROLLBACK.sql).
begin;

drop table if exists public.resenas_google_token;
drop table if exists public.resenas_ajustes;
drop function if exists public.resenas_ajustes_fijar_autor();

drop index if exists public.resenas_gbp_review_name_unico;
drop index if exists public.resenas_respuesta_estado_idx;

alter table public.resenas
  drop constraint if exists resenas_respuesta_estado_check,
  drop constraint if exists resenas_respuesta_origen_check,
  drop constraint if exists resenas_respuesta_propuesta_largo,
  drop constraint if exists resenas_google_maps_uri_https,
  drop constraint if exists resenas_respuesta_intentos_no_negativo,
  drop column if exists respuesta_propuesta,
  drop column if exists respuesta_estado,
  drop column if exists respuesta_origen,
  drop column if exists respuesta_modelo,
  drop column if exists respuesta_automatica,
  drop column if exists respuesta_aprobada_por,
  drop column if exists respuesta_aprobada_en,
  drop column if exists respuesta_error,
  drop column if exists respuesta_intentos,
  drop column if exists gbp_review_name,
  drop column if exists google_maps_uri;

do $$
begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    delete from public.ia_modelo_funcion where funcion = 'resenas-contestador';
  end if;
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'resenas-contestador';
  end if;
end;
$$;

commit;
