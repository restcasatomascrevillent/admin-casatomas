UPDATE "BebidasVENTA" 
SET precio_eur = ROUND((precio_eur * 0.8)::numeric, 2)::double precision
WHERE precio_eur IS NOT NULL;