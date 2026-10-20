set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005151000_luga_54_cantidades_kg.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005151000_luga_54_cantidades_kg_ROLLBACK.sql
--
-- Devuelve las 54 líneas de la factura 54 a los valores EXACTOS que tenían el
-- 05/10/2026 antes de la migración (cantidad = Uds; unidad 'uds', 'unidades'
-- o 'ud' tal cual estaba; bultos NULL — escritos aquí por id y orden) y
-- alertas_validacion a la copia guardada por la migración en
-- facturas_sustituciones (resumen_antes.migracion = '20261005151000').
-- La copia de seguridad se CONSERVA (es auditoría).
-- ABORTA sin tocar nada si la 54 ya no es Luga ML/101511 con esas 54 líneas
-- (mismos id y orden) o si falta la copia de seguridad.
-- ANTES: si está aplicada 20261006110000_luga_54_total_con_iva.sql, deshacerla
-- primero (su rollback): esta restaura los avisos de antes de los kilos, que
-- daban la base 3.787,53 por total, y ABORTA si la 54 sigue con el IVA.
-- Imprime «luga_54_cantidades_kg: revertida | 54 | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

--  orden, id, cantidad, unidad (valores del 05/10/2026 antes de la migración)
create temp table _luga54_antes (
  orden integer primary key, id bigint not null unique, cantidad numeric not null, unidad text not null
) on commit drop;
insert into _luga54_antes (orden, id, cantidad, unidad) values
    ( 0, 997,  2.000, 'uds'),
    ( 1, 998,  1.000, 'uds'),
    ( 2, 999, 12.000, 'uds'),
    ( 3, 1000,  1.000, 'uds'),
    ( 4, 1001,  3.000, 'uds'),
    ( 5, 1002,  1.000, 'uds'),
    ( 6, 1003,  1.000, 'uds'),
    ( 7, 1004, 24.000, 'uds'),
    ( 8, 1005,  3.000, 'uds'),
    ( 9, 1006,  1.000, 'uds'),
    (10, 1007,  2.000, 'unidades'),
    (11, 1008,  2.000, 'unidades'),
    (12, 1009, 12.000, 'unidades'),
    (13, 1010,  4.000, 'unidades'),
    (14, 1011,  1.000, 'unidades'),
    (15, 1012,  1.000, 'unidades'),
    (16, 1013,  1.000, 'unidades'),
    (17, 1014,  3.000, 'unidades'),
    (18, 1015,  3.000, 'unidades'),
    (19, 1016,  1.000, 'unidades'),
    (20, 1017,  1.000, 'unidades'),
    (21, 1018,  2.000, 'unidades'),
    (22, 1019,  3.000, 'unidades'),
    (23, 1020,  1.000, 'unidades'),
    (24, 1021,  4.000, 'unidades'),
    (25, 1022, 12.000, 'unidades'),
    (26, 1023,  1.000, 'unidades'),
    (27, 1024,  2.000, 'unidades'),
    (28, 1025,  5.000, 'unidades'),
    (29, 1026,  1.000, 'unidades'),
    (30, 1027,  8.000, 'unidades'),
    (31, 1028,  1.000, 'ud'),
    (32, 1029,  1.000, 'ud'),
    (33, 1030,  2.000, 'ud'),
    (34, 1031,  2.000, 'ud'),
    (35, 1032,  1.000, 'ud'),
    (36, 1033,  1.000, 'ud'),
    (37, 1034,  3.000, 'ud'),
    (38, 1035, 12.000, 'ud'),
    (39, 1036,  2.000, 'ud'),
    (40, 1037,  4.000, 'ud'),
    (41, 1038,  3.000, 'ud'),
    (42, 1039,  6.000, 'ud'),
    (43, 1040,  1.000, 'ud'),
    (44, 1041,  8.000, 'ud'),
    (45, 1042,  1.000, 'ud'),
    (46, 1043,  1.000, 'ud'),
    (47, 1044, 12.000, 'ud'),
    (48, 1045,  1.000, 'ud'),
    (49, 1046,  1.000, 'ud'),
    (50, 1047,  4.000, 'ud'),
    (51, 1048,  1.000, 'ud'),
    (52, 1049,  4.000, 'ud'),
    (53, 1050,  4.000, 'ud');

do $$
declare n integer;
begin
  if not exists (select 1 from public.facturas where id = 54 and numero_documento = 'ML/101511') then
    raise exception 'ROLLBACK ABORTADO: la factura 54 ya no es Luga ML/101511. No se ha cambiado nada.';
  end if;
  if exists (select 1 from public.facturas where id = 54 and iva = 375.01 and total = 4162.54) then
    raise exception 'ROLLBACK ABORTADO: la 54 sigue con el total con IVA de 20261006110000. Ejecuta antes su rollback. No se ha cambiado nada.';
  end if;
  select count(*) into n from public.productos_factura p join _luga54_antes a on a.id = p.id and a.orden = p.orden
   where p.factura_id = 54;
  if n <> 54 or (select count(*) from public.productos_factura where factura_id = 54) <> 54 then
    raise exception 'ROLLBACK ABORTADO: las líneas de la 54 ya no son las mismas (% de 54 coinciden por id y orden). No se ha cambiado nada.', n;
  end if;
  if not exists (select 1 from public.facturas_sustituciones
                  where factura_id = 54 and resumen_antes->>'migracion' = '20261005151000') then
    raise exception 'ROLLBACK ABORTADO: no está la copia de seguridad de 20261005151000. No se ha cambiado nada.';
  end if;
end;
$$;

update public.productos_factura p
   set cantidad = a.cantidad, unidad = a.unidad, bultos = null
  from _luga54_antes a
 where p.id = a.id and p.factura_id = 54 and p.orden = a.orden;

update public.facturas f
   set alertas_validacion = (select s.factura_antes->'alertas_validacion'
                               from public.facturas_sustituciones s
                              where s.factura_id = 54 and s.resumen_antes->>'migracion' = '20261005151000'
                              order by s.id limit 1)
 where f.id = 54;

do $$
declare n integer;
begin
  -- Mismos valores que la copia de seguridad, línea a línea.
  select count(*) into n
    from public.facturas_sustituciones s
    cross join lateral jsonb_array_elements(s.productos_antes) b
    join public.productos_factura p on p.id = (b->>'id')::bigint
   where s.factura_id = 54 and s.resumen_antes->>'migracion' = '20261005151000'
     and (p.cantidad <> (b->>'cantidad')::numeric or p.unidad <> b->>'unidad' or p.bultos is not null);
  if n <> 0 then
    raise exception 'ROLLBACK ABORTADO: % líneas no coinciden con la copia de seguridad. No se ha cambiado nada.', n;
  end if;
end;
$$;

commit;

select 'luga_54_cantidades_kg: revertida' as resultado,
       count(*) as lineas,
       count(*) filter (where unidad = 'kg') as lineas_kg
  from public.productos_factura where factura_id = 54;
