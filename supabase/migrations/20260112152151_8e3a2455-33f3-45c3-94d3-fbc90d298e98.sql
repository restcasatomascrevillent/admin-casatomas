-- Crear tabla de suscriptores del newsletter
CREATE TABLE public.newsletter_suscriptores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nombre TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.newsletter_suscriptores ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Usuarios autenticados pueden ver suscriptores"
ON public.newsletter_suscriptores
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar suscriptores"
ON public.newsletter_suscriptores
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden actualizar suscriptores"
ON public.newsletter_suscriptores
FOR UPDATE
TO authenticated
USING (true);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_newsletter_suscriptores_updated_at
BEFORE UPDATE ON public.newsletter_suscriptores
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Función para agregar suscriptor desde reserva
CREATE OR REPLACE FUNCTION public.agregar_suscriptor_desde_reserva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.newsletter_suscriptores (email, nombre)
  VALUES (NEW.email, NEW.nombre)
  ON CONFLICT (email) DO UPDATE SET
    nombre = COALESCE(EXCLUDED.nombre, newsletter_suscriptores.nombre),
    updated_at = now();
  
  RETURN NEW;
END;
$$;

-- Trigger en la tabla reservas
CREATE TRIGGER agregar_suscriptor_al_reservar
AFTER INSERT ON public.reservas
FOR EACH ROW
WHEN (NEW.email IS NOT NULL AND NEW.email != '')
EXECUTE FUNCTION public.agregar_suscriptor_desde_reserva();

-- Migrar emails existentes de reservas
INSERT INTO public.newsletter_suscriptores (email, nombre)
SELECT DISTINCT ON (email) email, nombre
FROM public.reservas
WHERE email IS NOT NULL AND email != ''
ON CONFLICT (email) DO NOTHING;

-- Crear tabla para historial de envíos
CREATE TABLE public.newsletter_envios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  total_destinatarios INTEGER NOT NULL DEFAULT 0,
  enviado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS para historial
ALTER TABLE public.newsletter_envios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver historial de envíos"
ON public.newsletter_envios
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar envíos"
ON public.newsletter_envios
FOR INSERT
TO authenticated
WITH CHECK (true);