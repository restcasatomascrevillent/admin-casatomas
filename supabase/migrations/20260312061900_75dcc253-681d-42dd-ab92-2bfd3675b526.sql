
ALTER TABLE "Platos" ADD COLUMN IF NOT EXISTS ingredientes text;
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS ingredientes text;
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS expanded boolean DEFAULT false;
