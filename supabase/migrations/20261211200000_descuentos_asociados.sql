set client_encoding = 'UTF8';
-- ============================================================================
-- 20261211200000_descuentos_asociados · Facturas (17/11/2026)
-- Revisión de descuentos (docs/facturas/revision-descuentos/INFORME.md): 1.750 líneas de descuento
-- aparte (−130.952 € en producción: «DESCUENTO HEINEKEN…» de Catral, «- 20 % BONIFICAC S/ base» de
-- Riscal, el 9 % del pie de Directas…) se guardaban como productos sueltos de Servicios y no
-- rebajaban el producto que descuentan (barril de Cruzcampo 50 l: 200 € en vez de 99,57 €).
-- Sin tocar nada de lo impreso:
--  1. productos_factura.importe_neto: importe de la línea con los descuentos que tiene asociados.
--     NULL = igual que `total`. Una línea de descuento ya repartida vale 0. Por documento, la suma
--     de importe_neto (con NULL = total) sigue siendo la suma de `total`.
--  2. productos_factura_descuentos: qué parte de cada línea de descuento va a qué línea de producto,
--     con la regla que lo decidió (o 'manual', que el recálculo respeta).
--  3. es_linea_descuento(texto) y facturas_asociar_descuentos(ids): reglas, en este orden, dentro
--     del mismo albarán si el descuento lo cita y si no del documento:
--       linea_anterior el texto dice «línea anterior»;
--       nombre         el texto del descuento nombra el producto (similitud de trigramas ≥ 0,5);
--       pct_linea      «x %» del texto = x % de la línea anterior;
--       pie            «x %» del texto = x % del total de las líneas (o, sin %, un % redondo con
--                      «comercial», «pie» o «bonific» en el texto) → reparto proporcional;
--       pie_con_iva    «x %» sobre el total con IVA (Mª Carmen Virola) → reparto proporcional.
--     Lo que no encaja queda sin asociar (promociones de Makro sin artículo, rappels).
--  4. Trigger: al insertar, cambiar o borrar líneas se recalcula su documento (lectura del panel,
--     trabajos de OCR, importación histórica y ediciones a mano).
--  5. Relleno de todo el histórico (sin apuntar en auditoría una fila por línea).
-- Rollback: supabase/rollbacks/20261211200000_descuentos_asociados_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('extensions.similarity(text, text)') is null then
    raise exception '20261211200000: falta pg_trgm en el esquema extensions. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Importe neto por línea ───
alter table public.productos_factura add column if not exists importe_neto numeric(12, 2);
comment on column public.productos_factura.importe_neto is
  'Importe de la línea con los descuentos asociados (20261211200000). NULL = igual que total. Una línea de descuento ya repartida vale 0. Úsese coalesce(importe_neto, total) para precios, costes y sumas por producto o familia.';

-- ─── 2. Reparto de cada descuento ───
create table if not exists public.productos_factura_descuentos (
  descuento_linea_id bigint not null references public.productos_factura(id) on delete cascade,
  linea_id bigint not null references public.productos_factura(id) on delete cascade,
  importe numeric(12, 2) not null,
  regla text not null check (regla in ('nombre', 'linea_anterior', 'pct_linea', 'pie', 'pie_con_iva', 'manual')),
  creado_en timestamptz not null default now(),
  primary key (descuento_linea_id, linea_id),
  check (descuento_linea_id <> linea_id)
);
create index if not exists productos_factura_descuentos_linea_idx on public.productos_factura_descuentos (linea_id);
comment on table public.productos_factura_descuentos is
  'Qué parte de cada línea de descuento (importe negativo) se asigna a cada línea de producto del mismo documento, y por qué regla (20261211200000).';

alter table public.productos_factura_descuentos enable row level security;
revoke all on public.productos_factura_descuentos from public, anon;
grant select on public.productos_factura_descuentos to authenticated;
grant all on public.productos_factura_descuentos to service_role;
drop policy if exists productos_factura_descuentos_select on public.productos_factura_descuentos;
create policy productos_factura_descuentos_select on public.productos_factura_descuentos
  for select to authenticated
  using ((select public.can_read_section('facturas')));
drop policy if exists productos_factura_descuentos_service_role on public.productos_factura_descuentos;
create policy productos_factura_descuentos_service_role on public.productos_factura_descuentos
  for all to service_role using (true) with check (true);

