set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · factura 54 (Luga ML/101511): cantidades por KILO en las  ##
-- ##   19 líneas cuyo precio es por kilo, sin volver a pasar el OCR.       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (dueño, 05/10/2026)
--   La tabla de Luga trae «Uds | Kilos | Precio | Dto% | Importe | IVA» y,
--   cuando hay kilos, el precio es por kilo. La 54 (ya sustituida, 54 líneas)
--   guardó cantidad = Uds, así que 19 líneas no cuadran (cantidad × precio ≠
--   importe) y el panel avisa. Ejemplos: NATOP 12 uds · 24,00 kg · 4,14 →
--   99,46; CG. PUNTAS 3 uds · 15,00 kg · 5,80 → 87,00; JAMÓN 8 uds · 75,48 kg
--   · 20,50 → 1.547,26; ESPINAS 1 ud · 2,00 kg · 4,20 → 8,40.
--
-- QUÉ CAMBIA (solo factura_id = 54; VALORES EXPLÍCITOS por `orden` e `id`,
-- sacados de la lectura humana del original —ground truth 31.json, que casa
-- con las 54 líneas guardadas en orden, cantidad, precio e importe— y no
-- calculados a ciegas)
--   1. Copia de seguridad en facturas_sustituciones (trabajo_id NULL,
--      resumen_antes.migracion = '20261005151000'): cabecera, las 54 líneas y
--      su historial tal como están.
--   2. Las 19 líneas por kilo: cantidad = kilos, unidad = 'kg', bultos = las
--      Uds que tenían. precio_unitario y total NO se tocan.
--   3. Las otras 35: unidad 'uds'/'unidades'/'ud' → 'ud' (cantidad igual).
--      (Las 5 de LAMINAS traen kilos pero su precio es por unidad: 3 × 17,84 =
--      53,52 ≈ 53,53. Se quedan en ud.)
--   4. alertas_validacion: se quitan los «descuadre_linea» y se añaden los que
--      devuelva ahora validar_cordura_factura(54) (ninguno); el resto
--      (subtotal_ausente, total_deducido) se queda.
--   NO toca historial_precios (el trigger es solo AFTER INSERT y el precio por
--   kilo no cambia), ni nombres, precios, importes ni el total (3.787,53).
--   Comprobación final: las 54 líneas cuadran cantidad × precio = importe
--   (margen de redondeo: max(0,05; |cantidad| × 0,005 + 0,01), el de
--   magnitudes.ts; NATOP: 24 × 4,14 = 99,36 frente a 99,46).
--
-- REQUISITO: 20261005150000_productos_factura_bultos.sql aplicada.
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005151000_luga_54_cantidades_kg.sql
--      Tiene que imprimir «luga_54_cantidades_kg: aplicada | 54 | 19 | 0».
--   2. npx supabase db query --linked -f supabase/tests/luga_54_cantidades_kg_test.sql
--      (BEGIN … ROLLBACK).
--   Deshacer: supabase/rollbacks/20261005151000_luga_54_cantidades_kg_ROLLBACK.sql
--   Idempotente: si ya está aplicada no cambia nada; si la 54 ha cambiado por
--   otro lado (otra sustitución, edición a mano) ABORTA sin tocar nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

--  orden, id, cantidad_antes (Uds), unidad_antes, precio (€/kg), importe, kilos
create temp table _luga54_kg (
  orden integer primary key, id bigint not null unique,
  cantidad_antes numeric not null, unidad_antes text not null,
  precio numeric not null, total numeric not null, kg numeric not null
) on commit drop;
insert into _luga54_kg (orden, id, cantidad_antes, unidad_antes, precio, total, kg) values
    ( 1, 998,  1.000, 'uds'      ,  4.20,    8.40,     2),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    ( 2, 999, 12.000, 'uds'      ,  4.14,   99.46,    24),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    ( 5, 1002,  1.000, 'uds'      , 16.40,   49.20,     3),  -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
    ( 7, 1004, 24.000, 'uds'      ,  8.90,  113.88,  12.8),  -- FR.COSTILLA CONFITADA en su jugo (350/450) -Buenapinta-
    ( 9, 1006,  1.000, 'uds'      ,  4.20,    8.40,     2),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (12, 1009, 12.000, 'unidades' ,  4.14,   99.46,    24),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (16, 1013,  1.000, 'unidades' , 19.90,   39.80,     2),  -- GAMBON REBOZADO XXL (C/2K- 45U aprox) -Gegarri-
    (17, 1014,  3.000, 'unidades' ,  5.80,   87.00,    15),  -- CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)
    (23, 1020,  1.000, 'unidades' ,  4.20,    8.40,     2),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (25, 1022, 12.000, 'unidades' ,  4.14,   99.46,    24),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (29, 1026,  1.000, 'unidades' , 16.40,   49.20,     3),  -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
    (31, 1028,  1.000, 'ud'       ,  7.53,   25.13,  3.34),  -- PANCETA IBERICA BELLOTA (Pzas. 3 K aprox)-S.M-
    (36, 1033,  1.000, 'ud'       ,  4.20,    8.40,     2),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (38, 1035, 12.000, 'ud'       ,  4.14,   99.46,    24),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (41, 1038,  3.000, 'ud'       ,  5.80,   87.00,    15),  -- CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)
    (44, 1041,  8.000, 'ud'       , 20.50, 1547.26, 75.48),  -- JAMON (CEBO CAMPO) IBERICO  -Lisardo Castro
    (46, 1043,  1.000, 'ud'       ,  4.20,    8.40,     2),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (47, 1044, 12.000, 'ud'       ,  4.14,   99.46,    24),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (51, 1048,  1.000, 'ud'       , 16.40,   49.20,     3)   -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
