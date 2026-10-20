set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · factura 54 (Luga ML/101511): total CON IVA, deducido     ##
-- ##   con el tipo de IVA de cada línea, sin volver a pasar el OCR.        ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (06/10/2026)
--   La captura de la ML/101511 no llega al pie de totales (la tabla de totales
--   de la página 1 está impresa EN BLANCO y la página 2 se corta antes del
--   pie). procesar-factura dedujo el total sumando las 54 líneas: 3.787,53,
--   marcado `deducido`, con un aviso que ya decía que «el total real será
--   mayor». Esa cifra es la BASE IMPONIBLE, sin IVA, y el chatbot la presentaba
--   como «IVA incluido» y la sumaba al gasto. Pero la tabla trae una columna
--   «IVA» por fila, así que el IVA SÍ es calculable:
--     10 %: base 3.725,10 (49 líneas) → cuota 372,51
--      4 %: base    62,43 ( 5 líneas: PICOS Sin Gluten ×3, ROSQUILLA ×2)
--           → cuota 2,4972 → 2,50 (una cuota por tipo, redondeada a céntimos,
--             como lo imprimen las facturas españolas)
--     IVA 375,01 · TOTAL 3.787,53 + 375,01 = 4.162,54
--   Sin recargo de equivalencia: el recuadro de totales tiene las columnas
--   «% R.E. / importe R.E.» pero vacías, ninguna fila lleva R.E., y el cliente
--   (MASIDE 2011, S.L.U.) es una sociedad, que no tributa en ese régimen. Sin
--   portes, descuentos ni retención visibles (la columna Dto% está vacía en
--   las 54 filas). Si el papel completo trajera algo de eso en el pie, el
--   total real sería distinto: el aviso lo dice.
--   El OCR nuevo (procesar-factura, 06/10/2026) ya lee `iva_pct` por línea y
--   haría este mismo cálculo; esto corrige la 54 YA guardada.
--
-- DE DÓNDE SALEN LOS TIPOS (VALORES EXPLÍCITOS por `orden` e `id`, no a ciegas)
--   De la lectura humana del original (ground truth 31.json, scratchpad
--   952d3c36, que transcribe «IVA 4%» / «IVA 10%» de cada fila, original
--   facturas/WhatsApp Image 2026-02-03 at 22.04.59 (3).jpeg). Las 54 filas de
--   la ground truth casan 1:1 por `orden` con las 54 líneas guardadas (mismo
--   importe en las 54; los nombres solo difieren en erratas de OCR, p. ej.
--   «ROSKILLA», «GAMBON ZARADO»). Ninguna fila de la ground truth está sin
--   tipo: no ha hecho falta mirar el original para ninguna.
--   4 % → orden 0, 14, 35, 43, 45 (PICOS Sin Gluten, ROSQUILLA NATURAL,
--   PICOS, ROSQUILLA, PICOS). 10 % → las otras 49.
--
-- QUÉ CAMBIA (solo factura_id = 54)
--   1. Copia de seguridad en facturas_sustituciones (trabajo_id NULL,
--      resumen_antes.migracion = '20261006110000'): cabecera, las 54 líneas y
--      su historial tal como están.
--   2. productos_factura.iva_pct de las 54 líneas (4 o 10, por id y orden).
--   3. facturas: subtotal NULL → 3787.53, iva NULL → 375.01,
--      total 3787.53 → 4162.54; total_origen sigue 'deducido'. Las tres cifras
--      se RECALCULAN aquí desde las líneas y los tipos y tienen que coincidir
--      con las explícitas, o aborta.
--   4. alertas_validacion: fuera «subtotal_ausente» (ya hay base) y el
--      «total_deducido» viejo (el que decía que la base era el total); entra un
--      «total_deducido» nuevo, metodo «iva_por_linea», con el desglose, más lo
--      que devuelva ahora validar_cordura_factura(54) (nada: base = líneas y
--      base + IVA = total). Mismo formato que escribe procesar-factura.
--   NO toca nombres, cantidades, unidades, bultos, precios, importes ni
--   historial_precios (ningún trigger de productos_factura salta con un UPDATE
--   de iva_pct; el de facturas solo pone updated_at).
--   La migración anterior de la 54 (20261005151000, kilos) NO se toca; su
--   cabecera ya avisa de que «el total (3.787,53)» era la base.
--
-- REQUISITO: 20261006105000_productos_factura_iva_pct.sql aplicada.
--
-- PASOS (desde adminpanelct/, POR TERMINAL: usa una tabla temporal
-- `on commit drop`, así que NO en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261006110000_luga_54_total_con_iva.sql
--      Tiene que imprimir «luga_54_total_con_iva: aplicada | 3787.53 | 375.01 | 4162.54».
--   2. npx supabase db query --linked -f supabase/tests/luga_54_total_con_iva_test.sql
--      (BEGIN … ROLLBACK).
--   Deshacer: supabase/rollbacks/20261006110000_luga_54_total_con_iva_ROLLBACK.sql
--   Idempotente: si ya está aplicada no cambia nada; si la 54 ha cambiado por
--   otro lado (otra sustitución, edición a mano) ABORTA sin tocar nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

--  orden, id, importe (base de la línea), tipo de IVA impreso en la fila
create temp table _luga54_iva (
  orden integer primary key, id bigint not null unique, total numeric not null, iva_pct numeric not null
) on commit drop;
insert into _luga54_iva (orden, id, total, iva_pct) values
    ( 0,  997,    18.07,  4),  -- PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando
    ( 1,  998,     8.40, 10),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    ( 2,  999,    99.46, 10),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    ( 3, 1000,    12.31, 10),  -- ROUX CLARO (BOTE 1K) -Knorr-
    ( 4, 1001,    53.53, 10),  -- LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO
    ( 5, 1002,    49.20, 10),  -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
    ( 6, 1003,     9.48, 10),  -- ss.MIX FLORES SECAS (50g) -SOSA-
    ( 7, 1004,   113.88, 10),  -- FR.COSTILLA CONFITADA en su jugo (350/450) -Buenapinta-
    ( 8, 1005,    51.75, 10),  -- MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-
    ( 9, 1006,     8.40, 10),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (10, 1007,    43.60, 10),  -- TARTA CARAMELO SALADO / QUESO MANCHEGO (1,5 K ) Candida
    (11, 1008,    27.76, 10),  -- PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida
    (12, 1009,    99.46, 10),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (13, 1010,    71.38, 10),  -- LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO
    (14, 1011,    13.15,  4),  -- ROSQUILLA NATURAL (C/ 2 K) Individuales
    (15, 1012,     9.48, 10),  -- ss.MIX FLORES SECAS (50g) -SOSA-
    (16, 1013,    39.80, 10),  -- GAMBON REBOZADO XXL (C/2K- 45U aprox) -Gegarri-
    (17, 1014,    87.00, 10),  -- CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)
    (18, 1015,    51.75, 10),  -- MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-
    (19, 1016,     3.49, 10),  -- MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH
    (20, 1017,    24.90, 10),  -- CRUJIENTE DE WASABI ( C/ 48 U) Didess
    (21, 1018,     8.97, 10),  -- MOSTAZA DE CERVEZA 150g -ROOFTOP-
    (22, 1019,    74.71, 10),  -- CRUJIENTE DE WASABI ( C/ 48 U) Didess
    (23, 1020,     8.40, 10),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (24, 1021,    55.52, 10),  -- PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida
    (25, 1022,    99.46, 10),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (26, 1023,    12.31, 10),  -- MAIZENA EXPRESS CLARA (BOTE 1K)
    (27, 1024,    26.37, 10),  -- MAIZENA EXPRESS OSCURA (BOTE 1K)
    (28, 1025,    89.22, 10),  -- LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO
    (29, 1026,    49.20, 10),  -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
    (30, 1027,    27.90, 10),  -- MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH
    (31, 1028,    25.13, 10),  -- PANCETA IBERICA BELLOTA (Pzas. 3 K aprox)-S.M-
    (32, 1029,    17.51, 10),  -- SALSA POMODORO (BOTE 875g) -Knorr-
    (33, 1030,    34.50, 10),  -- MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-
    (34, 1031,     8.97, 10),  -- MOSTAZA DE CERVEZA 150g -ROOFTOP-
    (35, 1032,     9.03,  4),  -- PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando
    (36, 1033,     8.40, 10),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (37, 1034,    41.64, 10),  -- PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida
    (38, 1035,    99.46, 10),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (39, 1036,    26.37, 10),  -- MAIZENA EXPRESS OSCURA (BOTE 1K)
    (40, 1037,    71.38, 10),  -- LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO
    (41, 1038,    87.00, 10),  -- CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)
    (42, 1039,   103.50, 10),  -- MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-
    (43, 1040,    13.15,  4),  -- ROSQUILLA NATURAL (C/ 2 K) Individuales
    (44, 1041,  1547.26, 10),  -- JAMON (CEBO CAMPO) IBERICO  -Lisardo Castro
    (45, 1042,     9.03,  4),  -- PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando
    (46, 1043,     8.40, 10),  -- ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-
    (47, 1044,    99.46, 10),  -- NATOP (20%nata animal de 35mg) 2 L -Debic-
    (48, 1045,    13.19, 10),  -- MAIZENA EXPRESS OSCURA (BOTE 1K)
    (49, 1046,    12.31, 10),  -- MAIZENA EXPRESS CLARA (BOTE 1K)
    (50, 1047,    71.38, 10),  -- LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO
    (51, 1048,    49.20, 10),  -- RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-
    (52, 1049,    13.95, 10),  -- MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH
    (53, 1050,    69.00, 10)   -- MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-
