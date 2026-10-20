set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Recoloca las mesas del COMEDOR y la TERRAZA de Casa Tomás según     ##
-- ##   los croquis a mano del 02/10/2026 y redibuja sus paredes.           ##
-- ##   Solo UPDATE de geometría/plazas en `mesas` (mismos id, mismos       ##
-- ##   números) y de `planos_espacio`. No crea ni borra mesas: las         ##
-- ##   asignaciones de reservas siguen apuntando a las mismas filas.       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ
--   El editor de plano (CanvasPlano.tsx) lee mesas.pos_x/pos_y en METROS
--   (esquina sup. izq. sin rotar) y ancho/alto en CM. Estas 29 mesas tenían
--   valores en píxeles (p. ej. pos_x=430), que el editor interpreta como
--   430 m: se dibujaban fuera del plano y los dos espacios parecían vacíos.
--   Las paredes de la Terraza (hasta x=999 px) también caían fuera de su
--   lienzo de 12×8 m. Las paredes sí van en px de escena a 50 px/m.
--
-- QUÉ CAMBIA (estado previo verificado en producción el 02/10/2026, solo SELECT)
--   Comedor: 11 mesas activas (1–11). Mesa 1 pasa de 4 a 2 plazas; el resto
--     4 plazas, 110×70 cm. Plano 9,5 × 15,5 m: zona de arriba (1–5), pasillo
--     con barra (área gris, NO es mesa) y aseos, zona de abajo con cocina,
--     columna y escalera (áreas) y mesas 6–11. Suma: 42 plazas.
--   Terraza: 18 mesas activas (1–18) en rejilla 65×65 cm, 4 plazas; la 18
--     redonda de 120 cm y 6 plazas. Plano 11,5 × 10,5 m (trapecio). 74 plazas.
--   No se tocan: «o (revisar)» del Comedor ni las tres fusiones inactivas de
--     la Terraza (activa=false), ni ningún otro espacio.
--   Escala estimada del croquis: 75 px de foto = 1 m. Las medidas reales
--     no se conocen; se ajustan luego en el editor.
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261002100000_casa_tomas_plano_comedor_terraza.sql
--   2. npx supabase db query --linked -f supabase/tests/casa_tomas_plano_comedor_terraza_test.sql
--   3. Abrir Super Admin → Espacios → Comedor / Terraza → «Configurar Plano y Mesas».
--   Deshacer: supabase/rollbacks/20261002100000_casa_tomas_plano_comedor_terraza_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer;
  esperadas integer;
