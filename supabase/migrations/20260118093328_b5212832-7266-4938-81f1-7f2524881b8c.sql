-- Añadir campos para personalización de novedades en la web
ALTER TABLE public.novedades 
ADD COLUMN IF NOT EXISTS badge_text TEXT,
ADD COLUMN IF NOT EXISTS icono TEXT DEFAULT 'utensils';

-- Comentarios para documentar
COMMENT ON COLUMN public.novedades.badge_text IS 'Texto del badge que aparece en la tarjeta (ej: Nuevo, Promo, -20%)';
COMMENT ON COLUMN public.novedades.icono IS 'Icono de Lucide a mostrar (utensils, wine, gift, calendar, star, etc.)';