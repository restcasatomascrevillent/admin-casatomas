set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005160000_productos_factura_unidades_normalizadas.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005160000_productos_factura_unidades_normalizadas_ROLLBACK.sql
--
-- Devuelve a productos_factura.unidad el valor que tenía antes (incluido NULL)
-- en las líneas que cambió la migración, leyéndolo de
-- productos_factura_unidades_respaldo. Si una línea se ha vuelto a tocar desde
-- entonces (su unidad ya no es la que dejó la migración) NO se pisa: se cuenta
-- como omitida. No toca cantidades, precios, totales ni bultos.
-- ANTES de restaurar quita el trigger trg_productos_factura_normalizar_unidad
-- (si no, normalizaría de nuevo lo que se restaura) y la función de ese
-- trigger, y devuelve el DEFAULT de unidad a 'unidades'. Al final quita
-- public.normalizar_unidad_factura(text). La tabla de respaldo SE CONSERVA
-- (es auditoría) y sus filas quedan marcadas con revertida_at.
-- Si la migración no cambió ninguna fila (el caso de hoy), no restaura nada y
-- solo quita el trigger, el DEFAULT y las funciones.
-- AVISO: sin el trigger, el OCR/panel pueden volver a guardar 'uds'/'unidades'.
-- Imprime «productos_factura_unidades_normalizadas: revertida | <restauradas> | <omitidas>».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.productos_factura_unidades_respaldo') is null then
    raise exception 'ROLLBACK ABORTADO: no existe productos_factura_unidades_respaldo (¿la migración 20261005160000 no se aplicó?). No se ha cambiado nada.';
  end if;
end;
$$;

-- Fuera el trigger y su función; DEFAULT como estaba (antes de 20261005160000).
drop trigger if exists trg_productos_factura_normalizar_unidad on public.productos_factura;
drop function if exists public.trg_productos_factura_normalizar_unidad();
alter table public.productos_factura alter column unidad set default 'unidades';

-- Para cada línea, el ÚLTIMO respaldo sin revertir (si la migración se ejecutó
-- varias veces sobre la misma línea, se deshace solo la última capa: es la que
-- dejó el valor actual).
create temp table _pf_unidades_ultimo on commit drop as
select distinct on (r.producto_id)
       r.respaldo_id, r.producto_id, r.unidad_antes, r.unidad_despues
  from public.productos_factura_unidades_respaldo r
 where r.migracion = '20261005160000' and r.revertida_at is null
 order by r.producto_id, r.respaldo_id desc;

create temp table _pf_unidades_sumas on commit drop as
select count(*)::bigint filas, coalesce(sum(cantidad), 0) s_cantidad, coalesce(sum(precio_unitario), 0) s_precio,
       coalesce(sum(total), 0) s_total, coalesce(sum(bultos), 0) s_bultos
  from public.productos_factura;

-- (Sin «on commit drop»: el SELECT final va después del commit; se borra al final.)
create temp table _pf_unidades_resultado (restauradas bigint, omitidas bigint);

do $$
declare
  v_rest bigint;
  v_omit bigint;
begin
  -- Restaura solo si la línea sigue como la dejó la migración.
  with hecho as (
    update public.productos_factura p
       set unidad = u.unidad_antes
      from _pf_unidades_ultimo u
     where p.id = u.producto_id
       and p.unidad is not distinct from u.unidad_despues
    returning p.id
  )
  select count(*) into v_rest from hecho;

  select count(*) - v_rest into v_omit from _pf_unidades_ultimo;

  -- Marca como revertido lo que se ha restaurado o ya no existe; lo omitido
  -- (editado después) también: la migración ya no manda sobre esa línea.
  update public.productos_factura_unidades_respaldo r
     set revertida_at = now()
   where r.migracion = '20261005160000' and r.revertida_at is null;

  insert into _pf_unidades_resultado values (v_rest, v_omit);

  -- Solo ha cambiado la unidad.
  if exists (
    select 1 from _pf_unidades_sumas a,
      (select count(*)::bigint filas, coalesce(sum(cantidad), 0) s_cantidad, coalesce(sum(precio_unitario), 0) s_precio,
              coalesce(sum(total), 0) s_total, coalesce(sum(bultos), 0) s_bultos
         from public.productos_factura) d
     where d.filas <> a.filas or d.s_cantidad <> a.s_cantidad or d.s_precio <> a.s_precio
        or d.s_total <> a.s_total or d.s_bultos <> a.s_bultos) then
    raise exception 'ROLLBACK ABORTADO: han cambiado cantidades, precios, totales o bultos. No se ha cambiado nada.';
  end if;
  if v_rest > 0 and exists (
    select 1 from _pf_unidades_ultimo u
      join public.productos_factura p on p.id = u.producto_id
     where p.unidad is distinct from u.unidad_antes and p.unidad is not distinct from u.unidad_despues) then
    raise exception 'ROLLBACK ABORTADO: alguna línea no ha recuperado su unidad anterior. No se ha cambiado nada.';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.productos_factura'::regclass
                and tgname = 'trg_productos_factura_normalizar_unidad') then
    raise exception 'ROLLBACK ABORTADO: el trigger de normalización sigue ahí. No se ha cambiado nada.';
  end if;
end;
$$;

drop function if exists public.normalizar_unidad_factura(text);

commit;

select 'productos_factura_unidades_normalizadas: revertida' as resultado,
       (select restauradas from _pf_unidades_resultado) as restauradas,
       (select omitidas from _pf_unidades_resultado) as omitidas;

drop table if exists _pf_unidades_resultado;
