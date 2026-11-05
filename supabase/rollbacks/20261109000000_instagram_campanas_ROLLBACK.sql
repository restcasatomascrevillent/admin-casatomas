set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261109000000_instagram_campanas.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS: las fechas señaladas (con lo que el dueño haya corregido o
-- añadido) y las campañas propuestas. Copia antes si hace falta:
--   create table public.zz_backup_marketing_fechas as table public.marketing_fechas;
--   create table public.zz_backup_instagram_campanas as table public.instagram_campanas;
--   create table public.zz_backup_instagram_piezas_campana as
--     select id, fecha_prevista, campana_id, origen from public.instagram_piezas
--      where fecha_prevista is not null or campana_id is not null or origen <> 'manual';
--
-- Los BORRADORES que creó «Aceptar» NO se borran: son piezas normales de
-- instagram_piezas; solo pierden fecha_prevista, campana_id y origen.
-- Las sugerencias de tipo «proponer_campana» e «ideas_semana» se borran (si
-- no, no se podría volver a poner el CHECK de 20261108000000).
--
-- AVISO: revertir el frontend PRIMERO (la pestaña «Campañas» y el calendario
-- leen estas tablas y columnas) y volver a desplegar la versión anterior de
-- la Edge Function instagram-ia (las acciones proponer_campana e ideas_semana
-- responderían 503 sin instagram_ia_contexto).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.instagram_aceptar_campana(uuid, integer[]);
drop function if exists public.instagram_descartar_campana(uuid);
drop function if exists public.instagram_campanas_permiso();
drop function if exists public.instagram_ia_contexto(text, date, date);
drop function if exists public.marketing_fechas_entre(date, date, text);

drop trigger if exists instagram_piezas_proteger_campana on public.instagram_piezas;
drop function if exists public.instagram_piezas_proteger_campana();
drop index if exists public.instagram_piezas_fecha_prevista_idx;
drop index if exists public.instagram_piezas_campana_idx;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_campana_id_fkey;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_origen_chk;
alter table public.instagram_piezas drop column if exists fecha_prevista;
alter table public.instagram_piezas drop column if exists campana_id;
alter table public.instagram_piezas drop column if exists origen;

drop table if exists public.instagram_campanas;
drop function if exists public.instagram_campanas_al_editar();
drop table if exists public.marketing_fechas;
drop function if exists public.marketing_fechas_al_editar();

do $$
begin
  if to_regclass('public.instagram_sugerencias_ia') is not null then
    delete from public.instagram_sugerencias_ia where tipo in ('proponer_campana', 'ideas_semana');
    alter table public.instagram_sugerencias_ia drop constraint if exists instagram_sugerencias_ia_tipo_chk;
    alter table public.instagram_sugerencias_ia add constraint instagram_sugerencias_ia_tipo_chk
      check (tipo in ('sugerir_texto', 'sugerir_rotulos'));
  end if;
end;
$$;

commit;
