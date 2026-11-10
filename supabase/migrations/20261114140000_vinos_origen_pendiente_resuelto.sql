-- Resuelve el origen de los vinos «… — ORIGEN PENDIENTE» (categoría, denominación, país, región).
-- Origen verificado en fichas/tiendas por un agente; ver notas. region NULL = se conserva la que ya tiene.
-- Solo toca filas que siguen en una categoría ORIGEN PENDIENTE. No cambia precios ni publica nada.
-- Sin resolver a propósito: «Brión Cepas Vellas» (la etiqueta no dice bodega ni origen).
begin;
update "Vinos" v set
  categoria = x.cat,
  denominacion_origen = x.den,
  ubicacion_pais = x.pais,
  ubicacion_region = coalesce(x.reg, v.ubicacion_region)
from (values
  -- Blancos
  ('ba574335', 'VINOS BLANCOS — IGP CASTILLA Y LEÓN', 'IGP Castilla y León', 'España', null),                 -- Abadía Retuerta Le Domaine
  ('9d21dc0b', 'VINOS BLANCOS — RUEDA', 'D.O. Rueda', 'España', 'Rueda, Valladolid'),                          -- El Perro Verde Selección Especial
  ('d0e8cab8', 'VINOS BLANCOS — PENEDÈS', 'D.O. Penedès', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Ermita d'Espiells Blanc Flor
  ('020cc178', 'VINOS BLANCOS — RIBEIRO', 'D.O. Ribeiro', 'España', null),                                     -- L'ombre
  ('8578e151', 'VINOS BLANCOS — ALICANTE', 'D.O. Alicante', 'España', null),                                   -- M de Alejandría
  ('40219f07', 'VINOS BLANCOS — MONTERREI', 'D.O. Monterrei', 'España', 'Verín, Ourense, Galicia'),           -- Muradella Alanda
  ('d387d56d', 'VINOS BLANCOS — MONTERREI', 'D.O. Monterrei', 'España', 'Verín, Ourense, Galicia'),           -- Muradella Gorvia
  ('f09fc7a2', 'VINOS BLANCOS — RIOJA', 'D.O.Ca. Rioja', 'España', 'San Vicente de la Sonsierra, La Rioja'),  -- Benjamín Romeo El Sauco (BLANCO según fichas)
  -- Espumosos
  ('0cf4c689', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', null),                                    -- Agustí Torelló Mata
  ('a8307832', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', null),                                    -- Torelló Mata Kripta
  ('05bc99d4', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', null),                                    -- Torelló
  ('2196712d', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', null),                                    -- Torelló Rosé
  ('b8102e68', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', null),                                    -- Torelló Rosé Magnum
  ('53d74758', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Gramona Brut Imperial
  ('4ecd5d61', 'VINOS ESPUMOSOS — CORPINNAT', 'Corpinnat', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Gramona Tres Lustros
  ('42b93d88', 'VINOS ESPUMOSOS — CAVA', 'D.O. Cava', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Gran Juvé
  ('a8e259b6', 'VINOS ESPUMOSOS — CAVA', 'D.O. Cava', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Juvé Milesimé
  ('89fd014b', 'VINOS ESPUMOSOS — CAVA', 'D.O. Cava', 'España', 'Sant Sadurní d''Anoia, Barcelona, Cataluña'), -- Juvé Reserva de la Familia
  ('12724d27', 'VINOS ESPUMOSOS — PROSECCO', 'DOC Prosecco', 'Italia', 'Véneto'),                              -- Donna Gloria
  ('14ac2968', 'VINOS ESPUMOSOS — IGP CASTILLA', 'IGP Castilla', 'España', null),                              -- Edoné Cuvée de María (según una sola tienda: sin D.O.)
  ('d6784096', 'VINOS ESPUMOSOS — IGP CASTILLA', 'IGP Castilla', 'España', null),                              -- Edoné Gran Cuvée Magnum
  ('ab41204d', 'VINOS ESPUMOSOS — IGP CASTILLA', 'IGP Castilla', 'España', null),                              -- Edoné Grand Cuvée
  -- Tintos
  ('38d76f0d', 'VINOS TINTOS — ABADÍA RETUERTA', 'D.O.P. Abadía Retuerta', 'España', null),                    -- Pago Garduña
  ('2749a417', 'VINOS TINTOS — ABADÍA RETUERTA', 'D.O.P. Abadía Retuerta', 'España', null),                    -- Pago Negralada
  ('83ae3d93', 'VINOS TINTOS — SIN D.O.', 'Sin D.O.', 'España', 'Laguardia, Álava'),                           -- Artadi San Lázaro
  ('7e02d098', 'VINOS TINTOS — SIN D.O.', 'Sin D.O.', 'España', null),                                         -- Artadi Viñas de Gaín
  ('3d4b2c14', 'VINOS TINTOS — MARGAUX', 'AOC Margaux', 'Francia', 'Margaux, Gironde'),                        -- Château Giscours
  ('d18df3cc', 'VINOS TINTOS — IGP CASTILLA Y LEÓN', 'IGP Castilla y León', 'España', 'Navarrevisca, Ávila'),  -- Comando G Rumbo al Norte
  ('e42cea58', 'VINOS TINTOS — JUMILLA', 'D.O. Jumilla', 'España', null),                                      -- Juan Gil Nácar
  ('6658d43a', 'VINOS TINTOS — COTEAUX CHAMPENOIS', 'AOC Coteaux Champenois', 'Francia', 'Bouzy, Marne')      -- P. Louis Martin Bouzy Rouge
) as x(pref, cat, den, pais, reg)
where v.id like x.pref || '%' and v.categoria ilike '%ORIGEN PENDIENTE%';
commit;
