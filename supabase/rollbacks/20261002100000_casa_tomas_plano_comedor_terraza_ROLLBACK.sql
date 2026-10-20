set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261002100000_casa_tomas_plano_comedor_terraza.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261002100000_casa_tomas_plano_comedor_terraza_ROLLBACK.sql
--
-- Devuelve las 29 mesas (por id) y los dos planos al estado previo, copiado
-- de producción el 02/10/2026. OJO: ese estado es el ROTO (pos_x en px que el
-- editor lee como metros: mesas fuera del plano). Cualquier retoque hecho en
-- el editor después de aplicar la migración se pierde.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

update public.mesas m set
  capacidad = v.capacidad, forma = v.forma, ancho = v.ancho, alto = v.alto,
  pos_x = v.pos_x, pos_y = v.pos_y, rotacion = v.rotacion
from (values
    ('002a7791-79d7-4c84-b094-21eb00a483da'::uuid, 4, 'rectangular', 65, 65, 190, 300, 0),
    ('56ecc4d1-7321-47fa-a513-3cec7bf2888e'::uuid, 4, 'rectangular', 80, 80, 40, 110, 0),
    ('1da33226-0abd-461e-b2a1-586ddb0f11eb'::uuid, 4, 'rectangular', 65, 65, 320, 20, 0),
    ('bf592cfe-6634-4090-b9a9-83a7fe3b6254'::uuid, 4, 'rectangular', 80, 80, 410, 290, 0),
    ('cda9eb0b-edf8-40b3-9af1-2e54782afe46'::uuid, 4, 'rectangular', 80, 80, 490, 290, 0),
    ('034e250e-7045-4c9a-8bb0-db7704fb49f0'::uuid, 4, 'rectangular', 65, 65, 450, 300, 0),
    ('6e35ebf9-93c3-4e56-b557-f24a8f9ab9bf'::uuid, 4, 'rectangular', 65, 65, 450, 230, 0),
    ('587e80e3-6921-479e-a93e-a6af691a2a69'::uuid, 4, 'rectangular', 65, 65, 450, 160, 0),
    ('fbf637d9-647a-43fd-9c50-c00839fe1841'::uuid, 4, 'rectangular', 65, 65, 450, 90, 0),
    ('117a7c23-816f-4d77-a581-01e7acec99f1'::uuid, 4, 'rectangular', 65, 65, 450, 20, 0),
    ('5a6f54f5-e841-4605-bcd4-99a4e3dc9c82'::uuid, 4, 'rectangular', 65, 65, 60, 90, 0),
    ('b7b4fb6c-b48f-4623-9245-4eb2f5fb8c15'::uuid, 4, 'rectangular', 65, 65, 60, 20, 0),
    ('5892b305-e630-4fac-88f2-ad77421742d6'::uuid, 6, 'circular', 80, 80, 55, 280, 0),
    ('11bc861c-8241-492a-ad1c-ab85fb22b123'::uuid, 4, 'rectangular', 65, 65, 190, 230, 0),
    ('bc7621b5-eef1-40d6-abd3-7ae43103f8d2'::uuid, 4, 'rectangular', 80, 80, 150, 20, 0),
    ('e04e043b-95fd-48aa-aad8-e242d780ed41'::uuid, 4, 'rectangular', 65, 65, 190, 160, 0),
    ('5790b07c-de6c-4c0f-b050-da08f0b654bb'::uuid, 4, 'rectangular', 80, 80, 430, 20, 0),
    ('d67d9741-ca19-4566-ac54-6cc50a9c4afa'::uuid, 4, 'rectangular', 80, 80, 510, 20, 0),
    ('27f365a1-3606-432a-ae31-b94e565c9729'::uuid, 4, 'rectangular', 65, 65, 190, 90, 0),
    ('9f0c66cf-6670-4911-9c6a-f647471ad0f2'::uuid, 4, 'rectangular', 65, 65, 190, 20, 0),
    ('aeae13e3-83e9-4bf5-8019-faf8c42c7536'::uuid, 4, 'rectangular', 80, 80, 430, 100, 0),
    ('1704f19c-b651-4870-b029-39fd8e34fe23'::uuid, 4, 'rectangular', 65, 65, 320, 300, 0),
    ('407215e0-4ead-4461-84de-3713d8f04a05'::uuid, 4, 'rectangular', 80, 80, 330, 200, 0),
    ('f84a540f-66bc-45f7-b7de-8689a0f6eec1'::uuid, 4, 'rectangular', 65, 65, 320, 230, 0),
    ('f9a0a277-2d71-4cd8-892a-77a6891ed50e'::uuid, 4, 'rectangular', 80, 80, 410, 200, 0),
    ('c1994bbd-953f-40a8-81ba-2a5d85f5f1fa'::uuid, 4, 'rectangular', 65, 65, 320, 160, 0),
    ('338614d9-4c65-486b-b457-3c013aa9c60a'::uuid, 4, 'rectangular', 80, 80, 490, 200, 0),
    ('24b5bbdc-b360-4ffb-b7f6-11b68536a73f'::uuid, 4, 'rectangular', 80, 80, 330, 290, 0),
    ('acf585b5-82d5-40f8-a8d9-74d09aacd62b'::uuid, 4, 'rectangular', 65, 65, 320, 90, 0)
) as v(id, capacidad, forma, ancho, alto, pos_x, pos_y, rotacion)
where m.id = v.id;

