set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK 20261211400000_regalos_y_descuentos_positivos · Facturas (18/11/2026)
-- Vuelve facturas_asociar_descuentos a la versión de 20261211200000 (sin regalos ni descuentos en
-- positivo), desmarca los regalos que marcó el relleno (con su valor de antes) y recalcula.
-- ============================================================================
set lock_timeout = '5s';

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

do $$
declare
  v_ids bigint[];
begin
  if to_regclass('public.productos_regalos_marcados_20261118') is not null then
    update public.productos_factura p
       set descuento_pct = null, importe_bruto = r.importe_bruto_antes,
           importe_bruto_estimado = coalesce(r.importe_bruto_estimado_antes, false)
      from public.productos_regalos_marcados_20261118 r
     where r.linea_id = p.id and p.descuento_pct = 100 and (p.total = 0 or p.total is null);
    drop table public.productos_regalos_marcados_20261118;
  end if;
  select array_agg(distinct p.factura_id) into v_ids
    from public.productos_factura p
   where p.total > 0 and public.es_linea_descuento(coalesce(p.nombre_busqueda, lower(p.nombre)));
  perform public.facturas_asociar_descuentos(v_ids);
end;
$$;
