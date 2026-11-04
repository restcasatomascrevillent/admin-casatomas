-- ---------------------------------------------------------------------------
-- Recalcular las alertas de un documento al AÑADIR o BORRAR líneas (04/11/2026)
-- ---------------------------------------------------------------------------
-- Desde el panel ya se puede añadir a mano una línea a una factura o albarán
-- («Añadir línea»). El trigger de 20261010140000 solo recalcula
-- alertas_validacion (y la auto-verificación) cuando se EDITA un importe, así
-- que tras añadir o borrar una línea los avisos de importes quedaban
-- desfasados hasta la siguiente edición.
--
-- Esta migración añade dos triggers POR SENTENCIA (no por fila) en
-- productos_factura, uno para INSERT y otro para DELETE, que llaman a
-- recalcular_alertas_factura(id) UNA vez por documento afectado.
--
-- No actúan cuando quien escribe es service_role: el OCR (procesar-factura)
-- borra e inserta líneas y luego valida él mismo; recalcular en medio
-- cambiaría su flujo y costaría una validación por sentencia. Sin JWT
-- (SQL editor, migraciones) sí actúan.
--
-- Idempotente. Rollback: supabase/rollbacks/20261104120000_..._ROLLBACK.sql
-- ---------------------------------------------------------------------------

create or replace function public.productos_factura_recalcular_alertas_lote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return null;
  end if;
  -- `filas` es la tabla de transición: las nuevas (INSERT) o las borradas (DELETE).
  for r in select distinct factura_id from filas where factura_id is not null loop
    perform public.recalcular_alertas_factura(r.factura_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.productos_factura_recalcular_alertas_lote() from public, anon, authenticated;

drop trigger if exists trg_productos_factura_alertas_insert on public.productos_factura;
create trigger trg_productos_factura_alertas_insert
  after insert on public.productos_factura
  referencing new table as filas
  for each statement
  execute function public.productos_factura_recalcular_alertas_lote();

drop trigger if exists trg_productos_factura_alertas_delete on public.productos_factura;
create trigger trg_productos_factura_alertas_delete
  after delete on public.productos_factura
  referencing old table as filas
  for each statement
  execute function public.productos_factura_recalcular_alertas_lote();