;

-- ─── 0. Comprobaciones previas (abortan sin tocar nada) ─────────────────────
do $$
declare
  n integer;
  f record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'iva_pct') then
    raise exception 'luga_54_total_con_iva: falta productos_factura.iva_pct (aplica antes 20261006105000_productos_factura_iva_pct.sql)';
  end if;
  select * into f from public.facturas where id = 54;
  if not found or f.numero_documento <> 'ML/101511' or f.proveedor not ilike 'LUGA%' then
    raise exception 'luga_54_total_con_iva: la factura 54 ya no es Luga ML/101511. No se ha cambiado nada.';
  end if;
  if (select count(*) from _luga54_iva) <> 54
     or (select count(*) from _luga54_iva where iva_pct = 4) <> 5
     or (select count(*) from _luga54_iva where iva_pct = 10) <> 49 then
    raise exception 'luga_54_total_con_iva: la tabla de tipos no tiene 54 filas (5 al 4 %% y 49 al 10 %%)';
  end if;
  select count(*) into n from public.productos_factura where factura_id = 54;
  if n <> 54 then
    raise exception 'luga_54_total_con_iva: la factura 54 tiene % líneas (se esperaban 54). No se ha cambiado nada.', n;
  end if;
  -- Cada línea: mismo id, orden e importe, y sin tipo o ya con el suyo.
  select count(*) into n
    from _luga54_iva v
    join public.productos_factura p on p.id = v.id and p.factura_id = 54 and p.orden = v.orden and p.total = v.total
   where p.iva_pct is null or p.iva_pct = v.iva_pct;
  if n <> 54 then
    raise exception 'luga_54_total_con_iva: solo % de las 54 líneas casan por id, orden e importe. No se ha cambiado nada.', n;
  end if;
  if (select sum(total) from public.productos_factura where factura_id = 54) <> 3787.53 then
    raise exception 'luga_54_total_con_iva: las líneas ya no suman 3787.53. No se ha cambiado nada.';
  end if;
  -- Cabecera: como la dejó el OCR (base guardada como total) o ya corregida.
  if not (
       (f.subtotal is null and f.iva is null and f.total = 3787.53 and f.total_origen = 'deducido')
    or (f.subtotal = 3787.53 and f.iva = 375.01 and f.total = 4162.54 and f.total_origen = 'deducido')
  ) then
    raise exception 'luga_54_total_con_iva: la cabecera de la 54 no está como se esperaba (subtotal %, iva %, total %, origen %). No se ha cambiado nada.',
      f.subtotal, f.iva, f.total, f.total_origen;
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
       jsonb_build_object('migracion', '20261006110000', 'motivo',
                          'total con IVA deducido con el tipo de cada línea (Luga ML/101511), sin OCR',
                          'subtotal', f.subtotal, 'iva', f.iva, 'total', f.total, 'total_origen', f.total_origen,
                          'lineas', 54, 'alertas', f.alertas_validacion),
       jsonb_build_object('subtotal', 3787.53, 'iva', 375.01, 'total', 4162.54, 'lineas_iva_10', 49, 'lineas_iva_4', 5)
  from public.facturas f
 where f.id = 54
   and f.total = 3787.53
   and not exists (select 1 from public.facturas_sustituciones s
                    where s.factura_id = 54 and s.resumen_antes->>'migracion' = '20261006110000');

