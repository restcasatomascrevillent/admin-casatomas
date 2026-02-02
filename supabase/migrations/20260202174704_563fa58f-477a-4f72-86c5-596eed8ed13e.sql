INSERT INTO "BebidasVENTA" (
  id, nombre, categoria, precio_eur, descripcion, imagen_url, 
  stock, activado, featured, orden,
  denominacion_origen, ubicacion_pais, ubicacion_region,
  nombre_en, nombre_fr, descripcion_en, descripcion_fr, categoria_en, categoria_fr
)
SELECT 
  id, nombre, categoria, precio_eur, descripcion, imagen_url,
  0 as stock, activado, featured, CAST(NULLIF(orden, '') AS INTEGER),
  denominacion_origen, ubicacion_pais, ubicacion_region,
  nombre_en, nombre_fr, NULL as descripcion_en, NULL as descripcion_fr, categoria_en, categoria_fr
FROM "Vinos"
ON CONFLICT (id) DO NOTHING;