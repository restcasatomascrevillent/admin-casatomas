-- Drop unique constraints on fecha (both tables)
ALTER TABLE public.menus_diarios DROP CONSTRAINT menus_diarios_fecha_key;
ALTER TABLE public.tapas DROP CONSTRAINT tapas_fecha_key;

-- Add idiom column to tapas
ALTER TABLE public.tapas ADD COLUMN IF NOT EXISTS idiom TEXT DEFAULT 'es';

-- Add composite unique constraints (fecha + idiom)
ALTER TABLE public.menus_diarios ADD CONSTRAINT menus_diarios_fecha_idiom_key UNIQUE (fecha, idiom);
ALTER TABLE public.tapas ADD CONSTRAINT tapas_fecha_idiom_key UNIQUE (fecha, idiom);

-- Insert en/fr for menus_diarios
INSERT INTO public.menus_diarios (fecha, idiom, menu) VALUES
('2026-03-12', 'en', '{"primero": "Parmesan salad", "segundo": "Roasted pork knuckle with potatoes", "postre": "Cheesecake"}'),
('2026-03-12', 'fr', '{"primero": "Salade au parmesan", "segundo": "Jarret de porc rôti avec pommes de terre", "postre": "Gâteau au fromage"}');

-- Insert en/fr for tapas
INSERT INTO public.tapas (fecha, idiom, tapas) VALUES
('2026-03-12', 'en', '["Russian salad", "Beef croquette", "Parmentier with braised beef cheeks", "Waffle"]'),
('2026-03-12', 'fr', '["Salade russe", "Croquette de bœuf", "Parmentier avec joue de bœuf braisée", "Gaufre"]');