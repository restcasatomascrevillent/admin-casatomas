-- Reconstruida desde supabase_migrations.schema_migrations (version 20260121150658).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Añadir columna base para filtrar por tipo de licor
ALTER TABLE "Cocteles" 
ADD COLUMN IF NOT EXISTS base text;

COMMENT ON COLUMN "Cocteles".base IS 'Base del cóctel: ginebra, vodka, ron, tequila, aperol, sin-alcohol';

-- Insertar los 13 cócteles
INSERT INTO "Cocteles" (id, nombre, descripcion, precio_eur, imagen_url, categoria, base, ingredientes, activado, orden) VALUES
-- Cócteles de Autor
('green-dream', 'Green Dream', 'Un sueño verde refrescante que combina la frescura del kiwi con notas de manzana verde.', 9.00, 'https://images.unsplash.com/photo-1536935338788-846bb9981813?w=500&h=600&fit=crop', 'autor', 'ginebra', 'Puré de kiwi, Lima, Sirope de manzana verde, Ginebra', true, 1),
('beso-escarlata', 'Beso Escarlata', 'Un beso de frutos rojos con la elegancia del licor de flor de saúco.', 9.00, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500&h=600&fit=crop', 'autor', 'ginebra', 'Ginebra, Zumo de lima, Licor de flor de saúco, Fresa, Frambuesa', true, 2),
('furia-frutal', 'Furia Frutal', 'Una explosión tropical de sabores intensos con un toque de almendra amarga.', 10.00, 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&h=600&fit=crop', 'autor', 'ron', 'Ron especiado, Licor Chartreuse, Mango, Fruta de la pasión, Lima, Sirope de almendra amarga', true, 3),
('spicy-mango-margarita', 'Spicy Mango Margarita', 'El clásico mexicano reinventado con mango picante y borde de Tajín.', 9.00, 'https://images.unsplash.com/photo-1556855810-ac404aa91e85?w=500&h=600&fit=crop', 'autor', 'tequila', 'Tequila, Zumo de lima, Triple seco, Mango picante, Borde de Tajín', true, 4),
-- Cócteles Clásicos
('pornstar-martini', 'Pornstar Martini', 'El sensual clásico moderno con fruta de la pasión y su chupito de cava.', 10.00, 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=500&h=600&fit=crop', 'clasicos', 'vodka', 'Vodka, Vainilla, Lima, Licor de fruta de la pasión, Chupito de cava', true, 5),
('clover-club', 'Clover Club', 'Elegante cóctel pre-prohibición con frambuesa fresca y espuma sedosa.', 8.50, 'https://images.unsplash.com/photo-1527761939622-9119094290d4?w=500&h=600&fit=crop', 'clasicos', 'ginebra', 'Ginebra, Limón, Frambuesa', true, 6),
('pina-colada', 'Piña Colada', 'El clásico tropical cremoso con coco natural y piña fresca.', 8.50, 'https://images.unsplash.com/photo-1587223962930-cb7f31384c19?w=500&h=600&fit=crop', 'clasicos', 'ron', 'Ron blanco, Zumo de piña, Puré de coco', true, 7),
('aperol-spritz', 'Aperol Spritz', 'El aperitivo italiano por excelencia, refrescante y vibrante.', 8.50, 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=500&h=600&fit=crop', 'clasicos', 'aperol', 'Aperol, Vino espumoso, Soda', true, 8),
('mojito', 'Mojito', 'El inmortal cubano con hierbabuena fresca machacada a mano.', 8.50, 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=500&h=600&fit=crop', 'clasicos', 'ron', 'Ron, Lima, Sirope de caña, Hierbabuena', true, 9),
('moscow-mule', 'Moscow Mule', 'Refrescante y especiado, servido en su icónica taza de cobre.', 8.50, 'https://images.unsplash.com/photo-1546171753-97d7676e4602?w=500&h=600&fit=crop', 'clasicos', 'vodka', 'Vodka, Ginger beer, Lima', true, 10),
-- Mocktails (Sin Alcohol)
('colada-virgen', 'Colada Virgen', 'Toda la cremosidad tropical sin alcohol.', 7.00, 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=500&h=600&fit=crop', 'sin-alcohol', 'sin-alcohol', 'Coco, Puré de piña, Zumo de piña', true, 11),
('ipanema', 'Ipanema', 'La versión brasileña sin alcohol del mojito, refrescante y tropical.', 7.00, 'https://images.unsplash.com/photo-1497534446932-c925b458314e?w=500&h=600&fit=crop', 'sin-alcohol', 'sin-alcohol', 'Zumo de lima, Piña natural, Ginger beer', true, 12),
('mojito-virgen', 'Mojito Virgen', 'Toda la frescura del mojito con variantes de sabor: frambuesa, fruta de la pasión o jabuticaba.', 7.00, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&h=600&fit=crop', 'sin-alcohol', 'sin-alcohol', 'Lima, Frambuesa / Fruta de la pasión / Jabuticaba, Hierbabuena, Soda', true, 13)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  precio_eur = EXCLUDED.precio_eur,
  imagen_url = EXCLUDED.imagen_url,
  categoria = EXCLUDED.categoria,
  base = EXCLUDED.base,
  ingredientes = EXCLUDED.ingredientes,
  activado = EXCLUDED.activado,
  orden = EXCLUDED.orden;
