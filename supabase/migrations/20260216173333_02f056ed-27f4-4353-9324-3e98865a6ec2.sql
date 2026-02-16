
-- General reservation settings (singleton table)
CREATE TABLE public.configuracion_reservas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Cutoff: minutes before service start that web reservations close
  minutos_corte_antes_servicio integer NOT NULL DEFAULT 60,
  -- Max reservations per phone per day
  max_reservas_por_telefono_dia integer NOT NULL DEFAULT 2,
  -- Max reservations per email per day
  max_reservas_por_email_dia integer NOT NULL DEFAULT 2,
  -- Max guests per single reservation
  max_comensales_por_reserva integer NOT NULL DEFAULT 12,
  -- Min guests per reservation
  min_comensales_por_reserva integer NOT NULL DEFAULT 1,
  -- Max advance days for booking
  dias_max_antelacion integer NOT NULL DEFAULT 60,
  -- Require phone for reservations
  telefono_obligatorio boolean NOT NULL DEFAULT true,
  -- Require email for reservations
  email_obligatorio boolean NOT NULL DEFAULT false,
  -- Auto-confirm reservations (skip pendiente)
  auto_confirmar boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.configuracion_reservas ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read config
CREATE POLICY "Authenticated users can read configuracion_reservas"
  ON public.configuracion_reservas FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can modify config
CREATE POLICY "Admins can manage configuracion_reservas"
  ON public.configuracion_reservas FOR ALL
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Public can read config (needed for public reservation form cutoff checks)
CREATE POLICY "Public can read configuracion_reservas"
  ON public.configuracion_reservas FOR SELECT
  USING (true);

-- Insert default row
INSERT INTO public.configuracion_reservas (id) VALUES (gen_random_uuid());

-- Trigger for updated_at
CREATE TRIGGER update_configuracion_reservas_updated_at
  BEFORE UPDATE ON public.configuracion_reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
