-- Update precio_coste to be 20% cheaper than precio_eur for existing products
UPDATE "BebidasVENTA" 
SET precio_coste = (precio_eur * 0.80)::numeric(10,2) 
WHERE precio_eur IS NOT NULL AND precio_coste IS NULL;

UPDATE "ComidaVENTA" 
SET precio_coste = (precio_eur * 0.80)::numeric(10,2) 
WHERE precio_eur IS NOT NULL AND precio_coste IS NULL;