-- ─── 2. Tipo de IVA de cada línea ───────────────────────────────────────────
update public.productos_factura p
   set iva_pct = v.iva_pct
  from _luga54_iva v
 where p.id = v.id and p.factura_id = 54 and p.orden = v.orden
   and p.iva_pct is distinct from v.iva_pct;

-- ─── 3. Base, IVA y total, recalculados desde las líneas ────────────────────
do $$
declare
  v_base numeric;
  v_iva  numeric;
begin
  select sum(base), sum(cuota) into v_base, v_iva
    from (select sum(total) as base, round(sum(total) * iva_pct / 100, 2) as cuota
            from public.productos_factura where factura_id = 54 group by iva_pct) t;
  if v_base <> 3787.53 or v_iva <> 375.01 or v_base + v_iva <> 4162.54 then
    raise exception 'luga_54_total_con_iva: el cálculo desde las líneas da base % + IVA % = % (se esperaba 3787.53 + 375.01 = 4162.54). Se deshace todo.',
      v_base, v_iva, v_base + v_iva;
  end if;
end;
$$;

update public.facturas
   set subtotal = 3787.53, iva = 375.01, total = 4162.54, total_origen = 'deducido'
 where id = 54
   and (subtotal, iva, total) is distinct from (3787.53::numeric, 375.01::numeric, 4162.54::numeric);