begin
  -- 0. Las mesas activas (no fusionadas) de cada espacio son exactamente las
  --    del croquis: si alguien ha añadido o quitado una, no seguimos a ciegas.
  create temp table _croquis (
    espacio_id uuid, nombre text, capacidad int, forma text,
    ancho numeric, alto numeric, pos_x numeric, pos_y numeric, rotacion numeric
  ) on commit drop;
  insert into _croquis values
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '1', 2, 'rectangular', 80, 70, 2.93, 3.45, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '2', 4, 'rectangular', 110, 70, 3.92, 0.78, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '3', 4, 'rectangular', 110, 70, 6.88, 0.58, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '4', 4, 'rectangular', 110, 70, 6.88, 2.12, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '5', 4, 'rectangular', 110, 70, 6.88, 3.65, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '9', 4, 'rectangular', 110, 70, 5.61, 11.36, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '6', 4, 'rectangular', 110, 70, 7.58, 11.36, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '10', 4, 'rectangular', 110, 70, 5.61, 12.92, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '7', 4, 'rectangular', 110, 70, 7.58, 12.92, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '11', 4, 'rectangular', 110, 70, 5.61, 14.48, 0),
    ('449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid, '8', 4, 'rectangular', 110, 70, 7.58, 14.48, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '17', 4, 'rectangular', 65, 65, 1.65, 1.05, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '16', 4, 'rectangular', 65, 65, 1.65, 2.69, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '5', 4, 'rectangular', 65, 65, 4.48, 1.05, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '4', 4, 'rectangular', 65, 65, 4.48, 2.69, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '3', 4, 'rectangular', 65, 65, 4.48, 4.33, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '2', 4, 'rectangular', 65, 65, 4.48, 5.97, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '1', 4, 'rectangular', 65, 65, 4.48, 7.61, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '10', 4, 'rectangular', 65, 65, 6.62, 1.05, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '9', 4, 'rectangular', 65, 65, 6.62, 2.69, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '8', 4, 'rectangular', 65, 65, 6.62, 4.33, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '7', 4, 'rectangular', 65, 65, 6.62, 5.97, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '6', 4, 'rectangular', 65, 65, 6.62, 7.61, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '15', 4, 'rectangular', 65, 65, 9.18, 1.05, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '14', 4, 'rectangular', 65, 65, 8.96, 2.69, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '13', 4, 'rectangular', 65, 65, 8.75, 4.33, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '12', 4, 'rectangular', 65, 65, 8.53, 5.97, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '11', 4, 'rectangular', 65, 65, 8.32, 7.61, 0),
    ('5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid, '18', 6, 'circular', 120, 120, 0.8, 7.83, 0);

  if exists (
    (select espacio_id, nombre::text from public.mesas
      where espacio_id in (select distinct espacio_id from _croquis)
        and coalesce(activa, true) and not coalesce(is_merged, false))
    except
    (select espacio_id, nombre from _croquis)
  ) or exists (
    (select espacio_id, nombre from _croquis)
    except
    (select espacio_id, nombre::text from public.mesas
      where espacio_id in (select distinct espacio_id from _croquis)
        and coalesce(activa, true) and not coalesce(is_merged, false))
  ) then
    raise exception 'Las mesas activas de Comedor/Terraza ya no coinciden con el croquis (11 + 18). Revisar antes de aplicar.';
  end if;

  -- 1. Mesas: misma fila, nueva geometría y plazas.
  update public.mesas m set
    capacidad = c.capacidad, forma = c.forma, ancho = c.ancho, alto = c.alto,
    pos_x = c.pos_x, pos_y = c.pos_y, rotacion = c.rotacion
  from _croquis c
  where m.espacio_id = c.espacio_id and m.nombre::text = c.nombre
    and coalesce(m.activa, true) and not coalesce(m.is_merged, false);
  get diagnostics n = row_count;
  select count(*) into esperadas from _croquis;
  if n <> esperadas then
    raise exception 'mesas actualizadas: % (esperaba %)', n, esperadas;
  end if;

  -- 2. Planos: dimensiones y paredes/áreas (px de escena, 50 px/m).
  update public.planos_espacio set
    ancho = 475.0, alto = 775.0, ancho_metros = 9.5, alto_metros = 15.5,
    pixels_per_meter = 50, metros_cuadrados = 147.25,
    configuracion = '{"elementos":[{"id":"wall-croquis-1","tipo":"wall","props":{"x1":147,"y1":10,"x2":419,"y2":10}},{"id":"wall-croquis-2","tipo":"wall","props":{"x1":147,"y1":10,"x2":147,"y2":92}},{"id":"wall-croquis-3","tipo":"wall","props":{"x1":147,"y1":92,"x2":70,"y2":92}},{"id":"wall-croquis-4","tipo":"wall","props":{"x1":67,"y1":27,"x2":67,"y2":220}},{"id":"wall-croquis-5","tipo":"wall","props":{"x1":67,"y1":220,"x2":203,"y2":220}},{"id":"wall-croquis-6","tipo":"wall","props":{"x1":419,"y1":10,"x2":423,"y2":247}},{"id":"wall-croquis-7","tipo":"wall","props":{"x1":423,"y1":247,"x2":300,"y2":243}},{"id":"wall-croquis-8","tipo":"wall","props":{"x1":67,"y1":245,"x2":180,"y2":243}},{"id":"wall-croquis-9","tipo":"wall","props":{"x1":180,"y1":243,"x2":180,"y2":463}},{"id":"wall-croquis-10","tipo":"wall","props":{"x1":300,"y1":243,"x2":300,"y2":353}},{"id":"wall-croquis-11","tipo":"wall","props":{"x1":300,"y1":353,"x2":343,"y2":353}},{"id":"wall-croquis-12","tipo":"wall","props":{"x1":300,"y1":440,"x2":337,"y2":440}},{"id":"wall-croquis-13","tipo":"wall","props":{"x1":300,"y1":440,"x2":300,"y2":533}},{"id":"wall-croquis-14","tipo":"wall","props":{"x1":17,"y1":467,"x2":230,"y2":463}},{"id":"wall-croquis-15","tipo":"wall","props":{"x1":17,"y1":467,"x2":17,"y2":530}},{"id":"wall-croquis-16","tipo":"wall","props":{"x1":17,"y1":530,"x2":3,"y2":530}},{"id":"wall-croquis-17","tipo":"wall","props":{"x1":153,"y1":570,"x2":193,"y2":570}},{"id":"wall-croquis-18","tipo":"wall","props":{"x1":57,"y1":633,"x2":185,"y2":627}},{"id":"wall-croquis-19","tipo":"wall","props":{"x1":185,"y1":627,"x2":183,"y2":753}},{"id":"wall-croquis-20","tipo":"wall","props":{"x1":257,"y1":660,"x2":257,"y2":753}},{"id":"wall-croquis-21","tipo":"wall","props":{"x1":300,"y1":533,"x2":453,"y2":530}},{"id":"wall-croquis-22","tipo":"wall","props":{"x1":453,"y1":530,"x2":448,"y2":753}},{"id":"area-croquis-1","tipo":"area","props":{"left":180,"top":220,"width":23,"height":243}},{"id":"area-croquis-2","tipo":"area","props":{"left":157,"top":497,"width":30,"height":70}},{"id":"area-croquis-3","tipo":"area","props":{"left":183,"top":693,"width":73,"height":60}}],"realDimensions":{"width":9.5,"height":15.5}}'::jsonb
  where espacio_id = '449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'plano de % : % filas actualizadas (esperaba 1)', '449cffc7-1189-4f3c-a0b3-b60b3442979d', n; end if;

  update public.planos_espacio set
    ancho = 575.0, alto = 525.0, ancho_metros = 11.5, alto_metros = 10.5,
    pixels_per_meter = 50, metros_cuadrados = 120.75,
    configuracion = '{"elementos":[{"id":"wall-croquis-1","tipo":"wall","props":{"x1":43,"y1":23,"x2":547,"y2":7}},{"id":"wall-croquis-2","tipo":"wall","props":{"x1":547,"y1":7,"x2":492,"y2":423}},{"id":"wall-croquis-3","tipo":"wall","props":{"x1":492,"y1":423,"x2":453,"y2":423}},{"id":"wall-croquis-4","tipo":"wall","props":{"x1":503,"y1":493,"x2":167,"y2":493}},{"id":"wall-croquis-5","tipo":"wall","props":{"x1":37,"y1":27,"x2":37,"y2":287}},{"id":"wall-croquis-6","tipo":"wall","props":{"x1":17,"y1":367,"x2":5,"y2":490}},{"id":"wall-croquis-7","tipo":"wall","props":{"x1":17,"y1":497,"x2":123,"y2":497}}],"realDimensions":{"width":11.5,"height":10.5}}'::jsonb
  where espacio_id = '5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'plano de % : % filas actualizadas (esperaba 1)', '5888d22a-f228-41f5-8a9d-c8b3ee255863', n; end if;
end;
$$;

commit;
