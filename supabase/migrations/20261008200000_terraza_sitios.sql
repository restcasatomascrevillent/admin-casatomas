set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ##   TERRAZA de Casa Tomás: 16 SITIOS fijos en cuadrícula 4 × 4.          ##
-- ##   Requiere 20261008170000 y 20261008190000.                           ##
-- ===========================================================================
--
-- MODELO (dueño, 08/10/2026)
--   · El número va con el SITIO, no con la mesa física: 16 posiciones fijas
--     numeradas del 1 al 16. Mesas cuadradas e iguales, que se cambian mucho.
--   · Sin piezas ni pico. Cada sitio tiene un rango de plazas (2 a 6) y en
--     cada servicio se pone a mano cuántas lleva (`ajustes_mesa_servicio.plazas`).
--   · Juntar/Separar por servicio con los sitios ADYACENTES de la cuadrícula
--     (los de los lados, no la diagonal; la lógica lo decide por distancia).
--   · La entrada (rótulo) y la minibarra son solo dibujo (áreas), no mesas.
--
-- ESTADO PREVIO (verificado el 08/10/2026, solo SELECT)
--   18 mesas activas «1»–«18» (17 cuadradas de 4 y la 18 redonda de 6) y 3
--   fusiones inactivas. NINGUNA mesa tiene asignaciones (ni pasadas ni
--   futuras). Hay 1 reserva futura en la Terraza (09/10 14:00, 4 pax) SIN
--   mesa: no se toca y podrá sentarse en cualquier sitio.
--
-- QUÉ HACE
--   1. `mesas.plazas_min` / `plazas_max` y `ajustes_mesa_servicio.plazas`.
--   2. Las filas «1»–«16» pasan a ser los sitios 1–16 (mismo id, mismo
--      nombre: no hay renombrado, así que no puede chocar con el índice
--      único de nombres). La 17 y la 18 se DESACTIVAN (no se borran) y pasan
--      a «antigua 17» / «antigua 18».
--   3. Dibuja la entrada y la minibarra como áreas.
--   Si las 18 mesas activas no son exactamente las esperadas (por id) o
--   alguna tiene asignaciones de hoy en adelante, se para sin cambiar nada.
--
-- SUPUESTOS (el croquis está girado y no es una cuadrícula limpia)
--   · Numeración por filas, de izquierda a derecha y de arriba abajo:
--       1  2  3  4 / 5  6  7  8 / 9 10 11 12 / 13 14 15 16
--     Si el orden real es otro, basta cambiar `nombre` en los datos semilla.
--   · Sitios de 65 × 65 cm a 1,8 m entre centros, dentro de las paredes que
--     ya tiene el plano (11,5 × 10,5 m). 4 plazas por defecto.
--   · Entrada arriba en el centro y minibarra a su derecha (posición
--     estimada; se mueven en el editor de plano).
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261008200000_terraza_sitios.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- 1. Columnas ------------------------------------------------------------------
alter table public.mesas
  add column if not exists plazas_min smallint,
  add column if not exists plazas_max smallint;
alter table public.mesas drop constraint if exists mesas_plazas_rango_check;
alter table public.mesas add constraint mesas_plazas_rango_check check (
  (plazas_min is null and plazas_max is null)
  or (plazas_min >= 1 and plazas_max >= plazas_min)
);
comment on column public.mesas.plazas_min is 'Sitios (Terraza): mínimo de plazas que se le pueden poner en un servicio.';
comment on column public.mesas.plazas_max is 'Sitios (Terraza): máximo de plazas que se le pueden poner en un servicio.';

alter table public.ajustes_mesa_servicio
  add column if not exists plazas smallint;
alter table public.ajustes_mesa_servicio drop constraint if exists ajustes_mesa_servicio_plazas_check;
alter table public.ajustes_mesa_servicio add constraint ajustes_mesa_servicio_plazas_check
  check (plazas is null or plazas between 1 and 20);
comment on column public.ajustes_mesa_servicio.plazas is 'Sitios: plazas puestas a mano en este servicio. NULL = las del plano.';

-- 2. Terraza ---------------------------------------------------------------------
do $$
declare
  terraza constant uuid := '5888d22a-f228-41f5-8a9d-c8b3ee255863';
  n integer;