-- ─── 3. Reglas ───
create or replace function public.es_linea_descuento(p_texto text)
returns boolean
language sql
immutable
set search_path to 'public'
as $f$
  -- Texto ya normalizado (nombre_busqueda: minúsculas y sin tildes).
  select coalesce(p_texto ~ '((^|[^a-z])(desc\.?|dto\.?|dtos?|dcto)([^a-z]|$)|descuento|bonific|promo|oferta|rappel|compra mas paga menos|venta por volumen|venta proactiva|pronto pago|regalo|obsequio|cortesia|rebaja|sin cargo)', false)
$f$;

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
comment on function public.facturas_asociar_descuentos(bigint[]) is
  'Asocia las líneas de descuento de esos documentos a sus productos y recalcula importe_neto (20261211200000). Devuelve cuántos repartos ha creado.';
revoke all on function public.facturas_asociar_descuentos(bigint[]) from public, anon, authenticated;
grant execute on function public.facturas_asociar_descuentos(bigint[]) to service_role;

-- ─── 4. Recalcular al cambiar líneas ───
create or replace function public.trg_productos_factura_descuentos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_ids bigint[];
begin
  -- Lo que hace facturas_asociar_descuentos (importe_neto) no vuelve a disparar el recálculo.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    select array_agg(distinct n.factura_id) into v_ids from nuevas n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.factura_id) into v_ids from viejas o;
  else
    select array_agg(distinct x.factura_id) into v_ids
      from (
        select n.factura_id from nuevas n join viejas o on o.id = n.id
         where (n.total, n.nombre, n.albaran_ref, n.orden, n.pagina, n.factura_id)
               is distinct from (o.total, o.nombre, o.albaran_ref, o.orden, o.pagina, o.factura_id)
        union
        select o.factura_id from nuevas n join viejas o on o.id = n.id
         where n.factura_id is distinct from o.factura_id
      ) x;
  end if;
  if v_ids is null then
    return null;
  end if;
  begin
    perform public.facturas_asociar_descuentos(v_ids);
  exception when others then
    -- Un fallo del reparto nunca impide guardar la factura.
    raise warning 'trg_productos_factura_descuentos: no se pudieron asociar los descuentos: %', sqlerrm;
  end;
  return null;
end;
$f$;

drop trigger if exists trg_productos_factura_descuentos_ins on public.productos_factura;
create trigger trg_productos_factura_descuentos_ins
  after insert on public.productos_factura
  referencing new table as nuevas
  for each statement execute function public.trg_productos_factura_descuentos();
drop trigger if exists trg_productos_factura_descuentos_upd on public.productos_factura;
create trigger trg_productos_factura_descuentos_upd
  after update on public.productos_factura
  referencing old table as viejas new table as nuevas
  for each statement execute function public.trg_productos_factura_descuentos();
drop trigger if exists trg_productos_factura_descuentos_del on public.productos_factura;
create trigger trg_productos_factura_descuentos_del
  after delete on public.productos_factura
  referencing old table as viejas
  for each statement execute function public.trg_productos_factura_descuentos();

-- ─── 5. Relleno del histórico ───
-- Sin una fila de auditoría por línea (el importe impreso no cambia): se apaga solo el trigger de
-- auditoría de esta tabla mientras dura el relleno, dentro de esta misma transacción.
do $$
declare
  v_ids bigint[];
  v_n integer;
  v_auditoria boolean := exists (
    select 1 from pg_trigger t where t.tgrelid = 'public.productos_factura'::regclass and t.tgname = 'trg_auditoria');
begin
  select array_agg(f.id) into v_ids
    from public.facturas f
   where f.total > 0
     and exists (select 1 from public.productos_factura p
                  where p.factura_id = f.id and p.total < 0 and public.es_linea_descuento(coalesce(p.nombre_busqueda, lower(p.nombre))));
  if v_auditoria then
    execute 'alter table public.productos_factura disable trigger trg_auditoria';
  end if;
  v_n := public.facturas_asociar_descuentos(v_ids);
  if v_auditoria then
    execute 'alter table public.productos_factura enable trigger trg_auditoria';
  end if;
  raise notice '20261211200000: % repartos en % documentos.', v_n, coalesce(cardinality(v_ids), 0);
end;
$$;
