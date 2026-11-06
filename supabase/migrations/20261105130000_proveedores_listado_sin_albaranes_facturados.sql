set client_encoding = 'UTF8';
-- ===========================================================================
-- proveedores_listado sin albaranes ya facturados · 2026-11-05
-- ===========================================================================
--
-- PROBLEMA: `total_albaranes` sumaba TODOS los albaranes del proveedor, también
-- los ya recogidos en una factura (`facturado_en_id is not null`). El panel
-- (Compras › Proveedores) enseña `total_facturas + total_albaranes`, así que
-- esos albaranes contaban dos veces: una en su factura y otra suelta. En la
-- demo, p. ej., Herederos Angel Mariño Hermo C.B. salía con 14.329,51 € en la
-- lista y 13.176,21 € en su ficha (`ficha_proveedor_agente`).
--
-- DECISIÓN: `total_albaranes` pasa a ser el total de los albaranes SIN factura
-- (`facturado_en_id is null`), la misma regla que la lista de documentos
-- (`sumaEnTotal`). Mismo nombre de columna, misma firma y mismos permisos: el
-- panel no cambia de contrato. El recuento `albaranes` sigue contando todos.
--
-- Definición de partida: la viva en la demo (= 20261007180000, sin cambios
-- posteriores); solo se añade el filtro en el `sum` de albaranes.
--
-- Idempotente. Test: supabase/tests/proveedores_listado_sin_albaranes_facturados_test.sql
-- Rollback:
--   supabase/rollbacks/20261105130000_proveedores_listado_sin_albaranes_facturados_ROLLBACK.sql
-- ===========================================================================

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
  -- 20261105130000: total_albaranes = solo albaranes SIN factura (facturado_en_id is null).
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
             sum(f.total) filter (where f.tipo = 'albaran' and f.facturado_en_id is null) as total_albaranes,
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
  'Panel Facturas › Proveedores: cada proveedor con su CIF, nº de documentos, totales (total_albaranes = solo albaranes sin factura, 20261105130000), textos con que llega (variantes) y alias.';

revoke all on function public.proveedores_listado() from public, anon;
grant execute on function public.proveedores_listado() to authenticated, service_role;

commit;

select 'proveedores_listado_sin_albaranes_facturados: aplicada' as resultado;
