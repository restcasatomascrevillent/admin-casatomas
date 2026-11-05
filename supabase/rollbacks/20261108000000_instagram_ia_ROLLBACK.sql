set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261108000000_instagram_ia.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS: las guías de tono de cada marca (si alguien las editó en el
-- panel, esos cambios se pierden) y el registro de sugerencias de la IA.
-- Copia antes si hace falta:
--   create table public.zz_backup_instagram_guias_marca as table public.instagram_guias_marca;
--   create table public.zz_backup_instagram_sugerencias_ia as table public.instagram_sugerencias_ia;
--
-- AVISO: revertir el frontend PRIMERO (el botón «Sugerir texto» llama a la
-- función instagram-ia, que lee instagram_guias_marca: sin ella responde 503)
-- y borrar o dejar de desplegar la Edge Function instagram-ia.
-- Quita también la fila «instagram-ia» de ia_funciones; NO toca ia_uso (el
-- gasto ya registrado se queda, es dinero real) ni instagram_piezas.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop table if exists public.instagram_sugerencias_ia;
drop table if exists public.instagram_guias_marca;
drop function if exists public.instagram_sugerencias_ia_al_editar();
drop function if exists public.instagram_guias_marca_al_editar();

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'instagram-ia';
  end if;
end;
$$;

commit;