;

--  orden, id, cantidad, unidad_antes, precio, importe (cuadran por unidades)
create temp table _luga54_ud (
  orden integer primary key, id bigint not null unique,
  cantidad numeric not null, unidad_antes text not null, precio numeric not null, total numeric not null
) on commit drop;
insert into _luga54_ud (orden, id, cantidad, unidad_antes, precio, total) values
    ( 0, 997,  2.000, 'uds',  9.03,   18.07),
    ( 3, 1000,  1.000, 'uds', 12.31,   12.31),
    ( 4, 1001,  3.000, 'uds', 17.84,   53.53),
    ( 6, 1003,  1.000, 'uds',  9.48,    9.48),
    ( 8, 1005,  3.000, 'uds', 17.25,   51.75),
    (10, 1007,  2.000, 'unidades', 21.80,   43.60),
    (11, 1008,  2.000, 'unidades', 13.88,   27.76),
    (13, 1010,  4.000, 'unidades', 17.84,   71.38),
    (14, 1011,  1.000, 'unidades', 13.15,   13.15),
    (15, 1012,  1.000, 'unidades',  9.48,    9.48),
    (18, 1015,  3.000, 'unidades', 17.25,   51.75),
    (19, 1016,  1.000, 'unidades',  3.49,    3.49),
    (20, 1017,  1.000, 'unidades', 24.90,   24.90),
    (21, 1018,  2.000, 'unidades',  4.48,    8.97),
    (22, 1019,  3.000, 'unidades', 24.90,   74.71),
    (24, 1021,  4.000, 'unidades', 13.88,   55.52),
    (26, 1023,  1.000, 'unidades', 12.31,   12.31),
    (27, 1024,  2.000, 'unidades', 13.19,   26.37),
    (28, 1025,  5.000, 'unidades', 17.84,   89.22),
    (30, 1027,  8.000, 'unidades',  3.49,   27.90),
    (32, 1029,  1.000, 'ud', 17.51,   17.51),
    (33, 1030,  2.000, 'ud', 17.25,   34.50),
    (34, 1031,  2.000, 'ud',  4.48,    8.97),
    (35, 1032,  1.000, 'ud',  9.03,    9.03),
    (37, 1034,  3.000, 'ud', 13.88,   41.64),
    (39, 1036,  2.000, 'ud', 13.19,   26.37),
    (40, 1037,  4.000, 'ud', 17.84,   71.38),
    (42, 1039,  6.000, 'ud', 17.25,  103.50),
    (43, 1040,  1.000, 'ud', 13.15,   13.15),
    (45, 1042,  1.000, 'ud',  9.03,    9.03),
    (48, 1045,  1.000, 'ud', 13.19,   13.19),
    (49, 1046,  1.000, 'ud', 12.31,   12.31),
    (50, 1047,  4.000, 'ud', 17.84,   71.38),
    (52, 1049,  4.000, 'ud',  3.49,   13.95),
    (53, 1050,  4.000, 'ud', 17.25,   69.00);

-- ─── 0. Comprobaciones previas (abortan sin tocar nada) ─────────────────────
do $$
declare
  n_antes integer; n_ya integer; n integer;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'bultos') then
    raise exception 'luga_54_cantidades_kg: falta productos_factura.bultos (aplica antes 20261005150000_productos_factura_bultos.sql)';
  end if;
  if not exists (select 1 from public.facturas where id = 54 and numero_documento = 'ML/101511'
                    and proveedor ilike 'LUGA%') then
    raise exception 'luga_54_cantidades_kg: la factura 54 ya no es Luga ML/101511. No se ha cambiado nada.';
  end if;
  select count(*) into n from public.productos_factura where factura_id = 54;
  if n <> 54 then
    raise exception 'luga_54_cantidades_kg: la factura 54 tiene % líneas (se esperaban 54). No se ha cambiado nada.', n;
  end if;
  if (select count(*) from _luga54_kg) <> 19 or (select count(*) from _luga54_ud) <> 35 then
    raise exception 'luga_54_cantidades_kg: la tabla de valores no tiene 19 + 35 filas';
  end if;

  -- Cada línea por kilo está EXACTAMENTE como antes o EXACTAMENTE como después.
  select count(*) filter (where p.cantidad = k.cantidad_antes and p.unidad = k.unidad_antes and p.bultos is null),
         count(*) filter (where p.cantidad = k.kg and p.unidad = 'kg' and p.bultos = k.cantidad_antes)
    into n_antes, n_ya
    from _luga54_kg k
    join public.productos_factura p on p.id = k.id and p.factura_id = 54 and p.orden = k.orden
                                   and p.precio_unitario = k.precio and p.total = k.total;
  if n_antes + n_ya <> 19 or (n_antes > 0 and n_ya > 0) then
    raise exception 'luga_54_cantidades_kg: las 19 líneas por kilo no están como se esperaba (antes %, ya corregidas %). No se ha cambiado nada.',
      n_antes, n_ya;
  end if;
  select count(*) into n
    from _luga54_ud u
    join public.productos_factura p on p.id = u.id and p.factura_id = 54 and p.orden = u.orden
                                   and p.cantidad = u.cantidad and p.precio_unitario = u.precio and p.total = u.total
                                   and p.unidad in (u.unidad_antes, 'ud') and p.bultos is null;
  if n <> 35 then
    raise exception 'luga_54_cantidades_kg: solo % de las 35 líneas por unidad están como se esperaba. No se ha cambiado nada.', n;
  end if;
