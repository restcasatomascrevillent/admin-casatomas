set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261006110000_luga_54_total_con_iva.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL:
--   npx supabase db query --linked -f supabase/rollbacks/20261006110000_luga_54_total_con_iva_ROLLBACK.sql
--
-- Devuelve la factura 54 a los valores EXACTOS que tenía el 06/10/2026 antes
-- de la migración (escritos aquí, no calculados):
--   · facturas: subtotal NULL, iva NULL, total 3787.53, total_origen 'deducido'
--     (la base guardada como total, que es lo que se corrigió);
--   · alertas_validacion: la copia guardada por la migración en
--     facturas_sustituciones (resumen_antes.migracion = '20261006110000'),
--     que eran «subtotal_ausente» + el «total_deducido» de suma de líneas;
--   · productos_factura.iva_pct = NULL en las 54 líneas (por id y orden).
-- La copia de seguridad se CONSERVA (es auditoría).
-- ABORTA sin tocar nada si la 54 ya no es Luga ML/101511 con esas 54 líneas
-- (mismos id, orden e importe), si su cabecera no está como la dejó la
-- migración (3787.53 + 375.01 = 4162.54) o si falta la copia de seguridad.
-- Se ejecuta ANTES que el rollback de 20261006105000 (que quita la columna).
-- Imprime «luga_54_total_con_iva: revertida | 3787.53 | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer;
  f record;
begin
  select * into f from public.facturas where id = 54;
  if not found or f.numero_documento <> 'ML/101511' then
    raise exception 'ROLLBACK ABORTADO: la factura 54 ya no es Luga ML/101511. No se ha cambiado nada.';
  end if;
  if not (f.subtotal = 3787.53 and f.iva = 375.01 and f.total = 4162.54) then
    raise exception 'ROLLBACK ABORTADO: la cabecera de la 54 no es la de la migración (subtotal %, iva %, total %). No se ha cambiado nada.',
      f.subtotal, f.iva, f.total;
  end if;
  select count(*) into n
    from public.productos_factura p
   where p.factura_id = 54 and p.id = p.orden + 997 and p.orden between 0 and 53;
  if n <> 54 or (select count(*) from public.productos_factura where factura_id = 54) <> 54
     or (select sum(total) from public.productos_factura where factura_id = 54) <> 3787.53 then
    raise exception 'ROLLBACK ABORTADO: las líneas de la 54 ya no son las mismas (% de 54 casan por id y orden). No se ha cambiado nada.', n;
  end if;
  if not exists (select 1 from public.facturas_sustituciones
                  where factura_id = 54 and resumen_antes->>'migracion' = '20261006110000'
                    and (resumen_antes->>'total')::numeric = 3787.53) then
    raise exception 'ROLLBACK ABORTADO: no está la copia de seguridad de 20261006110000. No se ha cambiado nada.';
  end if;
end;
$$;

-- Líneas: sin tipo de IVA, como estaban (ids 997..1050 = orden 0..53).
update public.productos_factura
   set iva_pct = null
 where factura_id = 54 and id between 997 and 1050 and id = orden + 997;

-- Cabecera y avisos: valores exactos de antes.
update public.facturas f
   set subtotal = null,
       iva = null,
       total = 3787.53,
       total_origen = 'deducido',
       alertas_validacion = (select s.factura_antes->'alertas_validacion'
                               from public.facturas_sustituciones s
                              where s.factura_id = 54 and s.resumen_antes->>'migracion' = '20261006110000'
                              order by s.id limit 1)
 where f.id = 54;

do $$
declare
  f record;
begin
  select * into f from public.facturas where id = 54;
  if f.subtotal is not null or f.iva is not null or f.total <> 3787.53 or f.total_origen <> 'deducido' then
    raise exception 'ROLLBACK ABORTADO: la cabecera no ha vuelto a subtotal NULL, iva NULL, total 3787.53. Se deshace todo.';
  end if;
  if exists (select 1 from public.productos_factura where factura_id = 54 and iva_pct is not null) then
    raise exception 'ROLLBACK ABORTADO: quedan líneas de la 54 con iva_pct. Se deshace todo.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
              where a->>'codigo' = 'total_deducido' and a->'detalle'->>'metodo' = 'iva_por_linea') then
    raise exception 'ROLLBACK ABORTADO: los avisos no han vuelto a los de antes. Se deshace todo.';
  end if;
end;
$$;

commit;

select 'luga_54_total_con_iva: revertida' as resultado,
       (select total from public.facturas where id = 54) as total,
       (select count(*) from public.productos_factura where factura_id = 54 and iva_pct is not null) as lineas_con_iva_pct;