update public.planos_espacio set
  ancho = 600, alto = 400, ancho_metros = 12, alto_metros = 8,
  pixels_per_meter = 50, metros_cuadrados = 96,
  configuracion = '{"elementos":[{"id":"wall-1765994953755-0","props":{"x1":94,"x2":94,"y1":192,"y2":341},"tipo":"wall"},{"id":"wall-1765994953756-1","props":{"x1":94,"x2":546,"y1":341,"y2":341},"tipo":"wall"},{"id":"wall-1765994953756-2","props":{"x1":546,"x2":546,"y1":341,"y2":15},"tipo":"wall"},{"id":"wall-1765994953757-3","props":{"x1":546,"x2":93,"y1":15,"y2":190},"tipo":"wall"}],"realDimensions":{"height":8,"width":12}}'::jsonb
where espacio_id = '449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid;

update public.planos_espacio set
  ancho = 600, alto = 400, ancho_metros = 12, alto_metros = 8,
  pixels_per_meter = 50, metros_cuadrados = 96,
  configuracion = '{"elementos":[{"id":"wall-1767856763418-0","props":{"x1":999.2619443785127,"x2":999.2619443785127,"y1":749.7336257156717,"y2":100.60405469255424},"tipo":"wall"},{"id":"wall-1767856763418-1","props":{"x1":999.2619443785127,"x2":499.4495535761504,"y1":100.60405469255424,"y2":100.60405469255424},"tipo":"wall"},{"id":"wall-1767856763419-2","props":{"x1":499.4495535761504,"x2":499.4495535761504,"y1":100.60405469255424,"y2":201.40596933603703},"tipo":"wall"},{"id":"wall-1767856763419-3","props":{"x1":499.4495535761504,"x2":462.94151807406473,"y1":201.40596933603703,"y2":256.1518367717216},"tipo":"wall"},{"id":"wall-1767856763419-4","props":{"x1":462.94151807406473,"x2":462.94151807406473,"y1":256.1518367717216,"y2":751.471589761249},"tipo":"wall"},{"id":"wall-1767856763419-5","props":{"x1":462.94151807406473,"x2":994.9157496758834,"y1":751.471589761249,"y2":751.471589761249},"tipo":"wall"}],"realDimensions":{"height":8,"width":12}}'::jsonb
where espacio_id = '5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid;

commit;