begin
  create temp table _sitios (id_actual uuid, nombre_actual text, nombre text, pos_x numeric, pos_y numeric)
    on commit drop;
  -- DATOS SEMILLA (fáciles de corregir): fila actual → sitio (nombre) y su
  -- esquina superior izquierda en metros. Columnas x 2,2/4,0/5,8/7,6; filas
  -- y 2,2/4,0/5,8/7,6.
  insert into _sitios values
    ('002a7791-79d7-4c84-b094-21eb00a483da', '1',  '1',  2.20, 2.20),
    ('11bc861c-8241-492a-ad1c-ab85fb22b123', '2',  '2',  4.00, 2.20),
    ('e04e043b-95fd-48aa-aad8-e242d780ed41', '3',  '3',  5.80, 2.20),
    ('27f365a1-3606-432a-ae31-b94e565c9729', '4',  '4',  7.60, 2.20),
    ('9f0c66cf-6670-4911-9c6a-f647471ad0f2', '5',  '5',  2.20, 4.00),
    ('1704f19c-b651-4870-b029-39fd8e34fe23', '6',  '6',  4.00, 4.00),
    ('f84a540f-66bc-45f7-b7de-8689a0f6eec1', '7',  '7',  5.80, 4.00),
    ('c1994bbd-953f-40a8-81ba-2a5d85f5f1fa', '8',  '8',  7.60, 4.00),
    ('acf585b5-82d5-40f8-a8d9-74d09aacd62b', '9',  '9',  2.20, 5.80),
    ('1da33226-0abd-461e-b2a1-586ddb0f11eb', '10', '10', 4.00, 5.80),
    ('034e250e-7045-4c9a-8bb0-db7704fb49f0', '11', '11', 5.80, 5.80),
    ('6e35ebf9-93c3-4e56-b557-f24a8f9ab9bf', '12', '12', 7.60, 5.80),
    ('587e80e3-6921-479e-a93e-a6af691a2a69', '13', '13', 2.20, 7.60),
    ('fbf637d9-647a-43fd-9c50-c00839fe1841', '14', '14', 4.00, 7.60),
    ('117a7c23-816f-4d77-a581-01e7acec99f1', '15', '15', 5.80, 7.60),
    ('5a6f54f5-e841-4605-bcd4-99a4e3dc9c82', '16', '16', 7.60, 7.60);

  -- 0. Comprobaciones: las 18 activas esperadas, y ninguna asignación futura.
  if (select array_agg(id::text || '=' || nombre::text order by id) from public.mesas
        where espacio_id = terraza and coalesce(activa, true) and not coalesce(is_merged, false))
     is distinct from
     (select array_agg(x order by x) from unnest(array[
        '002a7791-79d7-4c84-b094-21eb00a483da=1',  '11bc861c-8241-492a-ad1c-ab85fb22b123=2',
        'e04e043b-95fd-48aa-aad8-e242d780ed41=3',  '27f365a1-3606-432a-ae31-b94e565c9729=4',
        '9f0c66cf-6670-4911-9c6a-f647471ad0f2=5',  '1704f19c-b651-4870-b029-39fd8e34fe23=6',
        'f84a540f-66bc-45f7-b7de-8689a0f6eec1=7',  'c1994bbd-953f-40a8-81ba-2a5d85f5f1fa=8',
        'acf585b5-82d5-40f8-a8d9-74d09aacd62b=9',  '1da33226-0abd-461e-b2a1-586ddb0f11eb=10',
        '034e250e-7045-4c9a-8bb0-db7704fb49f0=11', '6e35ebf9-93c3-4e56-b557-f24a8f9ab9bf=12',
        '587e80e3-6921-479e-a93e-a6af691a2a69=13', 'fbf637d9-647a-43fd-9c50-c00839fe1841=14',
        '117a7c23-816f-4d77-a581-01e7acec99f1=15', '5a6f54f5-e841-4605-bcd4-99a4e3dc9c82=16',
        'b7b4fb6c-b48f-4623-9245-4eb2f5fb8c15=17', '5892b305-e630-4fac-88f2-ad77421742d6=18'
      ]) x) then
    raise exception 'Las mesas activas de la Terraza ya no son las del 08/10. Revisar antes de aplicar.';
  end if;
  if exists (select 1 from public.asignaciones_mesa a join public.mesas m on m.id = a.mesa_id
              where m.espacio_id = terraza and a.fecha >= current_date) then
    raise exception 'Hay mesas de la Terraza con asignaciones de hoy en adelante. Quitarlas antes de aplicar.';
  end if;

  -- 1. La 17 y la 18 se desactivan (no se borran).
  update public.mesas set activa = false, nombre = 'antigua ' || nombre
  where id in ('b7b4fb6c-b48f-4623-9245-4eb2f5fb8c15', '5892b305-e630-4fac-88f2-ad77421742d6');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'mesas desactivadas: % (esperaba 2)', n; end if;

  -- 2. Filas 1–16 → sitios 1–16, por id.
  update public.mesas m set
    nombre = s.nombre,
    forma = 'rectangular',
    ancho = 65, alto = 65, rotacion = 0,
    pos_x = s.pos_x, pos_y = s.pos_y,
    capacidad = 4, plazas_min = 2, plazas_max = 6,
    piezas = null, picos_base = 0, picos_max = 0, piezas_max = null,
    grupo_piezas = 'terraza', crece_hacia = 'derecha'
  from _sitios s
  where m.id = s.id_actual and m.nombre::text = s.nombre_actual;
  get diagnostics n = row_count;
  if n <> 16 then raise exception 'sitios actualizados: % (esperaba 16)', n; end if;

  -- 3. Entrada y minibarra (px de escena, 50 px/m).
  update public.planos_espacio
  set configuracion = jsonb_set(
    coalesce(configuracion, '{}'::jsonb),
    '{elementos}',
    coalesce(configuracion -> 'elementos', '[]'::jsonb)
      || '[{"id":"area-entrada-terraza","tipo":"area","props":{"left":210,"top":25,"width":100,"height":45,"fill":"rgba(253, 230, 138, 0.6)"}},
           {"id":"area-minibarra-terraza","tipo":"area","props":{"left":325,"top":25,"width":55,"height":40,"fill":"rgba(203, 213, 225, 0.8)"}}]'::jsonb
  )
  where espacio_id = terraza
    and not coalesce(configuracion -> 'elementos', '[]'::jsonb) @> '[{"id":"area-entrada-terraza"}]'::jsonb;
  get diagnostics n = row_count;
  if n > 1 then raise exception 'planos actualizados: % (esperaba 0 o 1)', n; end if;
end;
$$;

commit;

-- Comprobación (16 sitios activos, 4 plazas cada uno, rango 2-6):
-- select nombre, capacidad, plazas_min, plazas_max, pos_x, pos_y from public.mesas
--  where espacio_id = '5888d22a-f228-41f5-8a9d-c8b3ee255863' and activa order by nombre::int;
