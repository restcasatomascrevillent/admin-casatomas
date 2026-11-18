set client_encoding = 'UTF8';
-- ============================================================================
-- 20261211400000_regalos_y_descuentos_positivos · Facturas (18/11/2026)
-- Cotejo con los originales (docs/facturas/revision-descuentos/INFORME.md, apartado 7):
--  1. Regalos. Las líneas a 0 € con cantidad que son regalo se guardaban sin marcar (482 en producción;
--     p. ej. Riscal regaló 270 botellas de Arienzo «Sin Cargo» en una factura). Ahora quedan con
--     descuento_pct = 100 y su valor en importe_bruto (el impreso o, si no lo hay, el de la línea pagada
--     del mismo producto, marcado como estimado), igual que la regla 6 de docs/facturas/README.md, si:
--     ya tenían valor, el nombre lo dice («sin cargo», «S/C», «regalo», «bonif.», «gratis», «muestra»…) o
--     el mismo producto va pagado en la misma factura. No: envases, Servicios, ni lo que no cumpla nada
--     de eso (pan sin valorar, remesas, merchandising sin precio).
--  2. Descuentos en positivo: Catral imprime «DESC. <producto>» en positivo bajo una devolución (deshace
--     su descuento) y, por error del proveedor, bajo un producto pagado (facturas 000919 y 000619: 91,20 €
--     cobrados de más). Ahora se asocian a esa línea.
-- Lo hace facturas_asociar_descuentos (mismo trigger de 20261211200000), así que vale para todo lo que
-- se guarde a partir de ahora, venga de la lectura, del OCR por páginas o de la importación histórica.
-- Relleno del histórico sin una fila de auditoría por línea.
-- Rollback: supabase/rollbacks/20261211400000_regalos_y_descuentos_positivos_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.facturas_asociar_descuentos(bigint[])') is null then
    raise exception '20261211400000: falta 20261211200000 (facturas_asociar_descuentos). No se ha cambiado nada.';
  end if;
end;
$$;

-- Respaldo de lo que marca el relleno (para el rollback).
create table if not exists public.productos_regalos_marcados_20261118 (
  linea_id bigint primary key,
  importe_bruto_antes numeric,
  importe_bruto_estimado_antes boolean,
  guardado_en timestamptz not null default now()
);
alter table public.productos_regalos_marcados_20261118 enable row level security;
revoke all on public.productos_regalos_marcados_20261118 from public, anon, authenticated;
grant all on public.productos_regalos_marcados_20261118 to service_role;

