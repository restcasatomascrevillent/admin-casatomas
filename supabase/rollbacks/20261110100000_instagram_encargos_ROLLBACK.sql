set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261110100000_instagram_encargos — quita los encargos de
-- Instagram (tablas, RPC, trigger de instagram_piezas y políticas de storage
-- de las entregas). BORRA los encargos, sus mensajes, eventos y versiones.
--
-- NO borra:
--   · las instagram_piezas creadas al aprobar (origen «encargo»): siguen
--     siendo piezas normales que se pueden publicar o programar;
--   · los ficheros entregados en los cubos (encargos/… en «instagram» y
--     reels/…-<encargo> en «instagram-video»): bórralos a mano si sobran;
--   · los avisos de la campana (notificaciones_dashboard, tipo
--     «instagram_encargo»); se pueden borrar con
--     delete from public.notificaciones_dashboard where tipo = 'instagram_encargo';
--   · los permisos «instagram_agencia» de user_permissions (no hacen nada sin
--     las tablas; se quitan desde Usuarios o con
--     delete from public.user_permissions where section_key = 'instagram_agencia').
--
--   npx supabase db query --linked -f supabase/rollbacks/20261110100000_instagram_encargos_ROLLBACK.sql
-- Idempotente. Tiene que terminar en «instagram_encargos: deshecha».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop trigger if exists instagram_piezas_avanzar_encargo on public.instagram_piezas;
drop function if exists public.instagram_piezas_avanzar_encargo();

drop function if exists public.instagram_encargo_destinatarios(uuid);
drop function if exists public.instagram_encargo_comentar(uuid, text, text);
drop function if exists public.instagram_encargo_entregar(uuid, text, text, text, text, bigint, integer, integer, numeric);
drop function if exists public.instagram_encargo_empezar(uuid);
drop function if exists public.instagram_encargo_rechazar(uuid, text);
drop function if exists public.instagram_encargo_aceptar(uuid, date, text);
drop function if exists public.instagram_encargo_cancelar(uuid, text);
drop function if exists public.instagram_encargo_aprobar(uuid);
drop function if exists public.instagram_encargo_pedir_cambios(uuid, text);
drop function if exists public.instagram_encargo_vincular_pieza(uuid, uuid);
drop function if exists public.instagram_encargo_enviar(uuid);
drop function if exists public.instagram_encargo_guardar(uuid, jsonb);
drop function if exists public.instagram_encargo_respuesta(uuid, uuid, jsonb);
do $$
begin
  if to_regclass('public.instagram_encargos') is not null then
    execute 'drop function if exists public.instagram_encargo_registrar(public.instagram_encargos, text, text, text, text, text)';
    execute 'drop function if exists public.instagram_encargo_bloquear(uuid, text[], text)';
  end if;
end;
$$;
drop function if exists public.instagram_encargo_lado(text, text);
drop function if exists public.instagram_sumar_dias_laborables(date, integer);
drop function if exists public.instagram_encargo_hoy();

drop policy if exists ig_encargos_jpeg_insert on storage.objects;
drop policy if exists ig_encargos_jpeg_select on storage.objects;
drop policy if exists ig_encargos_video_insert on storage.objects;
drop policy if exists ig_encargos_video_select on storage.objects;

drop table if exists public.instagram_encargo_eventos;
drop table if exists public.instagram_encargo_mensajes;
drop table if exists public.instagram_encargo_entregas;
drop table if exists public.instagram_encargo_adjuntos;
drop table if exists public.instagram_encargos;
drop function if exists public.instagram_encargos_al_editar();
drop table if exists public.instagram_encargos_ajustes;
drop function if exists public.instagram_encargos_ajustes_al_editar();

do $$
begin
  if to_regclass('public.instagram_encargos') is not null
     or exists (select 1 from pg_trigger where tgname = 'instagram_piezas_avanzar_encargo') then
    raise exception 'instagram_encargos: el rollback no ha quitado todo';
  end if;
  raise notice 'instagram_encargos: deshecha';
end;
$$;

commit;
