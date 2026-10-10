-- ---------------------------------------------------------------------------
-- Recalcular alertas_validacion de todos los documentos (10/10/2026)
-- ---------------------------------------------------------------------------
-- Las alertas guardadas de los documentos antiguos no corresponden a la
-- versión actual de validar_cordura_factura (p. ej. el 46 tiene NULL y hoy
-- daría descuadre_cabecera). Esta migración:
--   1. crea recalcular_alertas_factura(id): alertas = validar_cordura_factura
--      + las alertas del OCR en TS (códigos que SQL no produce: total_deducido,
--      fecha_ausente...), y vuelve a aplicar la regla de auto-verificación
--      (20261010130000). Las verificaciones manuales no se tocan.
--   2. la ejecuta sobre todos los documentos.
--   3. trigger en productos_factura: si en el panel se cambia cantidad, precio
--      o total de una línea, se recalculan las alertas de su documento. Solo
--      UPDATE (el OCR borra e inserta líneas y luego valida él mismo) y solo
--      si cambia un importe (clasificar-productos solo toca producto_id).
-- ---------------------------------------------------------------------------

create or replace function public.recalcular_alertas_factura(p_factura_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f          record;
  v_sql      jsonb;
  v_previas  jsonb;
  v_alertas  jsonb;
  v_ok       boolean;
  v_codigos_sql constant text[] := array[
    'descuadre_cabecera', 'descuadre_linea', 'iva_incoherente',
    'precio_atipico_historico', 'precio_unitario_extremo',
    'subtotal_ausente', 'total_ausente',
    'total_documento_extremo', 'total_documento_irrisorio'];
begin
  select id, alertas_validacion, verificada, verificacion_origen
    into f from public.facturas where id = p_factura_id;
  if not found then
    return;
  end if;

  v_sql := coalesce(public.validar_cordura_factura(p_factura_id), '[]'::jsonb);
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_previas
    from jsonb_array_elements(
           case when jsonb_typeof(f.alertas_validacion) = 'array'
                then f.alertas_validacion else '[]'::jsonb end) a
   where not ((a->>'codigo') = any (v_codigos_sql));
  v_alertas := v_sql || v_previas;

  update public.facturas
     set alertas_validacion = case when jsonb_array_length(v_alertas) > 0 then v_alertas end
   where id = p_factura_id
     and alertas_validacion is distinct from
         (case when jsonb_array_length(v_alertas) > 0 then v_alertas end);

  -- La regla se aplica aquí también: cuando esto corre desde el trigger de
  -- productos_factura, el trigger de facturas va a profundidad 2 y no actúa.
  if f.verificacion_origen = 'manual' then
    return;
  end if;
  v_ok := public.factura_cumple_autoverificacion(p_factura_id);
  if not coalesce(f.verificada, false) and v_ok then
    update public.facturas set verificada = true, verificacion_origen = 'auto' where id = p_factura_id;
  elsif f.verificacion_origen = 'auto' and not v_ok then
    update public.facturas set verificada = false, verificacion_origen = null where id = p_factura_id;
  end if;
end;
$$;

revoke all on function public.recalcular_alertas_factura(bigint) from public, anon, authenticated;
grant execute on function public.recalcular_alertas_factura(bigint) to service_role;

-- Trigger en líneas ----------------------------------------------------------
create or replace function public.productos_factura_recalcular_alertas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.recalcular_alertas_factura(new.factura_id);
  if old.factura_id is distinct from new.factura_id then
    perform public.recalcular_alertas_factura(old.factura_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_productos_factura_recalcular_alertas on public.productos_factura;
create trigger trg_productos_factura_recalcular_alertas
  after update of cantidad, precio_unitario, total, factura_id on public.productos_factura
  for each row
  when (old.cantidad is distinct from new.cantidad
        or old.precio_unitario is distinct from new.precio_unitario
        or old.total is distinct from new.total
        or old.factura_id is distinct from new.factura_id)
  execute function public.productos_factura_recalcular_alertas();

-- Recalcular todo -------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.facturas order by id loop
    perform public.recalcular_alertas_factura(r.id);
  end loop;
end;
$$;