create or replace function public.facturas_asociar_descuentos(p_facturas bigint[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $f$
declare
  v_n integer := 0;
begin
  if p_facturas is null or cardinality(p_facturas) = 0 then
    return 0;
  end if;

  -- Lo automático se recalcula entero; lo 'manual' se respeta.
  delete from public.productos_factura_descuentos x
   using public.productos_factura p
   where p.id = x.descuento_linea_id and p.factura_id = any(p_facturas) and x.regla <> 'manual';

  -- Regalos (20261211400000): líneas a 0 € con cantidad que son regalo → 100 % de descuento y su
  -- valor (el impreso; si no hay, el de la línea pagada del mismo producto, marcado como estimado).
  update public.productos_factura p
     set descuento_pct = 100,
         importe_bruto = coalesce(p.importe_bruto, round(p.cantidad * nullif(p.precio_unitario, 0), 2), round(p.cantidad * r.precio, 2)),
         importe_bruto_estimado = case when p.importe_bruto is not null then p.importe_bruto_estimado
                                       when nullif(p.precio_unitario, 0) is not null then false
                                       else r.precio is not null end
    from (
      select z.id,
             (select q.total / q.cantidad
                from public.productos_factura q
               where q.factura_id = z.factura_id and q.id <> z.id and q.total > 0 and q.cantidad > 0
                 and ((q.producto_id is not null and q.producto_id = z.producto_id) or q.nombre_normalizado = z.nombre_normalizado)
               order by q.id limit 1) as precio
        from public.productos_factura z
        join public.facturas f on f.id = z.factura_id
        left join public.productos_catalogo pc on pc.id = z.producto_id
        left join public.categorias_producto c on c.id = pc.categoria_id
        left join public.categorias_producto c2 on c2.id = c.padre_id
       where z.factura_id = any(p_facturas) and f.total > 0
         and z.total = 0 and z.cantidad > 0 and z.descuento_pct is null
         and coalesce(z.nombre_busqueda, lower(z.nombre)) !~ '(envase|palet|caja bn|retorn)'
         and coalesce(c2.clave, c.clave, '') <> 'servicios'
    ) r
   where r.id = p.id
     and (p.importe_bruto > 0
          or coalesce(p.nombre_busqueda, lower(p.nombre)) ~ '(sin cargo|(^|[^a-z])s/c([^a-z]|$)|regalo|obsequio|bonif|gratis|muestra|cortesia)'
          or r.precio is not null);

  create temp table if not exists _pfd_reparto (
    descuento_linea_id bigint, linea_id bigint, importe numeric, regla text
  ) on commit drop;
  truncate _pfd_reparto;

  insert into _pfd_reparto
  with lin as (
    select p.id, p.factura_id, coalesce(p.nombre_busqueda, lower(p.nombre)) as nb, p.total,
           coalesce(p.albaran_ref, '') as alb,
           row_number() over (partition by p.factura_id order by p.pagina nulls first, p.orden nulls last, p.id) as rn
      from public.productos_factura p
      join public.facturas f on f.id = p.factura_id
     where p.factura_id = any(p_facturas) and f.total > 0 and p.total is not null
  ),
  d as (
    select l.*,
           regexp_replace(l.nb, '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s+', '') as limpio,
           replace(nullif(substring(l.nb from '(\d+(?:[.,]\d+)?)\s*%'), ''), ',', '.')::numeric as pct
      from lin l
     where l.total < 0 and public.es_linea_descuento(l.nb)
       and not exists (select 1 from public.productos_factura_descuentos m where m.descuento_linea_id = l.id)
  ),
  candidatas as (
    select d.id as did, l.id as lid, l.total as ltotal, extensions.similarity(l.nb, d.limpio) as s,
           l.rn, d.rn as drn
      from d join lin l on l.factura_id = d.factura_id and l.total > 0 and (d.alb = '' or l.alb = d.alb)
  ),
  por_nombre as (
    select distinct on (did) did, lid
      from candidatas
     where s >= 0.5
     order by did, s desc, (rn < drn) desc, abs(rn - drn), lid
  ),
  anterior as (
    select d.id as did, l.id as lid, l.total as ltotal
      from d join lin l on l.factura_id = d.factura_id and l.rn = d.rn - 1 and l.total > 0
  ),
  bloque as (
    select did, sum(ltotal) as btotal from candidatas group by did
  ),
  regla as (
    select d.id as did, d.total,
           case
             when d.nb ~ 'linea anterior' and a.lid is not null then 'linea_anterior'
             when n.did is not null then 'nombre'
             when d.pct is not null and a.lid is not null
                  and abs(-d.total - a.ltotal * d.pct / 100) <= greatest(0.02, a.ltotal * d.pct / 100 * 0.02) then 'pct_linea'
             when d.pct is not null and b.btotal > 0
                  and abs(-d.total - b.btotal * d.pct / 100) <= greatest(0.05, b.btotal * d.pct / 100 * 0.02) then 'pie'
             when d.pct is null and b.btotal > 0 and d.nb ~ '(comercial|pie|bonific)'
                  and abs(round(-d.total / b.btotal * 200) / 2 - (-d.total / b.btotal * 100)) <= 0.05 then 'pie'
             when d.pct is not null and f.total > 0
                  and abs(-d.total - (f.total - d.total) * d.pct / 100) <= greatest(0.5, f.total * 0.01) then 'pie_con_iva'
           end as regla,
           case when d.nb ~ 'linea anterior' and a.lid is not null then a.lid else coalesce(n.lid, a.lid) end as lid_unica,
           b.btotal
      from d
      join public.facturas f on f.id = d.factura_id
      left join por_nombre n on n.did = d.id
      left join anterior a on a.did = d.id
      left join bloque b on b.did = d.id
  )
  select r.did, r.lid_unica, r.total, r.regla
    from regla r
   where r.regla in ('nombre', 'linea_anterior', 'pct_linea')
  union all
  select r.did, c.lid, round(r.total * c.ltotal / r.btotal, 2), r.regla
    from regla r join candidatas c on c.did = r.did
   where r.regla in ('pie', 'pie_con_iva');

  -- Descuentos en POSITIVO (20261211400000): «DESC./DESCUENTO <producto>» con importe positivo justo
  -- debajo de su línea (Catral: deshace el descuento de una devolución, o lo cobra de más). Va a esa
  -- línea, sea positiva o negativa.
  insert into _pfd_reparto
  with lin as (
    select p.id, p.factura_id, coalesce(p.nombre_busqueda, lower(p.nombre)) as nb, p.total,
           row_number() over (partition by p.factura_id order by p.pagina nulls first, p.orden nulls last, p.id) as rn
      from public.productos_factura p
      join public.facturas f on f.id = p.factura_id
     where p.factura_id = any(p_facturas) and f.total > 0 and p.total is not null
  )
  select d.id, a.id, d.total, 'nombre'
    from lin d
    join lin a on a.factura_id = d.factura_id and a.rn = d.rn - 1 and a.total <> 0
   where d.total > 0
     and d.nb ~ '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s'
     and not public.es_linea_descuento(a.nb)
     and not exists (select 1 from public.productos_factura_descuentos m where m.descuento_linea_id = d.id)
     and extensions.similarity(a.nb, regexp_replace(d.nb, '^\W*(descuento|desc\.?|dto\.?|dcto\.?)\s+', '')) >= 0.5;

  -- Céntimos del reparto: a la línea que más recibe, para que sume exactamente el descuento.
  update _pfd_reparto t
     set importe = t.importe + x.resto
    from (
      select r.descuento_linea_id, p.total - sum(r.importe) as resto,
             (array_agg(r.linea_id order by abs(r.importe) desc, r.linea_id))[1] as linea_id
        from _pfd_reparto r join public.productos_factura p on p.id = r.descuento_linea_id
       group by r.descuento_linea_id, p.total
    ) x
   where t.descuento_linea_id = x.descuento_linea_id and t.linea_id = x.linea_id and x.resto <> 0;

  insert into public.productos_factura_descuentos (descuento_linea_id, linea_id, importe, regla)
  select descuento_linea_id, linea_id, importe, regla from _pfd_reparto
  on conflict (descuento_linea_id, linea_id) do nothing;
  get diagnostics v_n = row_count;

  update public.productos_factura p
     set importe_neto = x.neto
    from (
      select p2.id,
             case
               when exists (select 1 from public.productos_factura_descuentos m where m.descuento_linea_id = p2.id) then 0
               when s.asignado is not null then p2.total + s.asignado
             end as neto
        from public.productos_factura p2
        left join (
          select m.linea_id, sum(m.importe) as asignado
            from public.productos_factura_descuentos m
            join public.productos_factura q on q.id = m.linea_id
           where q.factura_id = any(p_facturas)
           group by m.linea_id
        ) s on s.linea_id = p2.id
       where p2.factura_id = any(p_facturas)
    ) x
   where x.id = p.id and p.importe_neto is distinct from x.neto;

  return v_n;
end;
$f$;


-- ─── Relleno del histórico ───
do $$
declare
  v_ids bigint[];
  v_n integer;
  v_auditoria boolean := exists (
    select 1 from pg_trigger t where t.tgrelid = 'public.productos_factura'::regclass and t.tgname = 'trg_auditoria');
begin
  insert into public.productos_regalos_marcados_20261118 (linea_id, importe_bruto_antes, importe_bruto_estimado_antes)
  select p.id, p.importe_bruto, p.importe_bruto_estimado
    from public.productos_factura p join public.facturas f on f.id = p.factura_id
   where f.total > 0 and p.total = 0 and p.cantidad > 0 and p.descuento_pct is null
  on conflict (linea_id) do nothing;

  select array_agg(distinct p.factura_id) into v_ids
    from public.productos_factura p join public.facturas f on f.id = p.factura_id
   where f.total > 0
     and ((p.total = 0 and p.cantidad > 0 and p.descuento_pct is null)
          or (p.total <> 0 and public.es_linea_descuento(coalesce(p.nombre_busqueda, lower(p.nombre)))));
  if v_auditoria then
    execute 'alter table public.productos_factura disable trigger trg_auditoria';
  end if;
  v_n := public.facturas_asociar_descuentos(v_ids);
  if v_auditoria then
    execute 'alter table public.productos_factura enable trigger trg_auditoria';
  end if;

  -- En el respaldo solo se quedan las líneas que de verdad se han marcado.
  delete from public.productos_regalos_marcados_20261118 r
   using public.productos_factura p
   where p.id = r.linea_id and p.descuento_pct is distinct from 100;
  raise notice '20261211400000: % regalos marcados; % repartos de descuento.',
    (select count(*) from public.productos_regalos_marcados_20261118), v_n;
end;
$$;