-- ─── 4. Avisos ──────────────────────────────────────────────────────────────
--  Lo mismo que hace procesar-factura (validarYGuardarAlertas): primero lo que
--  devuelve validar_cordura_factura, y después los avisos propios cuyo código
--  no haya devuelto SQL. Los propios son los de antes salvo «subtotal_ausente»
--  y el «total_deducido» viejo, más el «total_deducido» nuevo.
update public.facturas f
   set alertas_validacion = nullif(
         coalesce(public.validar_cordura_factura(54), '[]'::jsonb)
         || coalesce((select jsonb_agg(a) from jsonb_array_elements(
                        coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) x
                                   where x->>'codigo' not in ('subtotal_ausente', 'total_deducido')), '[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object(
                             'codigo', 'total_deducido',
                             'severidad', 'media',
                             'mensaje',
                               'El documento no declara ni base imponible, ni IVA, ni total: el bloque de totales no se ve '
                               || '(recortado, en blanco o fuera del encuadre). Se ha CALCULADO deducido con el IVA de cada '
                               || 'linea: base 3787.53 EUR (suma de 54 linea(s)) + IVA 375.01 EUR (10 %: base 3725.10 EUR '
                               || '-> IVA 372.51 EUR; 4 %: base 62.43 EUR -> IVA 2.50 EUR) = 4162.54 EUR. Sin recargo de '
                               || 'equivalencia (no consta). Si el pie llevara portes, descuentos, recargo o retencion, o los '
                               || 'importes de linea ya incluyeran el IVA, el total real sera distinto: contrastalo con el papel. '
                               || '(Corregido el 06/10/2026 sin volver a pasar el OCR: antes se guardaba la base, 3787.53, como total.)',
                             'detalle', jsonb_build_object(
                               'metodo', 'iva_por_linea',
                               'num_lineas', 54,
                               'subtotal', 3787.53,
                               'iva', 375.01,
                               'total', 4162.54,
                               'desglose', jsonb_build_array(
                                 jsonb_build_object('tipo', 10, 'base', 3725.10, 'cuota', 372.51, 'lineas', 49),
                                 jsonb_build_object('tipo', 4, 'base', 62.43, 'cuota', 2.50, 'lineas', 5)),
                               'recargo_equivalencia', null,
                               'origen', 'deduccion',
                               'migracion', '20261006110000')))) a
                      where a->>'codigo' not in (select s->>'codigo'
                                                   from jsonb_array_elements(coalesce(public.validar_cordura_factura(54), '[]'::jsonb)) s)),
                     '[]'::jsonb),
         '[]'::jsonb)
 where f.id = 54
   and not exists (select 1 from jsonb_array_elements(coalesce(f.alertas_validacion, '[]'::jsonb)) x
                    where x->>'codigo' = 'total_deducido' and x->'detalle'->>'metodo' = 'iva_por_linea');

