set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK 20261211100000_reparar_producto_id_de_categoria · Facturas (17/11/2026)
-- Devuelve los alias borrados (si nadie ha creado otro con el mismo texto) y el producto de las
-- líneas que se dejaron sin producto (solo si siguen sin producto: lo que el cron haya
-- reclasificado bien no se toca). Después borra el respaldo.
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.productos_reparacion_ia_20261117') is null then
    raise notice 'ROLLBACK 20261211100000: no hay respaldo; nada que hacer.';
    return;
  end if;

  insert into public.productos_alias (texto_normalizado, producto_id, origen, created_at)
  select r.texto_normalizado, r.producto_id, coalesce(r.alias_origen, 'ia'), coalesce(r.alias_created_at, now())
    from public.productos_reparacion_ia_20261117 r
   where r.tipo = 'alias'
     and exists (select 1 from public.productos_catalogo pc where pc.id = r.producto_id)
  on conflict (texto_normalizado) do nothing;

  update public.productos_factura pf
     set producto_id = r.producto_id
    from public.productos_reparacion_ia_20261117 r
   where r.tipo = 'linea' and r.linea_id = pf.id and pf.producto_id is null
     and exists (select 1 from public.productos_catalogo pc where pc.id = r.producto_id);

  drop table public.productos_reparacion_ia_20261117;
end;
$$;
