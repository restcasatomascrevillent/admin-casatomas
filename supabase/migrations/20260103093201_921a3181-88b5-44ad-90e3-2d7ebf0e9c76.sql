-- Crear tabla de configuración de turnos
CREATE TABLE public.configuracion_turnos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre_periodo text NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  intervalo_base_minutos integer NOT NULL DEFAULT 30,
  umbral_apertura_secundario integer NOT NULL DEFAULT 70,
  dias_semana integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  activo boolean NOT NULL DEFAULT true,
  espacio_id uuid REFERENCES public.espacios_reserva(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear índice para búsquedas por espacio
CREATE INDEX idx_configuracion_turnos_espacio ON public.configuracion_turnos(espacio_id);

-- Habilitar RLS
ALTER TABLE public.configuracion_turnos ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Usuarios autenticados pueden ver configuración de turnos"
ON public.configuracion_turnos
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins pueden crear configuración de turnos"
ON public.configuracion_turnos
FOR INSERT
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden actualizar configuración de turnos"
ON public.configuracion_turnos
FOR UPDATE
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden eliminar configuración de turnos"
ON public.configuracion_turnos
FOR DELETE
USING (public.is_admin(auth.uid()));

-- Trigger para updated_at
CREATE TRIGGER update_configuracion_turnos_updated_at
BEFORE UPDATE ON public.configuracion_turnos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insertar datos iniciales (configuración global)
INSERT INTO public.configuracion_turnos (nombre_periodo, hora_inicio, hora_fin, intervalo_base_minutos, umbral_apertura_secundario, dias_semana, activo)
VALUES 
  ('Comida', '13:00', '17:00', 30, 70, ARRAY[0,1,2,3,4,5,6], true),
  ('Cena', '20:00', '00:00', 30, 70, ARRAY[0,1,2,3,4,5,6], true);