end;
$$;

-- ─── 1. Copia de seguridad (una sola vez) ───────────────────────────────────
insert into public.facturas_sustituciones
  (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes, resumen_despues)
select f.id, null, null,
       to_jsonb(f) - 'embedding' - 'embedding_observaciones',
       coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.orden)
                   from public.productos_factura p where p.factura_id = 54), '[]'::jsonb),
       coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
                   from public.historial_precios h where h.factura_id = 54), '[]'::jsonb),
       jsonb_build_object('migracion', '20261005151000', 'motivo',
                          'cantidades por kilo en las líneas de precio por kilo (Luga ML/101511), sin OCR',
                          'total', f.total, 'lineas', 54, 'alertas', f.alertas_validacion),
       jsonb_build_object('lineas_kg', 19, 'lineas_ud', 35)
  from public.facturas f
 where f.id = 54
   and not exists (select 1 from public.facturas_sustituciones s
                    where s.factura_id = 54 and s.resumen_antes->>'migracion' = '20261005151000');

-- ─── 2. Líneas por kilo ─────────────────────────────────────────────────────
update public.productos_factura p
   set cantidad = k.kg, unidad = 'kg', bultos = k.cantidad_antes
  from _luga54_kg k
 where p.id = k.id and p.factura_id = 54 and p.orden = k.orden
   and (p.cantidad, p.unidad) is distinct from (k.kg, 'kg');

-- ─── 3. Unidad normalizada en el resto ──────────────────────────────────────
update public.productos_factura p
   set unidad = 'ud'
  from _luga54_ud u
 where p.id = u.id and p.factura_id = 54 and p.orden = u.orden and p.unidad <> 'ud';

-- ─── 4. Avisos: fuera los descuadres de línea que ya no lo son ──────────────
update public.facturas f
   set alertas_validacion = nullif(
         coalesce((select jsonb_agg(a) from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) a
                    where a->>'codigo' <> 'descuadre_linea'), '[]'::jsonb)
         || coalesce((select jsonb_agg(a) from jsonb_array_elements(public.validar_cordura_factura(54)) a
                       where a->>'codigo' = 'descuadre_linea'), '[]'::jsonb),
         '[]'::jsonb)
 where f.id = 54;

-- ─── 5. Comprobación final ──────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from public.productos_factura
   where factura_id = 54
     and abs(cantidad * precio_unitario - total) > greatest(0.05, abs(cantidad) * 0.005 + 0.01);
  if n <> 0 then
    raise exception 'luga_54_cantidades_kg: % líneas siguen sin cuadrar. Se deshace todo.', n;
  end if;
  if (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'kg' and bultos is not null) <> 19
     or (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'ud' and bultos is null) <> 35 then
    raise exception 'luga_54_cantidades_kg: no han quedado 19 líneas en kg y 35 en ud. Se deshace todo.';
  end if;
  if (select sum(total) from public.productos_factura where factura_id = 54) <> 3787.53 then
    raise exception 'luga_54_cantidades_kg: la suma de importes ha cambiado. Se deshace todo.';
  end if;
  if (select count(*) from public.historial_precios where factura_id = 54) <> 54 then
    raise exception 'luga_54_cantidades_kg: el historial de precios de la 54 ha cambiado. Se deshace todo.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce((select alertas_validacion from public.facturas where id = 54), '[]'::jsonb)) a
              where a->>'codigo' = 'descuadre_linea') then
    raise exception 'luga_54_cantidades_kg: validar_cordura_factura sigue viendo descuadres de línea. Se deshace todo.';
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): «luga_54_cantidades_kg: aplicada | 54 | 19 | 0».
select 'luga_54_cantidades_kg: aplicada' as resultado,
       count(*) as lineas,
       count(*) filter (where unidad = 'kg') as lineas_kg,
       count(*) filter (where abs(cantidad * precio_unitario - total) > greatest(0.05, abs(cantidad) * 0.005 + 0.01)) as sin_cuadrar
  from public.productos_factura where factura_id = 54;
