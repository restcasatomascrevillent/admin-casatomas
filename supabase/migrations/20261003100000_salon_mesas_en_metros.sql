set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Pasa a METROS las dos mesas del SALÓN que seguían en píxeles        ##
-- ##   ("9" y "11"). Solo UPDATE de pos_x/pos_y de esas dos filas: mismos  ##
-- ##   id, mismos números, no se crea ni se borra nada.                    ##
-- ##                                                                       ##
-- ##   OJO: el valor convertido NO es una posición buena, solo una         ##
-- ##   posición visible. Léase "DESPUÉS DE APLICAR" antes de ejecutar.     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ
--   El editor de plano (CanvasPlano.tsx) lee mesas.pos_x/pos_y en METROS
--   (esquina sup. izq. de la caja sin rotar) y ancho/alto en CM. Estas dos
--   mesas se guardaron el 12/02/2026 con pos en píxeles de escena (1 m = 50 px):
--   "9" en (239,26 ; 100,17) y "11" en (349,07 ; 135,79). El editor los lee
--   como 239 m y 349 m: se dibujan lejísimos de la sala de 19 × 13 m y el
--   dueño no puede verlas ni arrastrarlas. Siguen activas, así que cuentan en
--   el aforo y se pueden asignar a una reserva.
--   (Origen del bug, ya corregido en código: PlanoEspacio2D daba de alta las
--   mesas nuevas con pos_x/pos_y = 50, ver posicionMesaNueva.ts.)
--
-- QUÉ CAMBIA (estado previo verificado en producción el 03/10/2026, solo SELECT)
--   Salón (db8be4e2-…): 15 filas activas, ninguna inactiva. Solo estas dos
--   están fuera del plano de 19 × 13 m; las otras 13 ya están en metros.
--     mesa "9"  (3a98ace3-…, circular 150 cm, 6 plazas)
--        pos (239,26 ; 100,17)  ->  (4,79 ; 2,00)      = px / 50, a cm
--     mesa "11" (08e9ae3d-…, circular 150 cm, 6 plazas)
--        pos (349,07 ; 135,79)  ->  (6,98 ; 2,72)
--   Es la conversión literal px / 50 de la esquina sup. izq. (la hipótesis
--   «el centro» da casi lo mismo: (4,04 ; 1,25) y (6,23 ; 1,97)). No se ha
--   inventado ningún sitio.
--   No se tocan: capacidad, forma, tamaño, rotación, activa; ni "9 (revisar)"
--   ni las 7 fusiones del Salón; ni ningún otro espacio (en Comedor y Terraza
--   solo hay filas INACTIVAS con coordenadas en px, que no se dibujan).
--   Asignaciones: ninguna reserva (pasada o futura) apunta a "9" ni a "11".
--
-- DESPUÉS DE APLICAR (decisión del dueño, pendiente)
--   Las dos mesas pasan a verse en el editor, pero la conversión literal cae
--   en sitios que NO son una mesa real:
--     · "11" queda ENCIMA de la "18" (solape de 1,22 × 0,92 m).
--     · "9" queda FUERA de las paredes: ocupa x 4,79–6,29 e y 2,00–3,50 m, y
--       el bloque izquierdo del Salón empieza en la pared y = 4,06 m.
--   Hay que abrir Super Admin → Espacios → Salón → «Configurar Plano y
--   Mesas», arrastrar "9" y "11" a su sitio real, o desactivarlas / borrarlas
--   si son restos (en el Salón conviven fusiones como "11+10" con mesas
--   sueltas como la "10" y la "11"; ver 20260927100000_mesas_numero_fiable).
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261003100000_salon_mesas_en_metros.sql
--   2. npx supabase db query --linked -f supabase/tests/salon_mesas_en_metros_test.sql
--   3. Abrir el editor del Salón y colocar "9" y "11" (ver arriba).
--   Deshacer: supabase/rollbacks/20261003100000_salon_mesas_en_metros_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer;
  r record;
begin
  -- 0. El Salón es el que esperamos: 15 mesas, plano de 19 x 13 m.
  select count(*) into n from public.mesas where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'::uuid;
  if n <> 15 then
    raise exception 'El Salón tiene % mesas (esperaba 15). Revisar antes de aplicar.', n;
  end if;
  select count(*) into n from public.planos_espacio
   where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'::uuid and ancho_metros = 19 and alto_metros = 13;
  if n <> 1 then
    raise exception 'El plano del Salón ya no mide 19 x 13 m. Revisar antes de aplicar.';
  end if;

  -- 1. Las únicas mesas fuera del plano son exactamente "9" y "11", con las
  --    coordenadas en px verificadas. Si hay otra, o ya las movieron, no
  --    seguimos a ciegas.
  select count(*) into n
    from public.mesas m
    join public.planos_espacio p on p.espacio_id = m.espacio_id
   where m.espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'::uuid
     and (m.pos_x + m.ancho / 100 > p.ancho_metros or m.pos_y + m.alto / 100 > p.alto_metros
          or m.pos_x < 0 or m.pos_y < 0)
     and m.id not in ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7'::uuid, '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77'::uuid);
  if n <> 0 then
    raise exception 'Hay % mesas más del Salón fuera del plano, además de "9" y "11". Revisar antes de aplicar.', n;
  end if;

  select count(*) into n from public.mesas
   where (id = '3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7'::uuid and nombre = '9'
          and pos_x = 239.26 and pos_y = 100.17 and ancho = 150 and alto = 150 and coalesce(activa, true))
      or (id = '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77'::uuid and nombre = '11'
          and pos_x = 349.07 and pos_y = 135.79 and ancho = 150 and alto = 150 and coalesce(activa, true));
  if n <> 2 then
    raise exception 'Las mesas "9" y "11" del Salón ya no están como se verificó el 03/10/2026. Revisar antes de aplicar.';
  end if;

  -- 2. Conversión px -> m (1 m = 50 px) a centímetros. Mismas filas, mismos id.
  update public.mesas set
    pos_x = round(pos_x / 50, 2),
    pos_y = round(pos_y / 50, 2)
  where id in ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7'::uuid, '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77'::uuid);
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'mesas actualizadas: % (esperaba 2)', n;
  end if;

  -- 3. Resultado esperado y dentro del plano.
  for r in
    select nombre, pos_x, pos_y, ancho, alto from public.mesas
     where id in ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7'::uuid, '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77'::uuid)
  loop
    if not ((r.nombre = '9' and r.pos_x = 4.79 and r.pos_y = 2.00)
         or (r.nombre = '11' and r.pos_x = 6.98 and r.pos_y = 2.72)) then
      raise exception 'mesa % quedó en (%, %): no es la conversión esperada', r.nombre, r.pos_x, r.pos_y;
    end if;
  end loop;
end;
$$;

commit;
