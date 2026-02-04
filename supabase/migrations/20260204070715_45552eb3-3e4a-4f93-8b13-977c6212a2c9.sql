-- Añadir campo precio_coste a BebidasVENTA
ALTER TABLE "BebidasVENTA"
ADD COLUMN precio_coste numeric DEFAULT NULL;

-- Añadir campo precio_coste a ComidaVENTA
ALTER TABLE "ComidaVENTA"
ADD COLUMN precio_coste numeric DEFAULT NULL;

-- Comentarios descriptivos
COMMENT ON COLUMN "BebidasVENTA".precio_coste IS 'Precio de coste del producto para calcular rentabilidad';
COMMENT ON COLUMN "ComidaVENTA".precio_coste IS 'Precio de coste del producto para calcular rentabilidad';