-- ─── 5. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  f record;
  a jsonb;
begin
  select * into f from public.facturas where id = 54;
  if f.subtotal <> 3787.53 or f.iva <> 375.01 or f.total <> 4162.54 or f.total_origen <> 'deducido' then
    raise exception 'luga_54_total_con_iva: la cabecera no ha quedado 3787.53 + 375.01 = 4162.54 (deducido). Se deshace todo.';
  end if;
  if (select count(*) from public.productos_factura where factura_id = 54 and iva_pct = 10) <> 49
     or (select count(*) from public.productos_factura where factura_id = 54 and iva_pct = 4) <> 5 then
    raise exception 'luga_54_total_con_iva: no han quedado 49 líneas al 10 %% y 5 al 4 %%. Se deshace todo.';
  end if;
  if (select sum(total) from public.productos_factura where factura_id = 54) <> 3787.53
     or (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'kg') <> 19 then
    raise exception 'luga_54_total_con_iva: han cambiado importes o cantidades de las líneas. Se deshace todo.';
  end if;
  if (select count(*) from public.historial_precios where factura_id = 54) <> 54 then
    raise exception 'luga_54_total_con_iva: el historial de precios de la 54 ha cambiado. Se deshace todo.';
  end if;
  a := coalesce(f.alertas_validacion, '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(a) x
              where x->>'codigo' in ('subtotal_ausente', 'total_ausente', 'descuadre_cabecera', 'iva_incoherente')) then
    raise exception 'luga_54_total_con_iva: quedan avisos de importes que ya no aplican (%). Se deshace todo.', a;
  end if;
  if (select count(*) from jsonb_array_elements(a) x where x->>'codigo' = 'total_deducido') <> 1
     or not exists (select 1 from jsonb_array_elements(a) x
                     where x->>'codigo' = 'total_deducido' and x->'detalle'->>'metodo' = 'iva_por_linea'
                       and (x->'detalle'->>'total')::numeric = 4162.54) then
    raise exception 'luga_54_total_con_iva: el aviso total_deducido no es el nuevo (iva_por_linea, 4162.54). Se deshace todo.';
  end if;
  if not exists (select 1 from public.facturas_sustituciones
                  where factura_id = 54 and resumen_antes->>'migracion' = '20261006110000'
                    and (resumen_antes->>'total')::numeric = 3787.53) then
    raise exception 'luga_54_total_con_iva: falta la copia de seguridad. Se deshace todo.';
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): «luga_54_total_con_iva: aplicada | 3787.53 | 375.01 | 4162.54».
select 'luga_54_total_con_iva: aplicada' as resultado, subtotal, iva, total
  from public.facturas where id = 54;
