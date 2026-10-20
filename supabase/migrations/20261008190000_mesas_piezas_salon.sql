set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ##   SALÓN de Casa Tomás con el modelo de piezas, según el croquis del   ##
-- ##   08/10/2026. Requiere 20261008170000_mesas_piezas_comedor.sql.       ##
-- ===========================================================================
--
-- ESTADO PREVIO (verificado el 08/10/2026, solo SELECT)
--   13 mesas activas con nombres de fusiones viejas («2+1», «3+4», «11+10»…)
--   que no se parecen al croquis, y 2 inactivas guardadas en px («9», «11»).
--   NINGUNA tiene asignaciones de hoy en adelante; 8 asignaciones pasadas.
--
-- QUÉ HACE
--   1. Amplía `mesas.crece_hacia` con 'abajo'/'arriba' (filas verticales:
--      en el Salón casi todas las mesas tienen las sillas a izquierda y
--      derecha, así que la fila crece en vertical).
--   2. DESACTIVA (no borra) las 13 mesas activas actuales y les antepone
--      «antigua » al nombre: el historial de asignaciones sigue apuntando a
--      ellas. El índice único de nombres solo mira mesas activas, así que no
--      hay choque con los números nuevos (no hace falta renombrar en dos fases).
--   3. Da de alta las 13 mesas del croquis (54 plazas). NO HAY MESA 6: el
--      croquis numera 1–14 sin la 6 (debajo de la 10 hay un garabato tachado)
--      y las cuentas del dueño (8×4 + 2×2 + 3×6 = 54) salen con 13 mesas.
--   4. Añade la COLUMNA junto a la 7 como área (obstáculo dibujado).
--   Si las 13 mesas activas no son exactamente las esperadas (por id), se
--   para sin cambiar nada.
--
-- DATOS (confirmados por el dueño)
--   1, 3, 4, 8, 9, 10, 13, 14: 2 piezas (4); admiten pico y crecer en fila.
--   2 y 7: 1 pieza (2).  5, 11, 12: redondas de 6 (no se gestionan por piezas).
--
-- SUPUESTOS (croquis a mano; medidas estimadas, se ajustan en el editor)
--   · Posiciones encajadas en las paredes que ya tiene el plano del Salón
--     (19 × 13 m de lienzo; sala útil x 1,3–16,7 m, fondo y 8,1 m).
--   · Pieza de 55 cm a lo largo de la fila × 70 cm de fondo.
--   · Filas verticales (crecen hacia abajo): 1, 2, 3, 4, 7, 8, 9, 10.
--     Filas horizontales (crecen a la derecha): 13 y 14.
--   · Zonas que se pasan piezas, por cercanía en el croquis:
--       «salon-abajo»  = 1, 2, 3, 4, 8 y 9 (fila de abajo y las dos de encima)
--       «salon-arriba» = 13 y 14
--     La 10 va sola (lejos de todo) y la 7 también (pegada a la columna).
--   · La 2 puede recibir una pieza (hasta 4); la 7 no crece.
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261008190000_mesas_piezas_salon.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

alter table public.mesas drop constraint if exists mesas_crece_hacia_check;
alter table public.mesas add constraint mesas_crece_hacia_check
  check (crece_hacia in ('derecha', 'izquierda', 'abajo', 'arriba'));

do $$
declare
  salon constant uuid := 'db8be4e2-2e67-4110-99b1-9e1d779514cc';
  esperadas constant uuid[] := array[
    '21ba2971-098f-4e09-81ee-8023633059f1', 'f4bc8949-b6e4-4539-b77c-d6b242694acc',
    '974a1fd5-324f-45ce-b945-18fd4d0a54e2', '604a93d0-48f1-44e0-afc3-a31402449e9e',
    '8ff5cec3-c901-4140-ba07-3ea6d49eb710', '58771aec-340e-49b4-a296-cd17d21512fb',
    'decb7b12-2057-4e65-8fb8-2c68d941d81d', '196832e0-99d6-4560-b88f-b0cfffb6dd1b',
    'd0403a51-a093-423d-83db-929715c54481', 'b2603fda-6fa8-49e6-86a2-0384084e9e0d',
    '5c573c3a-296e-4e43-846f-b5b88262af79', 'cb918314-b128-49e0-a640-f992c8efd403',
    '2d66d706-9426-4daf-b7ef-9af36e1a6eb5'
  ]::uuid[];
  n integer;
