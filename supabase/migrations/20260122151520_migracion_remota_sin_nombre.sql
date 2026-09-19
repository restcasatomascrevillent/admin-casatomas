-- Reconstruida desde supabase_migrations.schema_migrations (version 20260122151520).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Fase 1: Eliminar duplicados en Vinos (mantener el primero por nombre y categoría)
DELETE FROM "Vinos" a USING "Vinos" b
WHERE a.ctid > b.ctid 
  AND a.nombre = b.nombre 
  AND a.categoria = b.categoria;

-- Fase 2: Añadir columnas a Vinos
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS touza boolean DEFAULT true;
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS restaurante boolean DEFAULT true;
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;

-- Fase 3: Insertar Cavas faltantes
INSERT INTO "Vinos" (id, nombre, precio_eur, categoria, touza, restaurante, featured, activado)
VALUES
  (gen_random_uuid()::text, 'Crémant de Chanceny Brut Rosé', 27.00, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true),
  (gen_random_uuid()::text, 'Edoné Cuvée de María', 18.50, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true),
  (gen_random_uuid()::text, 'Edoné Grand Cuvée', 25.00, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true),
  (gen_random_uuid()::text, 'Torelló', 26.50, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true),
  (gen_random_uuid()::text, 'Torelló Rosé', 27.50, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true),
  (gen_random_uuid()::text, 'Torelló Rosé Magnum', 61.60, 'CAVAS Y OTROS ESPUMOSOS', true, true, false, true)
ON CONFLICT DO NOTHING;

-- Fase 4: Marcar productos featured en Vinos
UPDATE "Vinos" SET featured = true
WHERE categoria = 'CHAMPAGNES' 
  AND (
    nombre ILIKE '%Cristal%' OR
    nombre ILIKE '%Dom Pérignon%' OR
    nombre ILIKE '%Alexandra%' OR
    nombre ILIKE '%Gran Siècle%' OR
    nombre ILIKE '%Krug%'
  );

UPDATE "Vinos" SET featured = true
WHERE categoria = 'CAVAS Y OTROS ESPUMOSOS' 
  AND (
    nombre ILIKE '%Kripta%' OR
    nombre ILIKE '%Gran Juvé%'
  );

-- Fase 5: Añadir columnas a Bebidas
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS touza boolean DEFAULT true;
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS restaurante boolean DEFAULT true;
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS tag text;

-- Fase 6: Insertar Cervezas (evitando duplicados)
INSERT INTO "Bebidas" (id, nombre, precio_eur, categoria, tag, touza, restaurante, activado, orden)
VALUES
  (gen_random_uuid()::text, 'Heineken', 3.00, 'Cervezas', NULL, true, true, true, 1),
  (gen_random_uuid()::text, 'Heineken 0.0', 3.00, 'Cervezas', 'Sin Alcohol', true, true, true, 2),
  (gen_random_uuid()::text, 'Amstel Oro 0.0', 3.00, 'Cervezas', 'Sin Alcohol', true, true, true, 3),
  (gen_random_uuid()::text, 'Desperados', 3.50, 'Cervezas', NULL, true, true, true, 4),
  (gen_random_uuid()::text, 'Sol', 3.50, 'Cervezas', NULL, true, true, true, 5),
  (gen_random_uuid()::text, 'Rubia 18/70', 3.50, 'Cervezas', NULL, true, true, true, 6),
  (gen_random_uuid()::text, 'Cruz Campo Sin Gluten', 3.00, 'Cervezas', 'Sin Gluten', true, true, true, 7),
  (gen_random_uuid()::text, 'Cruz Campo Gran Reserva', 3.50, 'Cervezas', NULL, true, true, true, 8),
  (gen_random_uuid()::text, 'Radler', 3.00, 'Cervezas', NULL, true, true, true, 9),
  (gen_random_uuid()::text, 'Mort Subite', 3.00, 'Cervezas', NULL, true, true, true, 10),
  (gen_random_uuid()::text, 'Águila Dorada', 3.00, 'Cervezas', NULL, true, true, true, 11),
  (gen_random_uuid()::text, 'Judas', 4.00, 'Cervezas', 'Especial', true, true, true, 12),
  (gen_random_uuid()::text, 'Ladrón de Manzanas', 3.00, 'Cervezas', 'Sidra', true, true, true, 13),
  (gen_random_uuid()::text, 'Águila Sin Filtrar', 3.50, 'Cervezas', NULL, true, true, true, 14),
  (gen_random_uuid()::text, 'Alcázar', 4.00, 'Cervezas', NULL, true, true, true, 15),
  (gen_random_uuid()::text, 'Paulaner', 4.50, 'Cervezas', 'Premium', true, true, true, 16)
ON CONFLICT DO NOTHING;

