-- Añadir stock de prueba a 20 bebidas para probar el TPV
UPDATE "BebidasVENTA" 
SET stock = 10, updated_at = now()
WHERE activado = true 
AND id IN (
  SELECT id FROM "BebidasVENTA" 
  WHERE activado = true 
  ORDER BY orden NULLS LAST, nombre
  LIMIT 20
);