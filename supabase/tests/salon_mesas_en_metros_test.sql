set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas SQL de 20261003100000_salon_mesas_en_metros.sql
-- ---------------------------------------------------------------------------
-- SQL plano: cada comprobación es un ASSERT dentro de un DO. Todo va dentro
-- de BEGIN … ROLLBACK (solo lee). DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/salon_mesas_en_metros_test.sql
-- Si termina sin ERROR, todo ha pasado.
-- ===========================================================================

begin;

do $$
declare
  r record;
  n integer;
begin
  -- A0. La migración está aplicada: "9" y "11" ya no tienen coordenadas en px.
  select count(*) into n from public.mesas
   where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
     and ((id = '3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7' and nombre = '9' and pos_x = 4.79 and pos_y = 2.00)
       or (id = '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77' and nombre = '11' and pos_x = 6.98 and pos_y = 2.72));
  assert n = 2, 'A0: la migración no parece aplicada (o las mesas se han movido ya en el editor)';

  -- A1. Mismas filas: el Salón sigue con 15 mesas, todas activas, y "9" y "11"
  --     conservan forma, tamaño, plazas y rotación.
  select count(*) into n from public.mesas where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc';
  assert n = 15, format('A1: el Salón tiene %s mesas (esperaba 15)', n);
  select count(*) into n from public.mesas
   where id in ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7', '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77')
     and forma = 'circular' and ancho = 150 and alto = 150 and capacidad = 6 and rotacion = 0
     and coalesce(activa, true) and not coalesce(is_merged, false);
  assert n = 2, 'A1: "9" o "11" han cambiado de forma/tamaño/plazas/estado';

  -- A2. Toda mesa del Salón cabe dentro del plano (pos en m, tamaño en cm).
  for r in
    select m.nombre, m.pos_x, m.pos_y, m.ancho, m.alto, p.ancho_metros, p.alto_metros
      from public.mesas m join public.planos_espacio p on p.espacio_id = m.espacio_id
     where m.espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
  loop
    assert r.pos_x >= 0 and r.pos_y >= 0
       and r.pos_x + r.ancho / 100 <= r.ancho_metros
       and r.pos_y + r.alto / 100 <= r.alto_metros,
       format('A2: mesa %s del Salón fuera del plano (%s, %s)', r.nombre, r.pos_x, r.pos_y);
  end loop;

  -- A3. Ninguna mesa del Salón conserva coordenadas en px.
  select count(*) into n from public.mesas m join public.planos_espacio p on p.espacio_id = m.espacio_id
   where m.espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
     and (m.pos_x > p.ancho_metros or m.pos_y > p.alto_metros);
  assert n = 0, 'A3: quedan mesas del Salón con coordenadas en px';

  -- A4. Solapes: tras la conversión literal el ÚNICO solape esperado es
  --     "11" encima de "18" (decisión pendiente del dueño, ver la cabecera de
  --     la migración). Si el dueño ya recolocó las mesas, este assert pasa
  --     igual con 0 solapes; si aparece otro par, falla.
  select count(*) into n
    from public.mesas a join public.mesas b on a.espacio_id = b.espacio_id and a.id < b.id
   where a.espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
     and coalesce(a.activa, true) and coalesce(b.activa, true)
     and a.pos_x < b.pos_x + b.ancho / 100 and b.pos_x < a.pos_x + a.ancho / 100
     and a.pos_y < b.pos_y + b.alto / 100 and b.pos_y < a.pos_y + a.alto / 100
     and not (a.nombre in ('11', '18') and b.nombre in ('11', '18'));
  assert n = 0, format('A4: %s solapes inesperados en el Salón', n);

  -- A5. No se ha tocado nada fuera del Salón: Comedor/Terraza siguen con sus
  --     filas inactivas en px (no se dibujan; no son objeto de esta migración).
  select count(*) into n from public.mesas
   where espacio_id <> 'db8be4e2-2e67-4110-99b1-9e1d779514cc' and coalesce(activa, true)
     and (pos_x > 30 or pos_y > 30);
  assert n = 0, 'A5: hay mesas activas de otros espacios con coordenadas en px';
end;
$$;

rollback;
