set client_encoding = 'UTF8';
-- Deshace 20261118100000_rrss.sql. BORRA los trabajos, archivos y resultados
-- de RRSS (no los ficheros del cubo «rrss»: vacíalo antes desde Storage si se
-- quiere liberar espacio; el cubo se borra solo si está vacío).
begin;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists rrss_objetos_select on storage.objects';
    execute 'drop policy if exists rrss_objetos_insert on storage.objects';
    execute 'drop policy if exists rrss_objetos_update on storage.objects';
    execute 'drop policy if exists rrss_objetos_delete on storage.objects';
    if not exists (select 1 from storage.objects where bucket_id = 'rrss') then
      delete from storage.buckets where id = 'rrss';
    end if;
  end if;
end;
$$;

drop table if exists public.rrss_ia_peticiones;
drop table if exists public.rrss_ideas;
drop table if exists public.rrss_resultados;
drop table if exists public.rrss_generaciones;
drop table if exists public.rrss_archivos;
drop table if exists public.rrss_proyectos;
drop function if exists public.rrss_comprobar_cupo_generacion();
drop function if exists public.rrss_comprobar_cupo_ia();
drop function if exists public.rrss_ruta_valida(text);
drop function if exists public.rrss_proteger_generacion();
drop function if exists public.rrss_fijar_autor();

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'rrss-ia';
  end if;
end;
$$;

commit;
