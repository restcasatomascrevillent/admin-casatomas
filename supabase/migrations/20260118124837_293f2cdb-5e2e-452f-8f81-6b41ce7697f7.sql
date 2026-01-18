-- Añadir columnas de traducción para bullets, tags y badge_text
ALTER TABLE public.novedades 
ADD COLUMN IF NOT EXISTS bullets_en text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS bullets_fr text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tags_en text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tags_fr text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS badge_text_en text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS badge_text_fr text DEFAULT NULL;