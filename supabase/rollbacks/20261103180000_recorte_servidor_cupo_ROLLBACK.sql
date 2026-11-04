set client_encoding = 'UTF8';
-- Deshace 20261103180000_recorte_servidor_cupo. Las filas de ia_uso de
-- 'recortar-foto' se CONSERVAN (son el histórico de gasto); sin las funciones,
-- api/recortar-foto responde 503 y el móvil deja las fotos para un ordenador.
begin;
set local lock_timeout = '5s';

drop function if exists public.recorte_servidor_terminar(bigint, integer, boolean);
drop function if exists public.recorte_servidor_reservar();
drop function if exists public.recorte_servidor_uso();
drop function if exists public.recorte_servidor_topes();

do $$
begin
  if to_regclass('public.servicios_contratados') is not null then
    update public.servicios_contratados
       set limites = limites - 'recortes_servidor_mes' - 'recortes_servidor_dia' - 'cpu_recortes_mes'
     where proveedor = 'vercel';
  end if;
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'recortar-foto';
  end if;
end;
$$;

do $$ begin raise notice 'recorte_servidor_cupo: deshecha'; end $$;
commit;