-- Fase 7: Insertar Copas de Vino
INSERT INTO "Bebidas" (id, nombre, precio_eur, categoria, tipo, touza, restaurante, activado, orden)
VALUES
  (gen_random_uuid()::text, 'Copa Ribera del Duero Aster Crianza', 4.50, 'Copas', 'Tinto', true, true, true, 1),
  (gen_random_uuid()::text, 'Copa Rosado Marqués de Riscal XR', 4.50, 'Copas', 'Rosado', true, true, true, 2),
  (gen_random_uuid()::text, 'Copa Verdejo', 4.50, 'Copas', 'Blanco', true, true, true, 3),
  (gen_random_uuid()::text, 'Copa Cava Edone', 5.00, 'Copas', 'Cava', true, true, true, 4),
  (gen_random_uuid()::text, 'Copa Champagne Laurent-Perrier', 13.50, 'Copas', 'Champagne', true, true, true, 5),
  (gen_random_uuid()::text, 'Copa Cava Juvé & Camps', 5.00, 'Copas', 'Cava', true, true, true, 6),
  (gen_random_uuid()::text, 'Copa Cava Rosado', 5.00, 'Copas', 'Cava', true, true, true, 7),
  (gen_random_uuid()::text, 'Copa Vino Dulce Oremus Tokaji', 12.00, 'Copas', 'Dulce', true, true, true, 8),
  (gen_random_uuid()::text, 'Copa Champagne Laurent-Perrier Rosé', 25.00, 'Copas', 'Champagne', true, true, true, 9),
  (gen_random_uuid()::text, 'Copa Champagne Laurent-Perrier Millésime', 28.00, 'Copas', 'Champagne', true, true, true, 10),
  (gen_random_uuid()::text, 'Copa Champagne Laurent-Perrier Ultra Brut', 25.00, 'Copas', 'Champagne', true, true, true, 11)
ON CONFLICT DO NOTHING;

-- Fase 8: Insertar Whiskies
INSERT INTO "Bebidas" (id, nombre, precio_eur, categoria, tipo, featured, touza, restaurante, activado, orden)
VALUES
  (gen_random_uuid()::text, 'Johnnie Walker Red Label', 7.00, 'Whiskies', 'Blend', false, true, true, true, 1),
  (gen_random_uuid()::text, 'Johnnie Walker Black Label', 9.00, 'Whiskies', 'Blend 12 años', false, true, true, true, 2),
  (gen_random_uuid()::text, 'Johnnie Walker Green Label', 12.00, 'Whiskies', 'Blended Malt 15 años', false, true, true, true, 3),
  (gen_random_uuid()::text, 'Johnnie Walker Blue Label', 40.00, 'Whiskies', 'Premium Blend', true, true, true, true, 4),
  (gen_random_uuid()::text, 'Jack Daniel''s Rye', 8.00, 'Whiskies', 'Tennessee Rye', false, true, true, true, 5),
  (gen_random_uuid()::text, 'Jack Daniel''s Gentleman Jack', 9.00, 'Whiskies', 'Tennessee Whiskey', false, true, true, true, 6),
  (gen_random_uuid()::text, 'Jack Daniel''s Single Barrel Select', 11.00, 'Whiskies', 'Single Barrel', false, true, true, true, 7),
  (gen_random_uuid()::text, 'Glenrothes 12', 10.00, 'Whiskies', 'Single Malt, Speyside', false, true, true, true, 8),
  (gen_random_uuid()::text, 'Glenfarclas Family Malt', 8.00, 'Whiskies', 'Single Malt, Speyside', false, true, true, true, 9),
  (gen_random_uuid()::text, 'Dewar''s 12 Double Aged', 10.00, 'Whiskies', 'Blend', false, true, true, true, 10),
  (gen_random_uuid()::text, 'Monkey Shoulder', 8.00, 'Whiskies', 'Blend, Speyside', false, true, true, true, 11),
  (gen_random_uuid()::text, 'The Kurayoshi Pure Malt 12 años', 15.00, 'Whiskies', 'Japanese Whisky', true, true, true, true, 12),
  (gen_random_uuid()::text, 'Lagavulin 8', 10.00, 'Whiskies', 'Single Malt, Islay', false, true, true, true, 13),
  (gen_random_uuid()::text, 'Aberfeldy 12 años', 9.00, 'Whiskies', 'Single Malt, Highlands', false, true, true, true, 14),
  (gen_random_uuid()::text, 'Ballantine''s', 7.00, 'Whiskies', 'Blend', false, true, true, true, 15),
  (gen_random_uuid()::text, 'Ballantine''s 10', 8.00, 'Whiskies', 'Blend 10 años', false, true, true, true, 16),
  (gen_random_uuid()::text, 'Ballantine''s Light', 7.00, 'Whiskies', 'Blend Light', false, true, true, true, 17),
  (gen_random_uuid()::text, 'Chivas Regal 18', 15.00, 'Whiskies', 'Blend Premium', true, true, true, true, 18)
ON CONFLICT DO NOTHING;
