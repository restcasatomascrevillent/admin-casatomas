-- Actualizar categorías para que coincidan con el desplegable
UPDATE "BebidasVENTA" 
SET categoria = 'Vinos Tintos'
WHERE categoria ILIKE 'VINOS TINTOS%';

UPDATE "BebidasVENTA" 
SET categoria = 'Vinos Blancos'
WHERE categoria ILIKE 'VINOS BLANCOS%';

UPDATE "BebidasVENTA" 
SET categoria = 'Vinos Rosados'
WHERE categoria ILIKE 'VINOS ROSADOS%';

UPDATE "BebidasVENTA" 
SET categoria = 'Champagnes'
WHERE categoria ILIKE 'CHAMPAGNE%';

UPDATE "BebidasVENTA" 
SET categoria = 'Cavas'
WHERE categoria ILIKE 'CAVAS%';

UPDATE "BebidasVENTA" 
SET categoria = 'Espumosos'
WHERE categoria ILIKE '%ESPUMOSOS%' AND categoria NOT ILIKE 'CAVAS%';