set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261105120500_vincular_albaranes_por_sentencia — Facturas largas (05/11/2026)
-- ===========================================================================
-- PROBLEMA
--   trg_productos_factura_vincular_albaranes era FOR EACH ROW: al guardar una
--   factura mensual con N líneas que citan albaranes (Nicolás y Valero, Luga,
--   Altamira…) llamaba N veces a vincular_albaranes_proveedor(), y cada llamada
--   recorre todas las líneas del proveedor (~225 ms con un año de datos).
--   Con 60 líneas: 10,6 s > statement_timeout (8 s) → «insert productos»
--   cancelado. Lo vimos en la importación histórica de la demo (14 facturas)
--   y pasaría igual en producción con las subidas normales del OCR.
--
-- QUÉ HACE
--   Cambia ese trigger por tres FOR EACH STATEMENT con tablas de transición
--   (INSERT / UPDATE / DELETE), igual que trg_productos_factura_aviso_precio_*
--   y trg_productos_factura_alertas_*. Por sentencia se llama a
--   vincular_albaranes_proveedor() UNA vez por proveedor afectado.
--   Mismo resultado que antes: solo cuentan las líneas con albaran_ref (la
--   nueva en INSERT/UPDATE, la vieja en UPDATE/DELETE); en UPDATE, solo las
--   filas a las que les cambia albaran_ref o factura_id.
--   La función conserva su nombre (trg_productos_factura_vincular_albaranes),
--   SECURITY DEFINER y sin EXECUTE para anon/authenticated.
--   No toca datos ni vincular_albaranes_proveedor(). Idempotente.
-- ===========================================================================

set lock_timeout = '5s';

drop trigger if exists trg_productos_factura_vincular_albaranes on public.productos_factura;
drop trigger if exists trg_productos_factura_vincular_albaranes_ins on public.productos_factura;
drop trigger if exists trg_productos_factura_vincular_albaranes_upd on public.productos_factura;
drop trigger if exists trg_productos_factura_vincular_albaranes_del on public.productos_factura;

CREATE OR REPLACE FUNCTION public.trg_productos_factura_vincular_albaranes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261105120500_vincular_albaranes_por_sentencia: por sentencia, una llamada por proveedor.
declare
  v_facturas bigint[];
  v_prov bigint;
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.factura_id) into v_facturas
      from nuevas n where n.albaran_ref is not null;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.factura_id) into v_facturas
      from viejas o where o.albaran_ref is not null;
  else
    select array_agg(distinct x.factura_id) into v_facturas
      from (
        select n.factura_id
          from nuevas n join viejas o on o.id = n.id
         where n.albaran_ref is not null
           and (n.albaran_ref is distinct from o.albaran_ref or n.factura_id is distinct from o.factura_id)
        union
        select o.factura_id
          from nuevas n join viejas o on o.id = n.id
         where o.albaran_ref is not null
           and (n.albaran_ref is distinct from o.albaran_ref or n.factura_id is distinct from o.factura_id)
      ) x;
  end if;

  if v_facturas is null then
    return null;
  end if;

  for v_prov in
    select distinct f.proveedor_id
      from facturas f
     where f.id = any (v_facturas) and f.proveedor_id is not null
  loop
    perform vincular_albaranes_proveedor(v_prov);
  end loop;
  return null;
end;
$function$;

revoke all on function public.trg_productos_factura_vincular_albaranes() from public, anon, authenticated;

create trigger trg_productos_factura_vincular_albaranes_ins
  after insert on public.productos_factura
  referencing new table as nuevas
  for each statement execute function public.trg_productos_factura_vincular_albaranes();

create trigger trg_productos_factura_vincular_albaranes_upd
  after update on public.productos_factura
  referencing old table as viejas new table as nuevas
  for each statement execute function public.trg_productos_factura_vincular_albaranes();

create trigger trg_productos_factura_vincular_albaranes_del
  after delete on public.productos_factura
  referencing old table as viejas
  for each statement execute function public.trg_productos_factura_vincular_albaranes();

select 'vincular_albaranes_por_sentencia: aplicada | triggers ' ||
       (select count(*) from pg_trigger
         where tgrelid = 'public.productos_factura'::regclass
           and tgname like 'trg_productos_factura_vincular_albaranes%') as resultado;
