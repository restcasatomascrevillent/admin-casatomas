set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261111090000_instagram_montar — «Montar con IA» (05/11/2026)
-- ===========================================================================
-- La Edge Function instagram-ia tiene una acción nueva, «montar_pieza»: de
-- 1 a 10 fotos → publicación montada (post o carrusel). Usa el MISMO cupo
-- diario que el resto de sugerencias, que cuenta las filas de
-- instagram_sugerencias_ia del usuario: hace falta admitir ese tipo.
--
-- Solo cambia el CHECK de instagram_sugerencias_ia.tipo. Sin tablas ni
-- permisos nuevos. Necesita 20261108000000_instagram_ia.sql y
-- 20261109000000_instagram_campanas.sql aplicadas.
-- Sin aplicar, montar_pieza funciona pero no guarda la sugerencia (la
-- función lo anota en el registro) y esa petición no cuenta en el cupo.
-- Rollback: supabase/rollbacks/20261111090000_instagram_montar_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.instagram_sugerencias_ia') is null then
    raise exception 'instagram_montar: falta instagram_sugerencias_ia (aplica antes 20261108000000_instagram_ia.sql).';
  end if;
end;
$$;

alter table public.instagram_sugerencias_ia drop constraint if exists instagram_sugerencias_ia_tipo_chk;
alter table public.instagram_sugerencias_ia add constraint instagram_sugerencias_ia_tipo_chk
  check (tipo in ('sugerir_texto', 'sugerir_rotulos', 'proponer_campana', 'ideas_semana', 'montar_pieza'));

do $$
begin
  raise notice 'instagram_montar: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'instagram_sugerencias_ia_tipo_chk';
