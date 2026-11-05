set client_encoding = 'UTF8';
-- Rollback de 20261111090000_instagram_montar.sql: borra las sugerencias
-- «montar_pieza» y deja el CHECK como lo dejó 20261109000000_instagram_campanas.
begin;

do $$
begin
  if to_regclass('public.instagram_sugerencias_ia') is not null then
    delete from public.instagram_sugerencias_ia where tipo = 'montar_pieza';
    alter table public.instagram_sugerencias_ia drop constraint if exists instagram_sugerencias_ia_tipo_chk;
    alter table public.instagram_sugerencias_ia add constraint instagram_sugerencias_ia_tipo_chk
      check (tipo in ('sugerir_texto', 'sugerir_rotulos', 'proponer_campana', 'ideas_semana'));
  end if;
end;
$$;

commit;
