set client_encoding = 'UTF8';
-- Rollback de 20261105130000_proveedores_listado_sin_albaranes_facturados.sql:
-- devuelve proveedores_listado() a la definición de 20261007180000 (total_albaranes
-- vuelve a sumar también los albaranes ya facturados). Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

create or replace function public.proveedores_listado()
returns table (
  id               bigint,
  nombre           text,
  nombre_comercial text,
  cif              text,
  activo           boolean,
  origen           text,
  documentos       integer,
  facturas         integer,
  albaranes        integer,
  total_facturas   numeric,
  total_albaranes  numeric,
  ultima_fecha     date,
  variantes        text[],
  alias            text[],
  cifs_extra       text[]
)
language sql
stable
set search_path = public
as $$
  select p.id, p.nombre::text, p.nombre_comercial, p.cif_normalizado, coalesce(p.activo, true), p.origen,
         coalesce(d.documentos, 0), coalesce(d.facturas, 0), coalesce(d.albaranes, 0),
         coalesce(d.total_facturas, 0), coalesce(d.total_albaranes, 0), d.ultima_fecha,
         coalesce(d.variantes, '{}'::text[]), coalesce(a.alias, '{}'::text[]), coalesce(a.cifs, '{}'::text[])
    from public.proveedores p
    left join lateral (
      select count(*)::int                                                  as documentos,
             (count(*) filter (where f.tipo = 'factura'))::int              as facturas,
             (count(*) filter (where f.tipo = 'albaran'))::int              as albaranes,
             sum(f.total) filter (where f.tipo = 'factura')                 as total_facturas,
             sum(f.total) filter (where f.tipo = 'albaran')                 as total_albaranes,
             max(f.fecha)                                                   as ultima_fecha,
             array_agg(distinct f.proveedor::text) filter (where f.proveedor is not null) as variantes
        from public.facturas f
       where f.proveedor_id = p.id) d on true
    left join lateral (
      select array_agg(x.alias_normalizado order by x.alias_normalizado) filter (where x.alias_normalizado is not null) as alias,
             array_agg(x.cif_normalizado order by x.cif_normalizado) filter (where x.cif_normalizado is not null)         as cifs
        from public.proveedores_alias x
       where x.proveedor_id = p.id) a on true
   order by lower(p.nombre::text)
$$;
comment on function public.proveedores_listado() is
  'Panel Facturas › Proveedores: cada proveedor con su CIF, nº de documentos, totales, textos con que llega (variantes) y alias.';

revoke all on function public.proveedores_listado() from public, anon;
grant execute on function public.proveedores_listado() to authenticated, service_role;

commit;

select 'proveedores_listado_sin_albaranes_facturados: revertida' as resultado;
