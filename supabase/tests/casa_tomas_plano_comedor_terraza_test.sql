set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas SQL de 20261002100000_casa_tomas_plano_comedor_terraza.sql
-- ---------------------------------------------------------------------------
-- SQL plano: cada comprobación es un ASSERT dentro de un DO. Todo va dentro
-- de BEGIN … ROLLBACK (solo lee). DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/casa_tomas_plano_comedor_terraza_test.sql
-- Si termina sin ERROR, todo ha pasado.
-- ===========================================================================

begin;

do $$
declare
  r record;
  n integer;
begin
  -- A0. La migración está aplicada (mesa 1 del Comedor con 2 plazas en metros).
  select count(*) into n from public.mesas
   where espacio_id = '449cffc7-1189-4f3c-a0b3-b60b3442979d' and nombre = '1' and capacidad = 2 and pos_x < 20
     and coalesce(activa, true);
  assert n = 1, 'A0: la migración no parece aplicada';

  -- A1. Recuento y plazas por espacio (activas, no fusionadas).
  select count(*), sum(capacidad) into r from public.mesas
   where espacio_id = '449cffc7-1189-4f3c-a0b3-b60b3442979d' and coalesce(activa, true) and not coalesce(is_merged, false);
  assert r.count = 11 and r.sum = 42, format('A1 Comedor: %s mesas / %s plazas', r.count, r.sum);
  select count(*), sum(capacidad) into r from public.mesas
   where espacio_id = '5888d22a-f228-41f5-8a9d-c8b3ee255863' and coalesce(activa, true) and not coalesce(is_merged, false);
  assert r.count = 18 and r.sum = 74, format('A1 Terraza: %s mesas / %s plazas', r.count, r.sum);

  -- A2. Toda mesa activa cabe dentro de su plano (pos en m, tamaño en cm).
  for r in
    select m.nombre, e.nombre as espacio, m.pos_x, m.pos_y, m.ancho, m.alto, p.ancho_metros, p.alto_metros
      from public.mesas m
      join public.planos_espacio p on p.espacio_id = m.espacio_id
      join public.espacios_reserva e on e.id = m.espacio_id
     where m.espacio_id in ('449cffc7-1189-4f3c-a0b3-b60b3442979d', '5888d22a-f228-41f5-8a9d-c8b3ee255863') and coalesce(m.activa, true)
  loop
    assert r.pos_x >= 0 and r.pos_y >= 0
       and r.pos_x + r.ancho / 100 <= r.ancho_metros
       and r.pos_y + r.alto / 100 <= r.alto_metros,
       format('A2: mesa %s de %s fuera del plano (%s, %s)', r.nombre, r.espacio, r.pos_x, r.pos_y);
  end loop;

  -- A3. Ninguna pareja de mesas activas se solapa.
  select count(*) into n
    from public.mesas a join public.mesas b
      on a.espacio_id = b.espacio_id and a.id < b.id
   where a.espacio_id in ('449cffc7-1189-4f3c-a0b3-b60b3442979d', '5888d22a-f228-41f5-8a9d-c8b3ee255863')
     and coalesce(a.activa, true) and coalesce(b.activa, true)
     and a.pos_x < b.pos_x + b.ancho / 100 and b.pos_x < a.pos_x + a.ancho / 100
     and a.pos_y < b.pos_y + b.alto / 100 and b.pos_y < a.pos_y + a.alto / 100;
  assert n = 0, format('A3: %s solapes', n);

  -- A4. Paredes dentro del lienzo (px de escena = m × 50) y dimensiones coherentes.
  for r in
    select e.nombre as espacio, p.ancho, p.alto, p.ancho_metros, p.alto_metros, p.pixels_per_meter, el
      from public.planos_espacio p
      join public.espacios_reserva e on e.id = p.espacio_id
      cross join lateral jsonb_array_elements(p.configuracion->'elementos') el
     where p.espacio_id in ('449cffc7-1189-4f3c-a0b3-b60b3442979d', '5888d22a-f228-41f5-8a9d-c8b3ee255863')
  loop
    assert r.pixels_per_meter = 50 and r.ancho = r.ancho_metros * 50 and r.alto = r.alto_metros * 50,
      format('A4: dimensiones incoherentes en %s', r.espacio);
    if r.el->>'tipo' = 'wall' then
      assert least((r.el->'props'->>'x1')::numeric, (r.el->'props'->>'x2')::numeric) >= 0
         and greatest((r.el->'props'->>'x1')::numeric, (r.el->'props'->>'x2')::numeric) <= r.ancho
         and least((r.el->'props'->>'y1')::numeric, (r.el->'props'->>'y2')::numeric) >= 0
         and greatest((r.el->'props'->>'y1')::numeric, (r.el->'props'->>'y2')::numeric) <= r.alto,
        format('A4: pared fuera del lienzo en %s: %s', r.espacio, r.el);
    end if;
  end loop;

  -- A5. Ninguna mesa activa de estos dos espacios conserva coordenadas en px.
  select count(*) into n from public.mesas m join public.planos_espacio p on p.espacio_id = m.espacio_id
   where m.espacio_id in ('449cffc7-1189-4f3c-a0b3-b60b3442979d', '5888d22a-f228-41f5-8a9d-c8b3ee255863') and coalesce(m.activa, true)
     and (m.pos_x > p.ancho_metros or m.pos_y > p.alto_metros);
  assert n = 0, 'A5: quedan mesas con coordenadas en px';
end;
$$;

select 'casa_tomas_plano_comedor_terraza: todas las comprobaciones han pasado' as resultado;

rollback;
