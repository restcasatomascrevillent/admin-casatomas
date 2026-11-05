set client_encoding = 'UTF8';
-- Rollback de 20261105191000_analisis_rapido.sql: quita la caché
-- nombres_linea_no_producto y su trigger. ANTES hay que devolver
-- tablero_compras y explorar_compras_hechos a sus versiones sin caché
-- (si no, fallarían al no encontrar la tabla):
--   supabase db query --linked -f supabase/migrations/20261105150500_tablero_compras.sql
--   supabase db query --linked -f supabase/migrations/20261105170000_explorar_compras.sql
-- y después este fichero. No hay datos que perder (la caché se recalcula).
-- Las dos RPC vuelven a tardar ~1-1,5 s. Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

do $$
begin
  if position('nombres_linea_no_producto' in pg_get_functiondef('public.tablero_compras(date,date,text)'::regprocedure)) > 0
     or position('nombres_linea_no_producto' in pg_get_functiondef('public.explorar_compras_hechos(date,date,text,text,text,jsonb)'::regprocedure)) > 0 then
    raise exception 'Antes de este rollback, vuelve a aplicar 20261105150500_tablero_compras.sql y 20261105170000_explorar_compras.sql';
  end if;
end;
$$;

drop trigger if exists trg_productos_factura_no_producto on public.productos_factura;
drop function if exists public.productos_factura_no_producto_cache();
drop table if exists public.nombres_linea_no_producto;

commit;

select 'analisis_rapido: revertida' as resultado;
