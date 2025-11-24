-- Insertar configuración inicial de Casa Tomás para Google Places
INSERT INTO public.config_google_places (
  place_id,
  place_name,
  direccion,
  telefono,
  website,
  rating_promedio,
  total_resenas
) VALUES (
  'ChIJ_casa_tomas_crevillente_id',
  'Casa Tomás Restaurante',
  'Calle Ejemplo 123, Crevillente, Alicante',
  '+34 966 123 456',
  'https://www.casatomas-crevillente.com',
  4.8,
  0
)
ON CONFLICT (id) DO NOTHING;