begin
  -- 0. Comprobaciones: mismas 13 activas y ninguna asignación futura.
  if (select array_agg(id order by id) from public.mesas
        where espacio_id = salon and coalesce(activa, true) and not coalesce(is_merged, false))
     is distinct from (select array_agg(x order by x) from unnest(esperadas) x) then
    raise exception 'Las mesas activas del Salón ya no son las del 08/10. Revisar antes de aplicar.';
  end if;
  if exists (select 1 from public.asignaciones_mesa a
              where a.mesa_id = any(esperadas) and a.fecha >= current_date) then
    raise exception 'Hay mesas del Salón con asignaciones de hoy en adelante. Quitarlas antes de aplicar.';
  end if;

  -- 1. Desactivar las viejas (no se borran: guardan el historial).
  update public.mesas set activa = false, nombre = 'antigua ' || nombre
  where id = any(esperadas);
  get diagnostics n = row_count;
  if n <> 13 then raise exception 'mesas desactivadas: % (esperaba 13)', n; end if;

  -- 2. DATOS SEMILLA (fáciles de corregir): una fila por mesa.
  --   nombre | piezas (NULL = redonda, sin piezas) | capacidad | picos | picos_max
  --   | piezas_max | grupo | crece_hacia | forma | ancho cm | alto cm | pos_x m | pos_y m
  insert into public.mesas
    (espacio_id, nombre, piezas, capacidad, picos_base, picos_max, piezas_max, grupo_piezas,
     crece_hacia, forma, ancho, alto, pos_x, pos_y, rotacion, activa, is_merged)
  select salon, v.nombre, v.piezas, v.capacidad, v.picos, v.picos_max, v.piezas_max, v.grupo,
         v.crece, v.forma, v.ancho, v.alto, v.pos_x, v.pos_y, 0, true, false
  from (values
    ('1',  2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-abajo',  'abajo',   'rectangular',  70, 110,  8.21, 6.00),
    ('2',  1::smallint,    2, 0::smallint, 1::smallint, 2::smallint,    'salon-abajo',  'abajo',   'rectangular',  70,  55,  6.39, 6.00),
    ('3',  2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-abajo',  'abajo',   'rectangular',  70, 110,  4.51, 6.00),
    ('4',  2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-abajo',  'abajo',   'rectangular',  70, 110,  2.26, 6.00),
    ('5',  null::smallint, 6, 0::smallint, 0::smallint, null::smallint, null,           'derecha', 'circular',    150, 150, 13.91, 5.35),
    ('7',  1::smallint,    2, 0::smallint, 1::smallint, 1::smallint,    null,           'abajo',   'rectangular',  70,  55,  9.00, 5.03),
    ('8',  2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-abajo',  'abajo',   'rectangular',  70, 110,  5.26, 4.30),
    ('9',  2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-abajo',  'abajo',   'rectangular',  70, 110,  2.26, 4.30),
    ('10', 2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    null,           'abajo',   'rectangular',  70, 110, 15.20, 2.00),
    ('11', null::smallint, 6, 0::smallint, 0::smallint, null::smallint, null,           'derecha', 'circular',    150, 150, 10.90, 3.30),
    ('12', null::smallint, 6, 0::smallint, 0::smallint, null::smallint, null,           'derecha', 'circular',    150, 150,  7.25, 2.25),
    ('13', 2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-arriba', 'derecha', 'rectangular', 110,  70, 11.60, 0.90),
    ('14', 2::smallint,    4, 0::smallint, 1::smallint, 3::smallint,    'salon-arriba', 'derecha', 'rectangular', 110,  70,  9.70, 0.90)
  ) as v(nombre, piezas, capacidad, picos, picos_max, piezas_max, grupo, crece, forma, ancho, alto, pos_x, pos_y);
  get diagnostics n = row_count;
  if n <> 13 then raise exception 'mesas creadas: % (esperaba 13)', n; end if;

  -- 3. La columna junto a la 7, como área del plano (px de escena, 50 px/m).
  update public.planos_espacio
  set configuracion = jsonb_set(
    coalesce(configuracion, '{}'::jsonb),
    '{elementos}',
    coalesce(configuracion -> 'elementos', '[]'::jsonb)
      || '[{"id":"area-columna-salon","tipo":"area","props":{"left":456,"top":212,"width":23,"height":23}}]'::jsonb
  )
  where espacio_id = salon
    and not coalesce(configuracion -> 'elementos', '[]'::jsonb) @> '[{"id":"area-columna-salon"}]'::jsonb;
end;
$$;

commit;

-- Comprobación (13 mesas activas, 54 plazas):
-- select nombre, piezas, capacidad, grupo_piezas from public.mesas
--  where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc' and activa order by nombre::int;
